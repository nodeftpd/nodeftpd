var net = require('net');
var util = require('util');
var events = require('events');
var PathModule = require('path');
var FsModule = require('fs');
var glob = require('./glob');
var tls = require('tls');
var crypto = require('crypto');
var starttls = require('./starttls');
var dateformat = require('dateformat');

/*
TODO:
- Implement Full RFC 959
- Implement Full RFC 2228 [PBSZ and PROT implemented already]
- Implement RFC 3659

- passive command is for server to determine which port it listens on and report that to the client
- doesn't necessarily mean it needs to be listening (i guess), but i assume it actually SHOULD be listening
- it keeps listening for subsequent connections

- what sort of security should i enforce? should i require the same IP for data and control connections?
    - maybe just for milesplit's use?
*/

function withCwd(cwd, p) {
    if (! p) return cwd;
    else if (! cwd) return p;
    else if (p.charAt(0) == "/") return p;
    else return PathModule.join(cwd, p);
}

// Currently used for stripping options from beginning of argument to LIST and NLST.
function stripOptions(str) {
    var IN_SPACE = 0, IN_DASH = 1;
    var state = IN_SPACE;
    for (var i = 0; i < str.length; ++i) {
        var c = str.charAt(i);
        if (state == IN_SPACE) {
            if (c == ' ' || c == '\t')
                ;
            else if (c == '-')
                state = IN_DASH;
            else
                return str.substr(i);
        }
        else if (state == IN_DASH && (c == ' ' || c == '\t')) {
            state = IN_SPACE;
        }
    }
    return "";
}

function PassiveListener() {
    events.EventEmitter.call(this);
}
util.inherits(PassiveListener, process.EventEmitter);

// We don't want to use setEncoding because it screws up TLS, but we
// also don't want to explicity specify ASCII encoding for every call to 'write'
// with a string argument.
function wwenc(socket, data, callback) {
    return socket.write(data, 'ascii', callback);
}

function FtpServer(host, options) {
    var self = this;
    events.EventEmitter.call(this);

    this.host = host;

    this.options = options;

    this.server = net.createServer();
    this.getInitialCwd = options.getInitialCwd || function () { return "/"; };
    this.getUsernameFromUid = options.getUsernameFromUid || function (uid, c) { c(null, "ftp"); };
    this.getGroupFromGid = options.getGroupFromGid || function (gid, c) { c(null, "ftp"); }
    this.getRoot = options.getRoot || function () { return "/"; };
    this.debugging = options.logLevel || 0;
    this.uploadMaxSlurpSize = options.uploadMaxSlurpSize || 0;

    this.server.on('connection', function (socket) { self._onConnection(socket); });
}
util.inherits(FtpServer, process.EventEmitter);

FtpServer.prototype._onConnection = function (socket) {
    var conn = new FtpConnection({
        server: this,
        socket: socket,
        passive: false,
        dataHost: null,
        dataPort: 20, // default
        dataListener: null, // for incoming passive connections
        dataSocket: null, // the actual data socket
        mode: "ascii",
        filefrom: "",
        authFailures: 0, // 3 tries then we disconnect you
        temp: null,
        username: null,
        totsize: 0,
        filename: "",
        fs: null,
        path: null,
        cwd: null,
        root: null,
        hasQuit: false,
        
        // State for handling TLS upgrades.
        secure: false,
        pbszReceived: false
    });

    this.emit("client:connected", conn); // pass client info so they can listen for client-specific events

    socket.setTimeout(0);
    socket.setNoDelay();

    socket.on('connect', function () { conn._onConnect(); });
    socket.on('data', function (buf) { conn._onData(buf); });
    socket.on('end', function () { conn._onEnd(); });
    socket.on('error', function (err) { conn.onError(err); });
};

["listen", "close"].forEach(function (fname) {
    FtpServer.prototype[fname] = function () {
        return this.server[fname].apply(this.server, arguments);
    }
});

FtpServer.prototype._logIf = function (level, message, conn, isError) {
    if (this.debugging >= level) {
        if (conn)
            console.log((conn & conn.socket ? conn.socket.remoteAddress + ": " : "") + message);
        else
            console.log(message);
        
        if (isError) {
            console.trace("Trace follows");
        }
    }
};
FtpServer.prototype._traceIf = function (level, message, conn) { return this.logIf(level, message, conn, true); };

function FtpConnection(properties) {
    events.EventEmitter.call(this);
    for (k in properties) { this[k] = properties[k]; }
}
util.inherits(FtpConnection, process.EventEmitter);

FtpConnection.prototype._logIf = function (level, message, conn, isError) { return this.server._logIf(level, message, conn, isError); };
FtpConnection.prototype._traceIf = function (level, message, conn) { return this.server._traceIf(level, message, conn); };

FtpConnection.prototype._authenticated = function () {
    return !!this.username;
};

FtpConnection.prototype._authFailures = function () {
    if (this.authFailures >= 2) {
        this.socket.end();
        return true;
    }
    return false;
};

FtpConnection.prototype._closeDataConnections = function () {
    if (this.dataListener)
        this.dataListener.close();
    if (this.dataSocket)
        this.dataSocket.end();
};

FtpConnection.prototype._createPassiveServer = function () {
    var self = this;

    this.pasv = net.createServer(function (psocket) {
        self._logIf(1, "Passive data event: connect", self);

        if (self.secure) {
            self._logIf(1, "Upgrading passive connection to TLS");
            starttls.starttlsServer(psocket, self.server.options.tlsOptions, function (err, cleartext) {
                if (err) {
                    self._logIf(0, "Error upgrading passive connection to TLS:" + util.inspect(err));
                    psocket.end();
                }
                else if (! cleartext.authorized) {
                    if (self.server.options.allowUnauthorizedTls) {
                        self._logIf(0, "Allowing unauthorized passive connection (allowUnauthorizedTls==true)");
                        switchToSecure();
                    }
                    else {
                        self._logIf(0, "Closing unauthorized passive connection (allowUnauthorizedTls==false)");
                        self.socket.end();
                    }
                }
                else {
                    switchToSecure();
                }
                
                function switchToSecure() {
                    self._logIf(1, "Secure passive connection started");
                    self.dataSocket = cleartext;
                    setupPassiveListener();
                }
            });
        }
        else {
            self.dataSocket = psocket;
            setupPassiveListener();
        }

        function setupPassiveListener() {
            self.passive.emit('ready');
            
            self.dataSocket.on("end", function () {
                self._logIf(3, "Passive data event: end", self);
                self.dataSocket = null;
            });
            self.dataSocket.on("error", function(err) {
                self._logIf(0, "Passive data event: error: " + err, self);
                self.dataSocket = null;
            });
            self.dataSocket.on("close", function(had_error) {
                self._logIf(
                    (had_error ? 0 : 3),
                    "Passive data event: close " + (had_error ? " due to error" : ""),
                    self.socket
                );
            });
        }
    });
};

FtpConnection.prototype._whenDataReady = function (callback) {
    var self = this;

    if (self.passive) {
        // how many data connections are allowed?
        // should still be listening since we created a server, right?
        if (self.dataSocket) {
            self._logIf(3, "A data connection exists", self);
            callback(self.dataSocket);
        } else {
            self._logIf(3, "Currently no data connection; expecting client to connect to pasv server shortly...", self);
            self.passive.once('ready', function () {
                self._logIf(3, "...client has connected now");
                callback(self.dataSocket);
            });
        }
    } else {
        // Do we need to open the data connection?
        if (self.dataSocket) { // There really shouldn't be an existing connection
            self._logIf(3, "Using existing non-passive dataSocket", self);
            callback(self.dataSocket);
        } else {
            // This branch of the conditional used to contain code for reopening the passive connection.
            // Currently removed because it needs to be updated to handle TLS, and I'm not sure how
            // to trigger this branch in testing as of yet. (Maybe it's not even necessary?)
            self._logIf(3, "No passive connection");
            wwenc(self.socket, "425 Can't open data connection (not in passive mode)\r\n");
        }
    }
};

FtpConnection.prototype._onError = function () {
    this._logIf(0, "Client connection error: " + err, this.socket);
    this.socket.destroy();
};

FtpConnection.prototype._onEnd = function () {
    this._logIf(1, "Client connection ended", this.socket);
};

FtpConnection.prototype._onConnect = function () {
    this._logIf(1, "Connection", this);
    wwenc(this.socket, "220 FTP server (nodeftpd) ready\r\n");
};

var NOT_SUPPORTED = { }; // (But recognized)
[ 'ABOR', 'ACCT', 'ADAT', 'ALLO', 'APPE', 'CCC',
  'CONF', 'ENC', 'HELP', 'LANG', 'LPRT', 'LPSV',
  'MDTM', 'MIC', 'MLSD', 'MLST', 'MODE', 'OPTS',
  'REIN', 'SITE', 'SMNT', 'STOU', 'STRU', 'SYST'
].forEach(function (ns) { NOT_SUPPORTED[ns] = true; });

// Whitelist of commands which don't require authentication.
// All other commands send by unauthorized users will be rejected by default.
var DOES_NOT_REQUIRE_AUTH = { };
[ 'AUTH', 'FEAT', 'NOOP', 'PASS', 'PBSZ', 'PROT', 'QUIT',
  'TYPE', 'USER'
].forEach(function (c) { DOES_NOT_REQUIRE_AUTH[c] = true; });

var TLS_ONLY_ERROR = "530 This server does not permit login over a non-secure connection; " +
                     "connect using FTP-SSL with explicit AUTH TLS\r\n";
                    
FtpConnection.prototype._onData = function (data) {
    var self = this;

    if (self.hasQuit)
        return;

    data = data.toString('utf-8').trim();
    // Don't want to include passwords in logs.
    self._logIf(2, "FTP command: " + data.toString('utf-8').replace(/^PASS\s+.*/, 'PASS ***'), self);

    var command, arg;
    var index = data.indexOf(" ");
    if (index > 0) {
        command = data.substring(0, index).trim().toUpperCase();
        commandArg = data.substring(index+1, data.length).trim();
    } else {
        command = data.trim().toUpperCase();
        commandArg = '';
    }

    var m = '_command_' + command;
    if (self[m]) {
        if (DOES_NOT_REQUIRE_AUTH[command]) {
            self[m](commandArg, command);
        }
        else {
            if (self._authenticated())
                self[m](commandArg, command);
            else
                wwenc(self.socket, "530 User not logged in\r\n");
        }
    }
    else if (NOT_SUPPORTED[command]) {
        wwenc(self.socket, "202 Not supported\r\n");
    }
    else {
        wwenc(self.socket, "202 Not recognized\r\n");
    }
};

FtpConnection.prototype._command_AUTH = function (commandArg) {
    var self = this;

    if (! self.server.options.tlsOptions)
        return wwenc(self.socket, "202 Not supported\r\n");
    if (commandArg != "TLS")
        return wwenc(self.socket, "500 Not recognized\r\n");
    
    wwenc(self.socket, "234 Honored\r\n", function () {
        self._logIf(0, "Establishing secure connection...");
        starttls.starttlsServer(self.socket, self.server.options.tlsOptions, function (err, cleartext) {
            if (err) {
                self._logIf(0, "Error upgrading connection to TLS: " + util.inspect(err));
                self.socket.end();
            }
            else if (! cleartext.authorized) {
                self._logIf(0, "Secure socket not authorized: " + util.inspect(cleartext.authorizationError));
                if (self.server.options.allowUnauthorizedTls) {
                    self._logIf(0, "Allowing unauthorized connection (allowUnauthorizedTls==true)");
                    switchToSecure();
                }
                else {
                    self._logIf(0, "Closing unauthorized connection (allowUnauthorizedTls==false)");
                    sekf.socket.end();
                }
            }
            else {
                switchToSecure();
            }
            
            function switchToSecure() {
                self._logIf(1, "Secure connection started");
                self.socket = cleartext;
                self.socket.on('data', function (data) { self._onData(data); });
                self.secure = true;
            }
        });
    });
};

FtpConnection.prototype._command_CDUP = function (commandArg)  {
    // Change to Parent Directory.
    // Not sure if this is technically correct, but 'dirname' does in fact just
    // strip the last component of the path for a UNIX-style path, even if this
    // has a trailing slash. It also maps "/foo" to "/" and "/" to "/".
    this.cwd = PathModule.dirname(this.cwd);
    wwenc(this.socket, "250 Directory changed to " + this.cwd + "\r\n");
};

FtpConnection.prototype._command_CWD = function (commandArg) {
    var self = this;

    var path = withCwd(self.cwd, commandArg);
    var fspath = PathModule.join(self.root, path);
    self.fs.exists(fspath, function(exists) {
        if (!exists) {
            wwenc(self.socket, "550 Folder not found.\r\n");
            return;
        }
        self.cwd = path;
        wwenc(self.socket, "250 CWD successful. \"" + self.cwd + "\" is current directory\r\n");
    });
};

FtpConnection.prototype._command_DELE = function (commandArg) {
    var self = this;

    var filename = withCwd(self.cwd, commandArg);
    self.fs.unlink( PathModule.join(self.root, filename), function(err){
        if (err) {
            self._logIf(0, "Error deleting file: " + filename + ", "+err, self);
            // write error to socket
            wwenc(self.socket, "550 Permission denied\r\n");
        } else {
            wwenc(self.socket, "250 File deleted\r\n");
        }
    });
};

FtpConnection.prototype._command_EPTR = function (commandArg) {
    // Specifies an extended address and port to which the server should connect. (RFC 2428)
    var addr = commandArg.split("|");
    if (addr.length != 5 || addr[1] != "1" ||
        !addr[2].match(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/) ||
        !addr[3].match(/^\d+/)) {
        wwenc(this.socket, "202 Not supported\r\n");
    }
    else {
        this.dataHost = addr[2];
        this.dataPort = parseInt(addr[3]);
        wwenc(this.socket, "200 EPRT command successful.\r\n");
    }
};

FtpConnection.prototype._command_FEAT = function (commandArg) {
    // Get the feature list implemented by the server. (RFC 2389)
    wwenc(this.socket,
          "211-Features\r\n" +
          " SIZE\r\n" +
          (!this.server.options.tlsOptions ? "" :
           " AUTH TLS\r\n" +
           " PBSZ\r\n" +
           " PROT\r\n") +
          "211 end\r\n");
};

FtpConnection.prototype._command_LIST = function (commandArg) {
    var self = this;

    // LIST may be passed options (-a in particular). We just ignore any of these.
    // (In the particular case of -a, we show hidden files anyway.)
    var dirname = stripOptions(commandArg);

    wwenc(self.socket, "150 Here comes the directory listing\r\n", function () {
        self._whenDataReady( function(pasvconn) {
            var leftPad = function(text, width) {
                var out = '';
                for (var j = text.length; j < width; j++) out += ' ';
                out += text;
                return out;
            };
            var success = function() {
                wwenc(self.socket, "226 Transfer OK\r\n");
                pasvconn.end();
            };
            self._logIf(3, "Sending file list", self);
            var dir = withCwd(self.cwd, dirname);
            self.fs.readdir(PathModule.join(self.root, dir), function(err, files) {
                if (err) {
                    self._logIf(0, "While sending file list, reading directory: " + err, self);
                    wwenc(self.socket, "550 Not a directory\r\n");
                    pasvconn.end();
                } else {
                    self._logIf(3, "Directory has " + files.length + " files", self);
                    var count = 0;
                    function writelast() { 
                        // write the last bit, so we can know when it's finished
                        wwenc(pasvconn, "\r\n", success);
                    }
                    
                    // Could use the Seq library here, but since it's not used anywhere else, seems
                    // a bit unnecessary. This requests file stats in parallel to degree AT_ONCE.
                    var i = 0, count = 0;
                    var AT_ONCE = self.server.options.maxStatsAtOnce || 5;
                    var lines = new Array(files.length);
                    for (; i < AT_ONCE && i < files.length; ++i) {
                        doStat(files[i], i);
                    }
                    if (files.length == 0) finishStat();
                    
                    function doStat(file, li) {
                        self.fs.stat(PathModule.join(self.root, dir, file), function (err, s) {
                            // An error could conceivably occur here if e.g. the file gets deleted
                            // in between the call to readdir and stat. Not really sure what a sensible
                            // thing to do would be in this sort of scenario. At the moment, we just
                            // pretend that the file doesn't exist in this case.
                            if (err) {
                                self._logIf(0, "Weird failure of 'stat' " + err, self);
                                next();
                            }
                            else {
                                self.server.getUsernameFromUid(s.uid, function (e1, uname) { self.server.getGroupFromGid(s.gid, function (e2, gname) {
                                    if (e1) self._logIf(0, "While attempting to get username: " + e1, self);
                                    if (e2) self._logIf(0, "While attempting to get group:" + e2, self);
                                    lines[li] = s.isDirectory() ? 'd' : '-';
                                    lines[li] += (0400 & s.mode) ? 'r' : '-';
                                    lines[li] += (0200 & s.mode) ? 'w' : '-';
                                    lines[li] += (0100 & s.mode) ? 'x' : '-';
                                    lines[li] += (040 & s.mode) ? 'r' : '-';
                                    lines[li] += (020 & s.mode) ? 'w' : '-';
                                    lines[li] += (010 & s.mode) ? 'x' : '-';
                                    lines[li] += (04 & s.mode) ? 'r' : '-';
                                    lines[li] += (02 & s.mode) ? 'w' : '-';
                                    lines[li] += (01 & s.mode) ? 'x' : '-';
                                    lines[li] += " 1 " + (e1 ? "ftp" : uname) + " " +
                                        (e2 ? "ftp" : gname) + " ";
                                    lines[li] += leftPad(s.size.toString(), 12) + ' ';
                                    var d = new Date(s.mtime);
                                    lines[li] += leftPad(dateformat(d, 'mmm dd HH:MM'), 12) + ' ';
                                    lines[li] += file;
                                    
                                    next();
                                }) });
                            }
                            
                            function next() {
                                ++count;
                                if (i < files.length) {
                                    doStat(files[i], i);
                                    ++i;
                                }
                                else if (count == files.length) {
                                    finishStat();
                                }
                            }
                        });
                    }
                    function finishStat() {
                        wwenc(pasvconn, lines.join('\r\n'));
                        // write the last bit, so we can know when it's finished
                        wwenc(pasvconn, "\r\n", success);
                    }
                }
            });
        });
    });
};

FtpConnection.prototype._command_MKD = function (commandArg) {
    var self = this;

    var filename = withCwd(self.cwd, commandArg);
    self.fs.mkdir( PathModule.join(self.root, filename), 0755, function(err){
        if(err) {
            self._logIf(0, "Error making directory " + filename + " because " + err, self);
            // write error to socket
            wwenc(self.socket, "550 \"" + filename + "\" directory NOT created\r\n");
            return;
        }
        wwenc(self.socket, "257 \"" + filename + "\" directory created\r\n");
    });
};

FtpConnection.prototype._command_NLST = function (commandArg) {
    var self = this;

    /*
      Normally the server responds with a mark using code 150. It then stops accepting new connections, attempts to send the contents of the directory over the data connection, and closes the data connection. Finally it
      
      accepts the LIST or NLST request with code 226 if the entire directory was successfully transmitted;
      rejects the LIST or NLST request with code 425 if no TCP connection was established;
      rejects the LIST or NLST request with code 426 if the TCP connection was established but then broken by the client or by network failure; or
      rejects the LIST or NLST request with code 451 if the server had trouble reading the directory from disk.
      
      The server may reject the LIST or NLST request (with code 450 or 550) without first responding with a mark. In this case the server does not touch the data connection.
    */
    
    var dirname = stripOptions(commandArg);
    
    wwenc(self.socket, "150 Here comes the directory listing\r\n", function () {
        self._whenDataReady( function(pasvconn) {
            var success = function() {
                wwenc(self.socket, "226 Transfer OK\r\n");
                pasvconn.end();
            };
            // Use temporary filesystem path maker since a path might be sent with NLST
            var temp = '';
            if (dirname) {
                // Remove double slashes or "up directory"
                dirname = dirname.replace(/\/{2,}|\.{2}/g, '');
                if (dirname.substr(0, 1) == '/') {
                    temp = dirname;
                } else {
                    temp = withCwd(self.cwd, dirname);
                }
            } else temp = self.cwd;
            self._logIf(3, "Sending file list", self);
            
            glob.glob(PathModule.join(self.root, temp), self.fs, function(err, files) {
                if (err) {
                    self._logIf(0, "During NLST, error globbing files: " + err, self);
                    wwenc(self.socket, "451 Read error\r\n");
                    pasvconn.end();
                    return;
                }
                self._logIf(3, "Directory has " + files.length + " files", self);
                wwenc(pasvconn, files.map(PathModule.basename).join("\015\012") + "\015\012", success);
            });
        });
    });
};

FtpConnection.prototype._command_NOOP = function () {
    // No operation (dummy packet; used mostly on keepalives).
    wwenc(this.socket, "200 OK\r\n");
};

FtpConnection.prototype._command_PASS = function () {
    var self = this;

    if (self.server.options.tlsOnly && !self.secure) {
        return wwenc(self.socket, TLS_ONLY_ERROR);
    }

    // Authentication password.
    self.emit(
        "command:pass",
        commandArg,
        function(username, userFsModule) { // implementor should call this on successful password check
            wwenc(self.socket, "230 Logged on\r\n");
            self.username = username;
            if (userFsModule)
                self.fs = userFsModule;
            else
                self.fs = FsModule;
            self.cwd = self.server.getInitialCwd(username);
            self.root = self.server.getRoot(username);
        },
        function() { // call second callback if password incorrect
            wwenc(self.socket, "530 Invalid password\r\n");
            self.authFailures++;
            self.username = null;
        }
    );
};

FtpConnection.prototype._command_PASV = function (x, y) { this._PASV(x, y); };
FtpConnection.prototype._command_EPASV = function (x, y) { this._PASV(x, y); };
FtpConnection.prototype._PASV = function (commandArg, command) {
    var self = this;

    if (command == "EPSV" && commandArg && commandArg != "1") {
        wwenc(self.socket, "202 Not supported\r\n");
        return;
    }

    // not sure whether the spec limits to 1 data connection at a time ...
    if (self.dataListener) self.dataListener.close(); // we're creating a new listener
    if (self.dataSocket) self.dataSocket.end(); // close any existing connections
    self.dataListener = null;
    self.dataSocket = null;

    var pasv = self._createPassiveServer();
    var portRangeErrorHandler;
    function normalErrorHandler(e) {
        self._logIf(3, "Error with passive data listener: " + util.inspect(e), self);
    }
    if (self.server.options.pasvPortRangeStart && self.server.options.pasvPortRangeEnd) {
        // Keep trying ports in the range supplied until either:
        //     (i)   It works
        //     (ii)  We get an error that's not just EADDRINUSE
        //     (iii) We run out of ports to try.
        var i = self.server.options.pasvPortRangeStart;
        self.pasv.listen(i);
        portRangeErrorHandler = function (e) {
            if (e.code == 'EADDRINUSE' && i < self.server.options.pasvPortRangeEnd)
                self.pasv.listen(++i);
        };
        self.pasv.on('error', portRangeErrorHandler);
    }
    else {
        self.pasv.listen(0);
        self.pasv.on('error', normalErrorHandler);
    }
    self.dataListener = pasv;
    // Once we're successfully listening, tell the client
    self.pasv.on("listening", function() {
        if (portRangeErrorHandler) {
            self.pasv.removeListener('error', portRangeErrorHandler);
            self.pasv.addListener('error', normalErrorHandler);
        }

        self._logIf(3, "Passive data connection beginning to listen", self);

        var port = self.pasv.address().port;
        var host = self.server.host;
        self.passive = new PassiveListener();
        self.dataHost = host;
        self.dataPort = port;
        self._logIf(3, "Passive data connection listening on port " + port, self);
        if (command == "PASV") {
            var i1 = parseInt(port / 256);
            var i2 = parseInt(port % 256);
            self._logIf(0, "227 Entering Passive Mode (" + host.split(".").join(",") + "," + i1 + "," + i2 + ") [=" + host + ":" + port + "]\r\n", self);
            wwenc(self.socket, "227 Entering Passive Mode (" + host.split(".").join(",") + "," + i1 + "," + i2 + ")\r\n");
        }
        else if (command == "EPSV") {
            wwenc(self.socket, "229 Entering Extended Passive Mode (|||" + port + "|)\r\n");
        }
    });
    self.pasv.on("close", function() {
        self._logIf(3, "Passive data listener closed", self);
    });
};

FtpConnection.prototype._command_PBSZ = function (commandArg) {
    var self = this;

    if (! self.server.options.tlsOptions)
        return wwenc(socket, "202 Not supported\r\n");
    
    // Protection Buffer Size (RFC 2228)
    if (! self.secure) {
        wwenc(self.socket, "503 Secure connection not established\r\n");
    }
    else if (parseInt(commandArg) != 0) {
        // RFC 2228 specifies that a 200 reply must be sent specifying a more
        // satisfactory PBSZ size (0 in our case, since we're using TLS).
        // Doubt that this will do any good if the client was already confused
        // enough to send a non-zero value, but ok...
        self.pbszReceived = true;
        wwenc(self.socket, "200 buffer too big, PBSZ=0\r\n");
    }
    else {
        self.pbszReceived = true;
        wwenc(self.socket, "200 OK\r\n");
    }
};

FtpConnection.prototype._command_PROT = function (commandArg) {
    var self = this;

    if (! self.server.options.tlsOptions)
        return wwenc(self.socket, "202 Not supported\r\n");
    
    if (! self.pbszReceived) {
        wwenc(self.socket, "503 No PBSZ command received\r\n");
    }
    else if (commandArg == 'S' || commandArg == 'E' || commandArg == 'C') {
        wwenc(self.socket, "536 Not supported\r\n");
    }
    else if (commandArg == 'P') {
        wwenc(self.socket, "200 OK\r\n");
    }
    else {
        // Don't even recognize this one...
        wwenc(self.socket, "504 Not recognized\r\n");
    }
};

FtpConnection.prototype._command_PWD = function (commandArg) {
    // Print working directory. Returns the current directory of the host.
    wwenc(this.socket, "257 \"" + this.cwd + "\" is current directory\r\n");
};

FtpConnection.prototype._command_QUIT = function (commandArg) {
    var self = this;

    self.hasQuit = true;
    wwenc(self.socket, "221 Goodbye\r\n", function (err) {
        if (err)
            self._logIf(0, "Error writing 'Goodbye' message following QUIT", err);                       
        self.socket.end();
        self._closeDataConnections();
    });
};

FtpConnection.prototype._command_RETR = function (commandArg) {
    var self = this;

    // Retrieve (download) a remote file.
    wwenc(self.socket, "150 Opening " + self.mode.toUpperCase() + " mode data connection\r\n", function () {
        self._whenDataReady( function(pasvconn) {
            var filename = PathModule.join(self.root, commandArg);
            if(filename != self.filename)
            {
                self.totsize = 0;
                self.filename = filename;
            }
            
            if (self.server.options.slurpFiles) {
                self.fs.readFile(self.filename, function (err, contents) {
                    if (err) {
                        if (err.code == 'ENOENT') {
                            wwenc(self.socket, "550 Not Found\r\n");
                        }
                        else { // Who knows what's going on here...
                            wwenc(self.socket, "550 Not Accessible\r\n");
                            self._traceIf(0, "Error at read other than ENOENT " + err, self);
                        }
                    }
                    else {
                        // TODO: This conditional was in the original code. Seems like there should also be
                        // an 'else'. What do do here?
                        if (pasvconn.readyState == 'open') {
                            pasvconn.write(contents);
                            wwenc(self.socket, "226 Closing data connection, sent " + self.totsize + " bytes\r\n");
                            pasvconn.end();
                        }
                    }
                });
            }
            else {
                self.fs.open(self.filename, "r", function (err, fd) {
                    self._logIf(0, "DATA file " + self.filename + " opened", self);
                    function readChunk() {
                        if (! self.buffer) self.buffer = new Buffer(4096);
                        self.fs.read(fd, self.buffer, 0, 4096, null/*pos*/, function(err, bytesRead, buffer) {
                            if(err) {
                                self._traceIf(0, "Error reading chunk", self);
                                self.server.emit("error", err);
                                return;
                            }
                            if (bytesRead > 0) {
                                self.totsize += bytesRead;
                                if(pasvconn.readyState == "open") pasvconn.write(self.buffer.slice(0, bytesRead));
                                readChunk();
                            }
                            else {
                                self._logIf(0, "DATA file " + self.filename + " closed", self);
                                pasvconn.end();
                                wwenc(self.socket, "226 Closing data connection, sent " + self.totsize + " bytes\r\n");
                                self.fs.close(fd, function (err) {
                                    if (err) self.server.emit("error", err);
                                    self.totsize = 0;
                                });
                            }
                        });
                    }
                    if(err) {
                        if (err.code == 'ENOENT') {
                            wwenc(self.socket, "550 Not Found\r\n");
                        }
                        else { // Who know's what's going on here...
                            wwenc(self.socket, "550 Not Accessible\r\n");
                            self._traceIf(0, "Error at read other than ENOENT " + err, self);
                        }
                    }
                    else {
                        readChunk();
                    }
                });
            }
        });
    });
};

FtpConnection.prototype._command_RMD = function (commandArg) {
    var self = this;

    var filename = withCwd(self.cwd, commandArg);
    self.fs.rmdir( PathModule.join(self.root, filename), function(err){
        if(err) {
            self._logIf(0, "Error removing directory " + filename, self.socket);
            wwenc(self.socket, "550 Delete operation failed\r\n");
        } else
            wwenc(self.socket, "250 \"" + filename + "\" directory removed\r\n");
    });
};

FtpConnection.prototype._command_RNFR = function (commandArg) {
    var self = this;

    self.filefrom = withCwd(self.cwd, commandArg);
    console.log("RNFR[" + self.filefrom + "]");
    self._logIf(3, "Rename from " + self.filefrom, self.socket);
    self.fs.exists( PathModule.join(self.root, self.filefrom), function(exists) {
        if (exists) wwenc(self.socket, "350 File exists, ready for destination name\r\n");
        else wwenc(self.socket, "350 Command failed, file does not exist\r\n");
    });
};

FtpConnection.prototype._command_RNTO = function (commandArg) {
    var self = this;

    var fileto = withCwd(self.cwd, commandArg);
    self.fs.rename( PathModule.join(self.root, self.filefrom), PathModule.join(self.root, fileto), function(err){
        if(err) {
            self._logIf(3, "Error renaming file from " + self.filefrom + " to " + fileto, self.socket);
            wwenc(self.socket, "550 Rename failed\r\n");
        } else {
            wwenc(self.socket, "250 File renamed successfully\r\n");
        }
    });
};

FtpConnection.prototype._command_SIZE = function (commandArg) {
    var self = this;

    var filename = withCwd(self.cwd, commandArg);
    self.fs.stat( PathModule.join(self.root, filename), function (err, s) {
        if(err) { 
            self._traceIf(0, "Error getting size of file: " + filename, self.socket);
            wwenc(self.socket, "450 Failed to get size of file\r\n");
            return;
        }
        wwenc(self.socket, "213 " + s.size + "\r\n");
    });
};

FtpConnection.prototype._command_TYPE = function (commandArg) {
    if (commandArg == "I" || commandArg == "A")
        wwenc(this.socket, "200 OK\r\n");
    else
        wwenc(this.socket, "202 Not supported\r\n");
};

FtpConnection.prototype._command_STOR = function (commandArg) {
    var self = this;

    var filename = withCwd(self.cwd, commandArg);
    var fd;
    self.fs.open( PathModule.join(self.root, filename), 'w', 0644, function(err, fd_) {
        fd = fd_;
        if(err) {
            self._traceIf(0, 'Error opening/creating file: ' + filename, self.socket);
            wwenc(self.socket, "553 Could not create file\r\n");
            self.dataSocket.end();
            return;
        }
        self._logIf(3, "File opened/created: " + filename, self.socket);
        self._logIf(3, "Told client ok to send file data", self.socket);

        wwenc(self.socket, "150 Ok to send data\r\n", function () {
            self._whenDataReady(handleUpload);
        });
    });

    function handleUpload(dataSocket) {
        var erroredOut = false;
        self.dataSocket.on('data', dataHandler);
        var slurpBuf;
        if (self.server.uploadMaxSlurpSize > 0) {
            self._logIf(0, "Allocating slurp buffer for upload");
            slurpBuf = new Buffer(1024);
        }
        var totalBytes = 0;
        function dataHandler (buf) {
            if (slurpBuf && totalBytes + buf.length <= self.server.uploadMaxSlurpSize) {
                if (totalBytes + buf.length > slurpBuf.length) {
                    var newLength = slurpBuf.length * 2;
                    if (newLength > self.server.uploadMaxSlurpSize)
                        newLength = self.server.uploadMaxSlurpSize;
                    if (newLength < totalBytes + buf.length)
                        newLength = totalBytes + buf.length;

                    var newSlurpBuf = new Buffer(newLength);
                    slurpBuf.copy(newSlurpBuf, 0, 0, totalBytes);
                    slurpBuf = newSlurpBuf;
                }
                buf.copy(slurpBuf, totalBytes, 0, buf.length);
                totalBytes += buf.length;
            }
            else {
                if (totalBytes > 0) {
                    writeBuf(slurpBuf, totalBytes);
                    slurpBuf = null;
                }
                writeBuf(buf, buf.length);

                var writeError = false;
                function writeBuf(wbuf, upto) {
                    if (writeError) return;

                    self.fs.write(fd, buf, 0, upto, null, function (err) {
                        if (err) {
                            writeError = true;
                            self.dataSocket.removeListener('data', dataHandler);
                            self.fs.close(fd, function (err) {
                                self._logIf(0, "Error closing file following write error", err);
                            });
                            wwenc(self.socket, "426 Connection closed; transfer aborted\r\n");
                        }
                    });
                }
            }
        }
        self.dataSocket.once('error', function (buf) {
            erroredOut = true;
            self.fs.close(fd, function (err) {
                if (err) {
                    self.dataSocket.removeListener('data', dataHandler);
                    self._logIf(0, "Error closing file following error on dataSocket", err);
                    wwenc(self.socket, "426 Connection closed; transfer aborted\r\n");
                }
            });
        });
        self.dataSocket.once('end', function (buf) {
            if (erroredOut)
                return;

            self.dataSocket.removeListener('data', dataHandler);
            
            // If we kept it all in the slurp buffer, finally write it out.
            if (slurpBuf) {
                self._logIf(0, "Writing out file from slurp buffer");
                self.fs.write(fd, slurpBuf, 0, totalBytes, null, function (err) {
                    if (err) {
                        self._logIf(0, "Error writing slurp buffer to file following 'end' message", err);
                        wwenc(self.socket, "426 Connection closed; transfer aborted\r\n");
                        return;
                    }
                    
                    onceOnDisk();
                });
            }
            else {
                onceOnDisk();
            }
            
            function onceOnDisk() {
                self.fs.close(fd, function (err) {
                    if (err) {
                        self._logIf(0, "Error closing file following 'end' message", err);
                        wwenc(self.socket, "426 Connection closed; transfer aborted\r\n");
                        return;
                    }
                    
                    wwenc(self.socket, "226 Closing data connection\r\n");
                });
            }
        });
    }
};

FtpConnection.prototype._command_USER = function (commandArg) {
    var self = this;

    if (self.server.options.tlsOnly && !self.secure) {
        return wwenc(self.socket, TLS_ONLY_ERROR);
    }

    // Authentication username.
    self.emit(
        "command:user",
        commandArg,
        function() { // implementor should call this on successful password check
            wwenc(self.socket, "331 Password required for " + commandArg + "\r\n");
        },
        function() { // call second callback if password incorrect
            wwenc(self.socket, "530 Invalid username: " + commandArg + "\r\n");
        }
    );
};

exports.FtpServer = FtpServer;

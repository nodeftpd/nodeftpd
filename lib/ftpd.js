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

// Currently used for stripping options from beginning of argument to LIST.
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
        else if (state == IN_DASH) {
            if (c == ' ' || c == '\t')
                state = IN_SPACE;
        }
    }
    return "";
}

function FtpConnection(properties) {
    events.EventEmitter.call(this);
    for (k in properties) { this[k] = properties[k]; }
}
util.inherits(FtpConnection, process.EventEmitter);

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

// host
//     an IP address.
//
// options.getInitialCwd
//     a function which, given a username, returns an initial CWD.
//
// options.getRoot
//     a function which, given a username, returns a root directory (user cannot get
//     outside of this dir). The default is a function which returns "/" as the root
//     dir for all users.
//
// options.slurpFiles
//     if set to true, files which the client requests to download are slurped using
//     readFile before being sent, rather than being read chunk-by-chunk.
//
// options.uploadMaxSlurpSize
//     determines the maximum file size (in bytes) for which uploads are buffered in memory
//     before being written to disk using a single call to 'write'. Bigger
//     uploads are written chunk-by-chunk via multiple calls to 'write'. The
//     default is 0 (all uploads are written chunk-by-chunk).
//
// options.tlsOptions
//     if this is set, the server will be FTPS. Value should be a dictionary
//     which is suitable as the 'options' argument of tls.createServer.
//
// options.allowUnauthorizedTls
//     if this is set to true, the server will allow a connection to continue even
//     if verifyError() returns a non-null value.
//
//
// The server raises a 'command:pass' event which is given 'pass', 'success' and
// 'failure' arguments. On successful login, 'success' should be called with a
// username argument. It may also optionally be given a second argument, which
// should be an object providing an implementation of the API for Node's 'fs'
// module. The following must be implemented:
//
//     fs
//         unlink
//         readdir
//         mkdir
//         open
//         read
//         close
//         rmdir
//         rename
//         stat -> { mode, isDirectory, size, mtime }
//         write
//         exists
// 
function FtpServer(host, options) {
    var self = this;

    if (false === (this instanceof FtpServer)) {
        return new FtpServer(host, options);
    }
    events.EventEmitter.call(this);

    // make sure host is an IP address, otherwise DATA connections will likely break
    this.server = net.createServer();
    this.getInitialCwd = options.getInitialCwd || function () { return "/"; };
    this.getUsernameFromUid = options.getUsernameFromUid || function (uid, c) { c(null, "ftp"); };
    this.getGroupFromGid = options.getGroupFromGid || function (gid, c) { c(null, "ftp"); }
    this.getRoot = options.getRoot || function () { return "/"; };
    this.debugging = options.logLevel || 0;
    this.uploadMaxSlurpSize = options.uploadMaxSlurpSize || 0;

    function logIf(level, message, conn, isError) {
        if (self.debugging >= level) {
            if (conn)
                console.log((conn & conn.socket ? conn.socket.remoteAddress + ": " : "") + message);
            else
                console.log(message);

            if (isError) {
                console.trace("Trace follows");
            }
        }
    };
    function traceIf(level, message, conn) { return logIf(level, message, conn, true); }

    this.server.on("error", function (err) {
        logIf(0, "Server error: " + err);
    });
    this.server.on("listening", function() {
        logIf(0, "nodeFTPd server up and ready for connections");
    });

    var socket;
    var conn;
    this.server.on('connection', function(socket_) {
        socket = socket_;
        conn = new FtpConnection({
            socket: socket_,
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

        self.emit("client:connected", conn); // pass client info so they can listen for client-specific events

        socket.setTimeout(0);
        socket.setNoDelay();

//        logIf(0, "Base FTP directory: "+conn.fs.cwd());

        var authenticated = function() {
            // send a message if not authenticated?
            return (conn.username ? true : false);
        };

        var authFailures = function() {
            if (conn.authFailures >= 2) {
                socket.end();
                return true;
            }
            return false;
        };

        var closeDataConnections = function() {
            if (conn.dataListener) conn.dataListener.close(); // we're creating a new listener
            if (conn.dataSocket) conn.dataSocket.end(); // close any existing connections
        };

        function createPassiveServer() {
            return net.createServer(function (psocket) {
                logIf(1, "Passive data event: connect", conn);
                
                if (conn.secure) {
                    logIf(1, "Upgrading passive connection to TLS");
                    starttls.starttlsServer(psocket, options.tlsOptions, function (err, cleartext) {
                        if (err) {
                            logIf(0, "Error upgrading passive connection to TLS:" + util.inspect(err));
                            psocket.end();
                        }
                        else if (! cleartext.authorized) {
                            if (options.allowUnauthorizedTls) {
                                logIf(0, "Allowing unauthorized passive connection (allowUnauthorizedTls==true)");
                                switchToSecure();
                            }
                            else {
                                logIf(0, "Closing unauthorized passive connection (allowUnauthorizedTls==false)");
                                socket.end();
                            }
                        }
                        else {
                            switchToSecure();
                        }
                        
                        function switchToSecure() {
                            logIf(1, "Secure passive connection started");
                            conn.dataSocket = cleartext;
                            setupPassiveListener();
                        }
                    });
                }
                else {
                    conn.dataSocket = psocket;
                    setupPassiveListener();
                }
                
                function setupPassiveListener() {
//                    conn.dataSocket.buffers = [];
                    conn.passive.emit('ready');
                    
                    conn.dataSocket.on("end", function () {
                        logIf(3, "Passive data event: end", conn);
                        conn.dataSocket = null;
                    });
                    conn.dataSocket.addListener("error", function(err) {
                        logIf(0, "Passive data event: error: " + err, conn);
                        conn.dataSocket = null;
                    });
                    conn.dataSocket.addListener("close", function(had_error) {
                        logIf(
                            (had_error ? 0 : 3),
                            "Passive data event: close " + (had_error ? " due to error" : ""),
                            socket
                        );
                    });
                }
            });
        }
                                        
        // Purpose of this is to ensure a valid data connection, and run the callback when it's ready
        function whenDataReady(callback) {
            if (conn.passive) {
                // how many data connections are allowed?
                // should still be listening since we created a server, right?
                if (conn.dataSocket) {
                    logIf(3, "A data connection exists", conn);
                    callback(conn.dataSocket);
                } else {
                    logIf(3, "Currently no data connection; expecting client to connect to pasv server shortly...", conn);
                    conn.passive.once('ready', function () {
                        logIf(3, "...client has connected now");
                        callback(conn.dataSocket);
                    });
                }
            } else {
                // Do we need to open the data connection?
                if (conn.dataSocket) { // There really shouldn't be an existing connection
                    logIf(3, "Using existing non-passive dataSocket", conn);
                    callback(conn.dataSocket);
                } else {
                    // This branch of the conditional used to contain code for reopening the passive connection.
                    // Currently removed because it needs to be updated to handle TLS, and I'm not sure how
                    // to trigger this branch in testing as of yet. (Maybe it's not even necessary?)
                    logIf(3, "No passive connection");
                    wwenc(socket, "425 Can't open data connection (not in passive mode)\r\n");
                }
            }
        };

        socket.addListener("connect", function () {
            logIf(1, "Connection", conn);
            //wwenc(socket, "220 NodeFTPd Server version 0.0.10\r\n");
            //wwenc(socket, "220 written by Andrew Johnston (apjohnsto@gmail.com)\r\n");
            //wwenc(socket, "220 Please visit http://github.com/billywhizz/NodeFTPd\r\n");
            wwenc(socket, "220 FTP server (nodeftpd) ready\r\n");
        });
        
        socket.addListener("data", dataListener);
        function dataListener (data) {
            data = data.toString('utf-8');

            data = (data+'').trim();
            // Don't want to include passwords in logs.
            logIf(2, "FTP command: " + data.toString('utf-8').replace(/^PASS\s+.*/, 'PASS ***'), conn);

            var command, arg;
            var index = data.indexOf(" ");
            if (index > 0) {
                command = data.substring(0, index).trim().toUpperCase();
                commandArg = data.substring(index+1, data.length).trim();
            } else {
                command = data.trim().toUpperCase();
                commandArg = '';
            }

            // Special case. Keep connection open when NOOP follows QUIT.
            if (command == 'NOOP' && conn.hasQuit && socket.readable && socket.writable) {
                logIf(0, "QUIT undone by subsequent NOOP");
                conn.hasQuit = false;
                // Fall through to normal handling of NOOP in switch below.
            }
            else if (conn.hasQuit) {
                logIf(0, "Ignoring data received following QUIT");
                socket.end();
                return;
            }
            
            switch(command)
            {
            case "ABOR":
                // Abort an active file transfer.
                wwenc(socket, "202 Not supported\r\n");
                break;
            case "ACCT":
                // Account information
                wwenc(socket, "202 Not supported\r\n");
                break;
            case "ADAT":
                // Authentication/Security Data (RFC 2228)
                wwenc(socket, "202 Not supported\r\n");
                break;
            case "ALLO":
                // Allocate sufficient disk space to receive a file.
                wwenc(socket, "202 Not supported\r\n");
                break;
            case "APPE":
                // Append.
                wwenc(socket, "202 Not supported\r\n");
                break;
            case "AUTH":
                if (commandArg != "TLS") {
                    wwenc(socket, "500 Not recognized\r\n");
                }
                else {
                    wwenc(socket, "234 Honored\r\n", function () {
                        logIf(0, "Establishing secure connection...");
                        starttls.starttlsServer(socket, options.tlsOptions, function (err, cleartext) {
                            if (err) {
                                logIf(0, "Error upgrading connection to TLS: " + util.inspect(err));
                                socket.end();
                            }
                            else if (! cleartext.authorized) {
                                logIf(0, "Secure socket not authorized: " + util.inspect(cleartext.authorizationError));
                                if (options.allowUnauthorizedTls) {
                                    logIf(0, "Allowing unauthorized connection (allowUnauthorizedTls==true)");
                                    switchToSecure();
                                }
                                else {
                                    logIf(0, "Closing unauthorized connection (allowUnauthorizedTls==false)");
                                    socket.end();
                                }
                            }
                            else {
                                switchToSecure();
                            }

                            function switchToSecure() {
                                logIf(1, "Secure connection started");
                                conn.socket = cleartext;
                                socket = cleartext;
                                socket.addListener('data', dataListener);
                                conn.secure = true;
                            }
                        });
                    });
                }
                break;
            case "CCC":
                // Clear Command Channel (RFC 2228)
                wwenc(socket, "202 Not supported\r\n");
                break;
            case "CDUP":
                // Change to Parent Directory.
                if (!authenticated()) break;
                // Not sure if this is technically correct, but 'dirname' does in fact just
                // strip the last component of the path for a UNIX-style path, even if this
                // has a trailing slash. It also maps "/foo" to "/" and "/" to "/".
                conn.cwd = PathModule.dirname(conn.cwd);
                wwenc(socket, "250 Directory changed to " + conn.cwd + "\r\n");
                break;
            case "CONF":
                // Confidentiality Protection Command (RFC 697)
                wwenc(socket, "202 Not supported\r\n");
                break;
            case "CWD":
                // Change working directory.
                if (!authenticated()) break;
                var path = withCwd(conn.cwd, commandArg);
                var fspath = PathModule.join(conn.root, path);
                conn.fs.exists(fspath, function(exists) {
                    if (!exists) {
                        wwenc(socket, "550 Folder not found.\r\n");
                        return;
                    }
                    conn.cwd = path;
                    wwenc(socket, "250 CWD successful. \"" + conn.cwd + "\" is current directory\r\n");
                });
                break;
            case "DELE":
                // Delete file.
                if (!authenticated()) break;
                var filename = PathModule.join(conn.root, withCwd(conn.cwd, commandArg));
                conn.fs.unlink( filename, function(err){
                    if (err) {
                        logIf(0, "Error deleting file: "+filename+", "+err, conn);
                        // write error to socket
                        wwenc(socket, "550 Permission denied\r\n");
                    } else
                        wwenc(socket, "250 File deleted\r\n");
                });
                break;
            case "ENC":
                // Privacy Protected Channel (RFC 2228)
                wwenc(socket, "202 Not supported\r\n");
                break;
            case "EPRT":
                // Specifies an extended address and port to which the server should connect. (RFC 2428)
                var addr = commandArg.split("|");
                if (addr.length != 5 || addr[1] != "1" ||
                    !addr[2].match(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/) ||
                    !addr[3].match(/^\d+/)) {
                    wwenc(socket, "202 Not supported\r\n");
                }
                else {
                    conn.dataHost = addr[2];
                    conn.dataPort = parseInt(addr[3]);
                    wwenc(socket, "200 EPRT command successful.\r\n");
                }
                break;
            case "FEAT":
                // Get the feature list implemented by the server. (RFC 2389)
                wwenc(socket,
                      "211-Features\r\n" +
                      " SIZE\r\n" +
                      " AUTH TLS\r\n" +
                      " PBSZ\r\n" +
                      " PROT\r\n" +
                      "211 end\r\n");
                break;
            case "HELP":
                // Returns usage documentation on a command if specified, else a general help document is returned.
                /*
                        214-The following commands are recognized:
                        USER   PASS   QUIT   CWD    PDD    PORT   PASV   TYPE
                        LIST   REST   CDUP   RETR   STOR   SIZE   DELE   RMD
                        MKD    RNFR   RNTO   ABOR   SYST   NOOP   APPE   NLST
                        MDTM   XPWD   XCUP   XMKD   XRMD   NOP    EPSV   EPRT
                        AUTH   ADAT   PBSZ   PROT   FEAT   MODE   OPTS   HELP
                        ALLO   MLST   MLSD   SITE   P@SW   STRU   CLNT   MFMT
                        214 Have a nice day.		
                        */
                wwenc(socket, "202 Not supported\r\n");
                break;
            case "LANG":
                // Language Negotiation (RFC 2640)
                wwenc(socket, "202 Not supported\r\n");
                break;
            case "LIST":
                // Returns information of a file or directory if specified, else information of the current working directory is returned.
                if (!authenticated()) break;

                // LIST may be passed options (-a in particular). We just ignore any of these.
                // (In the particular case of -a, we show hidden files anyway.)
                var dirname = stripOptions(commandArg);

                wwenc(socket, "150 Here comes the directory listing\r\n", function () {
                    whenDataReady( function(pasvconn) {
                        var leftPad = function(text, width) {
                            var out = '';
                            for (var j = text.length; j < width; j++) out += ' ';
                            out += text;
                            return out;
                        };
                        var success = function() {
                            wwenc(socket, "226 Transfer OK\r\n");
                            pasvconn.end();
                        };
                        logIf(3, "Sending file list", conn);
                        var dir = withCwd(conn.cwd, dirname);
                        conn.fs.readdir(PathModule.join(conn.root, dir), function(err, files) {
                            if (err) {
                                logIf(0, "While sending file list, reading directory: " + err, conn);
                                wwenc(socket, "550 Not a directory\r\n");
                                pasvconn.end();
                            } else {
                                logIf(3, "Directory has " + files.length + " files", conn);
                                var count = 0;
                                function writelast() { 
                                    // write the last bit, so we can know when it's finished
                                    wwenc(pasvconn, "\r\n", success);
                                }
                                
                                // Could use the Seq library here, but since it's not used anywhere else, seems
                                // a bit unnecessary. This requests file stats in parallel to degree AT_ONCE.
                                var i = 0, count = 0;
                                var AT_ONCE = options.maxStatsAtOnce || 5;
                                var lines = new Array(files.length);
                                for (; i < AT_ONCE && i < files.length; ++i) {
                                    doStat(files[i], i);
                                }
                                if (files.length == 0) finishStat();
                                
                                function doStat(file, li) {
                                    conn.fs.stat(PathModule.join(conn.root, dir, file), function (err, s) {
                                        // An error could conceivably occur here if e.g. the file gets deleted
                                        // in between the call to readdir and stat. Not really sure what a sensible
                                        // thing to do would be in this sort of scenario. At the moment, we just
                                        // pretend that the file doesn't exist in this case.
                                        if (err) {
                                            logIf(0, "Weird failure of 'stat' " + err, conn);
                                            next();
                                        }
                                        else {
                                            self.getUsernameFromUid(s.uid, function (e1, uname) { self.getGroupFromGid(s.gid, function (e2, gname) {
                                                if (e1) logIf(0, "While attempting to get username: " + e1, conn);
                                                if (e2) logIf(0, "While attempting to get group:" + e2, conn);
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
                break;
            case "LPRT":
                // Specifies a long address and port to which the server should connect. (RFC 1639)
                wwenc(socket, "202 Not supported\r\n");
                break;
            case "LPSV":
                // Enter long passive mode. (RFC 1639)
                wwenc(socket, "202 Not supported\r\n");
                break;
            case "MDTM":
                // Return the last-modified time of a specified file. (RFC 3659)
                wwenc(socket, "202 Not supported\r\n");
                break;
            case "MIC":
                // Integrity Protected Command (RFC 2228)
                wwenc(socket, "202 Not supported\r\n");
                break;
            case "MKD":
                // Make directory.
                if (!authenticated()) break;
                var filename = PathModule.join(conn.root, withCwd(conn.cwd, commandArg));
                conn.fs.mkdir( filename, 0755, function(err){
                    if(err) {
                        logIf(0, "Error making directory " + filename + " because " + err, conn);
                        // write error to socket
                        wwenc(socket, "550 \""+filename+"\" directory NOT created\r\n");
                        return;
                    }
                    wwenc(socket, "257 \""+filename+"\" directory created\r\n");
                });
                break;
            case "MLSD":
                // Lists the contents of a directory if a directory is named. (RFC 3659)
                wwenc(socket, "202 Not supported\r\n");
                break;
            case "MLST":
                // Provides data about exactly the object named on its command line, and no others. (RFC 3659)
                wwenc(socket, "202 Not supported\r\n");
                break;
            case "MODE":
                // Sets the transfer mode (Stream, Block, or Compressed).
                wwenc(socket, "202 Not supported\r\n");
                break;
            case "NLST":
                // Returns a list of file names in a specified directory.
                if (!authenticated()) break;
                
                /*
                Normally the server responds with a mark using code 150. It then stops accepting new connections, attempts to send the contents of the directory over the data connection, and closes the data connection. Finally it

                    accepts the LIST or NLST request with code 226 if the entire directory was successfully transmitted;
                    rejects the LIST or NLST request with code 425 if no TCP connection was established;
                    rejects the LIST or NLST request with code 426 if the TCP connection was established but then broken by the client or by network failure; or
                    rejects the LIST or NLST request with code 451 if the server had trouble reading the directory from disk.

                The server may reject the LIST or NLST request (with code 450 or 550) without first responding with a mark. In this case the server does not touch the data connection.
                */

                var dirname = stripOptions(commandArg);

                wwenc(socket, "150 Here comes the directory listing\r\n", function () {
                    whenDataReady( function(pasvconn) {
                        var success = function() {
                            wwenc(socket, "226 Transfer OK\r\n");
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
                                temp = withCwd(conn.cwd, dirname);
                            }
                        } else temp = conn.cwd;
                        logIf(3, "Sending file list", conn);
                        
                        glob.glob(temp, conn.fs, function(err, files) {
                            if (err) {
                                logIf(0, "During NLST, error globbing files: " + err, conn);
                                wwenc(socket, "451 Read error\r\n");
                                pasvconn.end();
                                return;
                            }
                            logIf(3, "Directory has " + files.length + " files", conn);
                            wwenc(pasvconn, files.map(PathModule.basename).join("\015\012") + "\015\012", success);
                        });
                    });
                });
                break;
            case "NOOP":
                // No operation (dummy packet; used mostly on keepalives).
                wwenc(socket, "200 OK\r\n");
                break;
            case "OPTS":
                // Select options for a feature. (RFC 2389)
                wwenc(socket, "202 Not supported\r\n");
                break;
            case "PASS":
                // Authentication password.
                conn.emit(
                    "command:pass",
                    commandArg,
                    function(username, userFsModule) { // implementor should call this on successful password check
                        wwenc(socket, "230 Logged on\r\n");
                        conn.username = username;
                        if (userFsModule)
                            conn.fs = userFsModule;
                        else
                            conn.fs = FsModule;
                        conn.cwd = self.getInitialCwd(username);
                        conn.root = self.getRoot(username);
                    },
                    function() { // call second callback if password incorrect
                        wwenc(socket, "530 Invalid password\r\n");
                        conn.authFailures++;
                        conn.username = null;
                    }
                );
                break;
            case "PASV":
            case "EPSV":
                if (command == "EPSV" && commandArg && commandArg != "1") {
                    wwenc(socket, "202 Not supported\r\n");
                    break;
                }
                // Enter passive mode. This creates the listening socket.
                if (!authenticated()) break;
                // not sure whether the spec limits to 1 data connection at a time ...
                if (conn.dataListener) conn.dataListener.close(); // we're creating a new listener
                if (conn.dataSocket) conn.dataSocket.end(); // close any existing connections
                conn.dataListener = null;
                conn.dataSocket = null;
                // Passive listener needs to pause data because sometimes commands come before a data connection,
                // othertime afterwards ... depends on the client and threads
                var pasv = createPassiveServer();
                var portRangeErrorHandler;
                function normalErrorHandler(e) {
                    logIf(3, "Error with passive data listener: " + util.inspect(e), conn);
                }
                if (options.pasvPortRangeStart && options.pasvPortRangeEnd) {
                    // Keep trying ports in the range supplied until either:
                    //     (i)   It works
                    //     (ii)  We get an error that's not just EADDRINUSE
                    //     (iii) We run out of ports to try.
                    var i = options.pasvPortRangeStart;
                    pasv.listen(i);
                    portRangeErrorHandler = function (e) {
                        if (e.code == 'EADDRINUSE' && i < options.pasvPortRangeEnd)
                            pasv.listen(++i);
                    };
                    pasv.on('error', portRangeErrorHandler);
                }
                else {
                    pasv.listen(0);
                    pasv.on('error', normalErrorHandler);
                }
                conn.dataListener = pasv;
                // Once we're successfully listening, tell the client
                pasv.addListener("listening", function() {
                    if (portRangeErrorHandler) {
                        pasv.removeListener('error', portRangeErrorHandler);
                        pasv.addListener('error', normalErrorHandler);
                    }

                    logIf(3, "Passive data connection beginning to listen", conn);

                    var port = pasv.address().port;
                    conn.passive = new PassiveListener();
                    conn.dataHost = host;
                    conn.dataPort = port;
                    logIf(3, "Passive data connection listening on port " + port, conn);
                    if (command == "PASV") {
                        var i1 = parseInt(port / 256);
                        var i2 = parseInt(port % 256);
                        logIf(0, "227 Entering Passive Mode (" + host.split(".").join(",") + "," + i1 + "," + i2 + ") [=" + host + ":" + port + "]\r\n", conn);
                        wwenc(socket, "227 Entering Passive Mode (" + host.split(".").join(",") + "," + i1 + "," + i2 + ")\r\n");
                    }
                    else if (command == "EPSV") {
                        wwenc(socket, "229 Entering Extended Passive Mode (|||" + port + "|)\r\n");
                    }
                });
                pasv.on("close", function() {
                    logIf(3, "Passive data listener closed", conn);
                });
                break;
            case "PBSZ":
                // Protection Buffer Size (RFC 2228)
                if (! conn.secure) {
                    wwenc(socket, "503 Secure connection not established\r\n");
                }
                else if (parseInt(commandArg) != 0) {
                    // RFC 2228 specifies that a 200 reply must be sent specifying a more
                    // satisfactory PBSZ size (0 in our case, since we're using TLS).
                    // Doubt that this will do any good if the client was already confused
                    // enough to send a non-zero value, but ok...
                    conn.pbszReceived = true;
                    wwenc(socket, "200 buffer too big, PBSZ=0\r\n");
                }
                else {
                    conn.pbszReceived = true;
                    wwenc(socket, "200 OK\r\n");
                }
                break;
            case "PROT":
                if (! conn.pbszReceived) {
                    wwenc(socket, "503 No PBSZ command received\r\n");
                }
                else if (commandArg == 'S' || commandArg == 'E' || commandArg == 'C') {
                    wwenc(socket, "536 Not supported\r\n");
                }
                else if (commandArg == 'P') {
                    wwenc(socket, "200 OK\r\n");
                }
                else {
                    // Don't even recognize this one...
                    wwenc(socket, "504 Not recognized\r\n");
                }
                break;
            case "PORT":
                // Specifies an address and port to which the server should connect.
                if (!authenticated()) break;
                conn.passive = false;
                conn.dataSocket = null;
                var addr = commandArg.split(",");
                conn.dataHost= addr[0]+"."+addr[1]+"."+addr[2]+"."+addr[3];
                conn.dataPort = (parseInt(addr[4]) * 256) + parseInt(addr[5]);
                wwenc(socket, "200 PORT command successful.\r\n");
                break;
            case "PWD":
                // Print working directory. Returns the current directory of the host.
                if (!authenticated()) break;
                wwenc(socket, "257 \"" + conn.cwd + "\" is current directory\r\n");
                break;
            case "QUIT":
                // Cyberduck seems to like to send both QUIT and NOOP
                // following file uploads in a confused attempt to
                // keep the connection alive. (Or maybe there's some
                // bug in this code?)  So, we wait to see if we get a
                // NOOP following the QUIT, and close the socket on a
                // timeout.

                conn.hasQuit = true;
                wwenc(socket, "221 Goodbye\r\n", function (err) {
                    if (err)
                        logIf(0, "Error writing 'Goodbye' message following QUIT", err);                       

                    setTimeout(function () {
                        // In the meantime, the connection might have been re-opened by a NOOP,
                        // which will cause hasQuit to be set to false again.
                        if (conn.hasQuit && socket.readable && socket.writable) {
                            logIf(0, "Closing socket following QUIT");
                            socket.end();
                            closeDataConnections();
                        }
                    }, 10 * 1000);
                });
                break;
            case "REIN":
                // Re initializes the connection.
                wwenc(socket, "202 Not supported\r\n");
                break;
            case "REST":
                // Restart transfer from the specified point.
                if (!authenticated()) break;
                wwenc(socket, "202 Not supported\r\n");
                /*
                conn.totsize = parseInt(commandArg);
                wwenc(socket, "350 Rest supported. Restarting at " + conn.totsize + "\r\n");
                */
                break;
            case "RETR":
                // Retrieve (download) a remote file.
                wwenc(socket, "150 Opening " + conn.mode.toUpperCase() + " mode data connection\r\n", function () {
                    whenDataReady( function(pasvconn) {
                        var filename = PathModule.join(conn.root, commandArg);
                        if(filename != conn.filename)
                        {
                            conn.totsize = 0;
                            conn.filename = filename;
                        }
                        
                        if (options.slurpFiles) {
                            conn.fs.readFile(conn.filename, function (err, contents) {
                                if (err) {
                                    if (err.code == 'ENOENT') {
                                        wwenc(socket, "550 Not Found\r\n");
                                    }
                                    else { // Who knows what's going on here...
                                        wwenc(socket, "550 Not Accessible\r\n");
                                        traceIf(0, "Error at read other than ENOENT " + err, conn);
                                    }
                                }
                                else {
                                    // TODO: This conditional was in the original code. Seems like there should also be
                                    // an 'else'. What do do here?
                                    if (pasvconn.readyState == 'open')
                                        pasvconn.write(contents)
                                    pasvconn.end();
                                    wwenc(socket, "226 Closing data connection, sent " + conn.totsize + " bytes\r\n");
                                }
                            });
                        }
                        else {
                            conn.fs.open(conn.filename, "r", function (err, fd) {
                                logIf(0, "DATA file " + conn.filename + " opened", conn);
                                function readChunk() {
                                    if (! self.buffer) self.buffer = new Buffer(4096);
                                    conn.fs.read(fd, self.buffer, 0, 4096, null/*pos*/, function(err, bytesRead, buffer) {
                                        if(err) {
                                            traceIf(0, "Error reading chunk", conn);
                                            conn.emit("error", err);
                                            return;
                                        }
                                        if (bytesRead > 0) {
                                            conn.totsize += bytesRead;
                                            if(pasvconn.readyState == "open") pasvconn.write(self.buffer.slice(0, bytesRead));
                                            readChunk();
                                        }
                                        else {
                                            logIf(0, "DATA file " + conn.filename + " closed", conn);
                                            pasvconn.end();
                                            wwenc(socket, "226 Closing data connection, sent " + conn.totsize + " bytes\r\n");
                                            conn.fs.close(fd, function (err) {
                                                if (err) conn.emit("error", err);
                                                conn.totsize = 0;
                                            });
                                        }
                                    });
                                }
                                if(err) {
                                    if (err.code == 'ENOENT') {
                                        wwenc(socket, "550 Not Found\r\n");
                                    }
                                    else { // Who know's what's going on here...
                                        wwenc(socket, "550 Not Accessible\r\n");
                                        traceIf(0, "Error at read other than ENOENT " + err, conn);
                                    }
                                }
                                else {
                                    readChunk();
                                }
                            });
                        }
                    });
                });
                break;
            case "RMD":
                // Remove a directory.
                if (!authenticated()) break;
                var filename = PathModule.join(conn.root, withCwd(conn.cwd, commandArg));
                conn.fs.rmdir( filename, function(err){
                    if(err) {
                        logIf(0, "Error removing directory "+filename, socket);
                        wwenc(socket, "550 Delete operation failed\r\n");
                    } else
                        wwenc(socket, "250 \""+filename+"\" directory removed\r\n");
                });
                break;
            case "RNFR":
                // Rename from.
                if (!authenticated()) break;
                conn.filefrom = withCwd(conn.cwd, commandArg);
                logIf(3, "Rename from " + conn.filefrom, socket);
                conn.fs.exists( conn.filefrom, function(exists) {
                    if (exists) wwenc(socket, "350 File exists, ready for destination name\r\n");
                    else wwenc(socket, "350 Command failed, file does not exist\r\n");
                });
                break;
            case "RNTO":
                // Rename to.
                if (!authenticated()) break;
                var fileto = PathModule.join(conn.root, withCwd(conn.cwd, commandArg));
                conn.fs.rename( conn.filefrom, fileto, function(err){
                    if(err) {
                        logIf(3, "Error renaming file from "+conn.filefrom+" to "+fileto, socket);
                        wwenc(socket, "550 Rename failed\r\n");
                    } else
                        wwenc(socket, "250 File renamed successfully\r\n");
                });
                break;
            case "SITE":
                // Sends site specific commands to remote server.
                wwenc(socket, "202 Not supported\r\n");
                break;
            case "SIZE":
                // Return the size of a file. (RFC 3659)
                if (!authenticated()) break;
                var filename = PathModule.join(conn.root, withCwd(conn.cwd, commandArg));
                conn.fs.stat( filename, function (err, s) {
                    if(err) { 
                        traceIf(0, "Error getting size of file: "+filename, socket);
                        wwenc(socket, "450 Failed to get size of file\r\n");
                        return;
                    }
                    wwenc(socket, "213 " + s.size + "\r\n");
                });
                break;
            case "SMNT":
                // Mount file structure.
                wwenc(socket, "202 Not supported\r\n");
                break;
            case "STAT":
                // Returns the current status.
                
                /* from FileZilla
                        Connected to 192.168.2.100.
                        No proxy connection.
                        Mode: stream; Type: ascii; Form: non-print; Structure: file
                        Verbose: on; Bell: off; Prompting: on; Globbing: on
                        Store unique: off; Receive unique: off
                        Case: off; CR stripping: on
                        Ntrans: off
                        Nmap: off
                        Hash mark printing: off; Use of PORT cmds: on
                        Tick counter printing: off
                        */
                wwenc(socket, "202 Not supported\r\n");
                break;
            case "STOR":
                // Store (upload) a file.
                if (!authenticated()) break;
                
                var filename = PathModule.join(conn.root, withCwd(conn.cwd, commandArg));
                var fd;
                conn.fs.open( filename, 'w', 0644, function(err, fd_) {
                    fd = fd_;
                    if(err) {
                        traceIf(0, 'Error opening/creating file: ' + filename, socket);
                        wwenc(socket, "553 Could not create file\r\n");
                        dataSocket.end();
                        return;
                    }
                    logIf(3, "File opened/created: " + filename, socket);
                    logIf(3, "Told client ok to send file data", socket);

                    wwenc(socket, "150 Ok to send data\r\n", function () {
                        whenDataReady(handleUpload);
                    });
                });

                function handleUpload(dataSocket) {
                    var erroredOut = false;
                    dataSocket.on('data', dataHandler);
                    var slurpBuf;
                    if (self.uploadMaxSlurpSize > 0) {
                        logIf(0, "Allocating slurp buffer for upload");
                        slurpBuf = new Buffer(1024);
                    }
                    var totalBytes = 0;
                    function dataHandler (buf) {
                        if (slurpBuf && totalBytes + buf.length <= self.uploadMaxSlurpSize) {
                            if (totalBytes + buf.length > slurpBuf.length) {
                                var newLength = slurpBuf.length * 2;
                                if (newLength > self.uploadMaxSlurpSize)
                                    newLength = self.uploadMaxSlurpSize;
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

                                conn.fs.write(fd, buf, 0, upto, null, function (err) {
                                    if (err) {
                                        writeError = true;
                                        dataSocket.removeListener('data', dataHandler);
                                        conn.fs.close(fd, function (err) {
                                            logIf(0, "Error closing file following write error", err);
                                        });
                                        wwenc(socket, "426 Connection closed; transfer aborted\r\n");
                                    }
                                });
                            }
                        }
                    }
                    dataSocket.once('error', function (buf) {
                        erroredOut = true;
                        conn.fs.close(fd, function (err) {
                            if (err) {
                                dataSocket.removeListener('data', dataHandler);
                                logIf(0, "Error closing file following error on dataSocket", err);
                                wwenc(socket, "426 Connection closed; transfer aborted\r\n");
                            }
                        });
                    });
                    dataSocket.once('end', function (buf) {
                        if (erroredOut)
                            return;

                        dataSocket.removeListener('data', dataHandler);
                        
                        // If we kept it all in the slurp buffer, finally write it out.
                        if (slurpBuf) {
                            logIf(0, "Writing out file from slurp buffer");
                            conn.fs.write(fd, slurpBuf, 0, totalBytes, null, function (err) {
                                if (err) {
                                    logIf(0, "Error writing slurp buffer to file following 'end' message", err);
                                    wwenc(socket, "426 Connection closed; transfer aborted\r\n");
                                    return;
                                }
                                
                                onceOnDisk();
                            });
                        }
                        else {
                            onceOnDisk();
                        }
                        
                        function onceOnDisk() {
                            conn.fs.close(fd, function (err) {
                                if (err) {
                                    logIf(0, "Error closing file following 'end' message", err);
                                    wwenc(socket, "426 Connection closed; transfer aborted\r\n");
                                    return;
                                }
                                
                                wwenc(socket, "226 Closing data connection\r\n");
                            });
                        }
                    });
                }
                break;
            case "STOU":
                // Store file uniquely.
                wwenc(socket, "202 Not supported\r\n");
                break;
            case "STRU":
                // Set file transfer structure.
                wwenc(socket, "202 Not supported\r\n");
                break;
            case "SYST":
                // Return system type.
                wwenc(socket, "215 UNIX emulated by NodeFTPd\r\n");
                break;
            case "TYPE":
                // Sets the transfer mode (ASCII/Binary).
                if (!authenticated()) break;
                if(commandArg == "A"){
                    conn.mode = "ascii";
                    wwenc(socket, "200 Type set to A\r\n");			
                }
                else{
                    conn.mode = "binary";
                    wwenc(socket, "200 Type set to I\r\n");			
                }
                break;
            case "USER":
                // Authentication username.
                conn.emit(
                    "command:user",
                    commandArg,
                    function() { // implementor should call this on successful password check
                        wwenc(socket, "331 Password required for " + commandArg + "\r\n");
                    },
                    function() { // call second callback if password incorrect
                        wwenc(socket, "530 Invalid username: " + commandArg + "\r\n");
                    }
                );
                break;
            case "XPWD":
                // 
                wwenc(socket, "257 " + conn.cwd + " is the current directory\r\n");
                break;
            default:
                wwenc(socket, "202 Not supported\r\n");
                break;
            }
        }

        socket.addListener("end", endListener);
        function endListener () {
            logIf(1, "Client connection ended", socket);
        }
        socket.addListener("error", errorListener);
        function errorListener (err) {
            logIf(0, "Client connection error: " + err, socket);
            socket.destroy();
        }
    });

    this.server.addListener("close", function() {
        logIf(0, "Server closed");
    });
}
util.inherits(FtpServer, process.EventEmitter);

["listen", "close"].forEach(function (fname) {
    FtpServer.prototype[fname] = function () {
        return this.server[fname].apply(this.server, arguments);
    }
});

exports.FtpServer = FtpServer;

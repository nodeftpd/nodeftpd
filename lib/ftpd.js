var TRACE = false;

var net = require('net');
var util = require('util');
var events = require('events');
var pathModule = require('path');
var fsModule = require('fs');
var dateformat = require('dateformat');

var glob = require('./glob');
var starttls = require('./starttls');

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

function pathEscape(text) {
  text = text.replace(/\"/g, '""');
  return text;
}

function withCwd(cwd, path) {
  var firstChar = (path || '').charAt(0);
  cwd = cwd || pathModule.sep;
  path = path || '';
  if (firstChar === '/' || firstChar === pathModule.sep) {
    cwd = pathModule.sep;
  }
  path = pathModule.join(pathModule.sep, cwd, path);
  return path;
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
// also don't want to explicitly specify ASCII encoding for every call to 'write'
// with a string argument.
function wwenc(socket, data, callback) {
  logIf(TRACE, '>> ' + data.trim());
  return socket.write(data, 'ascii', callback);
}

function FtpServer(host, options) {
  var self = this;
  events.EventEmitter.call(self);

  self.host = host;

  self.options = options;

  if (!self.options.maxStatsAtOnce)
    self.options.maxStatsAtOnce = 5;

  if (!options.getInitialCwd)
    throw new Error("'getInitialCwd' option of FtpServer must be set");
  if (!options.getRoot)
    throw new Error("'getRoot' option of FtpServer must be set");
  self.getInitialCwd = options.getInitialCwd;
  self.getRoot = options.getRoot;

  self.getUsernameFromUid = options.getUsernameFromUid || function(uid, c) {
    c(null, "ftp");
  };
  self.getGroupFromGid = options.getGroupFromGid || function(gid, c) {
    c(null, "ftp");
  };
  self.debugging = options.logLevel || 0;
  self.useWriteFile = options.useWriteFile;
  self.useReadFile = options.useReadFile;
  self.uploadMaxSlurpSize = options.uploadMaxSlurpSize || 0;

  self.server = net.createServer();
  self.server.on('connection', function(socket) {
    self._onConnection(socket);
  });
  self.server.on('error', function(err) {
    self.emit('error', err);
  });
  self.server.on('close', function() {
    self.emit('close');
  });
}
util.inherits(FtpServer, process.EventEmitter);

FtpServer.prototype._onConnection = function(socket) {
  var conn = new FtpConnection({
    server: this,
    socket: socket,
    pasv: null, // passive listener server
    dataPort: 20,
    dataHost: null,
    dataListener: null, // for incoming passive connections
    dataSocket: null, // the actual data socket
    // True if the client has sent a PORT/PASV command, and
    // we haven't experienced a problem with the configuration
    // it specified. (This can therefore be true even if there
    // is not currently an open data connection.)
    dataConfigured: false,
    mode: "ascii",
    filefrom: "",
    username: null,
    filename: "",
    fs: null,
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

  this._logIf(1, "Connection");
  conn.respond("220 FTP server (nodeftpd) ready");

  socket.on('data', function(buf) {
    conn._onData(buf);
  });
  socket.on('end', function() {
    conn._onEnd();
  });
  socket.on('close', function() {
    conn._onClose();
  });
  socket.on('error', function(err) {
    conn._onError(err);
  });
};

["listen", "close"].forEach(function(fname) {
  FtpServer.prototype[fname] = function() {
    return this.server[fname].apply(this.server, arguments);
  };
});

FtpServer.prototype._logIf = function(level, message, conn, isError) {
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
FtpServer.prototype._traceIf = function(level, message, conn) {
  return this._logIf(level, message, conn, true);
};

function FtpConnection(properties) {
  events.EventEmitter.call(this);
  for (var k in properties) {
    this[k] = properties[k];
  }
}
util.inherits(FtpConnection, process.EventEmitter);

FtpConnection.prototype.respond = function(message, callback) {
    message += '\r\n';
    return wwenc(this.socket, message, callback);
};

FtpConnection.prototype._logIf = function(level, message, conn, isError) {
  return this.server._logIf(level, message, this, isError);
};
FtpConnection.prototype._traceIf = function(level, message, conn) {
  return this.server._traceIf(level, message, this);
};

FtpConnection.prototype._authenticated = function() {
  return !!this.username;
};

FtpConnection.prototype._closeDataConnections = function() {
  if (this.dataSocket)
    this.dataSocket.destroy();
  if (this.pasv)
    this.pasv.close();
};

FtpConnection.prototype._createPassiveServer = function() {
  var self = this;

  return net.createServer(function(psocket) {
    self._logIf(1, "Passive data event: connect");

    if (self.secure) {
      self._logIf(1, "Upgrading passive connection to TLS");
      starttls.starttlsServer(psocket, self.server.options.tlsOptions, function(err, cleartext) {
        if (err) {
          self._logIf(0, "Error upgrading passive connection to TLS:" + util.inspect(err));
          psocket.end();
          self.dataConfigured = false;
        }
        else if (!cleartext.authorized) {
          if (self.server.options.allowUnauthorizedTls) {
            self._logIf(0, "Allowing unauthorized passive connection (allowUnauthorizedTls==true)");
            switchToSecure();
          }
          else {
            self._logIf(0, "Closing unauthorized passive connection (allowUnauthorizedTls==false)");
            self.socket.end();
            self.dataConfigured = false;
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
      if (self.dataListener)
        self.dataListener.emit('ready');
      else
        self._logIf(0, "WARNING: Passive connection initiated, but no data listener");

      // Responses are not guaranteed to have an 'end' event
      // (https://github.com/joyent/node/issues/728), but we want to set
      // dataSocket to null as soon as possible, so we handle both events.
      self.dataSocket.on('close', allOver('close'));
      self.dataSocket.on('end', allOver('end'));
      function allOver(ename) {
        return function(err) {
          self._logIf(
              (err ? 0 : 3),
              "Passive data event: " + ename + (err ? " due to error" : "")
          );
          self.dataSocket = null;
        };
      }

      self.dataSocket.on("error", function(err) {
        self._logIf(0, "Passive data event: error: " + err);
        self.dataSocket = null;
        self.dataConfigured = false;
      });
    }
  });
};

FtpConnection.prototype._whenDataReady = function(callback) {
  var self = this;

  if (self.dataListener) {
    // how many data connections are allowed?
    // should still be listening since we created a server, right?
    if (self.dataSocket) {
      self._logIf(3, "A data connection exists");
      callback(self.dataSocket);
    } else {
      self._logIf(3, "Currently no data connection; expecting client to connect to pasv server shortly...");
      self.dataListener.once('ready', function() {
        self._logIf(3, "...client has connected now");
        callback(self.dataSocket);
      });
    }
  } else {
    // Do we need to open the data connection?
    if (self.dataSocket) { // There really shouldn't be an existing connection
      self._logIf(3, "Using existing non-passive dataSocket");
      callback(self.dataSocket);
    } else {
      self._initiateData(function(sock) {
        callback(sock);
      });
    }
  }
};

FtpConnection.prototype._initiateData = function(callback) {
  var self = this;

  if (self.dataSocket)
    return callback(self.dataSocket);

  var sock = net.connect(self.dataPort, self.dataHost || self.socket.remoteAddress);
  sock.on('connect', function() {
    self.dataSocket = sock;
    callback(sock);
  });
  sock.on('end', allOver);
  sock.on('close', allOver);
  function allOver(err) {
    self.dataSocket = null;
    self._logIf(err ? 0 : 3, "Non-passive data connection ended" + (err ? "due to error: " + util.inspect(err) : ""));
  }

  sock.on('error', function(err) {
    sock.destroy();
    self._logIf(0, "Data connection error: " + util.inspect(err));
    self.dataSocket = null;
    self.dataConfigured = false;
  });
};

FtpConnection.prototype._onError = function(err) {
  this._logIf(0, "Client connection error: " + util.inspect(err));
  this.socket.destroy();
};

FtpConnection.prototype._onEnd = function() {
  this._logIf(3, "Client connection ended");
};

FtpConnection.prototype._onClose = function() {
  this._logIf(0, "Client connection closed");
};

// Whitelist of commands which don't require authentication.
// All other commands sent by unauthorized users will be rejected by default.
var DOES_NOT_REQUIRE_AUTH = { };
[ 'AUTH', 'FEAT', 'NOOP', 'PASS', 'PBSZ', 'PROT', 'QUIT',
  'TYPE', 'SYST', 'USER'
].forEach(function(c) {
      DOES_NOT_REQUIRE_AUTH[c] = true;
    });

// Commands which can't be issued until a PASV/PORT command has been sent
// without an intervening data connection error.
var REQUIRES_CONFIGURED_DATA = { };
[ 'LIST', 'NLST', 'RETR', 'STOR' ]
    .forEach(function(c) {
      REQUIRES_CONFIGURED_DATA[c] = true;
    });

FtpConnection.prototype._onData = function(data) {
  var self = this;

  if (self.hasQuit)
    return;

  data = data.toString('utf-8').trim();
  logIf(TRACE, '<< ' + data.trim());
  // Don't want to include passwords in logs.
  self._logIf(2, "FTP command: " +
    data.toString('utf-8').replace(/^PASS [\s\S]*$/i, 'PASS ***')
  );

  var command, commandArg;
  var index = data.indexOf(" ");
  if (index > 0) {
    command = data.substring(0, index).trim().toUpperCase();
    commandArg = data.substring(index + 1, data.length).trim();
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
      // If 'tlsOnly' option is set, all commands which require user authentication will only
      // be permitted over a secure connection. See RFC4217 regarding error code.
      if (!self.secure && self.server.options.tlsOnly)
        self.respond("522 Protection level not sufficient; send AUTH TLS");
      else if (self._authenticated())
        checkData();
      else {
        self.respond('530 Not logged in.');
      }
    }

    function checkData() {
      if (REQUIRES_CONFIGURED_DATA[command] && !self.dataConfigured) {
        self.respond("425 Data connection not configured; send PASV or PORT");
        return;
      }

      self[m](commandArg, command);
    }
  }
  else {
    self.respond('502 Command not implemented.');
  }
  self.previousCommand = command;
};

/**
 * Specify the user's account (superfluous)
 * @return {FtpConnection} this
 */
FtpConnection.prototype._command_ACCT = function () {
  this.respond('202 Command not implemented, superfluous at this site.');
  return this;
};

/**
 * Allocate storage space (superfluous)
 * @return {FtpConnection} this
 */
FtpConnection.prototype._command_ALLO = function () {
  this.respond('202 Command not implemented, superfluous at this site.');
  return this;
};

FtpConnection.prototype._command_AUTH = function(commandArg) {
  var self = this;

  if (!self.server.options.tlsOptions)
    return self.respond("202 Not supported");
  if (commandArg != "TLS")
    return self.respond("500 Not recognized");

  self.respond("234 Honored", function() {
    self._logIf(0, "Establishing secure connection...");
    starttls.starttlsServer(self.socket, self.server.options.tlsOptions, function(err, cleartext) {
      if (err) {
        self._logIf(0, "Error upgrading connection to TLS: " + util.inspect(err));
        self.socket.end();
      }
      else if (!cleartext.authorized) {
        self._logIf(0, "Secure socket not authorized: " + util.inspect(cleartext.authorizationError));
        if (self.server.options.allowUnauthorizedTls) {
          self._logIf(0, "Allowing unauthorized connection (allowUnauthorizedTls==true)");
          switchToSecure();
        }
        else {
          self._logIf(0, "Closing unauthorized connection (allowUnauthorizedTls==false)");
          self.socket.end();
        }
      }
      else {
        switchToSecure();
      }

      function switchToSecure() {
        self._logIf(1, "Secure connection started");
        self.socket = cleartext;
        self.socket.on('data', function(data) {
          self._onData(data);
        });
        self.secure = true;
      }
    });
  });
};

/**
 * Change working directory to parent directory
 * @return {FtpConnection} this
 */
FtpConnection.prototype._command_CDUP = function () {
  var pathServer = pathModule.dirname(this.cwd);
  var pathEscaped = pathEscape(pathServer);
  this.cwd = pathServer;
  this.respond('250 Directory changed to "' + pathEscaped + '"');
  return this;
};

/**
 * Change working directory
 * @param {string} pathRequest
 * @return {FtpConnection} this
 */
FtpConnection.prototype._command_CWD = function (pathRequest) {
  var pathServer = withCwd(this.cwd, pathRequest);
  var pathFs = pathModule.join(this.root, pathServer);
  var pathEscaped = pathEscape(pathServer);
  this.fs.stat(pathFs, function (err, stats) {
    if (err) {
      this._logIf(0, 'ERROR: CWD ' + pathRequest + ': ' + err);
      this.respond("550 Directory not found.");
    } else if (!stats.isDirectory()) {
      this._logIf(3, 'Attempt to CWD to non-directory');
      this.respond('550 Not a directory');
    } else {
      this.cwd = pathServer;
      this.respond('250 CWD successful. "' + pathEscaped + '" is current directory');
    }
  }.bind(this));
  return this;
};

FtpConnection.prototype._command_DELE = function(commandArg) {
  var self = this;

  var filename = withCwd(self.cwd, commandArg);
  self.fs.unlink(pathModule.join(self.root, filename), function(err) {
    if (err) {
      self._logIf(0, "Error deleting file: " + filename + ", " + err);
      // write error to socket
      self.respond("550 Permission denied");
    } else {
      self.respond("250 File deleted");
    }
  });
};

FtpConnection.prototype._command_FEAT = function(commandArg) {
  // Get the feature list implemented by the server. (RFC 2389)
  this.respond(
      "211-Features\r\n" +
          " SIZE\r\n" +
          " MDTM\r\n" +
          (!this.server.options.tlsOptions ? "" :
              " AUTH TLS\r\n" +
                  " PBSZ\r\n" +
                  " PROT\r\n"
              ) +
          "211 end"
  );
};

/**
 * Print the file modification time
 * @param {string} file
 * @return {FtpConnection} this
 */
FtpConnection.prototype._command_MDTM = function (file) {
  file = withCwd(this.cwd, file);
  file = pathModule.join(this.root, file);
  this.fs.stat(file, function (err, stats) {
    if (err) {
      this.respond("550 File unavailable");
    } else {
      this.respond("213 " + dateformat(stats.mtime, "yyyymmddhhMMss"));
    }
  }.bind(this));
  return this;
};

FtpConnection.prototype._command_LIST = function(commandArg) {
  this._LIST(commandArg, true/*detailed*/, 'LIST');
};
FtpConnection.prototype._command_NLST = function(commandArg) {
  this._LIST(commandArg, false/*!detailed*/, 'NLST');
};

FtpConnection.prototype._command_STAT = function(commandArg) {
  if (commandArg) {
    this._LIST(commandArg, true/*detailed*/, 'STAT');
  }
  else {
    this.respond("211 FTP Server Status OK");
  }
};

FtpConnection.prototype._LIST = function(commandArg, detailed, cmd) {
  /*
   Normally the server responds with a mark using code 150. It then stops accepting new connections, attempts to send the contents of the directory over the data connection, and closes the data connection. Finally it

   accepts the LIST or NLST request with code 226 if the entire directory was successfully transmitted;
   rejects the LIST or NLST request with code 425 if no TCP connection was established;
   rejects the LIST or NLST request with code 426 if the TCP connection was established but then broken by the client or by network failure; or
   rejects the LIST or NLST request with code 451 if the server had trouble reading the directory from disk.

   The server may reject the LIST or NLST request (with code 450 or 550) without first responding with a mark. In this case the server does not touch the data connection.
   */

  var self = this;

  // LIST may be passed options (-a in particular). We just ignore any of these.
  // (In the particular case of -a, we show hidden files anyway.)
  var dirname = stripOptions(commandArg);
  var dir = withCwd(self.cwd, dirname);

  glob.setMaxStatsAtOnce(self.server.options.maxStatsAtOnce);
  glob.glob(pathModule.join(self.root, dir), self.fs, function(err, files) {
    if (err) {
      self._logIf(0, "While sending file list, reading directory: " + err);
      self.respond("550 Not a directory");
      return;
    }

    self._logIf(3, "Directory has " + files.length + " files");
    if (files.length == 0)
      return self._listFiles([], detailed, cmd);

    var fileInfos; // To contain list of files with info for each.

    if (!detailed) {
      // We're not doing a detailed listing, so we don't need to get username
      // and group name.
      fileInfos = files;
      return finished();
    }

    // Now we need to get username and group name for each file from user/group ids.
    fileInfos = [];

    var CONC = self.server.options.maxStatsAtOnce;
    var i = 0, j = 0;
    for (i = 0; i < files.length && i < CONC; ++i)
      handleFile(i);
    j = --i;

    function handleFile(ii) {
      if (i >= files.length)
        return i == files.length + j ? finished() : null;

      self.server.getUsernameFromUid(files[ii].stats.uid, function(e1, uname) {
        self.server.getGroupFromGid(files[ii].stats.gid, function(e2, gname) {
          if (e1 || e2) {
            self._logIf(3, "Error getting user/group name for file: " + util.inspect(e1 || e2));
            fileInfos.push({ file: files[ii],
              uname: null,
              gname: null });
          }
          else {
            fileInfos.push({ file: files[ii],
              uname: uname,
              gname: gname });
          }
          handleFile(++i);
        });
      });
    }

    function finished() {
      // Sort file names.
      if (!self.server.options.dontSortFilenames) {
        if (self.server.options.filenameSortMap !== false) {
          var sm = ( self.server.options.filenameSortMap ||
              function(x) {
                return x.toUpperCase();
              } );
          for (var i = 0; i < fileInfos.length; ++i)
            fileInfos[i]._s = sm(detailed ? fileInfos[i].file.name : fileInfos[i].name);
        }

        var sf = (self.server.options.filenameSortFunc ||
            function(x, y) {
              return x.localeCompare(y);
            });
        fileInfos = fileInfos.sort(function(x, y) {
          if (self.server.options.filenameSortMap !== false)
            return sf(x._s, y._s);
          else if (detailed)
            return sf(x.file.name, y.file.name);
          else
            return sf(x.name, y.name);
        });
      }

      self._listFiles(fileInfos, detailed, cmd);
    }
  }, self.server.options.noWildcards);
};

function leftPad(text, width) {
  var out = '';
  for (var j = text.length; j < width; j++) out += ' ';
  out += text;
  return out;
}

FtpConnection.prototype._listFiles = function(fileInfos, detailed, cmd) {
  var self = this;

  var m = "150 Here comes the directory listing";
  var BEGIN_MSGS = { LIST: m, NLST: m,
                     STAT: "213-Status follows" };
  m = "226 Transfer OK";
  var END_MSGS = { LIST: m, NLST: m,
                   STAT: "213 End of status" };

  self.respond(BEGIN_MSGS[cmd], function() {
    if (cmd == 'STAT')
      whenReady(self.socket);
    else
      self._whenDataReady(whenReady);

    function whenReady(listconn) {
      if (fileInfos.length == 0)
        return success();

      function success(err) {
        if (err)
          self.respond("550 Error listing files");
        else
          self.respond(END_MSGS[cmd]);
        if (cmd != 'STAT')
          listconn.end();
      }

      self._logIf(3, "Sending file list");

      for (var i = 0; i < fileInfos.length; ++i) {
        var fileInfo = fileInfos[i];

        var line = '';

        if (!detailed) {
          var file = fileInfo;
          line += file.name + '\r\n';
        }
        else {
          var file = fileInfo.file;
          var s = file.stats;
          line += s.isDirectory() ? 'd' : '-';
          line += (0400 & s.mode) ? 'r' : '-';
          line += (0200 & s.mode) ? 'w' : '-';
          line += (0100 & s.mode) ? 'x' : '-';
          line += (040 & s.mode) ? 'r' : '-';
          line += (020 & s.mode) ? 'w' : '-';
          line += (010 & s.mode) ? 'x' : '-';
          line += (04 & s.mode) ? 'r' : '-';
          line += (02 & s.mode) ? 'w' : '-';
          line += (01 & s.mode) ? 'x' : '-';
          line += " 1 " + (fileInfo.uname === null ? "ftp" : fileInfo.uname) + " " +
              (fileInfo.gname === null ? "ftp" : fileInfo.gname) + " ";
          line += leftPad(s.size.toString(), 12) + ' ';
          var d = new Date(s.mtime);
          line += leftPad(dateformat(d, 'mmm dd HH:MM'), 12) + ' ';
          line += file.name;
          line += '\r\n';
        }

        wwenc(listconn, line, (i == fileInfos.length - 1 ? success : undefined));
      }
    }
  });
};

/**
 * Create a directory
 * @param {string} pathRequest
 * @return {FtpConnection} this
 */
FtpConnection.prototype._command_MKD = function (pathRequest) {
  var pathServer = withCwd(this.cwd, pathRequest);
  var pathEscaped = pathEscape(pathServer);
  var pathFs = pathModule.join(this.root, pathServer);
  this.fs.mkdir(pathFs, 0755, function (err) {
    if (err) {
      this._logIf(0, 'ERROR: MKD ' + pathRequest + ': ' + err);
      this.respond('550 "' + pathEscaped + '" directory NOT created');
    } else {
      this.respond('257 "' + pathEscaped + '" directory created');
    }
  }.bind(this));
  return this;
};

/**
 * Perform a no-op (used to keep-alive connection)
 * @return {FtpConnection} this
 */
FtpConnection.prototype._command_NOOP = function () {
  this.respond('200 OK');
  return this;
};

FtpConnection.prototype._command_PORT = function(x, y) {
  this._PORT(x, y);
};
FtpConnection.prototype._command_EPRT = function(x, y) {
  this._PORT(x, y);
};
FtpConnection.prototype._PORT = function(commandArg, command) {
  var self = this;

  self.dataConfigured = false;

  var host, port;
  if (command == 'PORT') {
    var m = commandArg.match(/^([0-9]{1,3}),([0-9]{1,3}),([0-9]{1,3}),([0-9]{1,3}),([0-9]{1,3}),([0-9]{1,3})$/);
    if (!m) {
      self.respond("501 Bad argument to PORT");
      return;
    }

    var host = m[1] + '.' + m[2] + '.' + m[3] + '.' + m[4];
    var port = (parseInt(m[5]) << 8) + parseInt(m[6]);
    if (isNaN(port)) {
      // The value should never be NaN because the relevant groups in the regex matche 1-3 digits.
      throw new Error("Impossible NaN in FtpConnection.prototype._PORT");
    }
  }
  else { // EPRT
    if (commandArg.length >= 3 && commandArg.charAt(0) == '|' &&
        commandArg.charAt(2) == '|' && commandArg.charAt(1) == '2') {
      // Only IPv4 is supported.
      self.respond("522 Server cannot handle IPv6 EPRT commands, use (1)");
      return;
    }

    var m = commandArg.match(/^\|1\|([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})\|([0-9]{1,5})/);
    if (!m) {
      self.respond("501 Bad Argument to EPRT");
      return;
    }

    var r = parseInt(m[2]);
    if (isNaN(r)) {
      // The value should never be NaN because the relevant group in the regex matches 1-5 digits.
      throw new Error("Impossible NaN in FtpConnection.prototype._PORT (2)");
    }
    if (r > 65535 || r <= 0) {
      self.respond("501 Bad argument to EPRT (invalid port number)");
      return;
    }

    host = m[1];
    port = r;
  }

  self.dataConfigured = true;
  self.dataHost = host;
  self.dataPort = port;
  self._logIf(3, "self.dataHost, self.dataPort set to " + self.dataHost + ":" + self.dataPort);
  self.respond("200 OK");
};

FtpConnection.prototype._command_PASV = function(x, y) {
  this._PASV(x, y);
};
FtpConnection.prototype._command_EPSV = function(x, y) {
  this._PASV(x, y);
};
FtpConnection.prototype._PASV = function(commandArg, command) {
  var self = this;

  self.dataConfigured = false;

  if (command == "EPSV" && commandArg && commandArg != "1") {
    self.respond("202 Not supported");
    return;
  }

  // not sure whether the spec limits to 1 data connection at a time ...
  if (self.dataSocket) {
    self.dataSocket.end();
  }

  if (self.dataListener) {
    self._logIf(3, "Telling client that they can connect now");
    self._writePASVReady(command);
  }
  else {
    self._logIf(3, "Setting up listener for passive connections");
    self._setupNewPASV(commandArg, command);
  }

  self.dataConfigured = true;
};

FtpConnection.prototype._writePASVReady = function(command) {
  var self = this;

  var a = self.pasv.address();
  var host = self.server.host;
  var port = a.port;
  if (command == "PASV") {
    var i1 = (port / 256) | 0;
    var i2 = port % 256;
    self.respond("227 Entering Passive Mode (" + host.split(".").join(",") + "," + i1 + "," + i2 + ")");
  }
  else { // EPASV
    self.respond("229 Entering Extended Passive Mode (|||" + port + "|)");
  }
};

FtpConnection.prototype._setupNewPASV = function(commandArg, command) {
  var self = this;

  var pasv = self._createPassiveServer();
  var portRangeErrorHandler;

  function normalErrorHandler(e) {
    self._logIf(3, "Error with passive data listener: " + util.inspect(e));
    self.respond("421 Server was unable to open passive connection listener");
    self.dataConfigured = false;
    self.dataListener = null;
    self.dataSocket = null;
    self.pasv = null;
  }

  if (self.server.options.pasvPortRangeStart != null && self.server.options.pasvPortRangeEnd != null) {
    // Keep trying ports in the range supplied until either:
    //     (i)   It works
    //     (ii)  We get an error that's not just EADDRINUSE
    //     (iii) We run out of ports to try.
    var i = self.server.options.pasvPortRangeStart;
    pasv.listen(i);
    portRangeErrorHandler = function(e) {
      if (e.code == 'EADDRINUSE' && i < self.server.options.pasvPortRangeEnd) {
        pasv.listen(++i);
      }
      else {
        self._logIf(3, "Passing on error from portRangeErrorHandler to normalErrorHandler:" + JSON.stringify(e));
        normalErrorHandler(e);
      }
    };
    pasv.on('error', portRangeErrorHandler);
  }
  else {
    pasv.listen(0);
    pasv.on('error', normalErrorHandler);
  }

  // Once we're successfully listening, tell the client
  pasv.on("listening", function() {
    self.pasv = pasv;

    if (portRangeErrorHandler) {
      pasv.removeListener('error', portRangeErrorHandler);
      pasv.addListener('error', normalErrorHandler);
    }

    self._logIf(3, "Passive data connection beginning to listen");

    var port = pasv.address().port;
    var host = self.server.host;
    self.dataListener = new PassiveListener();
    self._logIf(3, "Passive data connection listening on port " + port);
    self._writePASVReady(command);
  });
  pasv.on("close", function() {
    self.pasv = null;
    self.dataListener = null;
    self._logIf(3, "Passive data listener closed");
  });
};

FtpConnection.prototype._command_PBSZ = function(commandArg) {
  var self = this;

  if (!self.server.options.tlsOptions)
    return self.respond("202 Not supported");

  // Protection Buffer Size (RFC 2228)
  if (!self.secure) {
    self.respond("503 Secure connection not established");
  }
  else if (parseInt(commandArg) != 0) {
    // RFC 2228 specifies that a 200 reply must be sent specifying a more
    // satisfactory PBSZ size (0 in our case, since we're using TLS).
    // Doubt that this will do any good if the client was already confused
    // enough to send a non-zero value, but ok...
    self.pbszReceived = true;
    self.respond("200 buffer too big, PBSZ=0");
  }
  else {
    self.pbszReceived = true;
    self.respond("200 OK");
  }
};

FtpConnection.prototype._command_PROT = function(commandArg) {
  var self = this;

  if (!self.server.options.tlsOptions)
    return self.respond("202 Not supported");

  if (!self.pbszReceived) {
    self.respond("503 No PBSZ command received");
  }
  else if (commandArg == 'S' || commandArg == 'E' || commandArg == 'C') {
    self.respond("536 Not supported");
  }
  else if (commandArg == 'P') {
    self.respond("200 OK");
  }
  else {
    // Don't even recognize this one...
    self.respond("504 Not recognized");
  }
};

/**
 * Print the current working directory.
 * @param {string} commandArg must always be empty
 * @return {FtpConnection} this
 */
FtpConnection.prototype._command_PWD = function(commandArg) {
  var pathEscaped = pathEscape(this.cwd);
  if (commandArg === '') {
    this.respond('257 "' + pathEscaped + '" is current directory');
  } else {
    this.respond('501 Syntax error in parameters or arguments.');
  }
  return this;
};

FtpConnection.prototype._command_QUIT = function(commandArg) {
  var self = this;

  self.hasQuit = true;
  self.respond("221 Goodbye", function(err) {
    if (err)
      self._logIf(0, "Error writing 'Goodbye' message following QUIT");
    self.socket.end();
    self._closeDataConnections();
  });
};

FtpConnection.prototype._command_RETR = function(commandArg) {
  var filename = pathModule.join(this.root, withCwd(this.cwd, commandArg));

  if (this.server.options.useReadFile)
    this._RETR_usingReadFile(commandArg, filename);
  else
    this._RETR_usingCreateReadStream(commandArg, filename);
};

FtpConnection.prototype._RETR_usingCreateReadStream = function(commandArg, filename) {
  var self = this;
  var startTime = new Date();

  self.emit("file:retr", "open", {
    user: self.username,
    file: filename,
    sTime: startTime
  });

  function afterOk(callback) {
    self.respond("150 Opening " + self.mode.toUpperCase() + " mode data connection", callback);
  }

  afterOk(function() {
    self._whenDataReady(function(pasvconn) {
      var rs = self.fs.createReadStream(filename);
      var readLength = 0;
      var now = new Date();
      rs.once("error", function(err) {
        self.emit("file:retr", "close", {
          user: self.username,
          file: filename,
          filesize: 0,
          sTime: startTime,
          eTime: now,
          duration: now - startTime,
          errorState: true,
          error: err
        });
        if (err.code == 'ENOENT') {
          self.respond("550 Not found");
        }
        else {
          self.respond("550 Not Accessible");
          self._traceIf(0, "Error at read of '" + filename + "' other than ENOENT " + err, self);
        }
        rs.destroy();
      });

      rs.on("data", function(buffer) {
        readLength += buffer.length;
        pasvconn.write(buffer);
      });

      rs.on("end", function(info) {
        var now = new Date();
        self.emit("file:retr", "close", {
          user: self.username,
          file: filename,
          filesize: 0,
          sTime: startTime,
          eTime: now,
          duration: now - startTime,
          errorState: false
        });
        self.respond("226 Closing data connection, sent " + readLength + " bytes");
        rs.destroy();
        pasvconn.end();
      });
    });
  });
};

FtpConnection.prototype._RETR_usingReadFile = function(commandArg, filename) {
  var self = this;
  var startTime = new Date();

  self.emit("file:retr", "open", {
    user: self.username,
    file: filename,
    sTime: startTime
  });

  function afterOk(callback) {
    self.respond("150 Opening " + self.mode.toUpperCase() + " mode data connection", callback);
  }

  self.fs.readFile(filename, function(err, contents) {
    if (err) {
      self.emit("file:retr", "error", {
        user: self.username,
        file: filename,
        filesize: 0,
        sTime: startTime,
        eTime: new Date(),
        duration: new Date() - startTime,
        errorState: true,
        error: err
      });
      if (err.code == 'ENOENT') {
        self.respond("550 Not Found");
      }
      else { // Who knows what's going on here...
        self.respond("550 Not Accessible");
        self._traceIf(0, "Error at read of '" + filename + "' other than ENOENT " + err, self);
      }
    }
    else {
      afterOk(function() {
        self._whenDataReady(function(pasvconn) {
          contents = {filename: filename, data: contents};
          self.emit("file:retr:contents", contents);
          contents = contents.data;
          pasvconn.write(contents);
          var contentLength = contents.length;
          self.respond("226 Closing data connection, sent " + contentLength + " bytes");
          self.emit("file:retr", "close", {
            user: self.username,
            file: filename,
            filesize: contentLength,
            sTime: startTime,
            eTime: new Date(),
            duration: new Date() - startTime,
            errorState: false
          });
          pasvconn.end();
        });
      });
    }
  });
};

/**
 * Remove a directory
 * @param {string} pathRequest
 * @return {FtpConnection} this
 */
FtpConnection.prototype._command_RMD = function (pathRequest) {
  var pathServer = withCwd(this.cwd, pathRequest);
  var pathFs = pathModule.join(this.root, pathServer);
  this.fs.rmdir(pathFs, function (err) {
    if (err) {
      this._logIf(0, 'ERROR: RMD ' + pathRequest + ': ' + err);
      this.respond('550 Delete operation failed');
    } else {
      this.respond('250 "' + pathServer + '" directory removed');
    }
  }.bind(this));
  return this;
};

FtpConnection.prototype._command_RNFR = function(commandArg) {
  var self = this;

  self.filefrom = withCwd(self.cwd, commandArg);
  self._logIf(3, "Rename from " + self.filefrom);
  self.respond("350 Ready for destination name");
};

FtpConnection.prototype._command_RNTO = function(commandArg) {
  var self = this;

  var fileto = withCwd(self.cwd, commandArg);
  self.fs.rename(pathModule.join(self.root, self.filefrom), pathModule.join(self.root, fileto), function(err) {
    if (err) {
      self._logIf(3, "Error renaming file from " + self.filefrom + " to " + fileto);
      self.respond("550 Rename failed" + ( err.code == 'ENOENT' ? "; file does not exist" : "" ));
    } else {
      self.respond("250 File renamed successfully");
    }
  });
};

FtpConnection.prototype._command_SIZE = function(commandArg) {
  var self = this;

  var filename = withCwd(self.cwd, commandArg);
  self.fs.stat(pathModule.join(self.root, filename), function(err, s) {
    if (err) {
      self._traceIf(0, "Error getting size of file '" + filename + "' ", self.socket);
      self.respond("450 Failed to get size of file");
      return;
    }
    self.respond("213 " + s.size + "");
  });
};

FtpConnection.prototype._command_TYPE = function(commandArg) {
  if (commandArg == "I" || commandArg == "A")
    this.respond("200 OK");
  else
    this.respond("202 Not supported");
};

FtpConnection.prototype._command_SYST = function(commandArg) {
  this.respond("215 UNIX Type: I");
};

FtpConnection.prototype._command_STOR = function(commandArg) {
  var filename = withCwd(this.cwd, commandArg);

  if (this.server.options.useWriteFile)
    this._STOR_usingWriteFile(filename);
  else
    this._STOR_usingCreateWriteStream(filename);
};

// 'initialBuffers' argument is set when this is called from _STOR_usingWriteFile.
FtpConnection.prototype._STOR_usingCreateWriteStream = function(filename, initialBuffers) {
  var self = this;

  var wStreamFlags = {flags: "w", mode: 0644};
  var storeStream = self.fs.createWriteStream(pathModule.join(self.root, filename), wStreamFlags);
  var notErr = true;
  // Adding for event metadata for file upload (STOR)
  var startTime = new Date();
  var uploadSize = 0;

  if (initialBuffers) {
    initialBuffers.forEach(function(b) {
      storeStream.write(b);
    });
  }

  self._whenDataReady(handleUpload);

  storeStream.on("open", function(fd) {
    self._logIf(3, "File opened/created: " + filename);
    self._logIf(3, "Told client ok to send file data");
    // Adding event emitter for upload start time
    self.emit("file:stor", "open", {
      user: self.username,
      file: filename,
      time: startTime
    });

    self.respond("150 Ok to send data");
  });

  storeStream.on("error", function(err) {
    self.emit("file:stor", "error", {
      user: self.username,
      file: filename,
      filesize: uploadSize,
      sTime: startTime,
      eTime: new Date(),
      duration: new Date() - startTime,
      errorState: !notErr
    });
    storeStream.destroy();
    notErr = false;
    if (self.dataSocket)
      self.dataSocket.destroy();
    self.respond("426 Connection closed; transfer aborted");
  });

  storeStream.on("close", function() {
    // Adding event emitter for completed upload.
    self.emit("file:stor", "close", {
      user: self.username,
      file: filename,
      filesize: uploadSize,
      sTime: startTime,
      eTime: new Date(),
      duration: new Date() - startTime,
      errorState: !notErr
    });
    notErr ? self.respond("226 Closing data connection") : true;
    if (self.dataSocket)
      self.dataSocket.end();
  });

  function handleUpload(dataSocket) {
    self.dataSocket.on('data', function(buff) {
      storeStream.write(buff);
    });
    self.dataSocket.once('error', function(buf) {
      notErr = false;
      storeStream.destroy();
    });
    self.dataSocket.once('close', function() {
      storeStream.end(); // send EOF/FIN
      storeStream.destroySoon(); // close once writestream is drained
    });
  }
};

FtpConnection.prototype._STOR_usingWriteFile = function(filename) {
  var self = this;

  var erroredOut = false;
  var slurpBuf = new Buffer(1024);
  var totalBytes = 0;
  var startTime = new Date();

  self.emit("file:stor", "open", {
    user: self.username,
    file: filename,
    time: startTime
  });

  self.respond("150 Ok to send data", function() {
    self._whenDataReady(handleUpload);
  });

  function handleUpload() {
    self.dataSocket.on('data', dataHandler);
    self.dataSocket.once('close', closeHandler);
    self.dataSocket.once('error', errorHandler);
  }

  function dataHandler(buf) {
    if (self.server.options.uploadMaxSlurpSize != null &&
        totalBytes + buf.length > self.server.options.uploadMaxSlurpSize) {
      // Give up trying to slurp it -- it's too big.

      // If the 'fs' module we've been given doesn't implement 'createWriteStream', then
      // we give up and send the client an error.
      if (!self.fs.createWriteStream) {
        if (self.dataSocket)
          self.dataSocket.destroy();
        self.respond("552 Requested file action aborted; file too big");
        return;
      }

      // Otherwise, we call _STOR_usingWriteStream, and tell it to prepend the stuff
      // that we've buffered so far to the file.
      self._logIf(1, "uploadMaxSlurpSize exceeded; falling back to createWriteStream");
      self._STOR_usingCreateWriteStream(filename, [slurpBuf.slice(0, totalBytes), buf]);
      self.dataSocket.removeListener('data', dataHandler);
      self.dataSocket.removeListener('error', errorHandler);
      self.dataSocket.removeListener('close', closeHandler);
    }
    else {
      if (totalBytes + buf.length > slurpBuf.length) {
        var newLength = slurpBuf.length * 2;
        if (newLength < totalBytes + buf.length)
          newLength = totalBytes + buf.length;

        var newSlurpBuf = new Buffer(newLength);
        slurpBuf.copy(newSlurpBuf, 0, 0, totalBytes);
        slurpBuf = newSlurpBuf;
      }
      buf.copy(slurpBuf, totalBytes, 0, buf.length);
      totalBytes += buf.length;
    }
  }

  function closeHandler() {
    if (erroredOut)
      return;

    var contents = {filename: filename, data: slurpBuf.slice(0, totalBytes)};
    self.emit("file:stor:contents", contents);
    self.fs.writeFile(pathModule.join(self.root, filename), contents.data, function(err) {
      self.emit("file:stor", "close", {
        user: self.username,
        file: filename,
        filesize: totalBytes,
        sTime: startTime,
        eTime: new Date(),
        duration: new Date() - startTime,
        errorState: err ? true : false
      });
      if (err) {
        erroredOut = true;
        self._logIf(0, "Error writing file");
        if (self.dataSocket)
          self.dataSocket.destroy();
        self.respond("426 Connection closed; transfer aborted");
        return;
      }

      self.respond("226 Closing data connection");
      if (self.dataSocket)
        self.dataSocket.end();
    });
  }

  function errorHandler(err) {
    erroredOut = true;
  }
};

/**
 * Specify a username for login
 * @param {string} username
 * @return {FtpConnection} this
 */
FtpConnection.prototype._command_USER = function (username) {
  var self = this;

  if (self.server.options.tlsOnly && !self.secure) {
    self.respond(
      "530 This server does not permit login over " +
      "a non-secure connection; " +
      "connect using FTP-SSL with explicit AUTH TLS");
  } else {
    self.emit('command:user', username,
        function success() {
          self.respond('331 User name okay, need password.');
        },
        function failure() {
          self.respond('530 Not logged in.');
        }
    );
  }
  return this;
};

/**
 * Specify a password for login
 * @param {string} password
 * @return {FtpConnection} this
 */
FtpConnection.prototype._command_PASS = function (password) {
  var self = this;

  if (self.previousCommand !== 'USER') {
    self.respond('503 Bad sequence of commands.');
  } else {
    self.emit('command:pass', password,
        function success(username, userFsModule) {
          function panic(error, method) {
            self._logIf(0, method + ' signaled error ' + util.inspect(error));
            self.respond('421 Service not available, closing control connection.', function () {
              self.socket.destroy();
            });
          }
          function setCwd(cwd) {
            function setRoot(root) {
              self.root = root;
              self.fs = userFsModule || fsModule;
              self.respond('230 User logged in, proceed.');
            }

            self.cwd = cwd;
            if (self.server.getRoot.length <= 1) {
              setRoot(self.server.getRoot(self));
            }
            else {
              self.server.getRoot(self, function (err, root) {
                if (err) {
                  panic(err, 'getRoot');
                }
                else {
                  setRoot(root);
                }
              });
            }
          }
          self.username = username;
          if (self.server.getInitialCwd.length <= 1) {
            setCwd(withCwd(self.server.getInitialCwd(self)));
          }
          else {
            self.server.getInitialCwd(self, function (err, cwd) {
              if (err) {
                panic(err, 'getInitialCwd');
              }
              else {
                setCwd(withCwd(cwd));
              }
            });
          }
        },
        function failure() {
          self.respond('530 Not logged in.');
          self.username = null;
        }
    );
  }
  return this;
};

exports.FtpServer = FtpServer;

function logIf(condition) {
  if (condition) {
    console.error.apply(console, [].slice.call(arguments, 1));
  }
}

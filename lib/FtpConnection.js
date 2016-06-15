/* eslint-disable no-octal */

var net = require('net');
var util = require('util');
var events = require('events');
var path = require('path');
var fsModule = require('fs');
var StatMode = require('stat-mode');
var dateformat = require('dateformat');

var glob = require('./glob');
var starttls = require('./starttls');
var Constants = require('./Constants');

var pathEscape = require('./helpers/pathEscape');
var withCwd = require('./helpers/withCwd');
var stripOptions = require('./helpers/stripOptions');
var leftPad = require('./helpers/leftPad');

var EventEmitter = events.EventEmitter;

// Use LOG for brevity.
var LOG = Constants.LOG_LEVELS;
var DOES_NOT_REQUIRE_AUTH = Constants.DOES_NOT_REQUIRE_AUTH;

var REQUIRES_CONFIGURED_DATA = Constants.REQUIRES_CONFIGURED_DATA;

function FtpConnection(properties) {
  var self = this;

  EventEmitter.call(this);

  Object.keys(properties).forEach(function(key) {
    self[key] = properties[key];
  });

  self.socket.setTimeout(0);
  self.socket.setNoDelay();

  self.socket.on('data', self._onData.bind(self));
  self.socket.on('end', endHandler);
  self.socket.on('error', errorHandler);
  self.socket.on('close', self._onClose.bind(self));

  self.respond('220 FTP server (nodeftpd) ready');
  self._logIf(LOG.INFO, 'Accepted a new client connection');

  function endHandler() {
    self._logIf(LOG.DEBUG, 'Client connection ended');
  }

  function errorHandler(err) {
    self._logIf(LOG.ERROR, 'Client connection error: ' + util.inspect(err));
    self._closeCommandConnection(true);
  }

}

util.inherits(FtpConnection, EventEmitter);

// TODO: rename this to writeLine?
FtpConnection.prototype.respond = function(message, callback) {
  this._writeText(this.socket, message + '\r\n', callback);
};

FtpConnection.prototype._logIf = function(verbosity, message) {
  this.server._logIf(verbosity, message, this);
};

// We don't want to use setEncoding because it screws up TLS, but we
// also don't want to explicitly specify ASCII encoding for every call to 'write'
// with a string argument.
FtpConnection.prototype._writeText = function(socket, data, callback) {
  if (!socket || !socket.writable) {
    this._logIf(LOG.DEBUG, 'Attempted writing to a closed socket:\n>> ' + data.trim());
    return;
  }
  this._logIf(LOG.TRACE, '>> ' + data.trim());
  return socket.write(data, 'utf8', callback);
};

FtpConnection.prototype._closeDataConnections = function(destroy) {
  if (this.dataSocket) {
    this._closeSocket(this.dataSocket, destroy);
    this.dataSocket = null;
  }
  if (this.pasv) {
    this.pasv.close();
    this.pasv = null;
  }
  this.dataConfigured = false;
};

FtpConnection.prototype._closeCommandConnection = function(destroy) {
  if (this.socket) {
    this._closeSocket(this.socket, destroy);
    this.socket = null;
  }
};

FtpConnection.prototype._createPassiveServer = function() {
  var self = this;

  return net.createServer(function(socket) {
    // This is simply a connection listener.
    // TODO: Should we keep track of *all* connections, or enforce just one?
    self._logIf(LOG.INFO, 'Passive data event: connect on port ' + this.address().port);

    if (self.secure) {
      self._logIf(LOG.INFO, 'Upgrading passive connection to TLS');
      starttls.starttlsServer(socket, self.server.options.tlsOptions, function(err, secureSocket) {
        if (err) {
          self._logIf(LOG.ERROR, 'Error upgrading passive connection to TLS:' + util.inspect(err));
          self._closeSocket(socket, true);
          self.dataConfigured = false;
          return;
        }

        if (secureSocket.authorized || self.server.options.allowUnauthorizedTls) {
          self._logIf(LOG.INFO, 'Secure passive connection started');
          // TODO: Check for existing dataSocket.
          self._setupDataSocket(secureSocket);
          return;
        }

        self._logIf(LOG.INFO, 'Closing disallowed unauthorized secure passive connection (allowUnauthorizedTls is off)');
        self._closeSocket(socket, true);
        self.dataConfigured = false;
      });
    } else {
      // TODO: Check for existing dataSocket.
      self._setupDataSocket(socket);
    }
  });
};

FtpConnection.prototype._setupDataSocket = function(socket) {
  var self = this;

  function allOver(socket, ename) {
    var port = socket.address().port;
    return function(err) {
      if (err) {
        self._logIf(LOG.ERROR, 'Data event: ' + ename + ' due to error: ' + util.inspect(err) + ' on port ' + port);
      } else {
        self._logIf(LOG.DEBUG, 'Data event: ' + ename + ' on port ' + port);
      }
      self.dataSocket = null;
    };
  }

  // Responses are not guaranteed to have an 'end' event
  // (https://github.com/joyent/node/issues/728), but we want to set
  // dataSocket to null as soon as possible, so we handle both events.
  self.dataSocket = socket
    .on('close', allOver(socket, 'close'))
    .on('end', allOver(socket, 'end'))
    .on('error', function(err) {
      self._logIf(LOG.ERROR, 'Data connection error: ' + err);
      if (self.dataSocket) {
        self._closeSocket(self.dataSocket, true);
        self.dataSocket = null;
      }
      self.dataConfigured = false;
    });

  (self.pasv || socket).emit('ready', socket);
};

FtpConnection.prototype._whenDataReady = function(callback) {
  var self = this;

  var socket = self.dataSocket;
  if (socket) {
    self._logIf(LOG.DEBUG, 'Using existing ' + (self.pasv ? '' : 'non-') +  'passive connection');
    callback(socket);
    return;
  }

  self._logIf(LOG.DEBUG, 'Currently no data connection; setting up ' + (self.pasv ? '' : 'non-') + 'passive connection to client');

  (self.pasv ||  net.connect(self.dataPort, self.dataHost || self.socket.remoteAddress, function() {
    self._setupDataSocket(this);
  })).once('ready', callback);
};

FtpConnection.prototype._onClose = function(hadError) {
  // I feel like some of this might be redundant since we probably close some
  // of these sockets elsewhere, but it is fine to call _closeSocket more than
  // once.
  this._closeDataConnections(hadError);
  this._closeCommandConnection(hadError);
  // TODO: LOG.DEBUG?
  this._logIf(LOG.INFO, 'Client connection closed');
};

FtpConnection.prototype._onData = function(data) {
  var self = this;

  if (self.hasQuit) {
    return;
  }

  data = data.toString('utf-8').trim();
  self._logIf(LOG.TRACE, '<< ' + data);
  // Don't want to include passwords in logs.
  self._logIf(LOG.INFO, 'FTP command: ' +
    data.replace(/^PASS [\s\S]*$/i, 'PASS ***')
  );

  var command;
  var commandArg;
  var index = data.indexOf(' ');
  if (index !== -1) {
    var parts = data.split(' ');
    command = parts.shift().toUpperCase();
    commandArg = parts.join(' ').trim();
  } else {
    command = data.toUpperCase();
    commandArg = '';
  }

  var m = '_command_' + command;
  if (self[m]) {
    if (self.allowedCommands != null && self.allowedCommands[command] !== true) {
      self.respond('502 ' + command + ' not implemented.');
    } else if (DOES_NOT_REQUIRE_AUTH[command]) {
      self[m](commandArg, command);
    } else {
      // If 'tlsOnly' option is set, all commands which require user authentication will only
      // be permitted over a secure connection. See RFC4217 regarding error code.
      if (!self.secure && self.server.options.tlsOnly) {
        self.respond('522 Protection level not sufficient; send AUTH TLS');
      } else if (self.username) {
        checkData();
      } else {
        self.respond('530 Not logged in.');
      }
    }

    function checkData() {
      if (REQUIRES_CONFIGURED_DATA[command] && !self.dataConfigured) {
        self.respond('425 Data connection not configured; send PASV or PORT');
        return;
      }

      self[m](commandArg, command);
    }
  } else {
    self.respond('502 Command not implemented.');
  }
  self.previousCommand = command;
};

// Specify the user's account (superfluous)
FtpConnection.prototype._command_ACCT = function() {
  this.respond('202 Command not implemented, superfluous at this site.');
};

// Allocate storage space (superfluous)
FtpConnection.prototype._command_ALLO = function() {
  this.respond('202 Command not implemented, superfluous at this site.');
};

FtpConnection.prototype._command_AUTH = function(commandArg) {
  var self = this;

  if (!self.server.options.tlsOptions || commandArg !== 'TLS') {
    return self.respond('502 Command not implemented');
  }

  self.respond('234 Honored', function() {
    self._logIf(LOG.INFO, 'Establishing secure connection...');
    starttls.starttlsServer(self.socket, self.server.options.tlsOptions, function(err, secureSocket) {
      if (err) {
        self._logIf(LOG.ERROR, 'Error upgrading connection to TLS: ' + util.inspect(err));
        self._closeSocket(self.socket, true);
        return;
      }

      if (secureSocket.authorized || self.server.options.allowUnauthorizedTls) {
        self._logIf(LOG.INFO, 'Secure connection started');
        self.socket = secureSocket;
        self.socket.on('data', function(data) {
          self._onData(data);
        });
        self.secure = true;
        return;
      }

      self._logIf(LOG.INFO, 'Closing unauthorized connection (allowUnauthorizedTls is off)');
      self._closeSocket(self.socket, true);
    });
  });
};

// Change working directory to parent directory
FtpConnection.prototype._command_CDUP = function() {
  var pathServer = path.dirname(this.cwd);
  var pathEscaped = pathEscape(pathServer);
  this.cwd = pathServer;
  this.respond('250 Directory changed to "' + pathEscaped + '"');
};

// Change working directory
FtpConnection.prototype._command_CWD = function(pathRequest) {
  var pathServer = withCwd(this.cwd, pathRequest);
  var pathFs = path.join(this.root, pathServer);
  var pathEscaped = pathEscape(pathServer);
  this.fs.stat(pathFs, function(err, stats) {
    if (err) {
      this._logIf(LOG.ERROR, 'CWD ' + pathRequest + ': ' + err);
      this.respond('550 Directory not found.');
    } else if (!stats.isDirectory()) {
      this._logIf(LOG.WARN, 'Attempt to CWD to non-directory');
      this.respond('550 Not a directory');
    } else {
      this.cwd = pathServer;
      this.respond('250 CWD successful. "' + pathEscaped + '" is current directory');
    }
  }.bind(this));
};

FtpConnection.prototype._command_DELE = function(commandArg) {
  var self = this;

  var filename = withCwd(self.cwd, commandArg);
  self.fs.unlink(path.join(self.root, filename), function(err) {
    if (err) {
      self._logIf(LOG.ERROR, 'Error deleting file: ' + filename + ', ' + err);
      // write error to socket
      self.respond('550 Permission denied');
    } else {
      self.respond('250 File deleted');
    }
  });
};

FtpConnection.prototype._command_FEAT = function() {
  // Get the feature list implemented by the server. (RFC 2389)
  this.respond(
      '211-Features\r\n' +
          ' SIZE\r\n' +
          ' UTF8\r\n' +
          ' MDTM\r\n' +
          (!this.server.options.tlsOptions ? '' :
              ' AUTH TLS\r\n' +
                  ' PBSZ\r\n' +
                  ' UTF8\r\n' +
                  ' PROT\r\n'
              ) +
          '211 end'
  );
};

FtpConnection.prototype._command_OPTS = function(commandArg) {
  // http://tools.ietf.org/html/rfc2389#section-4
  if (commandArg.toUpperCase() === 'UTF8 ON') {
    this.respond('200 OK');
  } else {
    this.respond('451 Not supported');
  }
};

// Print the file modification time
FtpConnection.prototype._command_MDTM = function(file) {
  var self = this;
  file = withCwd(this.cwd, file);
  file = path.join(this.root, file);
  this.fs.stat(file, function(err, stats) {
    if (err) {
      self.respond('550 File unavailable');
    } else {
      self.respond('213 ' + dateformat(stats.mtime, 'yyyymmddhhMMss'));
    }
  });
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
  } else {
    this.respond('211 FTP Server Status OK');
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
  glob.glob(path.join(self.root, dir), self.fs, function(err, files) {
    if (err) {
      self._logIf(LOG.ERROR, 'Error sending file list, reading directory: ' + err);
      self.respond('550 Not a directory');
      return;
    }

    if (self.server.options.hideDotFiles) {
      files = files.filter(function(file) {
        if (file.name && file.name[0] !== '.') {
          return true;
        }
      });
    }

    self._logIf(LOG.INFO, 'Directory has ' + files.length + ' files');
    if (files.length === 0) {
      return self._listFiles([], detailed, cmd);
    }

    var fileInfos; // To contain list of files with info for each.

    if (!detailed) {
      // We're not doing a detailed listing, so we don't need to get username
      // and group name.
      fileInfos = files;
      return finished();
    }

    // Now we need to get username and group name for each file from user/group ids.
    fileInfos = [];

    var j = 0;
    for (var i = 0; i < files.length; ++i) {
      handleFile(files[i]);
    }

    function handleFile(file) {
      self.server.getUsernameFromUid(file.stats.uid, function(e1, uname) {
        self.server.getGroupFromGid(file.stats.gid, function(e2, gname) {
          if (e1 || e2) {
            self._logIf(3, 'Error getting user/group name for file: ' + util.inspect(e1 || e2));
          }
          fileInfos.push({
            file: file,
            uname: uname,
            gname: gname,
          });
          j++;
          if (j === files.length) {
            finished();
          }
        });
      });
    }

    function finished() {
      // Sort file names.
      if (!self.server.options.dontSortFilenames) {
        if (self.server.options.filenameSortMap !== false) {
          var sm = (
            self.server.options.filenameSortMap ||
            function(x) {
              return x.toUpperCase();
            }
          );
          for (var i = 0; i < fileInfos.length; ++i) {
            fileInfos[i]._s = sm(detailed ? fileInfos[i].file.name : fileInfos[i].name);
          }
        }

        var sf = (self.server.options.filenameSortFunc ||
            function(x, y) {
              return x.localeCompare(y);
            });
        fileInfos = fileInfos.sort(function(x, y) {
          if (self.server.options.filenameSortMap !== false) {
            return sf(x._s, y._s);
          } else if (detailed) {
            return sf(x.file.name, y.file.name);
          } else {
            return sf(x.name, y.name);
          }
        });
      }

      self._listFiles(fileInfos, detailed, cmd);
    }
  }, self.server.options.noWildcards);
};

FtpConnection.prototype._listFiles = function(fileInfos, detailed, cmd) {
  var self = this;

  var m = '150 Here comes the directory listing';
  var BEGIN_MSGS = {
    LIST: m, NLST: m, STAT: '213-Status follows',
  };
  m = '226 Transfer OK';
  var END_MSGS = {
    LIST: m, NLST: m, STAT: '213 End of status', ERROR: '550 Error listing files',
  };

  self.respond(BEGIN_MSGS[cmd], function() {
    if (cmd === 'STAT') {
      writeFileList(self.socket);
    } else {
      self._whenDataReady(writeFileList);
    }

    function writeFileList(socket) {
      if (fileInfos.length === 0) {
        return success();
      }

      function success(err) {
        self.respond(END_MSGS[err && 'ERROR' || cmd]);

        if (cmd !== 'STAT') {
          self._closeSocket(socket);
        }
      }

      self._logIf(LOG.DEBUG, 'Sending file list');

      for (var i = 0; i < fileInfos.length; ++i) {
        var fileInfo = fileInfos[i];

        var line = '';
        var file;

        if (!detailed) {
          file = fileInfo;
        } else {
          file = fileInfo.file;
          var s = file.stats;
          var allModes = (new StatMode({mode: s.mode})).toString();
          var rwxModes = allModes.substr(1, 9);
          line += (s.isDirectory() ? 'd' : '-') + rwxModes;
          // ^-- Clients don't need to know about special files and pipes
          line += ' 1 ' +
            (fileInfo.uname || 'ftp') + ' ' +
            (fileInfo.gname === null ? 'ftp' : fileInfo.gname) + ' ';
          line += leftPad(s.size.toString(), 12) + ' ';
          var d = new Date(s.mtime);
          line += leftPad(dateformat(d, 'mmm dd HH:MM'), 12) + ' ';
        }
        line += file.name + '\r\n';
        self._writeText(
          socket,
          line,
          (i === fileInfos.length - 1 ? success : undefined)
        );
      }
    }
  });
};

// Create a directory
FtpConnection.prototype._command_MKD = function(pathRequest) {
  var pathServer = withCwd(this.cwd, pathRequest);
  var pathEscaped = pathEscape(pathServer);
  var pathFs = path.join(this.root, pathServer);
  this.fs.mkdir(pathFs, 0755, function(err) {
    if (err) {
      this._logIf(LOG.ERROR, 'MKD ' + pathRequest + ': ' + err);
      this.respond('550 "' + pathEscaped + '" directory NOT created');
    } else {
      this.respond('257 "' + pathEscaped + '" directory created');
    }
  }.bind(this));
};

// Perform a no-op (used to keep-alive connection)
FtpConnection.prototype._command_NOOP = function() {
  this.respond('200 OK');
};

FtpConnection.prototype._command_PORT = function(x, y) {
  this._PORT(x, y);
};

FtpConnection.prototype._command_EPRT = function(x, y) {
  this._PORT(x, y);
};

FtpConnection.prototype._PORT = function(commandArg, command) {
  var self = this;
  var m;
  var host;
  var port;

  // TODO: should the arg be false here?
  self._closeDataConnections(true);

  if (command === 'PORT') {
    m = commandArg.match(/^([0-9]{1,3}),([0-9]{1,3}),([0-9]{1,3}),([0-9]{1,3}),([0-9]{1,3}),([0-9]{1,3})$/);
    if (!m) {
      self.respond('501 Bad argument to PORT');
      return;
    }

    host = m[1] + '.' + m[2] + '.' + m[3] + '.' + m[4];
    port = (parseInt(m[5], 10) << 8) + parseInt(m[6], 10);
    if (isNaN(port)) {
      // The value should never be NaN because the relevant groups in the regex matche 1-3 digits.
      throw new Error('Impossible NaN in FtpConnection.prototype._PORT');
    }
  } else { // EPRT
    if (commandArg.length >= 3 && commandArg.charAt(0) === '|' &&
        commandArg.charAt(2) === '|' && commandArg.charAt(1) === '2') {
      // Only IPv4 is supported.
      self.respond('522 Server cannot handle IPv6 EPRT commands, use (1)');
      return;
    }

    m = commandArg.match(/^\|1\|([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})\|([0-9]{1,5})/);
    if (!m) {
      self.respond('501 Bad Argument to EPRT');
      return;
    }

    var r = parseInt(m[2], 10);
    if (isNaN(r)) {
      // The value should never be NaN because the relevant group in the regex matches 1-5 digits.
      throw new Error('Impossible NaN in FtpConnection.prototype._PORT (2)');
    }

    host = m[1];
    port = r;
  }

  if (port > 65535 || port < 1024) {
    self.respond('501 Bad argument to ' + command + ' (invalid port number)');
    return;
  }

  self.dataConfigured = true;
  self.dataHost = host;
  self.dataPort = port;
  self._logIf(LOG.DEBUG, 'self.dataHost, self.dataPort set to ' + self.dataHost + ':' + self.dataPort);
  self.respond('200 OK');
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

  if (command === 'EPSV' && commandArg && commandArg !== '1') {
    self.respond('202 Not supported');
    return;
  }

  // not sure whether the spec limits to 1 data connection at a time ...
  if (self.dataSocket) {
    self._closeSocket(self.dataSocket, true);
    self.dataSocket = null;
  }

  self._setupPASV(commandArg, command);
};

FtpConnection.prototype._writePASVReady = function(command) {
  var self = this;

  self.dataConfigured = true;

  self._logIf(LOG.DEBUG, 'Telling client that it can connect now');

  var host = self.server.host;
  var port = self.pasv.address().port;
  if (command === 'PASV') {
    var i1 = (port / 256) | 0;
    var i2 = port % 256;
    self.respond('227 Entering Passive Mode (' + host.split('.').join(',') + ',' + i1 + ',' + i2 + ')');
  } else { // EPASV
    self.respond('229 Entering Extended Passive Mode (|||' + port + '|)');
  }
};

// Keep trying ports in the range supplied until either:
//     (i)   It works
//     (ii)  We get an error that's not just EADDRINUSE
//     (iii) We run out of ports to try.
FtpConnection.prototype._setupPASV = function(commandArg, command) {
  var self = this;

  if (self.pasv) {
    self._writePASVReady(command);
    return;
  }

  self._logIf(LOG.DEBUG, 'Setting up listener for passive connections');

  var firstPort = this.server.options.pasvPortRangeStart;
  var lastPort = this.server.options.pasvPortRangeEnd;

  this._createPassiveServer()
    .on('error', function(e) {
      if (self.pasv === null && e.code === 'EADDRINUSE' && e.port < (lastPort || firstPort || 0)) {
        this.listen(++e.port);
        return;
      }

      self._logIf(LOG.WARN, 'Passive Error with passive data listener: ' + util.inspect(e));
      self.respond('421 Server was unable to open passive connection listener');
      self.dataConfigured = false;
      self.dataSocket = null;
      self.pasv = null;
    })

    // Once we're successfully listening, tell the client
    .on('listening', function() {
      self._logIf(LOG.DEBUG, 'Passive data connection listening on port ' + this.address().port);
      self.pasv = this;
      self._writePASVReady(command);
    })

    .on('close', function() {
      self.pasv = null;
      self._logIf(LOG.DEBUG, 'Passive data listener closed');
    })

    .listen(firstPort || lastPort || 0);
};

FtpConnection.prototype._command_PBSZ = function(commandArg) {
  if (this.secure) {
    this.pbszReceived = true;
  }

  this.respond(
    !this.server.options.tlsOptions ? '202 Not supported' :
    !this.secure ? '503 Secure connection not established' /* Protection Buffer Size (RFC 2228) */ :
    parseInt(commandArg, 10) !== 0 ? '200 buffer too big, PBSZ=0' :
    // RFC 2228 specifies that a 200 reply must be sent specifying a more
    // satisfactory PBSZ size (0 in our case, since we're using TLS).
    // Doubt that this will do any good if the client was already confused
    // enough to send a non-zero value, but ok...
    '200 OK'
  );
};

FtpConnection.prototype._command_PROT = function(commandArg) {
  this.respond(
    !this.server.options.tlsOptions ? '202 Not supported' :
    !this.pbszReceived ? '503 No PBSZ command received' :
    (commandArg === 'S' || commandArg === 'E' || commandArg === 'C') ? '536 Not supported' :
    commandArg !== 'P' ? '504 Not recognized' /* Don't even recognize this one... */ :
    '200 OK'
  );
};

// Print the current working directory.
FtpConnection.prototype._command_PWD = function(commandArg) {
  this.respond(
    commandArg === ''
      ? '257 "' + pathEscape(this.cwd) + '" is current directory'
      : '501 Syntax error in parameters or arguments.'
  );
};

FtpConnection.prototype._command_QUIT = function() {
  var self = this;

  self.hasQuit = true;
  self.respond('221 Goodbye', function(err) {
    if (err) {
      self._logIf(LOG.ERROR, "Error writing 'Goodbye' message following QUIT");
    }
    // TODO: should the arg be false here?
    self._onClose(true);
  });
};

FtpConnection.prototype._command_RETR = function(commandArg) {
  var filename = path.join(this.root, withCwd(this.cwd, commandArg));

  if (this.server.options.useReadFile) {
    this._RETR_usingReadFile(commandArg, filename);
  } else {
    this._RETR_usingCreateReadStream(commandArg, filename);
  }
};

FtpConnection.prototype._RETR_usingCreateReadStream = function(commandArg, filename) {
  var self = this;
  var startTime = new Date();

  self.emit('file:retr', 'open', {
    user: self.username,
    file: filename,
    sTime: startTime,
  });

  function afterOk(callback) {
    self.respond('150 Opening ' + self.mode.toUpperCase() + ' mode data connection', callback);
  }


  self.fs.open(filename, 'r', function(err, fd) {
    if (err) {
      self.emit('file:retr', 'error', {
        user: self.username,
        file: filename,
        filesize: 0,
        sTime: startTime,
        eTime: new Date(),
        duration: new Date() - startTime,
        errorState: true,
        error: err,
      });
      if (err.code === 'ENOENT') {
        self.respond('550 Not Found');
      } else { // Who knows what's going on here...
        self.respond('550 Not Accessible');
        self._logIf(LOG.ERROR, "Error at read of '" + filename + "' other than ENOENT " + err);
      }
    } else {
      afterOk(function() {
        self._whenDataReady(function(socket) {
          var readLength = 0;
          var now = new Date();
          var rs = self.fs.createReadStream(null, {fd: fd});
          rs.pause();
          rs.once('error', function(err) {
            self.emit('file:retr', 'close', {
              user: self.username,
              file: filename,
              /** @deprecated filesize is deprecated, use bytesRead/bytesWritten instead */
              filesize: 0,
              bytesRead: rs.bytesRead,
              sTime: startTime,
              eTime: now,
              duration: now - startTime,
              errorState: true,
              error: err,
            });
          });

          rs.on('data', function(buffer) {
            readLength += buffer.length;
          });

          rs.on('end', function() {
            var now = new Date();
            self.emit('file:retr', 'close', {
              user: self.username,
              file: filename,
              /** @deprecated filesize is deprecated, use bytesRead/bytesWritten instead */
              filesize: 0,
              bytesRead: rs.bytesRead,
              sTime: startTime,
              eTime: now,
              duration: now - startTime,
              errorState: false,
            });
            self.respond('226 Closing data connection, sent ' + readLength + ' bytes');
          });

          rs.pipe(socket);
          rs.resume();
        });
      });
    }
  });
};

FtpConnection.prototype._RETR_usingReadFile = function(commandArg, filename) {
  var self = this;
  var startTime = new Date();

  self.emit('file:retr', 'open', {
    user: self.username,
    file: filename,
    sTime: startTime,
  });

  function afterOk(callback) {
    self.respond('150 Opening ' + self.mode.toUpperCase() + ' mode data connection', callback);
  }

  self.fs.readFile(filename, function(err, contents) {
    if (err) {
      self.emit('file:retr', 'error', {
        user: self.username,
        file: filename,
        /** @deprecated filesize is deprecated, use bytesRead/bytesWritten instead */
        filesize: 0,
        bytesRead: 0,
        sTime: startTime,
        eTime: new Date(),
        duration: new Date() - startTime,
        errorState: true,
        error: err,
      });
      if (err.code === 'ENOENT') {
        self.respond('550 Not Found');
      } else { // Who knows what's going on here...
        self.respond('550 Not Accessible');
        self._logIf(LOG.ERROR, "Error at read of '" + filename + "' other than ENOENT " + err);
      }
    } else {
      afterOk(function() {
        self._whenDataReady(function(socket) {
          self.emit('file:retr:contents', {filename: filename, data: contents});
          socket.write(contents);
          var contentLength = contents.length;
          self.respond('226 Closing data connection, sent ' + contentLength + ' bytes');
          self.emit('file:retr', 'close', {
            user: self.username,
            file: filename,
            /** @deprecated filesize is deprecated, use bytesRead/bytesWritten instead */
            filesize: contentLength,
            bytesRead: contentLength,
            sTime: startTime,
            eTime: new Date(),
            duration: new Date() - startTime,
            errorState: false,
          });
          if (self.dataSocket) {
            self._closeSocket(self.dataSocket);
            self.dataSocket = null;
          }
        });
      });
    }
  });
};

// Remove a directory
FtpConnection.prototype._command_RMD = function(pathRequest) {
  var pathServer = withCwd(this.cwd, pathRequest);
  var pathFs = path.join(this.root, pathServer);
  this.fs.rmdir(pathFs, function(err) {
    if (err) {
      this._logIf(LOG.ERROR, 'RMD ' + pathRequest + ': ' + err);
      this.respond('550 Delete operation failed');
    } else {
      this.respond('250 "' + pathServer + '" directory removed');
    }
  }.bind(this));
};

FtpConnection.prototype._command_RNFR = function(commandArg) {
  var self = this;
  self.filefrom = withCwd(self.cwd, commandArg);
  self._logIf(LOG.DEBUG, 'Rename from ' + self.filefrom);
  self.respond('350 Ready for destination name');
};

FtpConnection.prototype._command_RNTO = function(commandArg) {
  var self = this;
  var fileto = withCwd(self.cwd, commandArg);
  self.fs.rename(path.join(self.root, self.filefrom), path.join(self.root, fileto), function(err) {
    if (err) {
      self._logIf(LOG.ERROR, 'Error renaming file from ' + self.filefrom + ' to ' + fileto);
      self.respond('550 Rename failed' + (err.code === 'ENOENT' ? '; file does not exist' : ''));
    } else {
      self.respond('250 File renamed successfully');
    }
  });
};

FtpConnection.prototype._command_SIZE = function(commandArg) {
  var self = this;

  var filename = withCwd(self.cwd, commandArg);
  self.fs.stat(path.join(self.root, filename), function(err, s) {
    if (err) {
      self._logIf(LOG.ERROR, "Error getting size of file '" + filename + "' ");
      self.respond('450 Failed to get size of file');
      return;
    }
    self.respond('213 ' + s.size + '');
  });
};

FtpConnection.prototype._command_TYPE = function(commandArg) {
  this.respond(
    commandArg === 'I' || commandArg === 'A'
      ? '200 OK'
      : '202 Not supported'
  );
};

FtpConnection.prototype._command_SYST = function() {
  this.respond('215 UNIX Type: I');
};

FtpConnection.prototype._command_STOR = function(commandArg) {
  var filename = withCwd(this.cwd, commandArg);

  if (this.server.options.useWriteFile) {
    this._STOR_usingWriteFile(filename, 'w');
  } else {
    this._STOR_usingCreateWriteStream(filename, null, 'w');
  }
};

// 'initialBuffers' argument is set when this is called from _STOR_usingWriteFile.
FtpConnection.prototype._STOR_usingCreateWriteStream = function(filename, initialBuffers, flag) {
  var self = this;

  var wStreamFlags = {flags: flag || 'w', mode: 0644};
  var storeStream = self.fs.createWriteStream(path.join(self.root, filename), wStreamFlags);
  var notErr = true;
  // Adding for event metadata for file upload (STOR)
  var startTime = new Date();

  if (initialBuffers) {
    //todo: handle back-pressure
    initialBuffers.forEach(function(b) {
      storeStream.write(b);
    });
  }

  self._whenDataReady(function(socket) {
    socket.on('error', function(err) {
      notErr = false;
      self._logIf(LOG.ERROR, 'Data connection error: ' + util.inspect(err));
    });
    socket.pipe(storeStream);
  });

  storeStream.on('open', function() {
    self._logIf(LOG.DEBUG, 'File opened/created: ' + filename);
    self._logIf(LOG.DEBUG, 'Told client ok to send file data');
    // Adding event emitter for upload start time
    self.emit('file:stor', 'open', {
      user: self.username,
      file: filename,
      time: startTime,
    });

    self.respond('150 Ok to send data');
  });

  storeStream.on('error', function() {
    self.emit('file:stor', 'error', {
      user: self.username,
      file: filename,
      /** @deprecated filesize is deprecated, use bytesRead/bytesWritten instead */
      filesize: 0,
      bytesWritten: storeStream.bytesWritten,
      sTime: startTime,
      eTime: new Date(),
      duration: new Date() - startTime,
      errorState: !notErr,
    });
    storeStream.end();
    notErr = false;
    if (self.dataSocket) {
      self._closeSocket(self.dataSocket, true);
      self.dataSocket = null;
    }
    self.respond('426 Connection closed; transfer aborted');
  });

  storeStream.on('finish', function() {
    // Adding event emitter for completed upload.
    self.emit('file:stor', 'close', {
      user: self.username,
      file: filename,
      /** @deprecated filesize is deprecated, use bytesRead/bytesWritten instead */
      filesize: 0,
      bytesWritten: storeStream.bytesWritten,
      sTime: startTime,
      eTime: new Date(),
      duration: new Date() - startTime,
      errorState: !notErr,
    });
    notErr ? self.respond('226 Closing data connection') : true;
    if (self.dataSocket) {
      self._closeSocket(self.dataSocket);
      self.dataSocket = null;
    }
  });

};

FtpConnection.prototype._STOR_usingWriteFile = function(filename, flag) {
  var self = this;

  var erroredOut = false;
  var slurpBuf = new Buffer(1024);
  var totalBytes = 0;
  var startTime = new Date();

  self.emit('file:stor', 'open', {
    user: self.username,
    file: filename,
    time: startTime,
  });

  self.respond('150 Ok to send data', function() {
    self._whenDataReady(function(socket) {
      socket.on('data', dataHandler);
      socket.once('close', closeHandler);
      socket.once('error', errorHandler);
    });
  });


  function dataHandler(buf) {
    if (self.server.options.uploadMaxSlurpSize != null &&
        totalBytes + buf.length > self.server.options.uploadMaxSlurpSize) {
      // Give up trying to slurp it -- it's too big.

      // If the 'fs' module we've been given doesn't implement 'createWriteStream', then
      // we give up and send the client an error.
      if (!self.fs.createWriteStream) {
        if (self.dataSocket) {
          self._closeSocket(self.dataSocket, true);
          self.dataSocket = null;
        }
        self.respond('552 Requested file action aborted; file too big');
        return;
      }

      // Otherwise, we call _STOR_usingWriteStream, and tell it to prepend the stuff
      // that we've buffered so far to the file.
      self._logIf(LOG.WARN, 'uploadMaxSlurpSize exceeded; falling back to createWriteStream');
      self._STOR_usingCreateWriteStream(filename, [slurpBuf.slice(0, totalBytes), buf]);
      self.dataSocket.removeListener('data', dataHandler);
      self.dataSocket.removeListener('error', errorHandler);
      self.dataSocket.removeListener('close', closeHandler);
    } else {
      if (totalBytes + buf.length > slurpBuf.length) {
        var newLength = slurpBuf.length * 2;
        if (newLength < totalBytes + buf.length) {
          newLength = totalBytes + buf.length;
        }

        var newSlurpBuf = new Buffer(newLength);
        slurpBuf.copy(newSlurpBuf, 0, 0, totalBytes);
        slurpBuf = newSlurpBuf;
      }
      buf.copy(slurpBuf, totalBytes, 0, buf.length);
      totalBytes += buf.length;
    }
  }

  function closeHandler() {
    if (erroredOut) {
      return;
    }

    var wOptions = {flag: flag || 'w', mode: 0644};
    var contents = {filename: filename, data: slurpBuf.slice(0, totalBytes)};
    self.emit('file:stor:contents', contents);
    self.fs.writeFile(path.join(self.root, filename), contents.data, wOptions, function(err) {
      self.emit('file:stor', 'close', {
        user: self.username,
        file: filename,
        /** @deprecated filesize is deprecated, use bytesRead/bytesWritten instead */
        filesize: totalBytes,
        bytesWritten: totalBytes,
        sTime: startTime,
        eTime: new Date(),
        duration: new Date() - startTime,
        errorState: err ? true : false,
      });
      if (err) {
        erroredOut = true;
        self._logIf(LOG.ERROR, 'Error writing file. ' + err);
        if (self.dataSocket) {
          self._closeSocket(self.dataSocket, true);
        }
        self.respond('426 Connection closed; transfer aborted');
        return;
      }

      self.respond('226 Closing data connection');
      if (self.dataSocket) {
        self._closeSocket(self.dataSocket);
      }
    });
  }

  function errorHandler() {
    erroredOut = true; // TODO RWO: should we not log the error and emit error and close the connection?
  }
};

FtpConnection.prototype._command_APPE = function(commandArg) {
  var filename = withCwd(this.cwd, commandArg);

  if (this.server.options.useWriteFile) {
    this._STOR_usingWriteFile(filename, 'a');
  } else {
    this._STOR_usingCreateWriteStream(filename, null, 'a');
  }
};

// Specify a username for login
FtpConnection.prototype._command_USER = function(username) {
  var self = this;

  if (self.server.options.tlsOnly && !self.secure) {
    self.respond(
      '530 This server does not permit login over ' +
      'a non-secure connection; ' +
      'connect using FTP-SSL with explicit AUTH TLS');
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
};

// Specify a password for login
FtpConnection.prototype._command_PASS = function(password) {
  var self = this;

  if (self.previousCommand !== 'USER') {
    self.respond('503 Bad sequence of commands.');
  } else {
    self.emit('command:pass', password,
        function success(username, userFsModule) {
          function panic(error, method) {
            self._logIf(LOG.ERROR, method + ' signaled error ' + util.inspect(error));
            self.respond('421 Service not available, closing control connection.', function() {
              self._closeSocket(self.socket, true);
            });
          }
          function setCwd(cwd) {
            function setRoot(root) {
              self.root = root;
              self.respond('230 User logged in, proceed.');
            }

            self.cwd = cwd;
            if (self.server.getRoot.length <= 1) {
              setRoot(self.server.getRoot(self));
            } else {
              self.server.getRoot(self, function(err, root) {
                if (err) {
                  panic(err, 'getRoot');
                } else {
                  setRoot(root);
                }
              });
            }
          }
          self.username = username;
          self.fs = userFsModule || fsModule;
          if (self.server.getInitialCwd.length <= 1) {
            setCwd(withCwd(self.server.getInitialCwd(self)));
          } else {
            self.server.getInitialCwd(self, function(err, cwd) {
              if (err) {
                panic(err, 'getInitialCwd');
              } else {
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
};

FtpConnection.prototype._closeSocket = function(socket, shouldDestroy) {
  // TODO: Should we always use destroy() to avoid keeping sockets open longer
  // than necessary (and possibly exceeding OS max open sockets)?
  if (shouldDestroy || this.server.options.destroySockets) {
    // Don't call destroy() more than once.
    if (!socket.destroyed) {
      this._logIf(LOG.DEBUG, 'Closing socket on port ' + socket.address().port);
      socket.destroy();
    }
  } else {
    // Don't call `end()` more than once.
    if (socket.writable) {
      socket.end();
    }
  }
};

module.exports = FtpConnection;

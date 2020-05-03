/* eslint-disable no-octal */

const net = require('net');
const util = require('util');
const events = require('events');
const pathModule = require('path');
const fsModule = require('fs');
const StatMode = require('stat-mode');
const dateformat = require('dateformat');

const glob = require('./glob');
const starttls = require('./starttls');
const Constants = require('./Constants');
const PassiveListener = require('./PassiveListener');

const pathEscape = require('./helpers/pathEscape');
const withCwd = require('./helpers/withCwd');
const stripOptions = require('./helpers/stripOptions');
const leftPad = require('./helpers/leftPad');

const { EventEmitter } = events;

// Use LOG for brevity.
const LOG = Constants.LOG_LEVELS;
const { DOES_NOT_REQUIRE_AUTH } = Constants;
const { REQUIRES_CONFIGURED_DATA } = Constants;

const MODE_755 = 0x1ed;
const MODE_644 = 0x1a4;

function FtpConnection(properties) {
  EventEmitter.call(this);
  const self = this;
  Object.keys(properties).forEach((key) => {
    self[key] = properties[key];
  });
}
util.inherits(FtpConnection, EventEmitter);

// TODO: rename this to writeLine?
FtpConnection.prototype.respond = function (message, callback) {
  return this._writeText(this.socket, `${message}\r\n`, callback);
};

FtpConnection.prototype._logIf = function (verbosity, message) {
  return this.server._logIf(verbosity, message, this);
};

// We don't want to use setEncoding because it screws up TLS, but we
// also don't want to explicitly specify ASCII encoding for every call to 'write'
// with a string argument.
FtpConnection.prototype._writeText = function (socket, data, callback) {
  if (!socket || !socket.writable) {
    this._logIf(LOG.DEBUG, `Attempted writing to a closed socket:\n>> ${data.trim()}`);
    return;
  }
  this._logIf(LOG.TRACE, `>> ${data.trim()}`);
  return socket.write(data, 'utf8', callback);
};

FtpConnection.prototype._authenticated = function () {
  return !!this.username;
};

FtpConnection.prototype._closeDataConnections = function () {
  if (this.dataSocket) {
    // TODO: should the second arg be false here?
    this._closeSocket(this.dataSocket, true);
    this.dataSocket = null;
  }
  if (this.pasv) {
    this.pasv.close();
    this.pasv = null;
  }
};

FtpConnection.prototype._createPassiveServer = function () {
  const self = this;

  return net.createServer((psocket) => {
    // This is simply a connection listener.
    // TODO: Should we keep track of *all* connections, or enforce just one?
    self._logIf(LOG.INFO, 'Passive data event: connect');

    if (self.secure) {
      self._logIf(LOG.INFO, 'Upgrading passive connection to TLS');
      starttls.starttlsServer(psocket, self.server.options.tlsOptions, (err, cleartext) => {
        if (err) {
          self._logIf(LOG.ERROR, `Error upgrading passive connection to TLS:${util.inspect(err)}`);
          self._closeSocket(psocket, true);
          self.dataConfigured = false;
        } else if (!cleartext.authorized) {
          if (self.server.options.allowUnauthorizedTls) {
            self._logIf(LOG.INFO, 'Allowing unauthorized passive connection (allowUnauthorizedTls is on)');
            switchToSecure();
          } else {
            self._logIf(LOG.INFO, 'Closing unauthorized passive connection (allowUnauthorizedTls is off)');
            self._closeSocket(self.socket, true);
            self.dataConfigured = false;
          }
        } else {
          switchToSecure();
        }

        function switchToSecure() {
          self._logIf(LOG.INFO, 'Secure passive connection started');
          // TODO: Check for existing dataSocket.
          self.dataSocket = cleartext;
          setupPassiveListener();
        }
      });
    } else {
      // TODO: Check for existing dataSocket.
      self.dataSocket = psocket;
      setupPassiveListener();
    }

    function setupPassiveListener() {
      if (self.dataListener) {
        self.dataListener.emit('ready');
      } else {
        self._logIf(LOG.WARN, 'Passive connection initiated, but no data listener');
      }

      self.dataSocket.on('end', allOver('end'));

      // Responses are not guaranteed to have an 'end' event
      // (https://github.com/joyent/node/issues/728), but we want to set
      // dataSocket to null as soon as possible, so we handle both events.
      self.dataSocket.on('close', () => {
        allOver('close');
        if (self.pasv) {
          self.pasv.close();
        }
      });

      function allOver(ename) {
        return function (err) {
          self._logIf(
            (err ? LOG.ERROR : LOG.DEBUG),
            `Passive data event: ${ename}${err ? ' due to error' : ''}`,
          );
          self.dataSocket = null;
        };
      }

      self.dataSocket.on('error', (err) => {
        self._logIf(LOG.ERROR, `Passive data event: error: ${err}`);
        // TODO: Can we can rely on self.dataSocket having been closed?
        self.dataSocket = null;
        self.dataConfigured = false;
      });
    }
  });
};

FtpConnection.prototype._whenDataReady = function (callback) {
  const self = this;

  if (self.dataListener) {
    // how many data connections are allowed?
    // should still be listening since we created a server, right?
    if (self.dataSocket) {
      self._logIf(LOG.DEBUG, 'A data connection exists');
      callback(self.dataSocket);
    } else {
      self._logIf(LOG.DEBUG, 'Currently no data connection; expecting client to connect to pasv server shortly...');
      self.dataListener.once('ready', () => {
        self._logIf(LOG.DEBUG, '...client has connected now');
        callback(self.dataSocket);
      });
    }
  } else {
    // Do we need to open the data connection?
    if (self.dataSocket) { // There really shouldn't be an existing connection
      self._logIf(LOG.DEBUG, 'Using existing non-passive dataSocket');
      callback(self.dataSocket);
    } else {
      self._initiateData((sock) => {
        callback(sock);
      });
    }
  }
};

FtpConnection.prototype._initiateData = function (callback) {
  const self = this;

  if (self.dataSocket) {
    return callback(self.dataSocket);
  }

  const sock = net.connect(self.dataPort, self.dataHost || self.socket.remoteAddress);
  sock.on('connect', () => {
    self.dataSocket = sock;
    callback(sock);
  });
  sock.on('end', allOver);
  sock.on('close', allOver);
  function allOver(err) {
    self.dataSocket = null;
    self._logIf(
      err ? LOG.ERROR : LOG.DEBUG,
      `Non-passive data connection ended${err ? `due to error: ${util.inspect(err)}` : ''}`,
    );
  }

  sock.on('error', (err) => {
    self._closeSocket(sock, true);
    self._logIf(LOG.ERROR, `Data connection error: ${util.inspect(err)}`);
    self.dataSocket = null;
    self.dataConfigured = false;
  });
};

FtpConnection.prototype._onError = function (err) {
  this._logIf(LOG.ERROR, `Client connection error: ${util.inspect(err)}`);
  this._closeSocket(this.socket, true);
};

FtpConnection.prototype._onEnd = function () {
  this._logIf(LOG.DEBUG, 'Client connection ended');
};

FtpConnection.prototype._onClose = function (hadError) {
  // I feel like some of this might be redundant since we probably close some
  // of these sockets elsewhere, but it is fine to call _closeSocket more than
  // once.
  if (this.dataSocket) {
    this._closeSocket(this.dataSocket, hadError);
    this.dataSocket = null;
  }
  if (this.socket) {
    this._closeSocket(this.socket, hadError);
    this.socket = null;
  }
  if (this.pasv) {
    this.pasv.close();
    this.pasv = null;
  }
  // TODO: LOG.DEBUG?
  this._logIf(LOG.INFO, 'Client connection closed');
};

FtpConnection.prototype._onData = function (data) {
  const self = this;

  if (self.hasQuit) {
    return;
  }

  data = data.toString('utf-8').trim();
  self._logIf(LOG.TRACE, `<< ${data}`);
  // Don't want to include passwords in logs.
  self._logIf(LOG.INFO, `FTP command: ${
    data.replace(/^PASS [\s\S]*$/i, 'PASS ***')}`);

  let command;
  let commandArg;
  const index = data.indexOf(' ');
  if (index !== -1) {
    const parts = data.split(' ');
    command = parts.shift().toUpperCase();
    commandArg = parts.join(' ').trim();
  } else {
    command = data.toUpperCase();
    commandArg = '';
  }

  const m = `_command_${command}`;
  if (self[m]) {
    if (self.allowedCommands != null && self.allowedCommands[command] !== true) {
      self.respond(`502 ${command} not implemented.`);
    } else if (DOES_NOT_REQUIRE_AUTH[command]) {
      self[m](commandArg, command);
    } else {
      // If 'tlsOnly' option is set, all commands which require user authentication will only
      // be permitted over a secure connection. See RFC4217 regarding error code.
      if (!self.secure && self.server.options.tlsOnly) {
        self.respond('522 Protection level not sufficient; send AUTH TLS');
      } else if (self._authenticated()) {
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
FtpConnection.prototype._command_ACCT = function () {
  this.respond('202 Command not implemented, superfluous at this site.');
  return this;
};

// Allocate storage space (superfluous)
FtpConnection.prototype._command_ALLO = function () {
  this.respond('202 Command not implemented, superfluous at this site.');
  return this;
};

FtpConnection.prototype._command_AUTH = function (commandArg) {
  const self = this;

  if (!self.server.options.tlsOptions || commandArg !== 'TLS') {
    return self.respond('502 Command not implemented');
  }

  self.respond('234 Honored', () => {
    self._logIf(LOG.INFO, 'Establishing secure connection...');
    starttls.starttlsServer(self.socket, self.server.options.tlsOptions, (err, cleartext) => {
      if (err) {
        self._logIf(LOG.ERROR, `Error upgrading connection to TLS: ${util.inspect(err)}`);
        self._closeSocket(self.socket, true);
      } else if (!cleartext.authorized) {
        self._logIf(LOG.INFO, `Secure socket not authorized: ${util.inspect(cleartext.authorizationError)}`);
        if (self.server.options.allowUnauthorizedTls) {
          self._logIf(LOG.INFO, 'Allowing unauthorized connection (allowUnauthorizedTls is on)');
          switchToSecure();
        } else {
          self._logIf(LOG.INFO, 'Closing unauthorized connection (allowUnauthorizedTls is off)');
          self._closeSocket(self.socket, true);
        }
      } else {
        switchToSecure();
      }

      function switchToSecure() {
        self._logIf(LOG.INFO, 'Secure connection started');
        self.socket = cleartext;
        self.socket.on('data', (data) => {
          self._onData(data);
        });
        self.secure = true;
      }
    });
  });
};

// Change working directory to parent directory
FtpConnection.prototype._command_CDUP = function () {
  const pathServer = pathModule.dirname(this.cwd);
  const pathEscaped = pathEscape(pathServer);
  this.cwd = pathServer;
  this.respond(`250 Directory changed to "${pathEscaped}"`);
  return this;
};

// Change working directory
FtpConnection.prototype._command_CWD = function (pathRequest) {
  const pathServer = withCwd(this.cwd, pathRequest);
  const pathFs = pathModule.join(this.root, pathServer);
  const pathEscaped = pathEscape(pathServer);
  this.fs.stat(pathFs, (err, stats) => {
    if (err) {
      this._logIf(LOG.ERROR, `CWD ${pathRequest}: ${err}`);
      this.respond('550 Directory not found.');
    } else if (!stats.isDirectory()) {
      this._logIf(LOG.WARN, 'Attempt to CWD to non-directory');
      this.respond('550 Not a directory');
    } else {
      this.cwd = pathServer;
      this.respond(`250 CWD successful. "${pathEscaped}" is current directory`);
    }
  });
  return this;
};

FtpConnection.prototype._command_DELE = function (commandArg) {
  const self = this;

  const filename = withCwd(self.cwd, commandArg);
  self.fs.unlink(pathModule.join(self.root, filename), (err) => {
    if (err) {
      self._logIf(LOG.ERROR, `Error deleting file: ${filename}, ${err}`);
      // write error to socket
      self.respond('550 Permission denied');
    } else {
      self.respond('250 File deleted');
    }
  });
};

FtpConnection.prototype._command_FEAT = function () {
  // Get the feature list implemented by the server. (RFC 2389)
  this.respond(
    `${'211-Features\r\n'
          + ' SIZE\r\n'
          + ' UTF8\r\n'
          + ' MDTM\r\n'}${
      !this.server.options.tlsOptions ? ''
        : ' AUTH TLS\r\n'
                  + ' PBSZ\r\n'
                  + ' UTF8\r\n'
                  + ' PROT\r\n'
    }211 end`,
  );
};

FtpConnection.prototype._command_OPTS = function (commandArg) {
  // http://tools.ietf.org/html/rfc2389#section-4
  if (commandArg.toUpperCase() === 'UTF8 ON') {
    this.respond('200 OK');
  } else {
    this.respond('451 Not supported');
  }
};

// Print the file modification time
FtpConnection.prototype._command_MDTM = function (file) {
  file = withCwd(this.cwd, file);
  file = pathModule.join(this.root, file);
  this.fs.stat(file, (err, stats) => {
    if (err) {
      this.respond('550 File unavailable');
    } else {
      this.respond(`213 ${dateformat(stats.mtime, 'yyyymmddhhMMss')}`);
    }
  });
  return this;
};

FtpConnection.prototype._command_LIST = function (commandArg) {
  this._LIST(commandArg, true/* detailed */, 'LIST');
};

FtpConnection.prototype._command_NLST = function (commandArg) {
  this._LIST(commandArg, false/*! detailed */, 'NLST');
};

FtpConnection.prototype._command_STAT = function (commandArg) {
  if (commandArg) {
    this._LIST(commandArg, true/* detailed */, 'STAT');
  } else {
    this.respond('211 FTP Server Status OK');
  }
};

FtpConnection.prototype._LIST = function (commandArg, detailed, cmd) {
  /*
   Normally the server responds with a mark using code 150. It then stops accepting new connections, attempts to send the contents of the directory over the data connection, and closes the data connection. Finally it

   accepts the LIST or NLST request with code 226 if the entire directory was successfully transmitted;
   rejects the LIST or NLST request with code 425 if no TCP connection was established;
   rejects the LIST or NLST request with code 426 if the TCP connection was established but then broken by the client or by network failure; or
   rejects the LIST or NLST request with code 451 if the server had trouble reading the directory from disk.

   The server may reject the LIST or NLST request (with code 450 or 550) without first responding with a mark. In this case the server does not touch the data connection.
   */

  const self = this;

  // LIST may be passed options (-a in particular). We just ignore any of these.
  // (In the particular case of -a, we show hidden files anyway.)
  const dirname = stripOptions(commandArg);
  const dir = withCwd(self.cwd, dirname);

  glob.setMaxStatsAtOnce(self.server.options.maxStatsAtOnce);
  glob.glob(pathModule.join(self.root, dir), self.fs, (err, files) => {
    if (err) {
      self._logIf(LOG.ERROR, `Error sending file list, reading directory: ${err}`);
      self.respond('550 Not a directory');
      return;
    }

    if (self.server.options.hideDotFiles) {
      files = files.filter((file) => {
        if (file.name && file.name[0] !== '.') {
          return true;
        }
      });
    }

    self._logIf(LOG.INFO, `Directory has ${files.length} files`);
    if (files.length === 0) {
      return self._listFiles([], detailed, cmd);
    }

    let fileInfos; // To contain list of files with info for each.

    if (!detailed) {
      // We're not doing a detailed listing, so we don't need to get username
      // and group name.
      fileInfos = files;
      return finished();
    }

    // Now we need to get username and group name for each file from user/group ids.
    fileInfos = [];

    const CONC = self.server.options.maxStatsAtOnce;
    let j = 0;
    let i = 0;
    for (let i2 = 0; i2 < files.length && i2 < CONC; i2 += 1) {
      handleFile(i2);
      i = i2;
    }
    j = --i;

    function handleFile(i) {
      if (i >= files.length) {
        return i === files.length + j ? finished() : null;
      }

      self.server.getUsernameFromUid(files[ii].stats.uid, (e1, uname) => {
        self.server.getGroupFromGid(files[ii].stats.gid, (e2, gname) => {
          if (e1 || e2) {
            self._logIf(LOG.WARN, `Error getting user/group name for file: ${util.inspect(e1 || e2)}`);
            fileInfos.push({
              file: files[ii],
              uname: null,
              gname: null,
            });
          } else {
            fileInfos.push({
              file: files[ii],
              uname,
              gname,
            });
          }
          handleFile(++i);
        });
      });
    }

    function finished() {
      // Sort file names.
      if (!self.server.options.dontSortFilenames) {
        if (self.server.options.filenameSortMap !== false) {
          const sm = (
            self.server.options.filenameSortMap
            || function (x) {
              return x.toUpperCase();
            }
          );
          for (let i = 0; i < fileInfos.length; ++i) {
            fileInfos[i]._s = sm(detailed ? fileInfos[i].file.name : fileInfos[i].name);
          }
        }

        const sf = (self.server.options.filenameSortFunc
            || function (x, y) {
              return x.localeCompare(y);
            });
        fileInfos = fileInfos.sort((x, y) => {
          if (self.server.options.filenameSortMap !== false) {
            return sf(x._s, y._s);
          } if (detailed) {
            return sf(x.file.name, y.file.name);
          }
          return sf(x.name, y.name);
        });
      }

      self._listFiles(fileInfos, detailed, cmd);
    }
  }, self.server.options.noWildcards);
};

FtpConnection.prototype._listFiles = function (fileInfos, detailed, cmd) {
  const self = this;

  let m = '150 Here comes the directory listing';
  const BEGIN_MSGS = {
    LIST: m, NLST: m, STAT: '213-Status follows',
  };
  m = '226 Transfer OK';
  const END_MSGS = {
    LIST: m, NLST: m, STAT: '213 End of status',
  };

  self.respond(BEGIN_MSGS[cmd], () => {
    if (cmd === 'STAT') {
      whenReady(self.socket);
    } else {
      self._whenDataReady(whenReady);
    }

    function whenReady(listconn) {
      if (fileInfos.length === 0) {
        return success();
      }

      function success(err) {
        if (err) {
          self.respond('550 Error listing files');
        } else {
          self.respond(END_MSGS[cmd]);
        }
        if (cmd !== 'STAT') {
          self._closeSocket(listconn);
        }
      }

      self._logIf(LOG.DEBUG, 'Sending file list');

      for (let i = 0; i < fileInfos.length; ++i) {
        const fileInfo = fileInfos[i];

        let line = '';
        let file;

        if (!detailed) {
          file = fileInfo;
          line += `${file.name}\r\n`;
        } else {
          file = fileInfo.file;
          const s = file.stats;
          const allModes = (new StatMode({ mode: s.mode })).toString();
          const rwxModes = allModes.substr(1, 9);
          line += (s.isDirectory() ? 'd' : '-') + rwxModes;
          // ^-- Clients don't need to know about special files and pipes
          line += ` 1 ${
            fileInfo.uname || 'ftp'} ${
            fileInfo.gname === null ? 'ftp' : fileInfo.gname} `;
          line += `${leftPad(s.size.toString(), 12)} `;
          const d = new Date(s.mtime);
          line += `${leftPad(dateformat(d, 'mmm dd HH:MM'), 12)} `;
          line += file.name;
          line += '\r\n';
        }
        self._writeText(
          listconn,
          line,
          (i === fileInfos.length - 1 ? success : undefined),
        );
      }
    }
  });
};

// Create a directory
FtpConnection.prototype._command_MKD = function (pathRequest) {
  const pathServer = withCwd(this.cwd, pathRequest);
  const pathEscaped = pathEscape(pathServer);
  const pathFs = pathModule.join(this.root, pathServer);
  this.fs.mkdir(pathFs, MODE_755, (err) => {
    if (err) {
      this._logIf(LOG.ERROR, `MKD ${pathRequest}: ${err}`);
      this.respond(`550 "${pathEscaped}" directory NOT created`);
    } else {
      this.respond(`257 "${pathEscaped}" directory created`);
    }
  });
  return this;
};

// Perform a no-op (used to keep-alive connection)
FtpConnection.prototype._command_NOOP = function () {
  this.respond('200 OK');
  return this;
};

FtpConnection.prototype._command_PORT = function (x, y) {
  this._PORT(x, y);
};

FtpConnection.prototype._command_EPRT = function (x, y) {
  this._PORT(x, y);
};

FtpConnection.prototype._PORT = function (commandArg, command) {
  const self = this;
  let m;
  let host;
  let port;

  self.dataConfigured = false;
  self._closeDataConnections();

  if (command === 'PORT') {
    m = commandArg.match(/^([0-9]{1,3}),([0-9]{1,3}),([0-9]{1,3}),([0-9]{1,3}),([0-9]{1,3}),([0-9]{1,3})$/);
    if (!m) {
      self.respond('501 Bad argument to PORT');
      return;
    }

    host = `${m[1]}.${m[2]}.${m[3]}.${m[4]}`;
    port = (parseInt(m[5], 10) << 8) + parseInt(m[6], 10);
    if (isNaN(port)) {
      // The value should never be NaN because the relevant groups in the regex matche 1-3 digits.
      throw new Error('Impossible NaN in FtpConnection.prototype._PORT');
    }
  } else { // EPRT
    if (commandArg.length >= 3 && commandArg.charAt(0) === '|'
        && commandArg.charAt(2) === '|' && commandArg.charAt(1) === '2') {
      // Only IPv4 is supported.
      self.respond('522 Server cannot handle IPv6 EPRT commands, use (1)');
      return;
    }

    m = commandArg.match(/^\|1\|([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})\|([0-9]{1,5})/);
    if (!m) {
      self.respond('501 Bad Argument to EPRT');
      return;
    }

    const r = parseInt(m[2], 10);
    if (isNaN(r)) {
      // The value should never be NaN because the relevant group in the regex matches 1-5 digits.
      throw new Error('Impossible NaN in FtpConnection.prototype._PORT (2)');
    }

    host = m[1];
    port = r;
  }

  if (port > 65535 || port < 1024) {
    self.respond(`501 Bad argument to ${command} (invalid port number)`);
    return;
  }

  self.dataConfigured = true;
  self.dataHost = host;
  self.dataPort = port;
  self._logIf(LOG.DEBUG, `self.dataHost, self.dataPort set to ${self.dataHost}:${self.dataPort}`);
  self.respond('200 OK');
};

FtpConnection.prototype._command_PASV = function (x, y) {
  this._PASV(x, y);
};

FtpConnection.prototype._command_EPSV = function (x, y) {
  this._PASV(x, y);
};

FtpConnection.prototype._PASV = function (commandArg, command) {
  const self = this;

  self.dataConfigured = false;

  if (command === 'EPSV' && commandArg && commandArg !== '1') {
    self.respond('202 Not supported');
    return;
  }

  // not sure whether the spec limits to 1 data connection at a time ...
  if (self.dataSocket) {
    self._closeSocket(self.dataSocket, true);
  }

  if (self.dataListener) {
    self._logIf(LOG.DEBUG, 'Telling client that they can connect now');
    self._writePASVReady(command);
  } else {
    self._logIf(LOG.DEBUG, 'Setting up listener for passive connections');
    self._setupNewPASV(commandArg, command);
  }

  self.dataConfigured = true;
};

FtpConnection.prototype._writePASVReady = function (command) {
  const self = this;

  const a = self.pasv.address();
  const { host } = self.server;
  const { port } = a;
  if (command === 'PASV') {
    const i1 = (port / 256) | 0;
    const i2 = port % 256;
    self.respond(`227 Entering Passive Mode (${host.split('.').join(',')},${i1},${i2})`);
  } else { // EPASV
    self.respond(`229 Entering Extended Passive Mode (|||${port}|)`);
  }
};

FtpConnection.prototype._setupNewPASV = function (commandArg, command) {
  const self = this;

  const pasv = self._createPassiveServer();
  let portRangeErrorHandler;

  function normalErrorHandler(e) {
    self._logIf(LOG.WARN, `Error with passive data listener: ${util.inspect(e)}`);
    self.respond('421 Server was unable to open passive connection listener');
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
    let i = self.server.options.pasvPortRangeStart;
    pasv.listen(i);
    portRangeErrorHandler = function (e) {
      if (e.code === 'EADDRINUSE' && i < self.server.options.pasvPortRangeEnd) {
        pasv.listen(++i);
      } else {
        self._logIf(LOG.DEBUG, `Passing on error from portRangeErrorHandler to normalErrorHandler:${JSON.stringify(e)}`);
        normalErrorHandler(e);
      }
    };
    pasv.on('error', portRangeErrorHandler);
  } else {
    pasv.listen(0);
    pasv.on('error', normalErrorHandler);
  }

  // Once we're successfully listening, tell the client
  pasv.on('listening', () => {
    self.pasv = pasv;

    if (portRangeErrorHandler) {
      pasv.removeListener('error', portRangeErrorHandler);
      pasv.addListener('error', normalErrorHandler);
    }

    self._logIf(LOG.DEBUG, 'Passive data connection beginning to listen');

    const { port } = pasv.address();
    self.dataListener = new PassiveListener();
    self._logIf(LOG.DEBUG, `Passive data connection listening on port ${port}`);
    self._writePASVReady(command);
  });
  pasv.on('close', () => {
    self.pasv = null;
    self.dataListener = null;
    self._logIf(LOG.DEBUG, 'Passive data listener closed');
  });
};

FtpConnection.prototype._command_PBSZ = function (commandArg) {
  const self = this;

  if (!self.server.options.tlsOptions) {
    return self.respond('202 Not supported');
  }

  // Protection Buffer Size (RFC 2228)
  if (!self.secure) {
    self.respond('503 Secure connection not established');
  } else if (parseInt(commandArg, 10) !== 0) {
    // RFC 2228 specifies that a 200 reply must be sent specifying a more
    // satisfactory PBSZ size (0 in our case, since we're using TLS).
    // Doubt that this will do any good if the client was already confused
    // enough to send a non-zero value, but ok...
    self.pbszReceived = true;
    self.respond('200 buffer too big, PBSZ=0');
  } else {
    self.pbszReceived = true;
    self.respond('200 OK');
  }
};

FtpConnection.prototype._command_PROT = function (commandArg) {
  const self = this;

  if (!self.server.options.tlsOptions) {
    return self.respond('202 Not supported');
  }

  if (!self.pbszReceived) {
    self.respond('503 No PBSZ command received');
  } else if (commandArg === 'S' || commandArg === 'E' || commandArg === 'C') {
    self.respond('536 Not supported');
  } else if (commandArg === 'P') {
    self.respond('200 OK');
  } else {
    // Don't even recognize this one...
    self.respond('504 Not recognized');
  }
};

// Print the current working directory.
FtpConnection.prototype._command_PWD = function (commandArg) {
  const pathEscaped = pathEscape(this.cwd);
  if (commandArg === '') {
    this.respond(`257 "${pathEscaped}" is current directory`);
  } else {
    this.respond('501 Syntax error in parameters or arguments.');
  }
  return this;
};

FtpConnection.prototype._command_QUIT = function () {
  const self = this;

  self.hasQuit = true;
  self.respond('221 Goodbye', (err) => {
    if (err) {
      self._logIf(LOG.ERROR, "Error writing 'Goodbye' message following QUIT");
    }
    self._closeSocket(self.socket, true);
    self._closeDataConnections();
  });
};

FtpConnection.prototype._command_RETR = function (commandArg) {
  const filename = pathModule.join(this.root, withCwd(this.cwd, commandArg));

  if (this.server.options.useReadFile) {
    this._RETR_usingReadFile(commandArg, filename);
  } else {
    this._RETR_usingCreateReadStream(commandArg, filename);
  }
};

FtpConnection.prototype._RETR_usingCreateReadStream = function (commandArg, filename) {
  const self = this;
  const startTime = new Date();

  self.emit('file:retr', 'open', {
    user: self.username,
    file: filename,
    sTime: startTime,
  });

  function afterOk(callback) {
    self.respond(`150 Opening ${self.mode.toUpperCase()} mode data connection`, callback);
  }


  self.fs.open(filename, 'r', (err, fd) => {
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
        self._logIf(LOG.ERROR, `Error at read of '${filename}' other than ENOENT ${err}`);
      }
    } else {
      afterOk(() => {
        self._whenDataReady((pasvconn) => {
          let readLength = 0;
          const now = new Date();
          const rs = self.fs.createReadStream(null, { fd });
          rs.pause();
          rs.once('error', (err) => {
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

          rs.on('data', (buffer) => {
            readLength += buffer.length;
          });

          rs.on('end', () => {
            const now = new Date();
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
            self.respond(`226 Closing data connection, sent ${readLength} bytes`);
          });

          rs.pipe(pasvconn);
          rs.resume();
        });
      });
    }
  });
};

FtpConnection.prototype._RETR_usingReadFile = function (commandArg, filename) {
  const self = this;
  const startTime = new Date();

  self.emit('file:retr', 'open', {
    user: self.username,
    file: filename,
    sTime: startTime,
  });

  function afterOk(callback) {
    self.respond(`150 Opening ${self.mode.toUpperCase()} mode data connection`, callback);
  }

  self.fs.readFile(filename, (err, contents) => {
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
        self._logIf(LOG.ERROR, `Error at read of '${filename}' other than ENOENT ${err}`);
      }
    } else {
      afterOk(() => {
        self._whenDataReady((pasvconn) => {
          contents = { filename, data: contents };
          self.emit('file:retr:contents', contents);
          contents = contents.data;
          pasvconn.write(contents);
          const contentLength = contents.length;
          self.respond(`226 Closing data connection, sent ${contentLength} bytes`);
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
          self._closeSocket(pasvconn);
        });
      });
    }
  });
};

// Remove a directory
FtpConnection.prototype._command_RMD = function (pathRequest) {
  const pathServer = withCwd(this.cwd, pathRequest);
  const pathFs = pathModule.join(this.root, pathServer);
  this.fs.rmdir(pathFs, (err) => {
    if (err) {
      this._logIf(LOG.ERROR, `RMD ${pathRequest}: ${err}`);
      this.respond('550 Delete operation failed');
    } else {
      this.respond(`250 "${pathServer}" directory removed`);
    }
  });
  return this;
};

FtpConnection.prototype._command_RNFR = function (commandArg) {
  const self = this;
  self.filefrom = withCwd(self.cwd, commandArg);
  self._logIf(LOG.DEBUG, `Rename from ${self.filefrom}`);
  self.respond('350 Ready for destination name');
};

FtpConnection.prototype._command_RNTO = function (commandArg) {
  const self = this;
  const fileto = withCwd(self.cwd, commandArg);
  self.fs.rename(pathModule.join(self.root, self.filefrom), pathModule.join(self.root, fileto), (err) => {
    if (err) {
      self._logIf(LOG.ERROR, `Error renaming file from ${self.filefrom} to ${fileto}`);
      self.respond(`550 Rename failed${err.code === 'ENOENT' ? '; file does not exist' : ''}`);
    } else {
      self.respond('250 File renamed successfully');
    }
  });
};

FtpConnection.prototype._command_SIZE = function (commandArg) {
  const self = this;

  const filename = withCwd(self.cwd, commandArg);
  self.fs.stat(pathModule.join(self.root, filename), (err, s) => {
    if (err) {
      self._logIf(LOG.ERROR, `Error getting size of file '${filename}' `);
      self.respond('450 Failed to get size of file');
      return;
    }
    self.respond(`213 ${s.size}`);
  });
};

FtpConnection.prototype._command_TYPE = function (commandArg) {
  if (commandArg === 'I' || commandArg === 'A') {
    this.respond('200 OK');
  } else {
    this.respond('202 Not supported');
  }
};

FtpConnection.prototype._command_SYST = function () {
  this.respond('215 UNIX Type: I');
};

FtpConnection.prototype._command_STOR = function (commandArg) {
  const filename = withCwd(this.cwd, commandArg);

  if (this.server.options.useWriteFile) {
    this._STOR_usingWriteFile(filename, 'w');
  } else {
    this._STOR_usingCreateWriteStream(filename, null, 'w');
  }
};

// 'initialBuffers' argument is set when this is called from _STOR_usingWriteFile.
FtpConnection.prototype._STOR_usingCreateWriteStream = function (filename, initialBuffers, flag) {
  const self = this;

  const wStreamFlags = { flags: flag || 'w', mode: MODE_644 };
  const storeStream = self.fs.createWriteStream(pathModule.join(self.root, filename), wStreamFlags);
  let notErr = true;
  // Adding for event metadata for file upload (STOR)
  const startTime = new Date();

  if (initialBuffers) {
    // todo: handle back-pressure
    initialBuffers.forEach((b) => {
      storeStream.write(b);
    });
  }

  self._whenDataReady(handleUpload);

  storeStream.on('open', () => {
    self._logIf(LOG.DEBUG, `File opened/created: ${filename}`);
    self._logIf(LOG.DEBUG, 'Told client ok to send file data');
    // Adding event emitter for upload start time
    self.emit('file:stor', 'open', {
      user: self.username,
      file: filename,
      time: startTime,
    });

    self.respond('150 Ok to send data');
  });

  storeStream.on('error', () => {
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
    }
    self.respond('426 Connection closed; transfer aborted');
  });

  storeStream.on('finish', () => {
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
    }
  });

  function handleUpload(dataSocket) {
    dataSocket.pipe(storeStream);
    dataSocket.on('error', (err) => {
      notErr = false;
      self._logIf(LOG.ERROR, `Data connection error: ${util.inspect(err)}`);
    });
  }
};

FtpConnection.prototype._STOR_usingWriteFile = function (filename, flag) {
  const self = this;

  let erroredOut = false;
  let slurpBuf = Buffer.alloc(1024);
  let totalBytes = 0;
  const startTime = new Date();

  self.emit('file:stor', 'open', {
    user: self.username,
    file: filename,
    time: startTime,
  });

  self.respond('150 Ok to send data', () => {
    self._whenDataReady(handleUpload);
  });

  function handleUpload() {
    self.dataSocket.on('data', dataHandler);
    self.dataSocket.once('close', closeHandler);
    self.dataSocket.once('error', errorHandler);
  }

  function dataHandler(buf) {
    if (self.server.options.uploadMaxSlurpSize != null
        && totalBytes + buf.length > self.server.options.uploadMaxSlurpSize) {
      // Give up trying to slurp it -- it's too big.

      // If the 'fs' module we've been given doesn't implement 'createWriteStream', then
      // we give up and send the client an error.
      if (!self.fs.createWriteStream) {
        if (self.dataSocket) {
          self._closeSocket(self.dataSocket, true);
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
        let newLength = slurpBuf.length * 2;
        if (newLength < totalBytes + buf.length) {
          newLength = totalBytes + buf.length;
        }

        const newSlurpBuf = Buffer.alloc(newLength);
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

    const wOptions = { flag: flag || 'w', mode: MODE_644 };
    const contents = { filename, data: slurpBuf.slice(0, totalBytes) };
    self.emit('file:stor:contents', contents);
    self.fs.writeFile(pathModule.join(self.root, filename), contents.data, wOptions, (err) => {
      self.emit('file:stor', 'close', {
        user: self.username,
        file: filename,
        /** @deprecated filesize is deprecated, use bytesRead/bytesWritten instead */
        filesize: totalBytes,
        bytesWritten: totalBytes,
        sTime: startTime,
        eTime: new Date(),
        duration: new Date() - startTime,
        errorState: !!err,
      });
      if (err) {
        erroredOut = true;
        self._logIf(LOG.ERROR, `Error writing file. ${err}`);
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
    erroredOut = true;
  }
};

FtpConnection.prototype._command_APPE = function (commandArg) {
  const filename = withCwd(this.cwd, commandArg);

  if (this.server.options.useWriteFile) {
    this._STOR_usingWriteFile(filename, 'a');
  } else {
    this._STOR_usingCreateWriteStream(filename, null, 'a');
  }
};

// Specify a username for login
FtpConnection.prototype._command_USER = function (username) {
  const self = this;

  if (self.server.options.tlsOnly && !self.secure) {
    self.respond(
      '530 This server does not permit login over '
      + 'a non-secure connection; '
      + 'connect using FTP-SSL with explicit AUTH TLS',
    );
  } else {
    self.emit('command:user', username,
      () => {
        self.respond('331 User name okay, need password.');
      },
      () => {
        self.respond('530 Not logged in.');
      });
  }
  return this;
};

// Specify a password for login
FtpConnection.prototype._command_PASS = function (password) {
  const self = this;

  if (self.previousCommand !== 'USER') {
    self.respond('503 Bad sequence of commands.');
  } else {
    self.emit('command:pass', password,
      (username, userFsModule) => {
        function panic(error, method) {
          self._logIf(LOG.ERROR, `${method} signaled error ${util.inspect(error)}`);
          self.respond('421 Service not available, closing control connection.', () => {
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
            self.server.getRoot(self, (err, root) => {
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
          self.server.getInitialCwd(self, (err, cwd) => {
            if (err) {
              panic(err, 'getInitialCwd');
            } else {
              setCwd(withCwd(cwd));
            }
          });
        }
      },
      () => {
        self.respond('530 Not logged in.');
        self.username = null;
      });
  }
  return this;
};

FtpConnection.prototype._closeSocket = function (socket, shouldDestroy) {
  // TODO: Should we always use destroy() to avoid keeping sockets open longer
  // than necessary (and possibly exceeding OS max open sockets)?
  if (shouldDestroy || this.server.options.destroySockets) {
    // Don't call destroy() more than once.
    if (!socket.destroyed) {
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

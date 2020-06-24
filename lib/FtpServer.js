var net = require('net');
var util = require('util');
var events = require('events');
var FtpConnection = require('./FtpConnection');
var Constants = require('./Constants');

var EventEmitter = events.EventEmitter;

// Use LOG for brevity.
var LOG = Constants.LOG_LEVELS;

function FtpServer(host, options) {
  var self = this;
  EventEmitter.call(self);

  self.host = host;

  self.options = options;

  if (!self.options.maxStatsAtOnce) {
    self.options.maxStatsAtOnce = 5;
  }

  if (!options.getInitialCwd) {
    throw new Error("'getInitialCwd' option of FtpServer must be set");
  }
  if (!options.getRoot) {
    throw new Error("'getRoot' option of FtpServer must be set");
  }
  self.getInitialCwd = options.getInitialCwd;
  self.getRoot = options.getRoot;

  self.getUsernameFromUid = options.getUsernameFromUid || function(uid, c) {
    process.nextTick(c, null, 'ftp');
  };
  self.getGroupFromGid = options.getGroupFromGid || function(gid, c) {
    process.nextTick(c, null, 'ftp');
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
util.inherits(FtpServer, EventEmitter);

FtpServer.prototype._onConnection = function(socket) {
  // build an index for the allowable commands for this server
  var allowedCommands = null;
  if (this.options.allowedCommands) {
    allowedCommands = {};
    this.options.allowedCommands.forEach(function(c) {
      allowedCommands[c.trim().toUpperCase()] = true;
    });
  }

  var conn = new FtpConnection({
    server: this,
    socket: socket,
    pasv: null, // passive listener server
    allowedCommands: allowedCommands, // subset of allowed commands for this server
    dataPort: 20,
    dataHost: null,
    dataSocket: null, // the actual data socket
    // True if the client has sent a PORT/PASV command, and
    // we haven't experienced a problem with the configuration
    // it specified. (This can therefore be true even if there
    // is not currently an open data connection.)
    dataConfigured: false,
    mode: 'ascii',
    filefrom: '',
    username: null,
    filename: '',
    fs: null,
    cwd: null,
    root: null,
    hasQuit: false,

    // State for handling TLS upgrades.
    secure: false,
    pbszReceived: false,
  });

  this.emit('client:connected', conn); // pass client info so they can listen for client-specific events

};

['listen', 'close'].forEach(function(fname) {
  FtpServer.prototype[fname] = function() {
    return this.server[fname].apply(this.server, arguments);
  };
});

FtpServer.prototype._logIf = function(verbosity, message, conn) {
  if (verbosity > this.debugging) {
    return;
  }
  // TODO: Move this to FtpConnection.prototype._logIf.
  var peerAddr = (conn && conn.socket && conn.socket.remoteAddress);
  if (peerAddr) {
    message = '<' + peerAddr + '> ' + message;
  }
  if (verbosity === LOG.ERROR) {
    message = 'ERROR: ' + message;
  } else if (verbosity === LOG.WARN) {
    message = 'WARNING: ' + message;
  }
  console.log(message);
  var isError = (verbosity === LOG.ERROR);
  if (isError && this.debugging === LOG.TRACE) {
    console.trace('Trace follows');
  }
};

module.exports = FtpServer;

import net from 'net';
import events from 'events';
import FtpConnection from './FtpConnection';
import Constants from './Constants';

var {EventEmitter} = events;

// Use LOG for brevity.
var LOG = Constants.LOG_LEVELS;
var DEFAULT_OPTIONS = {
  logLevel: 0,
  maxStatsAtOnce: 5,
  uploadMaxSlurpSize: null,
  getGroupFromGid: (gid, c) => {
    c(null, 'ftp');
  },
  getUsernameFromUid: (uid, c) => {
    c(null, 'ftp');
  },
};

class FtpServer extends EventEmitter {
  constructor(host, options) {
    super();
    this.host = host;
    options = Object.assign({}, DEFAULT_OPTIONS, options);
    if (!options.getInitialCwd) {
      throw new Error("'getInitialCwd' option of FtpServer must be set");
    }
    if (!options.getRoot) {
      throw new Error("'getRoot' option of FtpServer must be set");
    }
    this.options = options;
    this.getInitialCwd = options.getInitialCwd;
    this.getRoot = options.getRoot;
    this.getUsernameFromUid = options.getUsernameFromUid;
    this.getGroupFromGid = options.getGroupFromGid;
    this.useWriteFile = options.useWriteFile;
    this.useReadFile = options.useReadFile;
    this.server = net.createServer();
    this.server.on('connection', (socket) => {
      this._onConnection(socket);
    });
    this.server.on('error', (err) => {
      this.emit('error', err);
    });
    this.server.on('close', () => {
      this.emit('close');
    });
    this.passiveListenerPool = new PassiveListenerPool({
      bindAddress: BIND_ADDRESS,
      portRange: [options.pasvPortRangeStart, options.pasvPortRangeEnd],
    });
  }

  _onConnection(socket) {
    // build an index for the allowable commands for this server
    var allowedCommands = null;
    if (this.options.allowedCommands) {
      allowedCommands = {};
      this.options.allowedCommands.forEach((c) => {
        allowedCommands[c.trim().toUpperCase()] = true;
      });
    }

    var conn = new FtpConnection({
      server: this,
      socket: socket,
      passiveListenerPool: this.passiveListenerPool,
      // subset of allowed commands for this server
      allowedCommands: allowedCommands,
      tlsOptions: this.options.tlsOptions,
    });

    this.emit('client:connected', conn); // pass client info so they can listen for client-specific events

    socket.setTimeout(0);
    socket.setNoDelay();

    this._log(LOG.INFO, 'Accepted a new client connection');
    conn.respond('220 FTP server (nodeftpd) ready');

    socket.on('data', (buf) => {
      conn._onData(buf);
    });
    socket.on('end', () => {
      conn._onEnd();
    });
    socket.on('error', (err) => {
      conn._onError(err);
    });
    // `close` will always be called once (directly after `end` or `error`)
    socket.on('close', (hadError) => {
      conn._onClose(hadError);
    });
  }

  _log(verbosity, message) {
    if (verbosity > this.options.logLevel) {
      return;
    }
    if (verbosity === LOG.ERROR) {
      message = 'ERROR: ' + message;
    } else if (verbosity === LOG.WARN) {
      message = 'WARNING: ' + message;
    }
    console.log(message);
    var isError = (verbosity === LOG.ERROR);
    if (isError && this.options.logLevel === LOG.TRACE) {
      console.trace('Trace follows');
    }
  }

  listen() {
    this.server.listen(...arguments);
  }

  close() {
    this.server.close(...arguments);
  }
}

export default FtpServer;

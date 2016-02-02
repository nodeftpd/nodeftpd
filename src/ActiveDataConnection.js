/* @//flow */

import net from 'net';
import {EventEmitter} from 'events';

import starttls from './starttls';

export const CONNECTION_STATE = {
  INITIALIZING: 0,     // Connection is not yet ready (initial state).
  INITIALIZING_TLS: 1, // Client is connected but we are negotiating TLS.
  READY: 2,            // Client is connected and socket is ready.
  CLOSED: 3,           // Connection is closed (error or normal connection end).
};

export const LISTENER_STATE = {
  INITIALIZING: 0, // Initial state.
  LISTENING: 1,    // Listener is waiting for client to connect.
  CLOSED: 2,       // Listener has stopped listening (connections may still exist).
};

export class ActiveDataConnection extends EventEmitter {
  constructor(port, remoteAddress, options) {
    super();
    // It's important to store the listening port here so the control connection
    // can send: 227 Entering Passive Mode (<IP_INFO>,<PORT_INFO>)
    this.port = port;
    this.remoteAddress = remoteAddress;
    this.state = CONNECTION_STATE.WAITING;
    this._useTLS = options.useTLS;
    this._socket = null;
    // Auto-bind methods.
    this._onError = this._onError.bind(this);
    this._close = this._close.bind(this);
  }

  getSocket() {
    return this._socket;
  }

  // This is not really a public method, except for use from the code that
  // created this instance.
  setSocket(socket) {
    if (this._socket) {
      throw new Error('DataConnection: method setSocket() called more than once.');
    }
    if (!this._useTLS) {
      this._socket = socket;
      this.state = CONNECTION_STATE.READY;
      socket.on('error', this._onError);
      socket.on('close', this._close);
      this.emit('ready', socket);
      return;
    }
    this.state = CONNECTION_STATE.INITIALIZING_TLS;
    this._upgradeConnection(socket, (error, cleartext) => {
      this._socket = cleartext;
      this.state = CONNECTION_STATE.READY;
      cleartext.on('error', this._onError);
      cleartext.on('close', this._close);
      this.emit('ready', cleartext);
    });
  }

  _upgradeConnection(rawSocket, callback) {
    // this._log(LOG.INFO, 'Upgrading passive connection to TLS');
    let {tlsOptions} = this.options;
    starttls.starttlsServer(rawSocket, tlsOptions, (error, cleartext) => {
      if (error) {
        // this._log(LOG.ERROR, 'Error upgrading passive connection to TLS:' + util.inspect(error));
        this._closeSocket(rawSocket, true);
        callback(error);
        return;
      }

      if (cleartext.authorized || this.options.allowUnauthorizedTls) {
        // this._log(LOG.INFO, 'Allowing unauthorized connection (allowUnauthorizedTls is on)');
        // this._log(LOG.INFO, 'Passive connection secured');
        callback(null, cleartext);
      } else {
        // this._log(LOG.INFO, 'Closing unauthorized connection (allowUnauthorizedTls is off)');
        this._closeSocket(rawSocket, true);
      }
    });
  }

  destroy() {
    if (this._socket) {
      this._socket.destroy(); // Will automatically emit `close`;
    } else {
      this._close();
    }
  }

  _onError(error) {
    this.emit('error', error);
    process.nextTick(this._close);
  }

  _close() {
    if (this.state === CONNECTION_STATE.CLOSED) {
      return;
    }
    this.state = CONNECTION_STATE.CLOSED;
    this.emit('close');
  }
}

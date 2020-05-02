// Modified slightly from
// https://github.com/andris9/rai/blob/master/lib/starttls.js
// (This code is MIT licensed.)

//
// Target API:
//
//  var s = require('net').createStream(25, 'smtp.example.com');
//  s.on('connect', function() {
//    require('starttls')(s, options, function() {
//      if (!s.authorized) {
//        s.destroy();
//        return;
//      }
//
//      s.end("hello world\n");
//    });
//  });
//
//

const tls = require('tls');
const crypto = require('crypto');

// From Node docs for TLS module.
const RECOMMENDED_CIPHERS = 'ECDHE-RSA-AES256-SHA:AES256-SHA:RC4-SHA:RC4:HIGH:!MD5:!aNULL:!EDH:!AESGCM';

function starttlsServer(socket, options, callback) {
  return starttls(socket, options, callback, true);
}
function starttlsClient(socket, options, callback) {
  return starttls(socket, options, callback, false);
}

function starttls(socket, options, callback, isServer) {
  let sslcontext;

  const opts = {};
  Object.keys(options).forEach((key) => {
    opts[key] = options[key];
  });
  if (!opts.ciphers) {
    opts.ciphers = RECOMMENDED_CIPHERS;
  }

  socket.removeAllListeners('data');
  if (tls.createSecureContext) {
    sslcontext = tls.createSecureContext(opts);
  } else {
    sslcontext = crypto.createCredentials(opts);
  }
  const pair = tls.createSecurePair(sslcontext, isServer);
  const cleartext = pipe(pair, socket);

  let erroredOut = false;
  pair.on('secure', () => {
    if (erroredOut) {
      pair.end();
      return;
    }

    const verifyError = (pair._ssl || pair.ssl).verifyError();

    if (verifyError) {
      cleartext.authorized = false;
      cleartext.authorizationError = verifyError;
    } else {
      cleartext.authorized = true;
    }

    callback(null, cleartext);
  });
  pair.once('error', (err) => {
    if (!erroredOut) {
      erroredOut = true;
      callback(err);
    }
  });

  cleartext._controlReleased = true;
  pair;
}

function forwardEvents(events, emitterSource, emitterDestination) {
  const map = [];

  for (let i = 0, len = events.length; i < len; i++) {
    const name = events[i];

    const handler = forwardEvent.bind(emitterDestination, name);

    map.push(name);
    emitterSource.on(name, handler);
  }

  return map;
}

function forwardEvent() {
  this.emit.apply(this, arguments);
}

function removeEvents(map, emitterSource) {
  for (let i = 0, len = map.length; i < len; i++) {
    emitterSource.removeAllListeners(map[i]);
  }
}

function pipe(pair, socket) {
  pair.encrypted.pipe(socket);
  socket.pipe(pair.encrypted);

  pair.fd = socket.fd;

  const { cleartext } = pair;

  cleartext.socket = socket;
  cleartext.encrypted = pair.encrypted;
  cleartext.authorized = false;

  function onerror(e) {
    if (cleartext._controlReleased) {
      cleartext.emit('error', e);
    }
  }

  const map = forwardEvents(['timeout', 'end', 'close', 'drain', 'error'], socket, cleartext);

  function onclose() {
    socket.removeListener('error', onerror);
    socket.removeListener('close', onclose);
    removeEvents(map, socket);
  }

  socket.on('error', onerror);
  socket.on('close', onclose);

  return cleartext;
}

exports.starttlsServer = starttlsServer;
exports.starttlsClient = starttlsClient;
exports.RECOMMENDED_CIPHERS = RECOMMENDED_CIPHERS;

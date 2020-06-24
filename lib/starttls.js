// Modified slightly from
// https://github.com/andris9/rai/blob/master/lib/starttls.js
// (This code is MIT licensed.)

var tls = require('tls');

// From Node docs for TLS module.
var RECOMMENDED_CIPHERS = 'ECDHE-RSA-AES256-SHA:AES256-SHA:RC4-SHA:RC4:HIGH:!MD5:!aNULL:!EDH:!AESGCM';

function starttlsServer(socket, options, callback) {
  return starttls(socket, options, callback, true);
}
function starttlsClient(socket, options, callback) {
  return starttls(socket, options, callback, false);
}

function starttls(socket, options, callback, isServer) {
  var opts = {};

  Object.keys(options).forEach(function(key) {
    opts[key] = options[key];
  });
  if (!opts.ciphers) {
    opts.ciphers = RECOMMENDED_CIPHERS;
  }
  opts.isServer = isServer;
  opts.secureContext = tls.createSecureContext(opts);

  var secureSocket = new tls.TLSSocket(socket, opts);
  var erroredOut = false;

  // NodeJS documentation bug: secure vs secureConnect
  // https://github.com/nodejs/node/issues/10555
  secureSocket.on('secure', function() {
    if (erroredOut) {
      secureSocket.end();
      return;
    }

    var authError = secureSocket.ssl.verifyError();
    if (authError) {
        secureSocket.authorized = false;
        secureSocket.authorizationError = authError;
    } else {
        secureSocket.authorized = true;
    }
    callback(null, secureSocket);
  });
  secureSocket.once('error', function(err) {
    if (!erroredOut) {
      erroredOut = true;
      callback(err);
    }
  });
}

exports.starttlsServer = starttlsServer;
exports.starttlsClient = starttlsClient;
exports.RECOMMENDED_CIPHERS = RECOMMENDED_CIPHERS;


// Modified slightly from
// https://github.com/andris9/rai/blob/master/lib/starttls.js
// (This code is MIT licensed.)

//
// Target API:
//
//  var s = require('net').createStream(25, 'smtp.example.com');
//  s.on('connect', function() {
//   require('starttls')(s, options, function() {
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

var CIPHERS = 'RC4-SHA:AES128-SHA:AES256-SHA';

function starttls(socket, options, callback) {
    var sslcontext, pair, cleartext;

    var opts = { };
    for (k in options) {
        opts[k] = options[k];
    }
    if (! opts.ciphers)
        opts.ciphers = CIPHERS;
    
    socket.removeAllListeners("data");
    sslcontext = require('crypto').createCredentials(opts);
    pair = require('tls').createSecurePair(sslcontext, true);
    cleartext = pipe(pair, socket);

    var erroredOut = false;
    pair.on('secure', function() {
        if (erroredOut) {
            pair.end();
            return;
        }

        var verifyError = (pair._ssl || pair.ssl).verifyError();

        if (verifyError) {
            cleartext.authorized = false;
            cleartext.authorizationError = verifyError;
        } else {
            cleartext.authorized = true;
        }

        callback(null, cleartext);
    });
    pair.on('error', function (err) {
        erroredOut = true;
        callback(err);
    });

    cleartext._controlReleased = true;
    pair;
}

function forwardEvents(events, emitterSource, emitterDestination) {
    var map = [], name, handler;
    
    for(var i = 0, len = events.length; i < len; i++) {
        name = events[i];

        handler = forwardEvent.bind(emitterDestination, name);
        
        map.push(name);
        emitterSource.on(name, handler);
    }
    
    return map;
}

function forwardEvent() {
    this.emit.apply(this, arguments);
}

function removeEvents(map, emitterSource) {
    for(var i = 0, len = map.length; i < len; i++){
        emitterSource.removeAllListeners(map[i]);
    }
}

function pipe(pair, socket) {
    pair.encrypted.pipe(socket);
    socket.pipe(pair.encrypted);

    pair.fd = socket.fd;
    
    var cleartext = pair.cleartext;
  
    cleartext.socket = socket;
    cleartext.encrypted = pair.encrypted;
    cleartext.authorized = false;

    function onerror(e) {
        if (cleartext._controlReleased) {
            cleartext.emit('error', e);
        }
    }

    var map = forwardEvents(["timeout", "end", "close", "drain", "error"], socket, cleartext);
  
    function onclose() {
        socket.removeListener('error', onerror);
        socket.removeListener('close', onclose);
        removeEvents(map,socket);
    }

    socket.on('error', onerror);
    socket.on('close', onclose);

    return cleartext;
}

module.exports = starttls;
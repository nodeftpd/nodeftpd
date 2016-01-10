'use strict';

var path = require('path');
var fs = require('fs');
var ftpd = require('../../');
var Client = require('jsftp');
var should = require('should');

var Server = ftpd.FtpServer;
var LogLevels = ftpd.LOG_LEVELS;
var LogLevelNames = Object.keys(LogLevels).reduce(function(map, name) {
  var value = LogLevels[name];
  map[value] = name;
  return map;
}, {});

var fixturesPath = path.join(__dirname, '../../fixture');

function toString(value) {
  var isPrimitive = Object(value) !== value;
  if (isPrimitive) {
    return JSON.stringify(value);
  } else {
    return ('toString' in value) ? value.toString() : Object.prototype.toString(value);
  }
}

var options = {
  host: process.env.IP || '127.0.0.1',
  port: process.env.port || 7002,
  user: 'jose',
  pass: 'esoj',
  tlsOnly: false,
  getInitialCwd: function() {
    return options.cwd;
  },
  getRoot: function(connection, callback) {
    var username = connection.username;
    var root = path.join(fixturesPath, username);
    fs.realpath(root, callback);
  },
};

module.exports = {
  should: should,

  fixturesPath: function() {
    return fixturesPath;
  },

  server: function(customOptions) {
    customOptions = customOptions || {};
    Object.keys(options).forEach(function(key) {
      if (!customOptions.hasOwnProperty(key)) {
        customOptions[key] = options[key];
      }
    });
    var server = new Server(customOptions.host, customOptions);
    server.on('client:connected', function(connection) {
      var username;
      connection.on('command:user', function(user, success, failure) {
        if (user === customOptions.user) {
          username = user;
          success();
        } else {
          failure();
        }
      });
      connection.on('command:pass', function(pass, success, failure) {
        if (pass === customOptions.pass) {
          success(username);
        } else {
          failure();
        }
      });
    });
    var origLogIf = server._logIf;
    server.suppressExpecteErrMsgs = [];
    server._logIf = function logIfNotExpected(verbosity, message, conn) {
      var expecteErrMsgs = server.suppressExpecteErrMsgs;
      message = String(message).split(fixturesPath).join('fixture:/');
      if ((expecteErrMsgs.length > 0) && (verbosity < LogLevels.LOG_INFO)) {
        var expected = expecteErrMsgs.shift();
        if (message === expected) {
          return;
        }
        if ((expected instanceof RegExp) && expected.test(message)) {
          return;
        }
        if ((typeof expected) === 'function') {
          message = expected(message);
          if (message === '') {
            return;
          }
        } else {
          console.error(
            '\nExpected log message:\n' + toString(expected) + '\n' +
            'did not match [' + LogLevelNames[verbosity] + ']:\n' +
            JSON.stringify(message)
          );
        }
      }
      return origLogIf.call(this, verbosity, message, conn);
    };
    server.listen(customOptions.port);
    return server;
  },

  client: function(done, customOptions) {
    customOptions = customOptions || {};
    Object.keys(options).forEach(function(key) {
      if (!customOptions.hasOwnProperty(key)) {
        customOptions[key] = options[key];
      }
    });
    var client = new Client({
      host: customOptions.host,
      port: customOptions.port,
    });
    client.auth(
      customOptions.user,
      customOptions.pass,
      function(error, response) {
        should.not.exist(error);
        should.exist(response);
        response.should.have.property('code', 230);
        done();
      }
    );
    return client;
  },
};

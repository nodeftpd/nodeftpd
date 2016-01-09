var path = require('path');
var fs = require('fs');
var Server = require('../../').FtpServer;
var Client = require('jsftp');
var should = require('should');
var fixturesPath = path.join(__dirname, '../../fixture');
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
    'use strict';
    var srv;
    var origLogIf;
    customOptions = customOptions || {};
    Object.keys(options).forEach(function(key) {
      if (!customOptions.hasOwnProperty(key)) {
        customOptions[key] = options[key];
      }
    });
    srv = new Server(customOptions.host, customOptions);
    srv.on('client:connected', function(connection) {
      var username;
      connection.on('command:user', function(user, success, failure) {
        if (user === customOptions.user) {
          username = user;
          success();
        } else {
          failure();
        }
      }).on('command:pass', function(pass, success, failure) {
        if (pass === customOptions.pass) {
          success(username);
        } else {
          failure();
        }
      });
    });
    origLogIf = srv._logIf;
    srv.suppressExpecteErrMsgs = [];
    srv._logIf = function logIfNotExpected(verbosity, msg, conn, isErr) {
      // TODO: remove this when we implement better noise control for logging.
      if (msg === 'Client connection closed') {
        return;
      }
      var xpct = srv.suppressExpecteErrMsgs;
      msg = String(msg);
      msg = msg.replace(new RegExp(fixturesPath.replace(/(\W)/g, '\\$1'),
        'g'), 'fixture:/');
      if ((xpct.length > 0) && (verbosity < 2)) {
        xpct = xpct.shift();
        if (msg === xpct) {
          return;
        }
        if ((xpct instanceof RegExp) && xpct.test(msg)) {
          return;
        }
        if ((typeof xpct) === 'function') {
          msg = xpct(msg);
          if (msg === '') {
            return;
          }
        } else {
          console.error('\nExpected log msg\t' +
            ((typeof xpct) === 'string' ? JSON.stringify(xpct) : String(xpct)));
          console.error('did not match [' + verbosity + ']\t' +
            JSON.stringify(msg));
        }
      }
      return origLogIf.call(this, verbosity, msg, conn, isErr);
    };
    srv.listen(customOptions.port);
    return srv;
  },
  client: function(done, customOptions) {
    'use strict';
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
    client.auth(customOptions.user, customOptions.pass,
      function(error, response) {
        should.not.exist(error);
        should.exist(response);
        response.should.have.property('code', 230);
        done();
      });
    return client;
  },
};

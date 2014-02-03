var path = require('path');
var fs = require('fs');
var Server = require('../').FtpServer,
  Client = require('jsftp'),
  should = require('should'),
  options = {
    'host': process.env.IP || '127.0.0.1',
    'port': process.env.port || 7002,
    'user': 'jose',
    'pass': 'esoj',
    'root': '../fixture'
  };

module.exports = {
  'should': should,
  'server': function () {
    return new Server(options.host, {
      getRoot: function (connection, callback) {
        var username = connection.username,
          root = path.join(__dirname, options.root, username);
        fs.realpath(root, callback);
      },
      getInitialCwd: function () {
        return path.sep;
      }
    }).on('client:connected', function (connection) {
      var username;
      connection.on('command:user', function (user, success, failure) {
        if (user === options.user) {
          username = user;
          success();
        } else {
          failure();
        }
      }).on('command:pass', function (pass, success, failure) {
        if (pass === options.pass) {
          success(username);
        } else {
          failure();
        }
      });
    }).listen(options.port);
  },
  'client': function (done) {
    var client = new Client({
        host: options.host,
        port: options.port
      });
    client.auth(options.user, options.pass, function (error, response) {
        should.not.exist(error);
        should.exist(response);
        response.should.have.property('code', 230);
        done();
      });
    return client;
  }
};


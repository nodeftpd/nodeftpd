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
    'tlsOnly': false,
    'getInitialCwd': function () {
      return options.cwd;
    },
    'getRoot': function (connection, callback) {
      var username = connection.username,
        root = path.join(__dirname, '../fixture', username);
      fs.realpath(root, callback);
    }
  };

module.exports = {
  'should': should,
  'server': function (customOptions) {
    'use strict';
    customOptions = customOptions || {};
    Object.keys(options).forEach(function (key) {
      if (!customOptions.hasOwnProperty(key)) {
        customOptions[key] = options[key];
      }
    });
    return new Server(customOptions.host, customOptions)
      .on('client:connected', function (connection) {
        var username;
        connection.on('command:user', function (user, success, failure) {
          if (user === customOptions.user) {
            username = user;
            success();
          } else {
            failure();
          }
        }).on('command:pass', function (pass, success, failure) {
          if (pass === customOptions.pass) {
            success(username);
          } else {
            failure();
          }
        });
      }).listen(customOptions.port);
  },
  'client': function (done, customOptions) {
    'use strict';
    customOptions = customOptions || {};
    Object.keys(options).forEach(function (key) {
      if (!customOptions.hasOwnProperty(key)) {
        customOptions[key] = options[key];
      }
    });
    var client = new Client({
        host: customOptions.host,
        port: customOptions.port
      });
    client.auth(customOptions.user, customOptions.pass,
      function (error, response) {
        should.not.exist(error);
        should.exist(response);
        response.should.have.property('code', 230);
        done();
      });
    return client;
  }
};


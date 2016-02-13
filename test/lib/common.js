'use strict';

var path = require('path');
var util = require('util');
var fs = require('fs');
var ftpd = require('../../');
var Client = require('jsftp');
var should = require('should');

var Server = ftpd.FtpServer;
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

var common = module.exports = {
  should: should,

  fixturesPath: function() {
    return fixturesPath;
  },

  defaultOptions: function() {
    return options;
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
  genFilterFuncFrom: function(filter) {
    if (!filter) {
      return function() {
        return true;
      };
    }
    if ((typeof filter) === 'function') {
      return filter;
    }
    if ((typeof filter) === 'string') {
      return function(item) {
        return String(item).indexOf(filter) !== -1;
      };
    }
    if ((typeof filter.test) === 'function') {
      // ^-- includes (filter instanceof RegExp)
      return filter.test.bind(filter);
    }
    throw new Error('unsupported filter precursor: ' + util.inspect(filter));
  },
  splitResponseLines: function(resp, filter) {
    var respType = typeof resp;
    respType.should.equal('string');
    resp = String(resp);
    var badEOL = (resp.replace(/\r\n/g, '').match(/[\r\n]+/) || false);
    badEOL.should.equal(false);
    resp.should.endWith('\r\n');
    resp = resp.replace(/\r\n$/, '').split(/\r\n/);
    if (!filter) {
      return resp;
    }
    resp = resp.filter(common.genFilterFuncFrom(filter));
    return resp;
  },
};

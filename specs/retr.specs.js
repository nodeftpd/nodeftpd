var Server = require('../').FtpServer,
  Client = require('jsftp'),
  fs = require('fs'),
  path = require('path'),
  should = require('should');

describe('RETR command', function () {
  'use strict';

  var client,
    server,
    options = {
      host: '127.0.0.1',
      port: 2021,
      user: 'jose',
      pass: 'esoj',
      root: '/../fixture'
    };

  beforeEach(function (done) {
    server = new Server(options.host, {
      getRoot: function (connection, callback) {
        var username = connection.username,
          root = path.join(__dirname, options.root, username);
        fs.realpath(root, callback);
      },
      getInitialCwd: function () {
        return path.sep;
      }
    });
    server.on('client:connected', function (connection) {
      var username;
      connection.on('command:user', function (user, success, failure) {
        if (user === options.user) {
          username = user;
          success();
        } else {
          failure();
        }
      });
      connection.on('command:pass', function (pass, success, failure) {
        if (pass === options.pass) {
          success(username);
        } else {
          failure();
        }
      });
    });
    server.listen(options.port);
    client = new Client({
      host: options.host,
      port: options.port
    });
    client.auth(options.user, options.pass, function (error, response) {
      should.not.exist(error);
      should.exist(response);
      response.should.have.property('code', 230);
      done();
    });
  });

  it('should contain "hola!"', function (done) {
    var str = '';
    client.get('/data.txt', function (error, socket) {
      should.not.exist(error);
      socket.on('data', function (data) {
        str += data.toString();
      });
      socket.on('close', function (error) {
        error.should.not.equal(true);
        str.should.eql('hola!');
        done();
      });
      socket.resume();
    });
  });

  afterEach(function () {
    server.close();
  });
});


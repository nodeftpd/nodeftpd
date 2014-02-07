var common = require('./common'),
  Client = require('jsftp');

describe('USER command', function () {
  'use strict';

  var client,
    server,
    options = {
      'host': '127.0.0.1',
      'port': 7002,
      'user': 'jose',
      'pass': 'esoj'
    };

  beforeEach(function (done) {
    done();
  });

  it('should reject non-secure USER when tlsOnly', function (done) {
    server = common.server({
      tlsOnly: true
    });
    client = new Client(options);
    client.auth(options.user, options.pass, function (error) {
      error.code.should.eql(530);
      client.raw.user(options.user, function (error) {
        error.code.should.eql(530);
        done();
      });
    });
  });

  it('should reject invalid username', function (done) {
    var badUser = options.user + '_invalid';
    server = common.server();
    client = new Client(options);
    client.auth(badUser, options.pass, function (error) {
      error.code.should.eql(530);
      client.raw.user(badUser, function (error) {
        error.code.should.eql(530);
        done();
      });
    });
  });

  afterEach(function () {
    server.close();
  });
});


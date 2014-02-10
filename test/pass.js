var common = require('./common'),
  Client = require('jsftp');

describe('PASS command', function () {
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
    server = common.server(options);
    done();
  });

  it('should reject invalid password', function (done) {
    var badPass = options.pass + '_invalid';
    client = new Client(options);
    client.auth(options.user, badPass, function (error) {
      error.code.should.eql(530);
      client.raw.user(options.user, function (error, reply) {
        reply.code.should.eql(331);
        client.raw.pass(badPass, function (error) {
          error.code.should.eql(530);
          done();
        });
      });
    });
  });

  it('should reject PASS without USER', function (done) {
    client = new Client(options);
    client.raw.pass(options.pass, function (error) {
      error.code.should.eql(503);
      done();
    });
  });

  afterEach(function () {
    server.close();
  });
});



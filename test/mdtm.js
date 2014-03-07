var common = require('./common');

describe('MDTM command', function () {
  'use strict';

  var client;
  var server;

  beforeEach(function (done) {
    server = common.server();
    client = common.client(done);
  });

  it('should respond 213 for a valid file', function (done) {
    client.raw('MDTM', '/data.txt', function (error, response) {
      common.should.not.exist(error);
      response.text.should.match(/^213 [0-9]{14}$/);
      done();
    });
  });

  it('should respond 550 for an invalid file', function (done) {
    client.raw('MDTM', '/data2.txt', function (error, response) {
      error.code.should.equal(550);
      done();
    });
  });

  afterEach(function () {
    server.close();
  });
});


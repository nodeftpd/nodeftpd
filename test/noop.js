var common = require('./common');

describe('NOOP command', function () {
  'use strict';

  var client;
  var server;

  beforeEach(function (done) {
    server = common.server();
    client = common.client(done);
  });

  it('should perform a NOOP', function (done) {
    client.raw('NOOP', function (error, response) {
      common.should.not.exist(error);
      response.code.should.equal(200);
      done();
    });
  });

  afterEach(function () {
    server.close();
  });
});


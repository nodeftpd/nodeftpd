var common = require('./common');

describe('ACCT command', function () {
  'use strict';

  var client,
    server;

  beforeEach(function (done) {
    server = common.server();
    client = common.client(done);
  });

  it('should reply 202', function (done) {
    client.execute('ACCT', function (error, reply) {
      common.should.not.exist(error);
      reply.code.should.equal(202);
      done();
    });
  });

  afterEach(function () {
    server.close();
  });
});



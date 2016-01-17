var common = require('./lib/common');

describe('Whitelisted commands', function() {
  'use strict';

  var client;
  var server;
  var options = {
    allowedCommands: [
      'USER',
      'PASS',
      'PASV',
      'LIST',
      'NOOP',
    ],
  };

  beforeEach(function(done) {
    server = common.server(options);
    client = common.client(done);
  });

  it('LIST should be allowed', function(done) {
    client.list('/', function(error) {
      common.should(error).not.be.ok;
      done();
    });
  });

  it('NOOP should be allowed', function(done) {
    client.raw('NOOP', function(error, response) {
      common.should.not.exist(error);
      response.code.should.equal(200);
      done();
    });
  });

  it('DELE should reply 502', function(done) {
    client.execute('DELE', function(error) {
      error.code.should.eql(502);
      done();
    });
  });

  it('RETR should reply 502', function(done) {
    client.get('/myfile', function(error) {
      error.code.should.eql(502);
      done();
    });
  });

  afterEach(function() {
    server.close();
  });
});

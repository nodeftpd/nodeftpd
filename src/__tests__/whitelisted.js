var common = require('./lib/common');

describe('Whitelisted commands', () => {
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

  beforeEach((done) => {
    server = common.server(options);
    client = common.client(done);
  });

  it('LIST should be allowed', (done) => {
    client.list('/', (error) => {
      common.should(error).not.be.ok;
      done();
    });
  });

  it('NOOP should be allowed', (done) => {
    client.raw('NOOP', (error, response) => {
      common.should.not.exist(error);
      response.code.should.equal(200);
      done();
    });
  });

  it('DELE should reply 502', (done) => {
    client.execute('DELE', (error) => {
      error.code.should.eql(502);
      done();
    });
  });

  it('RETR should reply 502', (done) => {
    client.get('/myfile', (error) => {
      error.code.should.eql(502);
      done();
    });
  });

  afterEach(() => {
    server.close();
  });
});

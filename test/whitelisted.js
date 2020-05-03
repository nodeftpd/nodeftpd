const common = require('./lib/common');

describe('Whitelisted commands', () => {
  let client;
  let server;
  const options = {
    allowedCommands: [
      'USER',
      'PASS',
      'PASV',
      'LIST',
      'NOOP',
    ],
    port: 7035
  };

  const clientOptions = { port: options.port };

  beforeEach((done) => {
    server = common.server(options);
    client = common.client(done, clientOptions);
  });

  test('LIST should be allowed', (done) => {
    client.list('/', (error) => {
      common.should(error).not.be.ok;
      done();
    });
  });

  test('NOOP should be allowed', (done) => {
    client.raw('NOOP', (error, response) => {
      common.should.not.exist(error);
      response.code.should.equal(200);
      done();
    });
  });

  test('DELE should reply 502', (done) => {
    client.execute('DELE', (error) => {
      error.code.should.eql(502);
      done();
    });
  });

  test('RETR should reply 502', (done) => {
    client.get('/myfile', (error) => {
      error.code.should.eql(502);
      done();
    });
  });

  afterEach(() => {
    server.close();
  });
});

const common = require('./lib/common');

describe('MDTM command', () => {
  let client;
  let server;

  const options = {
    port: 7018
  };

  beforeEach((done) => {
    server = common.server(options);
    client = common.client(done, options);
  });

  test('should respond 213 for a valid file', (done) => {
    client.raw('MDTM', '/data.txt', (error, response) => {
      common.should.not.exist(error);
      response.text.should.match(/^213 [0-9]{14}$/);
      done();
    });
  });

  test('should respond 550 for an invalid file', (done) => {
    client.raw('MDTM', '/data-something.txt', (error) => {
      error.code.should.equal(550);
      done();
    });
  });

  afterEach(() => {
    server.close();
  });
});

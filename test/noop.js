const common = require('./lib/common');

describe('NOOP command', () => {
  let client;
  let server;

  const options = {
    port: 7020
  };

  beforeEach((done) => {
    server = common.server(options);
    client = common.client(done, options);
  });

  test('should perform a NOOP', (done) => {
    client.raw('NOOP', (error, response) => {
      common.should.not.exist(error);
      response.code.should.equal(200);
      done();
    });
  });

  afterEach(() => {
    server.close();
  });
});

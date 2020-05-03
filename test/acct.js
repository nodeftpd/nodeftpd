const common = require('./lib/common');

describe('ACCT command', () => {
  let client;
  let server;

  const options = {
    port: 7011
  };

  beforeEach((done) => {
    server = common.server(options);
    client = common.client(done, options);
  });

  test('should reply 202', (done) => {
    client.execute('ACCT', (error, reply) => {
      expect(error).toBeNull();
      expect(reply.code).toBe(202);
      done();
    });
  });

  afterEach(() => {
    server.close();
  });
});

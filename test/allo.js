const common = require('./lib/common');

describe('ALLO command', () => {
  let client;
  let server;

  beforeEach((done) => {
    server = common.server();
    client = common.client(done);
  });

  test('should reply 202', (done) => {
    client.execute('ALLO', (error, reply) => {
      common.should.not.exist(error);
      reply.code.should.equal(202);
      done();
    });
  });

  afterEach(() => {
    server.close();
  });
});

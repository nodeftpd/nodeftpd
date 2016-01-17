var common = require('./lib/common');

describe('NOOP command', () => {
  var client;
  var server;

  beforeEach((done) => {
    server = common.server();
    client = common.client(done);
  });

  it('should perform a NOOP', (done) => {
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

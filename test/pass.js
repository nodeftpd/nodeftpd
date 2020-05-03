const Client = require('jsftp');
const common = require('./lib/common');

describe('PASS command', () => {
  let client;
  let server;
  const options = {
    host: '127.0.0.1',
    port: 7002,
    user: 'jose',
    pass: 'esoj',
  };

  beforeEach((done) => {
    server = common.server(options);
    done();
  });

  test('should reject invalid password', (done) => {
    const badPass = `${options.pass}_invalid`;
    client = new Client(options);
    client.auth(options.user, badPass, (error) => {
      error.code.should.eql(530);
      client.raw.user(options.user, (error, reply) => {
        reply.code.should.eql(331);
        client.raw.pass(badPass, (error) => {
          error.code.should.eql(530);
          done();
        });
      });
    });
  });

  test('should reject PASS without USER', (done) => {
    client = new Client(options);
    client.raw.pass(options.pass, (error) => {
      error.code.should.eql(503);
      done();
    });
  });

  afterEach(() => {
    server.close();
  });
});

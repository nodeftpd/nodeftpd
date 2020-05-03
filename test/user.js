const Client = require('jsftp');
const common = require('./lib/common');

describe('USER command', () => {
  let client;
  let server;
  const options = {
    host: '127.0.0.1',
    port: 7002,
    user: 'jose',
    pass: 'esoj',
  };

  beforeEach((done) => {
    done();
  });

  test('should reject non-secure USER when tlsOnly', (done) => {
    server = common.server({
      tlsOnly: true,
    });
    client = new Client(options);
    client.auth(options.user, options.pass, (error) => {
      expect(error.code).toBe(530);
      client.raw('user',options.user, (error) => {
        expect(error.code).toBe(530);
        done();
      });
    });
  });

  test('should reject invalid username', (done) => {
    const badUser = `${options.user}_invalid`;
    server = common.server();
    client = new Client(options);
    client.auth(badUser, options.pass, (error) => {
      expect(error.code).toBe(530);
      client.raw('user', badUser, (error) => {
        expect(error.code).toBe(530);
        done();
      });
    });
  });

  afterEach(() => {
    server.close();
  });
});

const common = require('./lib/common');

describe('MKD/RMD commands', () => {
  let client;
  let server;
  const directory = '/testdir';

  beforeEach((done) => {
    server = common.server();
    client = common.client(done);
  });

  describe('MKD command', () => {
    test('should create a new directory', (done) => {
      client.raw('MKD', directory, (error, response) => {
        common.should.not.exist(error);
        response.text.should.startWith(257);
        done();
      });
    });

    test('should not create a duplicate directory', (done) => {
      server.suppressExpecteErrMsgs.push(
        /^MKD \S+: Error: EEXIST/,
      );
      client.raw('MKD', directory, (error) => {
        error.code.should.equal(550);
        done();
      });
    });
  });

  describe('RMD command', () => {
    test('should delete an existing directory', (done) => {
      client.raw('RMD', directory, (error, response) => {
        common.should.not.exist(error);
        response.text.should.startWith(250);
        done();
      });
    });

    test('should not delete a non-existent directory', (done) => {
      server.suppressExpecteErrMsgs.push(
        /^RMD \S+: Error: ENOENT/,
      );
      client.raw('RMD', directory, (error) => {
        error.code.should.equal(550);
        done();
      });
    });
  });

  afterEach(() => {
    server.close();
  });
});

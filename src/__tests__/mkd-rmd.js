var common = require('./lib/common');

describe('MKD/RMD commands', () => {
  var client;
  var server;
  var directory = '/testdir';

  beforeEach((done) => {
    server = common.server();
    client = common.client(done);
  });

  describe('MKD command', () => {
    it('should create a new directory', (done) => {
      client.raw('MKD', directory, (error, response) => {
        common.should.not.exist(error);
        response.text.should.startWith(257);
        done();
      });
    });

    it('should not create a duplicate directory', (done) => {
      server.suppressExpecteErrMsgs.push(
        /^MKD \S+: Error: EEXIST/
      );
      client.raw('MKD', directory, (error) => {
        error.code.should.equal(550);
        done();
      });
    });
  });

  describe('RMD command', () => {
    it('should delete an existing directory', (done) => {
      client.raw('RMD', directory, (error, response) => {
        common.should.not.exist(error);
        response.text.should.startWith(250);
        done();
      });
    });

    it('should not delete a non-existent directory', (done) => {
      server.suppressExpecteErrMsgs.push(
        /^RMD \S+: Error: ENOENT/);
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

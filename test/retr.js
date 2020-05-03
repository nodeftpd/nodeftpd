const common = require('./lib/common');

describe('RETR command', () => {
  let client;
  let server;

  // run tests both ways
  [true, false].forEach((useReadFile) => {
    describe(`with useReadFile = ${useReadFile}`, () => {
      beforeEach((done) => {
        server = common.server({ useReadFile, port: 7025 });
        client = common.client(done, { port: 7025 });
      });

      test('should contain "hola!"', (done) => {
        let str = '';
        client.get('/data.txt', (error, socket) => {
          common.should.not.exist(error);
          socket.on('data', (data) => {
            str += data.toString();
          }).on('close', (error) => {
            error.should.not.equal(true);
            str.should.eql('hola!');
            done();
          }).resume();
        });
      });

      test('should fail when file not found', (done) => {
        client.get('/bad.file', (error) => {
          common.should.exist(error);
          done();
        });
      });

      afterEach(() => {
        server.close();
      });
    });
  });
});

var common = require('./lib/common');

describe('RETR command', () => {
  var client;
  var server;

  //run tests both ways
  [true, false].forEach((useReadFile) => {

    describe('with useReadFile = ' + useReadFile, () => {

      beforeEach((done) => {
        server = common.server({useReadFile: useReadFile});
        client = common.client(done);
      });

      it('should contain "hola!"', (done) => {
        var str = '';
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

      it('should fail when file not found', (done) => {
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

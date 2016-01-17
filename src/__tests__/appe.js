var common = require('./lib/common');
var FtpClient = require('ftp');
var path = require('path');
var fs = require('fs');

describe('APPE command', () => {
  var client = new FtpClient();
  var server;

  //run tests both ways
  [true, false].forEach((useWriteFile) => {

    describe('with useWriteFile = ' + useWriteFile, () => {

      beforeEach((done) => {
        server = common.server({useWriteFile: useWriteFile});
        client.once('ready', () => {
          done();
        });
        client.connect({
          host: common.defaultOptions().host,
          port: common.defaultOptions().port,
          user: common.defaultOptions().user,
          password: common.defaultOptions().pass,
        });
      });

      it('should append data to existing file', (done) => {
        var basename = path.basename(__filename);
        var fileSize = fs.statSync(__filename).size;
        client.put(__filename, '/uploads/' + basename, (err) => {
          common.should.not.exist(err);
          client.append(__filename, '/uploads/' + basename, (err) => {
            common.should.not.exist(err);
            var filePath = path.join(
              common.fixturesPath(),
              common.defaultOptions().user,
              'uploads',
              basename
            );
            var newSize = fs.statSync(filePath).size;
            newSize.should.be.eql(fileSize * 2);
            done();
          });
        });
      });

      afterEach(() => {
        server.close();
      });

    });

  });

});

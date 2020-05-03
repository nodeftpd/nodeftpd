const FtpClient = require('ftp');
const path = require('path');
const fs = require('fs');
const common = require('./lib/common');

describe('APPE command', () => {
  const client = new FtpClient();
  let server;
  const basename = path.basename(__filename);
  const uploadedFile = path.join(common.fixturesPath(), common.defaultOptions().user, 'uploads', basename);

  // run tests both ways
  [true, false].forEach((useWriteFile) => {
    describe(`with useWriteFile = ${useWriteFile}`, () => {
      beforeEach((done) => {
        server = common.server({ useWriteFile });
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

      test('should append data to existing file', (done) => {
        const fileSize = fs.statSync(__filename).size;
        client.put(__filename, `/uploads/${basename}`, (err) => {
          common.should.not.exist(err);
          client.append(__filename, `/uploads/${basename}`, (err) => {
            common.should.not.exist(err);
            const newSize = fs.statSync(uploadedFile).size;
            newSize.should.be.eql(fileSize * 2);
            done();
          });
        });
      });

      afterEach(() => {
        server.close();
        fs.unlinkSync(uploadedFile);
      });
    });
  });
});

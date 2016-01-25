var common = require('./lib/common');
var FtpClient = require('ftp');
var path = require('path');
var fs = require('fs');

describe('APPE command', () => {
  var client = new FtpClient();
  var server;
  var fileToUpload = __filename;
  var savedFileName = path.basename(fileToUpload) + '.test.txt';
  var savedFilePublicPath = '/uploads/' + savedFileName;
  var savedFilePrivatePath = path.join(
    common.fixturesPath(),
    common.defaultOptions().user,
    'uploads',
    savedFileName
  );

  //run tests with various option combinations
  let optionCombinations = [
    {useWriteFile: false},
    {useWriteFile: true},
    // This will cause writeFile to fall back to using a stream.
    {useWriteFile: true, uploadMaxSlurpSize: 1},
  ];
  optionCombinations.forEach((options) => {

    describe('with ' + JSON.stringify(options), () => {

      beforeEach((done) => {
        server = common.server(options);
        client.once('ready', () => {
          done();
        });
        let {host, port, user, pass} = common.defaultOptions();
        client.connect({host, port, user, password: pass});
      });

      it('should append data to existing file', (done) => {
        var removeFile = (callback) => {
          fs.unlink(savedFilePrivatePath, (error) => {
            common.should.not.exist(error);
            callback();
          });
        };

        var doTest = () => {
          fs.stat(fileToUpload, (error, stat) => {
            common.should.not.exist(error);
            var fileSize = stat.size;
            client.put(fileToUpload, savedFilePublicPath, (error) => {
              common.should.not.exist(error);
              fs.stat(savedFilePrivatePath, (error, stat) => {
                common.should.not.exist(error);
                stat.size.should.eql(fileSize);
                client.append(fileToUpload, savedFilePublicPath, (error) => {
                  common.should.not.exist(error);
                  fs.stat(savedFilePrivatePath, (error, stat) => {
                    common.should.not.exist(error);
                    var newSize = stat.size;
                    newSize.should.eql(fileSize * 2);
                    removeFile(done);
                  });
                });
              });
            });
          });
        };

        fs.stat(savedFilePrivatePath, (error) => {
          if (error) {
            if (error.code !== 'ENOENT') {
              throw error;
            }
            // The file doesn't exist. This is expected. Proceed with test.
            doTest();
          } else {
            // The file exists. Delete it and then proceed with test.
            removeFile(doTest);
          }
        });
      });

      afterEach(() => {
        server.close();
      });

    });

  });

});

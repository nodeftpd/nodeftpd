var common = require('./lib/common');
var async = require('async');
var collectStream = require('collect-stream');

describe('Tricky paths', () => {
  var client;
  var server;

  //run tests both ways
  [true, false].forEach((useReadFile) => {

    describe('with useReadFile = ' + useReadFile, () => {

      beforeEach((done) => {
        server = common.server({useReadFile: useReadFile});
        client = common.client(done);
      });

      it('should cope with unusual paths', (done) => {
        var coolGlasses = '\uD83D\uDE0E';
        var trickyName = "b\\\\s\\l, \"\"q'u\"o\"te''; pi|p|e & ^up^";
        var dirPath = 'tricky_paths/' + trickyName;
        var expectedData = 'good ' + coolGlasses + '\nfilesystem.\n';

        function receiveAndCompare(socket, nxt) {
          collectStream(socket, (error, receivedData) => {
            common.should.not.exist(error);
            String(receivedData).should.eql(expectedData);
            nxt();
          });
          socket.resume();
        }

        async.waterfall(
          [
            function strangePathRedundantEscape(nxt) {
              var dirRfcQuoted = dirPath.replace(/"/g, '""');
              server.suppressExpecteErrMsgs.push(
                /^CWD [\S\s]+: Error: ENOENT/
              );
              client.raw('CWD', dirRfcQuoted, (error) => {
                common.should.exist(error);
                error.code.should.equal(550);
                nxt();
              });
            },
            function strangePathCwd(nxt) {
              client.raw('CWD', dirPath, nxt);
            },
            function checkResponse(response, nxt) {
              response.code.should.equal(250);
              if (response.code !== 250) {
                return nxt(new Error('failed to CWD to unusual path'));
              }
              nxt();
            },
            function strangePathRetr(nxt) {
              var filename = trickyName + '.txt';
              client.get(filename, nxt);
            },
            receiveAndCompare,
            function strangePathRetr(nxt) {
              var filename = 'cool-glasses.' + coolGlasses + '.txt';
              client.get(filename, nxt);
            },
            receiveAndCompare,
          ],
          // finished callback
          (error) => {
            common.should.not.exist(error);
            done();
          }
        );
      });

      afterEach(() => {
        server.close();
      });

    });

  });


});

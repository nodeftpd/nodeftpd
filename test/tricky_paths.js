/*jslint indent: 2, maxlen: 80, node: true */
/*globals describe, it, beforeEach, afterEach */
'use strict';

var common = require('./common');
var async = require('async');
var collectStream = require('collect-stream');

describe('RETR command', function () {
  var client,
    server;

  //run tests both ways
  [true, false].forEach(function (useReadFile) {

    describe('with useReadFile = ' + useReadFile, function () {

      beforeEach(function (done) {
        server = common.server({ useReadFile: useReadFile });
        client = common.client(done);
      });

      it('should cope with unusual paths', function (done) {
        var coolGlasses = '\uD83D\uDE0E',
          trickyName = "b\\\\s\\l, \"\"q'u\"o\"te''; pi|p|e & ^up^",
          dirPath = 'tricky_paths/' + trickyName,
          expectedData = 'good ' + coolGlasses + '\nfilesystem.\n';

        function receive_and_compare(socket, nxt) {
          collectStream(socket, function (error, receivedData) {
            common.should.not.exist(error);
            String(receivedData).should.eql(expectedData);
            nxt();
          });
          socket.resume();
        }

        async.waterfall([
          function strange_path_redundant_escape(nxt) {
            var dirRfcQuoted = dirPath.replace(/"/g, '""');
            client.raw('CWD', dirRfcQuoted, function (error) {
              common.should.exist(error);
              error.code.should.equal(550);
              nxt();
            });
          },
          function strange_path_cwd(nxt) {
            client.raw('CWD', dirPath, nxt);
          },
          function check_response(response, nxt) {
            response.code.should.equal(250);
            if (response.code !== 250) {
              return nxt(new Error('failed to CWD to unusual path'));
            }
            nxt();
          },
          function strange_path_retr(nxt) {
            var filename = trickyName + '.txt';
            client.get(filename, nxt);
          },
          receive_and_compare,
          function strange_path_retr(nxt) {
            var filename = 'cool-glasses.' + coolGlasses + '.txt';
            client.get(filename, nxt);
          },
          receive_and_compare,
        ], function finished(error) {
          common.should.not.exist(error);
          done();
        });
      });

      afterEach(function () {
        server.close();
      });

    });

  });


});

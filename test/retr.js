var common = require('./common');

describe('RETR command', function () {
  'use strict';

  var client,
    server;

  //run tests both ways
  [true, false].forEach(function(useReadFile){

    describe('with useReadFile = ' + useReadFile, function(){

      beforeEach(function (done) {
        server = common.server({useReadFile:useReadFile});
        client = common.client(done);
      });

      it('should contain "hola!"', function (done) {
        var str = '';
        client.get('/data.txt', function (error, socket) {
          common.should.not.exist(error);
          socket.on('data', function (data) {
            str += data.toString();
          }).on('close', function (error) {
            error.should.not.equal(true);
            str.should.eql('hola!');
            done();
          }).resume();
        });
      });

      it('should fail when file not found', function (done) {
        client.get('/bad.file', function (error, socket) {
          common.should.exist(error);
          done();
        });
      });

      afterEach(function () {
        server.close();
      });

    });

  });


});

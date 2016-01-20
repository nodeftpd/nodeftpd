var common = require('./lib/common');
var FtpClient = require('ftp');
var path = require('path');
var fs = require('fs');

describe('APPE command', function() {
  'use strict';

  var client = new FtpClient();
  var server;
  var basename = path.basename(__filename);
  var uploadedFile = path.join(common.fixturesPath(), common.defaultOptions().user, 'uploads', basename);

  //run tests both ways
  [true, false].forEach(function(useWriteFile) {

    describe('with useWriteFile = ' + useWriteFile, function() {

      beforeEach(function(done) {
        server = common.server({useWriteFile:useWriteFile});
        client.once('ready', function() {
          done();
        });
        client.connect({
          host: common.defaultOptions().host,
          port: common.defaultOptions().port,
          user: common.defaultOptions().user,
          password: common.defaultOptions().pass,
        });
      });

      it('should append data to existing file', function(done) {
        var fileSize = fs.statSync(__filename).size;
        client.put(__filename, '/uploads/' + basename, function(err) {
          common.should.not.exist(err);
          client.append(__filename, '/uploads/' + basename, function(err) {
            common.should.not.exist(err);
            var newSize = fs.statSync(uploadedFile).size;
            newSize.should.be.eql(fileSize * 2);
            done();
          });
        });
      });

      afterEach(function() {
        server.close();
        fs.unlinkSync(uploadedFile);
      });

    });

  });


});

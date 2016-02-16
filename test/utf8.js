var common = require('./lib/common');
var path = require('path');
var fs = require('fs');

describe('UTF8 support', function() {
  'use strict';

  var client;
  var server;
  var filename = '/uploads/人人生而自由，在尊嚴和權利上一律平等。.txt';
  var uploadedFile = path.join(common.fixturesPath(), common.defaultOptions().user, 'uploads', path.basename(filename));

  beforeEach(function(done) {
    server = common.server();
    client = common.client(done);
  });

  it('should STOR file with UTF8 in filename', function(done) {
    client.put(new Buffer('1234'), filename, function(error) {
      error.should.be.eql(false);
      fs.existsSync(uploadedFile).should.be.eql(true);
      done();
    });
  });

  it('should RETR file with UTF8 in filename', function(done) {
    var str = '';
    client.get(filename, function(error, socket) {
      common.should.not.exist(error);
      socket.on('data', function(data) {
        str += data.toString();
      }).on('close', function(error) {
        error.should.not.equal(true);
        str.should.eql('1234');
        done();
      }).resume();
    });
  });

  it('should support UTF8 in LIST command', function(done) {
    client.list(path.dirname(filename), function(error, listing) {
      error.should.equal(false);
      listing.indexOf(path.basename(filename)).should.be.above(-1);
      done();
    });
  });

  it('should DELE file with UTF8 in filename', function(done) {
    client.raw.dele(filename, function(error) {
      common.should.not.exist(error);
      fs.existsSync(uploadedFile).should.be.eql(false);
      done();
    });
  });

  afterEach(function() {
    server.close();
  });
});

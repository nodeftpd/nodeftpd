var common = require('./lib/common');

describe('UTF8 support', function() {
  'use strict';

  var client;
  var server;

  beforeEach(function(done) {
    server = common.server();
    client = common.client(done);
  });

  it('should support UTF8 in LIST command', function(done) {
    var filename = 'привіт.txt';
    client.list('/' + filename, function(error, listing) {
      error.should.equal(false);
      listing = common.splitResponseLines(listing, ' ' + filename);
      listing.should.have.lengthOf(1);
      listing[0].indexOf(filename).should.be.above(-1);
      done();
    });
  });

  it('should RETR file with UTF8 in filename', function(done) {
    var filename = 'привіт.txt';
    var str = '';
    client.get('/' + filename, function(error, socket) {
      common.should.not.exist(error);
      socket.on('data', function(data) {
        str += data.toString();
      }).on('close', function(error) {
        error.should.not.equal(true);
        str.should.eql('1234\n');
        done();
      }).resume();
    });
  });

  afterEach(function() {
    server.close();
  });
});

var common = require('./lib/common');

describe('LIST command', function() {
  'use strict';

  var client;
  var server;

  beforeEach(function(done) {
    server = common.server();
    client = common.client(done);
  });

  it('should return "-" as first character for files', function(done) {
    client.list('/', function(error, directoryListing) {
      common.should(error).not.be.ok;
      directoryListing = directoryListing
        .split('\r\n')
        .filter(function(line) {
          return line.indexOf(' data') !== -1;
        });
      directoryListing.should.have.lengthOf(6);
      directoryListing[0].should.startWith('-');
      done();
    });
  });

  it('should list single files', function(done) {
    client.list('/data.txt', function(error, fileListing) {
      common.should(error).not.be.ok;
      fileListing = fileListing
        .split('\r\n')
        .filter(function(line) {
          return line.indexOf(' data.txt') !== -1;
        });
      fileListing.should.have.lengthOf(1);
      fileListing[0].should.startWith('-');
      done();
    });
  });

  afterEach(function() {
    server.close();
  });
});

var common = require('./lib/common');

describe('LIST command', function() {
  'use strict';

  var client;
  var server;

  beforeEach(function(done) {
    server = common.server();
    client = common.client(done);
  });

  function unslashRgx(rgx) {
    return String(rgx).replace(/^\/|\/$/g, '');
  }

  it('should return "-" as first character for files', function(done) {
    client.list('/', function(error, listing) {
      error.should.equal(false);
      listing = common.splitResponseLines(listing, / data\d*\.txt$/);
      listing.should.have.lengthOf(6);
      listing[0].should.startWith('-');
      done();
    });
  });

  it('should return "d" as first character for directories', function(done) {
    client.list('/', function(error, listing) {
      error.should.equal(false);
      listing = common.splitResponseLines(listing, / usr$/);
      listing.should.have.lengthOf(1);
      listing[0].should.startWith('d');
      done();
    });
  });

  it('should list files similar to ls -l', function(done) {
    client.list('/usr', function(error, listing) {
      error.should.equal(false);
      listing = common.splitResponseLines(listing);
      listing.should.have.lengthOf(1);
      var lsLongRgx = [
        /($# file modes: ___|)[d-]([r-][w-][x-]){3}/,
        /($# ?¿?¿? inodes?: |)\d+/,
        /($# owner name: ___|)\S+/,
        /($# owner group: __|)\S+/,
        /($# size in bytes: |)\d+/,
        /($# month: ________|)[A-Z][a-z]{2}/,
        /($# day of month: _|)\d{1,2}/,
        /($# time or year: _|)([\d ]\d:|19|[2-9]\d)\d{2}/,
        /($# file name: ____|)[\S\s]+/,
      ].map(unslashRgx).join('\\s+');
      lsLongRgx = new RegExp(lsLongRgx, '');
      var match = (lsLongRgx.exec(listing[0]) || [false]);
      match[0].should.equal(listing[0]);
      done();
    });
  });

  it('should list a single file', function(done) {
    var filename = 'data.txt';
    client.list('/' + filename, function(error, listing) {
      error.should.equal(false);
      listing = common.splitResponseLines(listing, ' ' + filename);
      listing.should.have.lengthOf(1);
      listing[0].should.startWith('-');
      done();
    });
  });

  it('should list a subdirectory', function(done) {
    client.list('/usr', function(error, listing) {
      error.should.equal(false);
      listing = common.splitResponseLines(listing);
      listing.should.have.lengthOf(1);
      listing[0].should.startWith('d');
      listing[0].should.endWith(' local');
      done();
    });
  });

  afterEach(function() {
    server.close();
  });
});

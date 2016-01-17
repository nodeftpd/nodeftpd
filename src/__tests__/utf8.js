var common = require('./lib/common');

describe('UTF8 support', () => {
  'use strict';

  var client;
  var server;

  beforeEach((done) => {
    server = common.server();
    client = common.client(done);
  });

  it('should support UTF8 in LIST command', (done) => {
    var filename = 'привіт.txt';
    client.list('/' + filename, (error, listing) => {
      error.should.equal(false);
      listing = common.splitResponseLines(listing, ' ' + filename);
      listing.should.have.lengthOf(1);
      listing[0].indexOf(filename).should.be.above(-1);
      done();
    });
  });

  it('should RETR file with UTF8 in filename', (done) => {
    var filename = 'привіт.txt';
    var str = '';
    client.get('/' + filename, (error, socket) => {
      common.should.not.exist(error);
      socket.on('data', (data) => {
        str += data.toString();
      }).on('close', (error) => {
        error.should.not.equal(true);
        str.should.eql('1234\n');
        done();
      }).resume();
    });
  });

  afterEach(() => {
    server.close();
  });
});

const common = require('./lib/common');

describe('UTF8 support', () => {
  let client;
  let server;

  beforeEach((done) => {
    server = common.server();
    client = common.client(done);
  });

  test('should support UTF8 in LIST command', (done) => {
    const filename = 'привіт.txt';
    client.list(`/${filename}`, (error, listing) => {
      error.should.equal(false);
      listing = common.splitResponseLines(listing, ` ${filename}`);
      listing.should.have.lengthOf(1);
      listing[0].indexOf(filename).should.be.above(-1);
      done();
    });
  });

  test('should RETR file with UTF8 in filename', (done) => {
    const filename = 'привіт.txt';
    let str = '';
    client.get(`/${filename}`, (error, socket) => {
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

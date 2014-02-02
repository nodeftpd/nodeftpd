var common = require('./common');

describe('RETR command', function () {
  'use strict';

  var client,
    server;

  beforeEach(function (done) {
    server = common.server();
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

  afterEach(function () {
    server.close();
  });
});


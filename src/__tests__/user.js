var common = require('./lib/common');
var Client = require('jsftp');

describe('USER command', () => {
  'use strict';

  var client;
  var server;
  var options = {
    host: '127.0.0.1',
    port: 7002,
    user: 'jose',
    pass: 'esoj',
  };

  beforeEach((done) => {
    done();
  });

  it('should reject non-secure USER when tlsOnly', (done) => {
    server = common.server({
      tlsOnly: true,
    });
    client = new Client(options);
    client.auth(options.user, options.pass, (error) => {
      error.code.should.eql(530);
      client.raw.user(options.user, (error) => {
        error.code.should.eql(530);
        done();
      });
    });
  });

  it('should reject invalid username', (done) => {
    var badUser = options.user + '_invalid';
    server = common.server();
    client = new Client(options);
    client.auth(badUser, options.pass, (error) => {
      error.code.should.eql(530);
      client.raw.user(badUser, (error) => {
        error.code.should.eql(530);
        done();
      });
    });
  });

  afterEach(() => {
    server.close();
  });
});

var common = require('./lib/common');
var Client = require('jsftp');

describe('initialization', () => {
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

  it('should getRoot synchronously', (done) => {
    server = common.server({
      getRoot: () => {
        return '../fixture/';
      },
    });
    client = common.client(done);
  });

  it('should getRoot asynchronously', (done) => {
    server = common.server({
      getRoot: (connection, callback) => {
        callback(null, '../fixture/');
      },
    });
    client = common.client(done);
  });

  it('should bail if getRoot fails', (done) => {
    server = common.server({
      getRoot: (connection, callback) => {
        server.suppressExpecteErrMsgs.push(
          'getRoot signaled error [Error: intentional failure]');
        callback(new Error('intentional failure'));
      },
    });
    client = new Client(options);
    client.auth(options.user, options.pass, (error) => {
      error.code.should.eql(421);
      done();
    });
  });

  it('should throw if getRoot is null', (done) => {
    var fail = false;
    try {
      server = common.server({
        getRoot: null,
      });
    } catch (error) {
      server = common.server();
      fail = true;
    }
    fail.should.eql(true);
    done();
  });

  it('should getInitialCwd synchronously', (done) => {
    server = common.server({
      getInitialCwd: () => {
        return '/';
      },
    });
    client = common.client(done);
  });

  it('should getInitialCwd asynchronously', (done) => {
    server = common.server({
      getInitialCwd: (connection, callback) => {
        callback(null, '/');
      },
    });
    client = common.client(done);
  });

  it('should bail if getInitialCwd fails', (done) => {
    server = common.server({
      getInitialCwd: (connection, callback) => {
        server.suppressExpecteErrMsgs.push(
          'getInitialCwd signaled error [Error: intentional failure]');
        callback(new Error('intentional failure'));
      },
    });
    client = new Client(options);
    client.auth(options.user, options.pass, (error) => {
      error.code.should.eql(421);
      done();
    });
  });

  it('should throw if getInitialCwd is null', (done) => {
    var fail = false;
    try {
      server = common.server({
        getInitialCwd: null,
      });
    } catch (error) {
      server = common.server();
      fail = true;
    }
    fail.should.eql(true);
    done();
  });

  afterEach(() => {
    server.close();
  });
});

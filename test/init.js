var common = require('./common'),
  Client = require('jsftp');

describe('initialization', function () {
  'use strict';

  var client,
    server,
    options = {
      'host': '127.0.0.1',
      'port': 7002,
      'user': 'jose',
      'pass': 'esoj'
    };

  beforeEach(function (done) {
    done();
  });

  it('should getRoot synchronously', function (done) {
    server = common.server({
      'getRoot': function () {
        return '../fixture/';
      }
    });
    client = common.client(done);
  });

  it('should getRoot asynchronously', function (done) {
    server = common.server({
      'getRoot': function (connection, callback) {
        callback(null, '../fixture/');
      }
    });
    client = common.client(done);
  });

  it('should bail if getRoot fails', function (done) {
    server = common.server({
      'getRoot': function (connection, callback) {
        callback(new Error('intentional failure'));
      }
    });
    client = new Client(options);
    client.auth(options.user, options.pass, function (error) {
      error.code.should.eql(421);
      done();
    });
  });

  it('should throw if getRoot is null', function (done) {
    var fail = false;
    try {
      server = common.server({
        'getRoot': null
      });
    } catch (error) {
      server = common.server();
      fail = true;
    }
    fail.should.eql(true);
    done();
  });

  it('should getInitialCwd synchronously', function (done) {
    server = common.server({
      'getInitialCwd': function () {
        return '/';
      }
    });
    client = common.client(done);
  });

  it('should getInitialCwd asynchronously', function (done) {
    server = common.server({
      'getInitialCwd': function (connection, callback) {
        callback(null, '/');
      }
    });
    client = common.client(done);
  });

  it('should bail if getInitialCwd fails', function (done) {
    server = common.server({
      'getInitialCwd': function (connection, callback) {
        callback(new Error('intentional failure'));
      }
    });
    client = new Client(options);
    client.auth(options.user, options.pass, function (error) {
      error.code.should.eql(421);
      done();
    });
  });

  it('should throw if getInitialCwd is null', function (done) {
    var fail = false;
    try {
      server = common.server({
        'getInitialCwd': null
      });
    } catch (error) {
      server = common.server();
      fail = true;
    }
    fail.should.eql(true);
    done();
  });

  afterEach(function () {
    server.close();
  });
});


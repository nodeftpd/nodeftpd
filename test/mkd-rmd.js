var common = require('./lib/common');
var sinon = require('sinon');

var logSpy = sinon.spy();

describe('MKD/RMD commands', function() {
  'use strict';

  var client;
  var server;
  var directory = '/testdir';

  beforeEach(function(done) {
    server = common.server({logFunction: logSpy, logTtyColors: false});
    client = common.client(done);
  });

  describe('MKD command', function() {
    it('should create a new directory', function(done) {
      client.raw('MKD', directory, function(error, response) {
        common.should.not.exist(error);
        response.text.should.startWith(257);
        done();
      });
    });

    it('should not create a duplicate directory', function(done) {
      client.raw('MKD', directory, function(error) {
        error.code.should.equal(550);
        sinon.assert.calledWithMatch(logSpy, 'ERROR', sinon.match.any, sinon.match.any, sinon.match.any, 'EEXIST');
        done();
      });
    });
  });

  describe('RMD command', function() {
    it('should delete an existing directory', function(done) {
      client.raw('RMD', directory, function(error, response) {
        common.should.not.exist(error);
        response.text.should.startWith(250);
        done();
      });
    });

    it('should not delete a non-existent directory', function(done) {
      client.raw('RMD', directory, function(error) {
        error.code.should.equal(550);
        sinon.assert.calledWithMatch(logSpy, 'ERROR', sinon.match.any, sinon.match.any, sinon.match.any, 'ENOENT');
        done();
      });
    });
  });

  afterEach(function() {
    server.close();
  });
});

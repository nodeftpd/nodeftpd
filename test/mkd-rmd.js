var common = require('./common');

describe('MKD/RMD commands', function () {
  'use strict';

  var client;
  var server;
  var directory = '/testdir';

  beforeEach(function (done) {
    server = common.server();
    client = common.client(done);
  });

  describe('MKD command', function () {
    it('should create a new directory', function (done) {
      client.raw('MKD', directory, function (error, response) {
        common.should.not.exist(error);
        response.text.should.startWith(257);
        done();
      });
    });

    it('should not create a duplicate directory', function (done) {
      client.raw('MKD', directory, function (error, response) {
        error.code.should.equal(550);
        done();
      });
    });
  });

  describe('RMD command', function () {
    it('should delete an existing directory', function (done) {
      client.raw('RMD', directory, function (error, response) {
        common.should.not.exist(error);
        response.text.should.startWith(250);
        done();
      });
    });

    it('should not delete a non-existent directory', function (done) {
      client.raw('RMD', directory, function (error, response) {
        error.code.should.equal(550);
        done();
      });
    });
  });

  afterEach(function () {
    server.close();
  });
});


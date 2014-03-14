var common = require('./common');

describe('CWD/CDUP commands', function () {
  'use strict';

  var client;
  var server;
  var pathExisting = 'usr/local';
  var pathWithQuotes = '/"quote"';
  var pathFile = 'data.txt';
  function pathEscape(text) {
    text = text.replace(/\"/g, '""');
    return text;
  }
  function pathExtract(response) {
    var text = response && response.text || '';
    var match = text.match(/\"(.*)\"/);
    text = match && match[1] || '';
    return text;
  }

  beforeEach(function (done) {
    server = common.server();
    client = common.client(done);
  });

  describe('CWD command', function () {
    it('should change to existing directory', function (done) {
      client.raw('CWD', pathExisting, function (error, response) {
        var pathCwd = pathExtract(response);
        response.code.should.equal(250);
        client.raw('PWD', function (error, response) {
          var pathPwd = pathExtract(response);
          response.code.should.equal(257);
          pathPwd.should.equal(pathCwd);
          done();
        });
      });
    });

    it('should not change to non-existent directory', function (done) {
      client.raw('CWD', pathExisting, function (error, response) {
        response.code.should.equal(250);
        client.raw('CWD', pathExisting, function (error) {
          error.code.should.equal(550);
          done();
        });
      });
    });

    it('should not change to regular file', function (done) {
      client.raw('CWD', pathFile, function (error) {
        error.code.should.equal(550);
        done();
      });
    });

    it('should escape quotation marks', function (done) {
      client.raw('MKD', pathWithQuotes, function (error, response) {
        var pathEscaped = pathEscape(pathWithQuotes);
        var pathMkd = pathExtract(response);
        pathMkd.should.equal(pathEscaped);
        client.raw('CWD', pathWithQuotes, function (error, response) {
          var pathCwd = pathExtract(response);
          pathCwd.should.equal(pathEscaped);
          client.raw('PWD', function (error, response) {
            var pathPwd = pathExtract(response);
            pathPwd.should.equal(pathEscaped);
            client.raw('RMD', pathWithQuotes);
            done();
          });
        });
      });
    });
  });

  describe('CDUP command', function () {
    it('should change to parent directory', function (done) {
      client.raw('CWD', pathExisting, function (error, response) {
        response.code.should.equal(250);
        client.raw('CDUP', function (error, response) {
          var pathCdup = pathExtract(response);
          response.code.should.equal(250);
          client.raw('PWD', function (error, response) {
            var pathPwd = pathExtract(response);
            response.code.should.equal(257);
            pathCdup.should.equal(pathPwd);
            done();
          });
        });
      });
    });
  });

  afterEach(function () {
    server.close();
  });
});


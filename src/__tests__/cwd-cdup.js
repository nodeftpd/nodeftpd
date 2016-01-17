var common = require('./lib/common');

describe('CWD/CDUP commands', () => {
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

  beforeEach((done) => {
    server = common.server();
    client = common.client(done);
  });

  describe('CWD command', () => {
    it('should change to existing directory', (done) => {
      client.raw('CWD', pathExisting, (error, response) => {
        var pathCwd = pathExtract(response);
        response.code.should.equal(250);
        client.raw('PWD', (error, response) => {
          var pathPwd = pathExtract(response);
          response.code.should.equal(257);
          pathPwd.should.equal(pathCwd);
          done();
        });
      });
    });

    it('should not change to non-existent directory', (done) => {
      client.raw('CWD', pathExisting, (error, response) => {
        response.code.should.equal(250);
        server.suppressExpecteErrMsgs.push(
          /^CWD \S+: Error: ENOENT/
        );
        client.raw('CWD', pathExisting, (error) => {
          error.code.should.equal(550);
          done();
        });
      });
    });

    it('should not change to regular file', (done) => {
      client.raw('CWD', pathFile, (error) => {
        error.code.should.equal(550);
        done();
      });
    });

    it('should escape quotation marks', (done) => {
      client.raw('MKD', pathWithQuotes, (error, response) => {
        var pathEscaped = pathEscape(pathWithQuotes);
        var pathMkd = pathExtract(response);
        pathMkd.should.equal(pathEscaped);
        client.raw('CWD', pathWithQuotes, (error, response) => {
          var pathCwd = pathExtract(response);
          pathCwd.should.equal(pathEscaped);
          client.raw('PWD', (error, response) => {
            var pathPwd = pathExtract(response);
            pathPwd.should.equal(pathEscaped);
            client.raw('RMD', pathWithQuotes);
            done();
          });
        });
      });
    });
  });

  describe('CDUP command', () => {
    it('should change to parent directory', (done) => {
      client.raw('CWD', pathExisting, (error, response) => {
        response.code.should.equal(250);
        client.raw('CDUP', (error, response) => {
          var pathCdup = pathExtract(response);
          response.code.should.equal(250);
          client.raw('PWD', (error, response) => {
            var pathPwd = pathExtract(response);
            response.code.should.equal(257);
            pathCdup.should.equal(pathPwd);
            done();
          });
        });
      });
    });
  });

  afterEach(() => {
    server.close();
  });
});

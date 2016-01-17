var common = require('./lib/common');
var path = require('path');

describe('PWD command', () => {
  'use strict';

  var client;
  var server;
  var directories = [
    path.sep,
    path.join(path.sep, 'public_html'),
    path.join(path.sep, 'public_html', 'tmp'),
    path.join(path.sep, 'tmp'),
  ];
  var falseyDirectories = [
    '',
    null,
    undefined,
  ];

  directories.forEach((directory) => {
    describe('CWD = "' + directory + '"', () => {
      beforeEach((done) => {
        server = common.server({
          getInitialCwd: () => {
            return directory;
          },
        });
        client = common.client(done);
      });

      it('should be "' + directory + '"', (done) => {
        client.raw.pwd((error, reply) => {
          common.should.not.exist(error);
          reply.code.should.equal(257);
          reply.text.should.startWith('257 "' + directory + '"');
          done();
        });
      });

      it('should reject parameters', (done) => {
        client.raw.pwd(directory, (error, reply) => {
          error.code.should.equal(501);
          reply.code.should.equal(501);
          done();
        });
      });

      afterEach(() => {
        server.close();
      });
    });
  });

  falseyDirectories.forEach((directory) => {
    describe('CWD = "' + directory + '"', () => {
      beforeEach((done) => {
        server = common.server({
          getInitialCwd: () => {
            return directory;
          },
        });
        client = common.client(done);
      });

      it('should be "/"', (done) => {
        client.raw.pwd((error, reply) => {
          common.should.not.exist(error);
          reply.code.should.equal(257);
          reply.text.should.startWith('257 "/"');
          done();
        });
      });

      afterEach(() => {
        server.close();
      });
    });
  });
});

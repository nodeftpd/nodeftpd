var common = require('./common'),
  path = require('path');

describe('PWD command', function () {
  'use strict';

  var client,
    server,
    directories = [
      path.sep,
      path.join(path.sep, 'public_html'),
      path.join(path.sep, 'public_html', 'tmp'),
      path.join(path.sep, 'tmp')
    ];

  directories.forEach(function (directory) {
    describe('CWD = "' + directory + '"', function () {
      beforeEach(function (done) {
        server = common.server({
          cwd: directory
        });
        client = common.client(done);
      });

      it('should be "' + directory + '"', function (done) {
        client.raw.pwd(function (error, reply) {
          common.should.not.exist(error);
          reply.code.should.equal(257);
          reply.text.should.startWith('257 "' + directory + '"');
          done();
        });
      });

      afterEach(function () {
        server.close();
      });
    });
  });
});


const path = require('path');
const common = require('./lib/common');

describe('PWD command', () => {
  let client;
  let server;
  const directories = [
    path.sep,
    path.join(path.sep, 'public_html'),
    path.join(path.sep, 'public_html', 'tmp'),
    path.join(path.sep, 'tmp'),
  ];
  const falseyDirectories = [
    '',
    null,
    undefined,
  ];

  const options = {
    port: 7030
  }

  directories.forEach((directory) => {
    describe(`CWD = "${directory}"`, () => {
      beforeEach((done) => {
        server = common.server({
          getInitialCwd() {
            return directory;
          },
          port: options.port
        });
        client = common.client(done, options);
      });

      test(`should be "${directory}"`, (done) => {
        client.raw('pwd', (error, reply) => {
          expect(error).toBeNull();
          expect(reply.code).toBe(257);
          reply.text.should.startWith(`257 "${directory}"`);
          done();
        });
      });

      test('should reject parameters', (done) => {
        client.raw('pwd', directory, (error, reply) => {
          expect(reply.code).toBe(501);
          expect(error.code).toBe(501);
          done();
        });
      });

      afterEach(() => {
        server.close();
      });
    });
  });

  falseyDirectories.forEach((directory) => {
    describe(`CWD = "${directory}"`, () => {
      beforeEach((done) => {
        server = common.server({
          getInitialCwd() {
            return directory;
          },
          port: options.port
        });
        client = common.client(done, options);
      });

      test('should be "/"', (done) => {
        client.raw('pwd', (error, reply) => {
          expect(error).toBeNull();
          expect(reply.code).toBe(257);
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

const common = require('./lib/common');

describe('UNSUPPORTED commands', () => {
  let client;
  let server;
  const commands = [
    // RFC959
    'ABOR',
    'HELP',
    'MODE',
    'REIN',
    'REST',
    'SITE',
    'SMNT',
    'STOU',
    'STRU',
    // Fake
    'FAKE',
    'COMMAND',
    'LS',
    'CD',
  ];

  const options = {
    port: 7040
  }

  beforeEach((done) => {
    server = common.server(options);
    client = common.client(done, options);
  });

  commands.forEach((command) => {
    test(`should reply 502 to ${command}`, (done) => {
      const callback = function (error) {
        error.code.should.eql(502);
        done();
      };
      command = command.toLowerCase();
      if (client.raw[command]) {
        client.raw[command](callback);
      } else {
        client.execute(command, callback);
      }
    });
  });

  afterEach(() => {
    server.close();
  });
});

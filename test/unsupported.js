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

  beforeEach((done) => {
    server = common.server();
    client = common.client(done);
  });

  commands.forEach((command) => {
    it(`should reply 502 to ${command}`, (done) => {
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

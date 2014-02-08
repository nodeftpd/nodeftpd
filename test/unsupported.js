var common = require('./common');

describe('UNSUPPORTED commands', function () {
  'use strict';

  var client,
    server,
    commands = [
      //RFC959
      'ABOR',
      'HELP',
      'MODE',
      'REIN',
      'REST',
      'SITE',
      'SMNT',
      'STOU',
      'STRU',
      //Fake
      'FAKE',
      'COMMAND',
      'LS',
      'CD'
    ];

  beforeEach(function (done) {
    server = common.server();
    client = common.client(done);
  });

  commands.forEach(function (command) {
    it('should reply 502 to ' + command, function (done) {
      var callback = function (error) {
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

  afterEach(function () {
    server.close();
  });
});


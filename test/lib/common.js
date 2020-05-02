
const path = require('path');
const util = require('util');
const fs = require('fs');
const Client = require('jsftp');
const should = require('should');
const ftpd = require('../..');

const Server = ftpd.FtpServer;
const LogLevels = ftpd.LOG_LEVELS;
const LogLevelNames = Object.keys(LogLevels).reduce((map, name) => {
  const value = LogLevels[name];
  map[value] = name;
  return map;
}, {});

const fixturesPath = path.join(__dirname, '../../fixture');

function toString(value) {
  const isPrimitive = Object(value) !== value;
  if (isPrimitive) {
    return JSON.stringify(value);
  }
  return ('toString' in value) ? value.toString() : Object.prototype.toString(value);
}

var options = {
  host: process.env.IP || '127.0.0.1',
  port: process.env.port || 7002,
  user: 'jose',
  pass: 'esoj',
  tlsOnly: false,
  getInitialCwd() {
    return options.cwd;
  },
  getRoot(connection, callback) {
    const { username } = connection;
    const root = path.join(fixturesPath, username);
    fs.realpath(root, callback);
  },
};

var common = module.exports = {
  should,

  fixturesPath() {
    return fixturesPath;
  },

  defaultOptions() {
    return options;
  },

  server(customOptions) {
    customOptions = customOptions || {};
    Object.keys(options).forEach((key) => {
      if (!customOptions.hasOwnProperty(key)) {
        customOptions[key] = options[key];
      }
    });
    const server = new Server(customOptions.host, customOptions);
    server.on('client:connected', (connection) => {
      let username;
      connection.on('command:user', (user, success, failure) => {
        if (user === customOptions.user) {
          username = user;
          success();
        } else {
          failure();
        }
      });
      connection.on('command:pass', (pass, success, failure) => {
        if (pass === customOptions.pass) {
          success(username);
        } else {
          failure();
        }
      });
    });
    const origLogIf = server._logIf;
    server.suppressExpecteErrMsgs = [];
    server._logIf = function logIfNotExpected(verbosity, message, conn) {
      const expecteErrMsgs = server.suppressExpecteErrMsgs;
      message = String(message).split(fixturesPath).join('fixture:/');
      if ((expecteErrMsgs.length > 0) && (verbosity < LogLevels.LOG_INFO)) {
        const expected = expecteErrMsgs.shift();
        if (message === expected) {
          return;
        }
        if ((expected instanceof RegExp) && expected.test(message)) {
          return;
        }
        if ((typeof expected) === 'function') {
          message = expected(message);
          if (message === '') {
            return;
          }
        } else {
          console.error(
            `\nExpected log message:\n${toString(expected)}\n`
            + `did not match [${LogLevelNames[verbosity]}]:\n${
              JSON.stringify(message)}`,
          );
        }
      }
      return origLogIf.call(this, verbosity, message, conn);
    };
    server.listen(customOptions.port);
    return server;
  },

  client(done, customOptions) {
    customOptions = customOptions || {};
    Object.keys(options).forEach((key) => {
      if (!customOptions.hasOwnProperty(key)) {
        customOptions[key] = options[key];
      }
    });
    const client = new Client({
      host: customOptions.host,
      port: customOptions.port,
    });
    client.auth(
      customOptions.user,
      customOptions.pass,
      (error, response) => {
        should.not.exist(error);
        should.exist(response);
        response.should.have.property('code', 230);
        done();
      },
    );
    return client;
  },
  genFilterFuncFrom(filter) {
    if (!filter) {
      return function () {
        return true;
      };
    }
    if ((typeof filter) === 'function') {
      return filter;
    }
    if ((typeof filter) === 'string') {
      return function (item) {
        return String(item).indexOf(filter) !== -1;
      };
    }
    if ((typeof filter.test) === 'function') {
      // ^-- includes (filter instanceof RegExp)
      return filter.test.bind(filter);
    }
    throw new Error(`unsupported filter precursor: ${util.inspect(filter)}`);
  },
  splitResponseLines(resp, filter) {
    const respType = typeof resp;
    respType.should.equal('string');
    resp = String(resp);
    const badEOL = (resp.replace(/\r\n/g, '').match(/[\r\n]+/) || false);
    badEOL.should.equal(false);
    resp.should.endWith('\r\n');
    resp = resp.replace(/\r\n$/, '').split(/\r\n/);
    if (!filter) {
      return resp;
    }
    resp = resp.filter(common.genFilterFuncFrom(filter));
    return resp;
  },
};

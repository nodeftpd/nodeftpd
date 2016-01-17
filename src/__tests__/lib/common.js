import path from 'path';
import util from 'util';
import fs from 'fs';
import Server from '../../FtpServer';
import Constants from '../../Constants';
import Client from 'jsftp';
import should from 'should';

var {LOG_LEVELS} = Constants;
// TODO: replace this stuff with github.com/rauschma/enumify
var LogLevelNames = Object.keys(LOG_LEVELS).reduce((map, name) => {
  var value = LOG_LEVELS[name];
  map[value] = name;
  return map;
}, {});

var fixturesPath = path.join(__dirname, '../../../fixture');

const toString = (value) => {
  var isPrimitive = Object(value) !== value;
  if (isPrimitive) {
    return JSON.stringify(value);
  } else {
    return ('toString' in value) ? value.toString() : Object.prototype.toString(value);
  }
};

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
    var username = connection.username;
    var root = path.join(fixturesPath, username);
    fs.realpath(root, callback);
  },
};

const common = {
  should: should,

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
    var server = new Server(customOptions.host, customOptions);
    server.on('client:connected', (connection) => {
      var username;
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
    var _log = server._log;
    server.suppressExpecteErrMsgs = [];
    server._log = (...args) => {
      var verbosity = args[0];
      // Remove the <0.0.0.0> prefix.
      var message = args[1].replace(/^<.+?> /, '');
      var expecteErrMsgs = server.suppressExpecteErrMsgs;
      message = String(message).split(fixturesPath).join('fixture:/');
      if ((expecteErrMsgs.length > 0) && (verbosity < LOG_LEVELS.INFO)) {
        var expected = expecteErrMsgs.shift();
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
            '\nExpected log message:\n' + toString(expected) + '\n' +
            'did not match [' + LogLevelNames[verbosity] + ']:\n' +
            JSON.stringify(message)
          );
        }
      }
      return _log.apply(server, args);
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
    var client = new Client({
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
      }
    );
    return client;
  },
  genFilterFuncFrom(filter) {
    if (!filter) {
      return () => {
        return true;
      };
    }
    if ((typeof filter) === 'function') {
      return filter;
    }
    if ((typeof filter) === 'string') {
      return (item) => {
        return String(item).indexOf(filter) !== -1;
      };
    }
    if ((typeof filter.test) === 'function') {
      // ^-- includes (filter instanceof RegExp)
      return filter.test.bind(filter);
    }
    throw new Error('unsupported filter precursor: ' + util.inspect(filter));
  },
  splitResponseLines(resp, filter) {
    var respType = typeof resp;
    respType.should.equal('string');
    resp = String(resp);
    var badEOL = (resp.replace(/\r\n/g, '').match(/[\r\n]+/) || false);
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

module.exports = common;

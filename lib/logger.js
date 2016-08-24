var util = require('util');
var tty = require('tty');

// is it a tty or file?
var isatty = tty.isatty(2) && tty.isatty(1);
var stdout = process.stdout;
var stderr = process.stderr;

var colors = {
  // text style
  bold          : ['\x1B[1m', '\x1B[22m'],
  italic        : ['\x1B[3m', '\x1B[23m'],
  underline     : ['\x1B[4m', '\x1B[24m'],
  inverse       : ['\x1B[7m', '\x1B[27m'],
  strikethrough : ['\x1B[9m', '\x1B[29m'],
  // text colors
  white         : ['\x1B[37m', '\x1B[39m'],
  grey          : ['\x1B[38;5;240m', '\x1B[39m'],
  black         : ['\x1B[30m', '\x1B[39m'],
  blue          : ['\x1B[34m', '\x1B[39m'],
  cyan          : ['\x1B[36m', '\x1B[39m'],
  green         : ['\x1B[32m', '\x1B[39m'],
  magenta       : ['\x1B[35m', '\x1B[39m'],
  red           : ['\x1B[31m', '\x1B[39m'],
  yellow        : ['\x1B[33m', '\x1B[39m'],
  // background colors
  whiteBG       : ['\x1B[47m', '\x1B[49m'],
  greyBG        : ['\x1B[49;5;8m', '\x1B[49m'],
  blackBG       : ['\x1B[40m', '\x1B[49m'],
  blueBG        : ['\x1B[44m', '\x1B[49m'],
  cyanBG        : ['\x1B[46m', '\x1B[49m'],
  greenBG       : ['\x1B[42m', '\x1B[49m'],
  magentaBG     : ['\x1B[45m', '\x1B[49m'],
  redBG         : ['\x1B[41m', '\x1B[49m'],
  yellowBG      : ['\x1B[43m', '\x1B[49m'],
};

var levels = {
  DEBUG : 'blue',
  TRACE : 'magenta',
  INFO  : 'green',
  WARN  : 'yellow',
  ERROR : 'red',
};

function colored(str, color) {
  return colors[color][0] + str + colors[color][1];
}

module.exports = function(options) {
  options = options || {};
  options.logLevel = options.logLevel !== undefined ? options.logLevel : 255;
  options.ttyColors = isatty && (options.ttyColors !== undefined ? options.ttyColors : true);

  options.logLevel = process.env.NODEFTPD_LOG_LEVEL ? parseInt(process.env.NODEFTPD_LOG_LEVEL, 10) : options.logLevel;

  var log = function log(level) {
    level = level || 'INFO';

    var ts = new Date().toISOString();
    var args = Array.prototype.slice.call(arguments, 1);

    if (isatty && options.ttyColors) {
      level = colored(level, levels[level]);
      ts = colored(ts, 'grey');
    }

    if (typeof args[0] === 'string') {
      args[0] = ts + ' ' + level + ' ' + args[0];
    } else {
      args = [ts, level].concat(args);
    }

    if (level === 'ERROR') {
      stderr.write(util.format.apply(null, args) + '\n');
    } else {
      stdout.write(util.format.apply(null, args) + '\n');
    }
  };

  if (typeof options.logFunction === 'function') {
    log = options.logFunction;
  }

  return {
    log: function() {
      if (options.logLevel > 1) {
        log.apply(null, ['INFO'].concat(Array.prototype.slice.call(arguments)));
      }
    },

    debug: function() {
      if (options.logLevel > 2) {
        log.apply(null, ['DEBUG'].concat(Array.prototype.slice.call(arguments)));
      }
    },

    trace: function() {
      if (options.logLevel > 3) {
        log.apply(null, ['TRACE'].concat(Array.prototype.slice.call(arguments)));
      }
    },

    warn: function() {
      if (options.logLevel > 0) {
        log.apply(null, ['WARN'].concat(Array.prototype.slice.call(arguments)));
      }
    },

    error: function error() {
      // capture error() call location
      var stackErr = new Error();
      Error.captureStackTrace(stackErr, error);
      var loggedAt = '[' + stackErr.stack.split('\n')[1].trim() + ']';

      var args = Array.prototype.slice.call(arguments);

      for (var i = 0; i < args.length; i++) {
        if (args[i] instanceof Error) {
          var err = args[i];
          args[i] = err.toString() + '\n' + util.inspect(err, false, 10, options.ttyColors);
          if (err.stack) {
            args[i] += '\n' + err.stack.split('\n').splice(1).join('\n');
          }
        }
      }

      args.push('\n' + loggedAt);

      log.apply(null, ['ERROR'].concat(args));
    },
  };
};

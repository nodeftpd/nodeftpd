var PathModule = require('path'),
    events = require('events'),
    constants = require('constants');

var CONC = 5;
function setMaxStatsAtOnce(n) {
  CONC = n;
}

// Wildcard directory listing. There is no way that a client should
// use wildcards in directory names unless they're identifying a
// unique directory to be listed. So this can be pretty simple.

function statList(fsm, list, callback) {
  if (list.length == 0)
    return callback(null, []);

  var stats = [];
  var i = 0, j = 0;
  for (i = 0; i < list.length && i < CONC; ++i)
    handleFile(i);
  j = --i;

  var erroredOut = false;

  function handleFile(ii) {
    if (erroredOut)
      return;
    if (i >= list.length)
      return i == list.length + j ? finished() : null;

    fsm.stat(list[i], function(err, st) {
      if (err) {
        erroredOut = true;
        callback(err);
      }
      else {
        stats.push({ name: PathModule.basename(list[ii]),
          stats: st });
        handleFile(++i);
      }
    });
  }

  function finished() {
    callback(null, stats);
  }
}

function matchPattern(pattern, string) {
  var pi = 0, si = 0;
  for (; si < string.length && pi < pattern.length; ++si) {
    var c = string.charAt(si);
    var pc = pattern.charAt(pi);

    if (pc == '*') {
      if (pi + 1 == pattern.length) {
        ;
      }
      else if (pattern.charAt(pi + 1) == '*') {
        --si;
        ++pi;
      }
      else if (pattern.charAt(pi + 1) == '?') {
        ++pi;
      }
      else if (si < string.length - 1 && pattern.charAt(pi + 1) == string.charAt(si)) {
        pi += 2;
      }
    }
    else if (pc == '?') {
      ++pi;
    }
    else if (pc == c) {
      ++pi;
    }
    else {
      return false;
    }
  }

  return (pi == pattern.length || (pi == pattern.length - 1 && pattern.charAt(pi) == '*')) &&
      si == string.length;
}

function glob(path, fsm, callback, noWildcards) {
  var s = path.indexOf('*');
  var q = path.indexOf('?');
  var w;
  for (w = 0; !noWildcards && w < path.length && path.charAt(w) != '*' && path.charAt(w) != '?'; ++w);

  if (w == path.length) { // There are no wildcards.
    fsm.readdir(path, function(err, contents) {
      if (err) {
        if (err.errno == constants.ENOTDIR) {
          statList(fsm, [path], function(err, list) {
            if (err)
              return callback(err);
            if (list.length != 1)
              throw new Error("Internal error in glob.js");
            callback(null, list);
          });
        }
        else if (err.errno == constants.ENOENT) {
          callback(null, []);
        }
        else {
          callback(err);
        }
      }
      else {
        statList(fsm, contents.map(function(p) {
          return PathModule.join(path, p);
        }), function(err, list) {
          if (err)
            callback(err);
          else
            callback(null, list);
        });
      }
    });

    return;
  }
  else {
    // Check that there is no '/' after the first wildcard.

    var i;
    for (i = w; i < path.length; ++i) {
      if (path.charAt(i) == '/')
        return callback(null, []);
    }

    var base = "", pattern;
    for (i = w; i >= 0; --i) {
      if (path.charAt(i) == '/') {
        base = path.substr(0, i + 1)
        break;
      }
    }
    pattern = path.substr(i == 0 ? 0 : i + 1);

    // Remove any leading/trailing slashes which might still
    // be present if the path contains multiple slashes.
    for (i = 0; i < pattern.length && pattern.charAt(i) == '/'; ++i);
    if (i > 0)
      pattern = pattern.substr(i);
    for (i = base.length - 1; i > 0 && base.charAt(i) == '/'; --i);
    if (i != base.length - 1)
      base = base.substr(0, i + 1);

    // We now have the base path in 'base' (possibly the empty string)
    // and the wildcard filename pattern in 'pattern'.

    readTheDir(false);
    function readTheDir(listingSingleDir) {
      fsm.readdir(base, function(err, contents) {
        if (err) {
          if (err.errno == constants.ENOTDIR || err.errno == constants.ENOENT) {
            callback(null, []);
          }
          else {
            callback(err);
          }
        }
        else {
          var matches;
          if (!listingSingleDir)
            matches = contents.filter(function(n) {
              return matchPattern(pattern, n);
            });
          else
            matches = contents;

          // Special case. If we have exactly one match, and it's a directory, then list
          // the contents of that directory. (There's no reason why anyone should want
          // to identify mutliple directories using wildcards and then list all of their
          // contents over FTP!)
          if (!listingSingleDir && matches.length == 1) {
            var dir = PathModule.join(base, matches[0]);
            fsm.stat(dir, function(err, st) {
              if (err)
                return callback(err);

              if (!st.isDirectory()) {
                doTheNormalThing();
              }
              else {
                base = dir;
                readTheDir(/*listingSingleDir=*/true);
              }
            });
          }
          else {
            doTheNormalThing();
          }

          function doTheNormalThing() {
            statList(fsm, matches.map(function(p) {
              return PathModule.join(base, p);
            }), function(err, list) {
              if (err)
                callback(err);
              else
                callback(null, list);
            });
          }
        }
      });
    }
  }
}

exports.glob = glob;
exports.matchPattern = matchPattern;
exports.setMaxStatsAtOnce = setMaxStatsAtOnce;

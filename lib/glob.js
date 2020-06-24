var PathModule = require('path');

var CONC = 5;
function setMaxStatsAtOnce(n) {
  CONC = n;
}

// Wildcard directory listing. There is no way that a client should
// use wildcards in directory names unless they're identifying a
// unique directory to be listed. So this can be pretty simple.

function statList(fsm, list, callback) {
  var total = list.length;
  var finished = false;
  var stats = [];

  for (var i = 0; i < CONC; ++i) {
    handleFile();
  }

  function handleFile() {
    if (stats.length === total) {
      return finish(null);
    }

    if (list.length === 0) {
      return;
    }

    var path = list.shift();
    fsm.stat(path, function(err, st) {
      if (err) {
        return finish(err);
      }

      stats.push({
        name: PathModule.basename(path),
        stats: st,
      });
      handleFile();
    });
  }

  function finish(err) {
    if (finished) {
      return;
    }
    finished = true;
    callback(err, stats);
  }
}

function matchPattern(pattern, string) {
  var pi = 0;
  var si = 0;
  for (; si < string.length && pi < pattern.length; ++si) {
    var c = string.charAt(si);
    var pc = pattern.charAt(pi);

    if (pc === '*') {
      if (pi + 1 === pattern.length) {

      } else if (pattern.charAt(pi + 1) === '*') {
        --si;
        ++pi;
      } else if (pattern.charAt(pi + 1) === '?') {
        ++pi;
      } else if (si < string.length - 1 && pattern.charAt(pi + 1) === string.charAt(si)) {
        pi += 2;
      }
    } else if (pc === '?') {
      ++pi;
    } else if (pc === c) {
      ++pi;
    } else {
      return false;
    }
  }

  return (pi === pattern.length || (pi === pattern.length - 1 && pattern.charAt(pi) === '*')) && si === string.length;
}

function glob(path, fsm, callback, noWildcards) {
  var w;
  for (w = 0; !noWildcards && w < path.length && path.charAt(w) !== '*' && path.charAt(w) !== '?'; ++w) {

  }

  if (w === path.length) { // There are no wildcards.
    fsm.readdir(path, function(err, contents) {
      if (err) {
        if (err.code === 'ENOENT') {
          callback(null, []);
          return;
        }

        if (err.code !== 'ENOTDIR') {
          callback(err);
          return;
        }

        contents = [''];
      }

      var list = contents.map(function(p) {
        return PathModule.join(path, p);
      });

      statList(fsm, list, callback);
    });

    return;
  }

  var i;

  // Check that there is no '/' after the first wildcard.
  for (i = w; i < path.length; ++i) {
    if (path.charAt(i) === '/') {
      return callback(null, []);
    }
  }

  var base = '';
  var pattern;
  for (i = w; i >= 0; --i) {
    if (path.charAt(i) === '/') {
      base = path.substr(0, i + 1);
      break;
    }
  }
  pattern = path.substr(i === 0 ? 0 : i + 1);

  // Remove any leading/trailing slashes which might still
  // be present if the path contains multiple slashes.
  for (i = 0; i < pattern.length && pattern.charAt(i) === '/'; ++i) {

  }
  if (i > 0) {
    pattern = pattern.substr(i);
  }
  for (i = base.length - 1; i > 0 && base.charAt(i) === '/'; --i) {

  }
  if (i !== base.length - 1) {
    base = base.substr(0, i + 1);
  }

  // We now have the base path in 'base' (possibly the empty string)
  // and the wildcard filename pattern in 'pattern'.

  readTheDir(false);
  function readTheDir(listingSingleDir) {
    fsm.readdir(base, function(err, contents) {
      if (err) {
        if (err.code === 'ENOTDIR' || err.code === 'ENOENT') {
          callback(null, []);
        } else {
          callback(err);
        }
      } else {
        var matches;
        if (!listingSingleDir) {
          matches = contents.filter(function(n) {
            return matchPattern(pattern, n);
          });
        } else {
          matches = contents;
        }

        // Special case. If we have exactly one match, and it's a directory, then list
        // the contents of that directory. (There's no reason why anyone should want
        // to identify mutliple directories using wildcards and then list all of their
        // contents over FTP!)
        if (!listingSingleDir && matches.length === 1) {
          var dir = PathModule.join(base, matches[0]);
          fsm.stat(dir, function(err, st) {
            if (err) {
              return callback(err);
            }

            if (!st.isDirectory()) {
              doTheNormalThing();
            } else {
              base = dir;
              readTheDir(/*listingSingleDir=*/true);
            }
          });
        } else {
          doTheNormalThing();
        }

        function doTheNormalThing() {
          statList(
            fsm,
            matches.map(function(p) {
              return PathModule.join(base, p);
            }),
            callback
          );
        }
      }
    });
  }
}

exports.glob = glob;
exports.matchPattern = matchPattern;
exports.setMaxStatsAtOnce = setMaxStatsAtOnce;

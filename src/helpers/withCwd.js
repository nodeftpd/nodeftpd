var pathModule = require('path');

function withCwd(cwd, path) {
  var firstChar = (path || '').charAt(0);
  cwd = cwd || pathModule.sep;
  path = path || '';
  if (firstChar === '/' || firstChar === pathModule.sep) {
    cwd = pathModule.sep;
  }
  path = pathModule.join(pathModule.sep, cwd, path);
  return path;
}

module.exports = withCwd;

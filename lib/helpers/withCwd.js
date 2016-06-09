var path = require('path');

function withCwd(cwd, p) {
  p = p || '';
  if (!cwd || p.charAt(0) in ['/', path.sep]) {
    cwd = path.sep;
  }
  return path.join(path.sep, cwd, p);
}

module.exports = withCwd;

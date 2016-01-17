import pathModule from 'path';

const SEP = pathModule.sep;

const withCwd = (cwd, path) => {
  let firstChar = (path || '').charAt(0);
  if (firstChar === '/' || firstChar === SEP) {
    cwd = SEP;
  }
  return pathModule.join(SEP, cwd || SEP, path || '');
};

export default withCwd;

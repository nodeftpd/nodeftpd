// Currently used for stripping options from beginning of argument to LIST and NLST.
function stripOptions(str) {
  const IN_SPACE = 0;
  const IN_DASH = 1;
  let state = IN_SPACE;
  for (let i = 0; i < str.length; ++i) {
    const c = str.charAt(i);
    if (state === IN_SPACE) {
      if (c === ' ' || c === '\t') {

      } else if (c === '-') {
        state = IN_DASH;
      } else {
        return str.substr(i);
      }
    } else if (state === IN_DASH && (c === ' ' || c === '\t')) {
      state = IN_SPACE;
    }
  }
  return '';
}

module.exports = stripOptions;

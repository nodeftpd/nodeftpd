// Currently used for stripping options from beginning of argument to LIST and NLST.
function stripOptions(str) {
  var IN_SPACE = 0;
  var IN_DASH = 1;
  var state = IN_SPACE;
  for (var i = 0; i < str.length; ++i) {
    var c = str.charAt(i);
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

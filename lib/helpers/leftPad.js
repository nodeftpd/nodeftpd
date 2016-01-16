function leftPad(text, width) {
  var out = '';
  for (var j = text.length; j < width; j++) {
    out += ' ';
  }
  out += text;
  return out;
}

module.exports = leftPad;

function leftPad(text, width) {
  let out = '';
  for (let j = text.length; j < width; j++) {
    out += ' ';
  }
  out += text;
  return out;
}

module.exports = leftPad;

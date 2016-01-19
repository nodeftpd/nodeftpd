const toBase256 = (number, minLength = 1) => {
  let digits = [];
  // This will truncate the number if it's larger than 2^31 - 1.
  number = number | 0;
  if (number < 0) {
    number = 0;
  }
  while (number !== 0) {
    let modulus = (number % 256);
    digits.unshift(modulus);
    number = (number - modulus) / 256;
  }
  if (minLength < 1) {
    minLength = 1;
  }
  while (digits.length < minLength) {
    digits.unshift(0);
  }
  return digits;
};

export default toBase256;

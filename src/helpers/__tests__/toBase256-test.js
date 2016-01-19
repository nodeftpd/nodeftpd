/*eslint-env node, mocha */
import toBase256 from '../toBase256';
import expect from 'expect';

describe('helpers/toBase256', () => {
  it('should convert numbers to their base256 parts', () => {
    expect(toBase256(1)).toEqual([1]);
    expect(toBase256(256)).toEqual([1, 0]);
    expect(toBase256(257)).toEqual([1, 1]);
  });

  it('should not allow negative numbers or overflow', () => {
    expect(toBase256(-1)).toEqual([0]);
    expect(toBase256(2147483648)).toEqual([0]);
    expect(toBase256(Math.pow(2, 33))).toEqual([0]);
  });

  it('should accept second parameter `minLength`', () => {
    expect(toBase256(-1, 2)).toEqual([0, 0]);
    expect(toBase256(2147483647, 5)).toEqual([0, 127, 255, 255, 255]);
    expect(toBase256(300, -1)).toEqual([1, 44]);
  });
});

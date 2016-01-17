/*eslint-env node, mocha */
import leftPad from '../leftPad';
import expect from 'expect';

describe('helpers/leftPad', () => {
  it('should prepend space to a string', () => {
    expect(leftPad('abc', 5)).toBe('  abc');
    expect(leftPad('abc', 3)).toBe('abc');
    expect(leftPad('abc', 2)).toBe('abc');
    expect(leftPad('', 3)).toBe('   ');
    expect(leftPad(' a', 3)).toBe('  a');
  });
});

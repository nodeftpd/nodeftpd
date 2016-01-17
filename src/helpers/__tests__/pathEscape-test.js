/*eslint-env node, mocha */
import pathEscape from '../pathEscape';
import expect from 'expect';

describe('helpers/pathEscape', () => {
  it('should not change a string that does not need escaping', () => {
    expect(pathEscape('')).toBe('');
    expect(pathEscape('abc')).toBe('abc');
  });
  it('should escape one ore more occurances', () => {
    expect(pathEscape('a"b')).toBe('a""b');
    expect(pathEscape('a"b"c')).toBe('a""b""c');
  });
});

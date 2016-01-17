/*eslint-env node, mocha */
import withCwd from '../withCwd';
import expect from 'expect';

describe('helpers/withCwd', () => {
  it('should accept no arguments', () => {
    expect(withCwd()).toBe('/');
  });
  it('should accept one argument', () => {
    expect(withCwd('/foo')).toBe('/foo');
  });
  it('should support relative paths', () => {
    expect(withCwd('/a', '../b')).toBe('/b');
    expect(withCwd('/a/b/c', './d')).toBe('/a/b/c/d');
    expect(withCwd('/a/b/c', 'd')).toBe('/a/b/c/d');
  });
  it('should support absolute paths', () => {
    expect(withCwd('/a', '/b')).toBe('/b');
    expect(withCwd('/a/b', '/c')).toBe('/c');
    expect(withCwd('/a/b/c', '/d')).toBe('/d');
  });
});

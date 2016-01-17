/*eslint-env node, mocha */
import stripOptions from '../stripOptions';
import expect from 'expect';

describe('helpers/stripOptions', () => {
  it('should not change a string unnecessarily', () => {
    expect(stripOptions('')).toBe('');
    expect(stripOptions('/ab/c')).toBe('/ab/c');
  });
  it('should remove options', () => {
    expect(stripOptions('-a /foo/bar')).toBe('/foo/bar');
    expect(stripOptions(' \t-a foo/bar')).toBe('foo/bar');
    expect(stripOptions('-d -ef A B C')).toBe('A B C');
  });
});

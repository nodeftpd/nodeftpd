var glob = require('../lib/glob'),
    assert = require('assert');

var matchPattern = glob.matchPattern;

describe('glob.matchPattern', function () {
  it('should match ? and * glob characters', function () {
    assert.equal(matchPattern("foo*", "foooxx"), true);
    assert.equal(matchPattern("foo*", "foo"), true);
    assert.equal(matchPattern("foo*", "fo"), false);
    assert.equal(matchPattern("foo*", ""), false);
    assert.equal(matchPattern("*foo*", "foo"), true);
    assert.equal(matchPattern("*foo*", "foio"), false);
    assert.equal(matchPattern("*.txt", ".txt"), true);
    assert.equal(matchPattern("*.txt", "xxx.txt"), true);
    assert.equal(matchPattern("*.txt", "xxx.txty"), false);
    assert.equal(matchPattern("*.txt?", "xxx.txty"), true);
    assert.equal(matchPattern("?a?b?c", "1a1b1c"), true);
    assert.equal(matchPattern("?a?b?c*.foo", "1a1b1cblah.foo"), true);
    assert.equal(matchPattern("?a?b?c*.foo", "1a1b1cblah.foob"), false);
    assert.equal(matchPattern("???", "xyz"), true);
    assert.equal(matchPattern("???", "xyzq"), false);
    assert.equal(matchPattern("?", "x"), true);
    assert.equal(matchPattern("?", "xx"), false);
    assert.equal(matchPattern("***", "xx"), true);
    assert.equal(matchPattern("***.foo", "xx.foo"), true);
    assert.equal(matchPattern("***.foo", "xx.foob"), false);
    assert.equal(matchPattern("*", ""), true);
    assert.equal(matchPattern("?", ""), false);
  });
});

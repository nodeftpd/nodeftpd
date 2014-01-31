var assert = require('assert');
var withCwd = require('../lib/ftpd').withCwd;

describe('withCwd', function () {
    assert.equal(withCwd('', ''), '/');
    assert.equal(withCwd('/', ''), '/');
    assert.equal(withCwd('', '/'), '/');
    assert.equal(withCwd('/', '/'), '/');
    assert.equal(withCwd('/foo', 'bar'), '/foo/bar');
    assert.equal(withCwd('/foo', '/bar'), '/foo/bar');
    assert.equal(withCwd('/foo', '/../bar'), '/foo/bar');
    assert.equal(withCwd('/foo', '../bar'), '/foo/bar');
    assert.equal(withCwd('/foo/bar', '../amp'), '/foo/bar/amp');
    assert.equal(withCwd('/foo/bar', '/../amp'), '/foo/bar/amp');
    assert.equal(withCwd('/foo/bar/', '../amp'), '/foo/bar/amp');
    assert.equal(withCwd('/foo/bar/', '/../amp'), '/foo/bar/amp');
});

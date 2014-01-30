var assert = require('assert');
var path = require('path');
// Hack to make it possible to test Windows behavior.
path.sep = '\\';
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
    assert.equal(withCwd('/foo/bar/', '/../amp/../../foobar'), '/foo/bar/amp/foobar');

    assert.equal(withCwd('', ''), '/');
    assert.equal(withCwd('\\', ''), '/');
    assert.equal(withCwd('', '\\'), '/');
    assert.equal(withCwd('\\', '\\'), '/');
    assert.equal(withCwd('\\foo', 'bar'), '\\foo/bar');
    assert.equal(withCwd('\\foo', '\\bar'), '\\foo/bar');
    assert.equal(withCwd('\\foo', '\\..\\bar'), '\\foo/bar');
    assert.equal(withCwd('\\foo', '..\\bar'), '\\foo/bar');
    assert.equal(withCwd('\\foo\\bar', '..\\amp'), '\\foo\\bar/amp');
    assert.equal(withCwd('\\foo\\bar', '\\..\\amp'), '\\foo\\bar/amp');
    assert.equal(withCwd('\\foo\\bar\\', '..\\amp'), '\\foo\\bar/amp');
    assert.equal(withCwd('\\foo\\bar\\', '\\..\\amp'), '\\foo\\bar/amp');
    assert.equal(withCwd('\\foo\\bar\\', '\\..\\amp\\..\\..\\foobar'), '\\foo\\bar/amp/foobar');
});

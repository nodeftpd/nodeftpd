nodeftpd - a simple FTP server written in node.js
====

This started as a fork of https://github.com/alanszlosek/nodeftpd
(which itself is based on Andrew Johnston's http://github.com/billywhizz/nodeftpd).
The code has now diverged quite a bit from the original codebase.
The old README for Alan Szlosek's version is OldREADME.markdown

Introduction
----

Nodeftpd is a simple but very configurable FTP(S) server. Nodeftpd:

* Abstracts out the `fs` module, so you can pass in any implemetation
  you like on a per-user basis. This makes it possible for each user to have
  his/her own virtual file system which is completely isolated from the file
  systems of other users.
* Provides hooks for handling authentication, etc.
* Supports TLS with explicit AUTH (though this is still a little buggy in places).

The code assumes that the `exists` function lives in the `fs` module, not the
`path` module, as in earlier versions of Node. However, monkeypatching `fs`
with `exists` should be sufficient to get this working with older Node versions.

Usage
----

See `test.js` for a simple example. `FtpServer` accepts the following options:

* `host`: An IP address.
* `getInitialCwd`: A function which, given a username, returns an initial CWD.
  The default is a function which always returns `"/"`.
* `getRoot`: A function which, given a username, returns a root directory (the
  user cannot escape this directory). The default is a function which always
  returns "/".
* `slurpFiles`: If set to `true`, files which the client requests to download
   are slurped using `readFile` before being sent, rather than being read
   chunk-by-chunk.
* `uploadMaxSlurpSize`: Determines the maximum file size (in bytes) for
  which uploads are buffered in memory before being written to disk using
  a single call to 'write'. Bigger uploads are written chunk-by-chunk via
  multiple calls to 'write'. The default is 0 (all uploads are written chunk-by-chunk).
* `tlsOptions`: If this is set, the server will allow explicit TLS authentication.
  Value should be a dictionary which is suitable as the `options` argument of
  `tls.createServer`.
* `tlsOnly`: If this is set to `true`, and `tlsOptions` is also set, then the
  server will not allow logins over non-secure connections.

The server raises a `command:pass` event which is given `pass`, `success` and
`failure` arguments. On successful login, `success` should be called with a
username argument. It may also optionally be given a second argument, which
should be an object providing an implementation of the API for Node's `fs`
module. The following must be implemented:

* `unlink`
* `readdir`
* `mkdir`
* `open`
* `read`
* `readFile`
* `close`
* `rmdir`
* `rename`
* `stat` → `{ mode, isDirectory(), size, mtime }`
* `write`
* `exists`

`FtpServer` has `listen` and `close` methods which behave as expected. It
emits `close` and `error` events.
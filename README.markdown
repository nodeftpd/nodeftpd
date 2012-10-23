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
* Supports TLS with explicit AUTH.

The code assumes that the `exists` function lives in the `fs` module, not the
`path` module, as in versions of Node prior to 0.8.x. However, monkeypatching `fs`
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
* `useWriteFile`: If set to `true`, then files which the client uploads are
  buffered in memory and then written to disk using `writeFile`.
* `useReadFile`: If set to `true`, then files which the client uploads are
  slurped using 'readFile'.
* `uploadMaxSlurpSize`: Determines the maximum file size (in bytes) for
  which uploads are buffered in memory before being written to disk. Has an effect
  only if `useWriteFile` is set to `true`. If `uploadMaxSlurpSize` is not set,
  then there is no limit on buffer size.
* `tlsOptions`: If this is set, the server will allow explicit TLS authentication.
  Value should be a dictionary which is suitable as the `options` argument of
  `tls.createServer`.
* `tlsOnly`: If this is set to `true`, and `tlsOptions` is also set, then the
  server will not allow logins over non-secure connections.
* `maxStatsAtOnce`: The maximum number of concurrent calls to `fs.stat` which will be
  made when processing a `LIST` request. Default is 5.
* `filenameSortFunc`: A function which can be used as the argument of an array's
  `sort` method. Used to sort filenames for directory listings. If this is not
  specified, filenames are ordered using `localeCompare`.
* `filenameSortMap`: A function which is applied to each filename before sorting.
  By default, this is `function (x) { return x.toUpperCase() }`. If set to `false`,
  filenames are unaltered.
* `dontSortFilenames`: If this is set, then filenames are not sorted in responses
   to the `LIST` and `NLST` commands.
* `noWildcards`: If set to `true`, then `LIST` and `NLST` treat the characters
  `?` and `*` as literals instead of as wildcards.

The server raises a `command:pass` event which is given `pass`, `success` and
`failure` arguments. On successful login, `success` should be called with a
username argument. It may also optionally be given a second argument, which
should be an object providing an implementation of the API for Node's `fs`
module. 

The following must be implemented:

* `unlink`
* `readdir`
* `mkdir`
* `open`
* `read` [if `slurpFiles` option is not set]
* `readFile` [if `slurpFiles` option is set]
* `close`
* `rmdir`
* `rename`
* `stat` → `{ mode, isDirectory(), size, mtime }`
* `createWriteStream` [if `useWriteFile` option is not set or is false] - 
    _Returns a writable stream, requiring:_ 
    events: 'open', 'error', 'close'; functions: 'write'
* `writeFile` [if `useWriteFile` option is set to 'true']
* `createReadStream` [if `useReadFile` option is not set or is false]
    _Returns a readable stream, requiring:_
    events: 'error', 'data', 'end'; functions: 'destroy'
* `readFile` [if `useReadFile` option is set to 'true']
* `exists`

`FtpServer` has `listen` and `close` methods which behave as expected. It
emits `close` and `error` events.
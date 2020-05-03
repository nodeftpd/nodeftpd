# FTP Server in node

[![Support me on Github][badge_sponsor]][link_sponsor]
[![npm][badge_npm]][link_npm]
[![github issues][badge_issues]][link_issues]
[![Build and test](https://github.com/svrooij/nodeftpd/workflows/Build%20and%20test/badge.svg)][link_build]
[![Coverage Status][badge_coveralls]](link_coveralls)
[![semantic-release][badge_semantic]](link_semantic)

This version of nodeftpd started as a scoped version to get [ipcam2mqtt](https://github.com/svrooij/ipcam2mqtt) running again.

Recently I'm trying to reboot the release of this package again. Some tests are still broken (but ignored) but once we get all the tests fixed they will be enforced for each PR. The package it automatically tested and released by a [workflow][link_build].

## Simple, Extensible FTP Server in Pure JavaScript

- [Introduction](#introduction)
- [Usage](#usage)
  - [FtpServer options:](#ftpserver-options)
    - [host (string) - IP Address](#host-string---ip-address)
    - [options (object) - Configuration](#options-object---configuration)
    - [Path Configurations](#path-configurations)
    - [File/handling Configurations](#filehandling-configurations)
    - [Connectivity settings](#connectivity-settings)
  - [File System Abstraction](#filesystem-abstraction)

## Introduction

This is a simple but very configurable FTP server. Notable features include:

- Abstracts out the `fs` module, so you can use any implementation,
  even on a per-user basis. This makes it possible for each user to have
  his/her own virtual file system, isolated from that of the system or other users.
- Provides hooks for handling authentication, content modification, etc.
- Supports TLS with explicit AUTH.

## Installation

`npm install @svrooij/ftpd`

## Usage

See example code in `sample/test.js`

### FtpServer options

#### host (string) - IP Address

host is a string representation of the IP address clients use to connect to the FTP server.  It's imperative that this actually reflects the remote IP the clients use to access the server, as this IP will be used in the establishment of PASV data connections.  If this IP is not the one clients use to connect, you will see some strange behavior from the client side (hangs).

#### options (object) - Configuration

See `sample/test.js` for a simple example. `FtpServer` accepts the following options:

##### Path Configurations

Both these need to be set - there are no defaults.

- `getInitialCwd`: Gets the initial working directory for the user.  Called after user is authenticated.
This path is relative to the root directory. The user may escape their initial cwd.
    - **Pattern**: `function(username, [callback(err, path)])`
    - **Arguments**:
        - username (string): the username to get CWD for
        - callback (function, optional):
    - **Examples**:
        - Simplest usage, no callback, just return:

        ```js
            getInitialCwd: function(connection) {
              return "/" + connection.username;
            }
        ```

        - Usage with callback:

        ```js
            getInitialCwd: function(connection, callback) {
              var userDir = '/' + connection.username;
              fs.exists(userDir, function(exists) {
                if (exists) {
                  callback(null, userDir);
                } else {
                  fs.mkDir(userDir, function(err) {
                    callback(err, userDir);
                  });
                }
              });
            }
            // If the directory exists, callback immediately with that directory
            // If not, create the directory and callback possible error + directory
        ```

        - Typical cases where you would want/need the callback involve retrieving configurations from external datasources and suchlike.

- `getRoot`: Gets the root directory for the user. This directory has the path '/' from the point of view of the user.
The user is not able to escape this directory.
    - **Pattern**: `function(connection, [callback(err, rootPath)])`
    - **Arguments**:
        - connection (object): the connection for which to get root
        - callback (function, optional):
    - **Examples**:

        ```js
            getRoot: function() {
              return process.cwd();
            }
            // The users will now enter at the '/' level, which is the directory passed to getInitialCwd.
        ```

        - Usage with callback:

        ```js
            getRoot: function(connection, callback) {
	          var rootPath = process.cwd() + '/' + connection.username;
              fs.exists(rootPath, function(exists) {
                if (exists) {
                  callback(null, rootPath);
                } else {
                  fs.mkDir(userDir, function(err) {
                    if (err) {
                      callback(null, '/'); // default to root
                    } else {
                      callback(err, rootPath);
                    }
                  });
                }
              });
            }
            // If the subdir exists, callback immediately with relative path to that directory
            // If not, create the directory, and callback relative path to the directory
            // Stupidly, instead of failing, we apparently want 'worst case' scenario to allow relative root.
        ```

      - Typical cases where you would want/need the callback involve retrieving configurations from external datasources and suchlike.
      - Additionally, you may want to provide emulation of a path, for instance /users/(username)/ftproot.

##### File/handling Configurations

- `useWriteFile`: _(default: false)_
  - If set to `true`, then files which the client uploads are buffered in memory and then written to disk using `writeFile`.
  - If `false`, files are written using writeStream.
- `useReadFile`: _(default: false)_
  - If set to `true`, then files which the client downloads are slurped using 'readFile'.
  - If `false`, files are read using readStream.
- `uploadMaxSlurpSize`: _(default: unlimited)_
  - Determines the maximum file size (in bytes) for which uploads are buffered in memory before being written to disk.
  - Has an effect only if `useWriteFile` is set to `true`.
  - If `uploadMaxSlurpSize` is not set, then there is no limit on buffer size.
- `hideDotFiles`: _(default: false)_
  - Hides files beginning with a dot (UNIX hidden files) on `LIST` commands.
- `maxStatsAtOnce`: _(default: 5)_
  - The maximum number of concurrent calls to `fs.stat` which will be
  made when processing a `LIST` request.
- `filenameSortFunc`: _(default: `localeCompare`)_
  - A function which can be used as the argument of an array's `sort` method. Used to sort filenames for directory listings.  
      See [https://developer.mozilla.org/en-US/docs/JavaScript/Reference/Global_Objects/Array/sort] for more info.
- `filenameSortMap`: _(default: `function (x) { return x.toUpperCase() }`)_
  - A function which is applied to each filename before sorting.
  - If set to `false`, filenames are unaltered.
- `dontSortFilenames`: _(default: false)_
  - If this is set, then filenames are not sorted in responses to the `LIST` and `NLST` commands.
- `noWildcards`: _(default: false)_
  - If set to `true`, then `LIST` and `NLST` treat the characters `?` and `*` as literals instead of as wildcards.

##### Command configuration

- `allowedCommands`: _(default: undefined)_
  - List of strings, the server will respond to only commands contained in this list, all other commands will result in a 502 unimplemented error.

##### Connectivity settings

- `tlsOptions`: _(default: undefined)_
  - If this is set, the server will allow explicit TLS authentication.
  - Value should be a dictionary which is suitable as the `options` argument of `tls.createServer`.
- `tlsOnly`: _(default: false)_
  - If this is set to `true`, and `tlsOptions` is also set, then the server will not allow logins over non-secure connections.
- `allowUnauthorizedTls`: ?? I obviously set this to true when tlsOnly is on -someone needs to update this.
- `pasvPortRangeStart`: _(default: random?)_
  - Integer, specifies the lower-bound port (min port) for creating PASV connections
- `pasvPortRangeEnd`: _(default: random?)_
  - Integer, specifies the upper-bound port (max port) for creating PASV connections

## Filesystem Abstraction

Filesystem abstraction makes it possible to
create an FTP server which interacts directly with a database rather than the
actual filesystem.

The server raises a `command:pass` event which is given `pass`, `success` and
`failure` arguments. On successful login, `success` should be called with a
username argument. It may also optionally be given a second argument, which
should be an object providing an implementation of the API for Node's `fs`
module.

The following must be implemented:

- `unlink`
- `readdir`
- `mkdir`
- `open`
- `close`
- `rmdir`
- `rename`
- `stat` →
  - specific object properties: `{ mode, isDirectory(), size, mtime }`
- if `useWriteFile` option is not set or is false
  - `createWriteStream`: _Returns a writable stream, requiring:_
        - events: 'open', 'error', 'finish'
        - functions: 'write', 'end'
        - properties: 'bytesWritten'
- if `useWriteFile` option is set to 'true'
  - `writeFile`
- if `useReadFile` option is not set or is false
  - `createReadStream`:  _Returns a readable stream, requiring:_
        - events: 'error', 'data', 'end'
        - functions: 'destroy'
- if `useReadFile` option is set to 'true'
  - `readFile`

`FtpServer` has `listen` and `close` methods which behave as expected. It
emits `close` and `error` events.

[badge_coveralls]: https://coveralls.io/repos/github/svrooij/nodeftpd/badge.svg?branch=master
[badge_issues]: https://img.shields.io/github/issues/svrooij/nodeftpd
[badge_npm]: https://img.shields.io/npm/v/@svrooij/ftpd
[badge_semantic]: https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg
[badge_sponsor]: https://img.shields.io/badge/Sponsor-on%20Github-red

[link_build]: https://github.com/svrooij/nodeftpd/actions
[link_coveralls]: https://coveralls.io/github/svrooij/nodeftpd?branch=master
[link_issues]: https://github.com/svrooij/nodeftpd/issues
[link_npm]: https://www.npmjs.com/package/@svrooij/ftpd
[link_semantic]: https://github.com/semantic-release/semantic-release
[link_sponsor]: https://github.com/sponsors/svrooij

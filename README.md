# Simple, Extensible FTP Server in Pure JavaScript
[![Build Status](https://travis-ci.org/sstur/nodeftpd.png?branch=master)](https://travis-ci.org/sstur/nodeftpd)

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

* Abstracts out the `fs` module, so you can use any implementation,
  even on a per-user basis. This makes it possible for each user to have
  his/her own virtual file system, isolated from that of the system or other
  users.
* Provides hooks for handling authentication, content modification, etc.
* Supports TLS with explicit AUTH.


## Installation

    npm install ftpd


## Usage

Create the FTPServer (simple example):

```js
    var ftpd = require('ftpd');
    var fs = require('fs');

    var options = {
      pasvPortRangeStart: 4000,
      pasvPortRangeEnd: 5000,
      getInitialCwd: function(user, callback) {
        var userPath = process.cwd() + '/' + user;
        fs.exists(userPath, function(exists) {
          exists ? callback(null, userPath) : callback('path does not exist', userPath);
        });
      },
      getRoot: function(user) {
        return '/';
      }
    };

    var host = '10.0.0.42';

    var server = new ftpd.FtpServer(host, options);

    server.on('client:connected', function(conn) {
      var username;
      console.log('Client connected from ' + conn.socket.remoteAddress);
      conn.on('command:user', function(user, success, failure) {
        username = user;
        (user == 'john') ? success() : failure();
      });
      conn.on('command:pass', function(pass, success, failure) {
        // check the password
        (pass == 'bar') ? success(username) : failure();
      });
    });

    server.listen(21);
    console.log('FTPD listening on port 21');
            
```

### FtpServer options:

#### host (string) - IP Address

host is a string representation of the IP address clients use to connect to the FTP server.  It's imperative that this actually reflects the remote IP the clients use to access the server, as this IP will be used in the establishment of PASV data connections.  If this IP is not the one clients use to connect, you will see some strange behavior from the client side (hangs).

#### options (object) - Configuration

See `test.js` for a simple example. `FtpServer` accepts the following options:

##### Path Configurations

Both these need to be set - there are no defaults.

- `getInitialCwd`: Gets the initial working directory for the user.  Called after user is authenticated.
    - **Pattern**: `function(username, [callback(err, path)])`
    - **Arguments**:
        - username (string): the username to get CWD for
        - callback (function, optional): 
    - **Examples**:
        - Simplest usage, no callback, just return:

        ```js
            getInitialCwd: function(connection) {
              return process.cwd() + "/" + connection.username;
            }
            // The user's path is hereby limited to the [cwd]/username directory
        ```

        - Usage with callback:
        
        ```js
            getInitialCwd: function(connection, callback) {
              var userDir = process.cwd() + '/' + connection.username;
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

- `getRoot`: Gets the root directory for the user relative to the CWD.  Called after getInitialCwd. 
    The user is not able to escape this directory.
    - **Pattern**: `function(username, [callback(err, rootPath)])`
    - **Arguments**:
        - username (string): the username to get root for
        - callback (function, optional): 
    - **Examples**:

        ```js
            getRoot: function() {
              return '/';
            }
            // The users will now enter at the '/' level, which is the directory passed to getInitialCwd.
        ```

        - Usage with callback:

        ```js
            getRoot: function(connection, callback) {
              var rootDir = '/my_home';
              var rootPath = process.cwd() + '/' + connection.username + '/my_home';
              fs.exists(rootPath, function(exists) {
                if (exists) {
                  callback(null, rootDir);
                } else {
                  fs.mkDir(userDir, function(err) {
                    if (err) {
                      callback(null, '/'); // default to root
                    } else {
                      callback(err, rootDir);
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
    - If set to `true`, then files which the client uploads are slurped using 'readFile'.
    - If `false`, files are read using readStream.
- `uploadMaxSlurpSize`: _(default: unlimited)_
    - Determines the maximum file size (in bytes) for which uploads are buffered in memory before being written to disk. 
    - Has an effect only if `useWriteFile` is set to `true`. 
    - If `uploadMaxSlurpSize` is not set, then there is no limit on buffer size.
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
        - events: 'open', 'error', 'close' 
        - functions: 'write'
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

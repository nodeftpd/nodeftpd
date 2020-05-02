const fs = require('fs');
const path = require('path');
const ftpd = require('.');

let keyFile;
let certFile;
const options = {
  host: process.env.IP || '127.0.0.1',
  port: process.env.PORT || 7002,
  tls: null,
};

if (process.env.KEY_FILE && process.env.CERT_FILE) {
  console.log('Running as FTPS server');
  if (process.env.KEY_FILE.charAt(0) !== '/') {
    keyFile = path.join(__dirname, process.env.KEY_FILE);
  }
  if (process.env.CERT_FILE.charAt(0) !== '/') {
    certFile = path.join(__dirname, process.env.CERT_FILE);
  }
  options.tls = {
    key: fs.readFileSync(keyFile),
    cert: fs.readFileSync(certFile),
    ca: !process.env.CA_FILES ? null : process.env.CA_FILES
      .split(':')
      .map((f) => fs.readFileSync(f)),
  };
} else {
  console.log();
  console.log('*** To run as FTPS server,                 ***');
  console.log('***  set "KEY_FILE", "CERT_FILE"           ***');
  console.log('***  and (optionally) "CA_FILES" env vars. ***');
  console.log();
}

const server = new ftpd.FtpServer(options.host, {
  getInitialCwd() {
    return '/';
  },
  getRoot() {
    return process.cwd();
  },
  pasvPortRangeStart: 1025,
  pasvPortRangeEnd: 1050,
  tlsOptions: options.tls,
  allowUnauthorizedTls: true,
  useWriteFile: false,
  useReadFile: false,
  uploadMaxSlurpSize: 7000, // N/A unless 'useWriteFile' is true.
});

server.on('error', (error) => {
  console.log('FTP Server error:', error);
});

server.on('client:connected', (connection) => {
  let username = null;
  console.log(`client connected: ${connection.remoteAddress}`);
  connection.on('command:user', (user, success, failure) => {
    if (user) {
      username = user;
      success();
    } else {
      failure();
    }
  });

  connection.on('command:pass', (pass, success, failure) => {
    if (pass) {
      success(username);
    } else {
      failure();
    }
  });
});

server.debugging = 4;
server.listen(options.port);
console.log(`Listening on port ${options.port}`);

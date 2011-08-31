var ftpd = require('./ftpd.js');

var server = ftpd.createServer("localhost").listen(7001, "127.0.0.1");

var ftpd = require('./ftpd.js');

var server = ftpd.createServer("127.0.0.1", "/home/alan/temporary").listen(7001);

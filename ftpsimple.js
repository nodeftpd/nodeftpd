var sys = require("sys");
var net = require("net");
var ftpd = require("./ftpd");
var spf = require("./sprintf");
ftpd.createServer("localhost").listen(21);
console.log('Listening on ftp://localhost:21/');

process.on('uncaughtException', function (err) {
    console.log('Uncaught exception: ' + err);
});

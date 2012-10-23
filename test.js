var ftpd = require('./');
var fs = require('fs');
var path = require('path');
var multiparter = require("multiparter");
var mime = require("mime");
var url = require("url");
var path = require("path");
var http = require("http");

var keyFile, certFile;
if (process.env.KEY_FILE && process.env.CERT_FILE) {
    console.log("Running as FPTS server");
    if (process.env.KEY_FILE.charAt(0) != '/')
        keyFile = path.join(__dirname, process.env.KEY_FILE);
    if (process.env.CERT_FILE.charAt(0) != '/')
        certFile = path.join(__dirname, process.env.CERT_FILE);
}
else {
    console.log(
        "\n" +
        "*** To run as FTPS server, set 'KEY_FILE', 'CERT_FILE' and (optionally) ***\n" +
        "*** 'CA_FILES' env vars. Set 'PORT' to change port that the server      ***\n" +
        "*** listens on.                                                         ***\n"
    );
}
var listenPort = process.env.PORT || 7002;

var tlsOptions = (process.env.KEY_FILE && process.env.CERT_FILE ? {
    key: fs.readFileSync(keyFile),
    cert: fs.readFileSync(certFile),
    ca: !process.env.CA_FILES ? null : process.env.CA_FILES.split(':').map(function (f) {
        return fs.readFileSync(f);
    })
} : null);

var server = new ftpd.FtpServer(process.env.IP || "127.0.0.1", {
//    getInitialCwd: function (username, callback) { callback(null, "/"); },
//    getRoot: function (username, callback) { callback(null, process.cwd()); },
    getInitialCwd: function () { return "/"; },
    getRoot: function () { return process.cwd(); },
    pasvPortRangeStart: 1025,
    pasvPortRangeEnd: 1050,
    tlsOptions: tlsOptions,
//    tlsOnly: true,
    allowUnauthorizedTls: true,
    useWriteFile: false,
    useReadFile: false,
    uploadMaxSlurpSize: 7000 // N/A unless 'useWriteFile' is true.
});

server.on('error', function (err) {
    console.log("FTP Server error:", err);
});

server.on("client:connected", function(conn) {
    var username = null;
    console.log("client connected: " + conn.remoteAddress);
    conn.on("command:user", function(user, success, failure) {
        if (user) {
            username = user;
            success();
        } else failure();
    });
    
    conn.on("command:pass", function(pass, success, failure) {
        if (pass) success(username);
        else failure();
    });
});
server.debugging = 4;
server.listen(listenPort);

console.log("Listening on port " + listenPort);

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
//    getInitialCwd: function () { return "/"; }
    getRoot: function () { return process.cwd(); },
    pasvPortRangeStart: 1025,
    pasvPortRangeEnd: 1050,
    tlsOptions: tlsOptions,
//    tlsOnly: true,
    allowUnauthorizedTls: true,
    uploadMaxSlurpSize: 0
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

  // This was added as a test in commit 6537c35710 by thomaschaaf to test the new file:received hook.
  // Commenting it out here since it won't work for people who don't have the relevant http server set up.
  //
/*  conn.on("file:received", function(file) {
    var post = "http://localhost/photos";
    var settings = url.parse(post);
    console.log(settings);
    var request = new multiparter.request(http, {
      host: settings.hostname,
      port: settings.post, 
      path: settings.pathname,
      method: "POST"
    });


    request.addStream(
      'file', 
      path.basename(file),
      mime.lookup(file),
      fs.statSync(file).size,
      fs.createReadStream(file));

    request.send(function(error, response) {
      if (error) {
        console.log(error);
      }

      var data = "";

      response.setEncoding("utf8");

      response.on("data", function(chunk) {
        data += chunk;
      });

      response.on("end", function() {
        console.log("Data: " + data);
      });

      response.on("error", function(error) {
        console.log(error);
      });
    });
  });*/
});
server.debugging = 4;
server.listen(listenPort);

console.log("Listening on port " + listenPort);

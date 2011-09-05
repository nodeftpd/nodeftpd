var ftpd = require('./ftpd.js');

var server = ftpd.createServer("127.0.0.1", "/home/alan/temporary");

// this event passes in the client socket which emits further events
// but should recommend they don't do socket operations on it
// so should probably encapsulate and hide it
server.on("client:connected", function(socket) {
    console.log("client connected: " + socket.remoteAddress);
    socket.on("command:user", function(user, success, failure) {
        if (user) success();
        else failure();
    });

    socket.on("command:pass", function(pass, success, failure) {
        if (pass) success();
        else failure();
    });
});
server.listen(7001);

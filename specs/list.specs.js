require('should');
var ftpd = require('../ftpd'),
    Ftp = require("jsftp"),
    path = require('path');


describe('LIST ftpd command', function(){
    var ftp, server;

    beforeEach(function(done){
        console.log("D", __dirname,  path.resolve(path.join(__dirname, '/../fixture')));
        server = new ftpd.FtpServer("127.0.0.1", {
            getRoot: function () { return path.resolve(path.join(__dirname, '/../fixture')); }
        });
        server.on("client:connected", function(cinfo) {
            var username;
            cinfo.on("command:user", function(user, success, failure) {
                if (user) {
                    username = user;
                    success();
                } else failure();
            });

            cinfo.on("command:pass", function(pass, success, failure) {
                if (pass) success(username);
                else failure();
            });
        });
        server.listen(2021);
        ftp = new Ftp({
            host: "127.0.0.1",
            port: 2021
        });
        ftp.auth("jose", "esoj", function(err, res) {
            done();
        });
    });

    it("should return - as a first character for files", function(done){
        ftp.list("/jose", function(err, d){
            console.log("X", d);
            var fileLine = d.substring(1).trim().split("\r\n")
                .filter(function(line){
                    console.log("FIL", line);
                    return line.indexOf("data.txt") !== -1;
                })[0];
            fileLine[0].should.eql("-");
            done();
        });
    });
    
    afterEach(function(){
        server.close();
    });
});
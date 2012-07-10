var net = require('net');

var tls = require('tls');
var fs = require('fs');
var net = require('net');
var starttls = require('./starttls');

var UPGRADE_IMMEDIATELY = true;

upgradingConnection();
//usingTlsCreateServer();

function usingTlsCreateServer() {
    var options = {
        key: fs.readFileSync('/users/alex/progs/nodeibexfarm/testcert/server.key'),
        cert: fs.readFileSync('/users/alex/progs/nodeibexfarm/testcert/server.crt'),
        
        // This is necessary only if using the client certificate authentication.
        requestCert: true,
        
        // This is necessary only if the client uses the self-signed certificate.
        //ca: [ fs.readFileSync('client-cert.pem') ]
        ca: null
    };
    
    var server = tls.createServer(options, withCleartextStream);
    server.listen(8000, function() {
        console.log('server bound (tls)');
    });
}

function upgradingConnection() {
    var server = net.createServer({ }, function (socket) {
        socket.setEncoding('utf-8');
        var m = '';
        socket.on('error', function (err) {
            console.log("ERROR", err);
        });

        if (UPGRADE_IMMEDIATELY) {
            upgrade();
        }
        else { 
            socket.on('data', function (s) {
                console.log('DATA', s);
                var nl = s.indexOf('\n');
                if (nl == -1) m += s;
                else {
                    socket.write("Acknowledged '" + m + s.trimRight() + "' -- switching to secure echo mode\n");
                    upgrade();
                }
            });
        }

        function upgrade() {
            starttls(socket, {
                key: fs.readFileSync('/users/alex/progs/nodeibexfarm/testcert/server.key'),
                cert: fs.readFileSync('/users/alex/progs/nodeibexfarm/testcert/server.crt'),
                ciphers: 'RC4-SHA:AES128-SHA:AES256-SHA'
            }, function (err, stream) {
                if (err) {
                    console.log(err);
                    return;
                }
                withCleartextStream(stream);
            });
        }
    });
    server.listen(8000, function () {
        console.log('server bound (net)');
    });
}

function withCleartextStream(cleartextStream) {
    console.log('server connected',
                cleartextStream.authorized ? 'authorized' : 'unauthorized');
    cleartextStream.write("welcome!\n");
    cleartextStream.setEncoding('utf8');
    cleartextStream.pipe(cleartextStream);
}

var net = require("net");
var util = require("util");
var PathModule = require('path');
var glob = require('./glob');
require('./date-format');

/*
TODO:
- Implement Full RFC 959
- Implement RFC 2428
- Implement RFC 2228
- Implement RFC 3659
- Implement TLS - http://en.wikipedia.org/wiki/FTPS


- passive command is for server to determine which port it listens on and report that to the client
- doesn't necessarily mean it needs to be listening (i guess), but i assume it actually SHOULD be listening
- it keeps listening for subsequent connections

- what sort of security should i enforce? should i require the same IP for data and control connections?
    - maybe just for milesplit's use?
*/


// host
//     an IP address.
//
// options.getFsModule
//     a function which, given a username, returns an object implemeting the API of
//     require('fs'). The following need to be implemented:
//         unlink
//         readdir
//         statSync
//         mkdir
//         open
//         read
//         close
//         rmdir
//         rename
//         stat
//         write
//
// options.getPathModule
//     a function which, given a username, returns an object implemeting the API of
//     require('path'). The following need to be implemented:
//         exists
//
// options.getInitialCwd
//     a function which, given a username, returns an initial CWD.
//
// options.getRoot
//     a function which, given a username, returns a root directory (user cannot get
//     outside of this dir).
// 
function createServer(host, options) {
    // make sure host is an IP address, otherwise DATA connections will likely break
    var server = net.createServer();
    server.getFsModule = options.getFsModule || (function () { var fs = require('fs'); return function () { return fs } })();
    server.getPathModule = options.getPathModule || function () { return PathModule; }
    server.getInitialCwd = options.getInitialCwd || function () { return "/"; };
    server.getRoot = options.getRoot || function () { return "/"; };
    server.debugging = 0;

    var logIf = function(level, message, socket) {
        if (server.debugging >= level) {
            if (socket)
                console.log(socket.remoteAddress + ": " + message);
            else
                console.log(message);
        }
    };

    server.on("listening", function() {
        logIf(0, "nodeFTPd server up and ready for connections");
    });
    server.on("connection", function(socket) {
        server.emit("client:connected", socket); // pass socket so they can listen for client-specific events

        socket.setTimeout(0);
        socket.setEncoding("ascii"); // force data String not Buffer
        socket.setNoDelay();

        var cinfo = {
            passive: false,
            dataHost: null,
            dataPort: 20, // default
            dataListener: null, // for incoming passive connections
            dataSocket: null, // the actual data socket
            mode: "ascii",
            filefrom: "",
            authFailures: 0, // 3 tries then we disconnect you
            temp: null,
            username: null,
            totsize: 0,
            filename: ""
        };

//        logIf(0, "Base FTP directory: "+cinfo.fs.cwd());

        var authenticated = function() {
            // send a message if not authenticated?
            return (cinfo.username ? true : false);
        };

        var authFailures = function() {
            if (cinfo.authFailures >= 2) {
                socket.end();
                return true;
            }
            return false;
        };

        var closeDataConnections = function() {
            if (cinfo.dataListener) cinfo.dataListener.close(); // we're creating a new listener
            if (cinfo.dataSocket) cinfo.dataSocket.end(); // close any existing connections
        };

        // Purpose of this is to ensure a valid data connection, and run the callback when it's ready
        function whenDataWritable(callback) {
            if (cinfo.passive) {
                // how many data connections are allowed?
                // should still be listening since we created a server, right?
                if (cinfo.dataSocket) {
                    logIf(3, "A data connection exists", socket);
                    if (callback) callback(cinfo.dataSocket); // do!
                } else {
                    logIf(3, "Passive, but no data socket exists ... weird", socket);
                    socket.write("425 Can't open data connection\r\n");
                }
            } else {
                // Do we need to open the data connection?
                if (cinfo.dataSocket) { // There really shouldn't be an existing connection
                    logIf(3, "Using existing non-passive dataSocket", socket);
                    callback(cinfo.dataSocket);
                } else {
                    logIf(1, "Opening data connection to " + cinfo.dataHost + ":" + cinfo.dataPort, socket);
                    var dataSocket = new net.Socket();
                    dataSocket.buffers = [];
                    // Since data may arrive once the connection is made, buffer it
                    dataSocket.on("data", function(data) {
                        logIf(3, dataSocket.remoteAddress + ' event: data ; ' + (Buffer.isBuffer(data) ? 'buffer' : 'string'));
                        dataSocket.buffers.push(data);
                    });
                    dataSocket.addListener("connect", function() {
                        cinfo.dataSocket = dataSocket;
                        logIf(3, "Data connection succeeded", socket);
                        callback(dataSocket);
                    });
                    dataSocket.addListener("close", function(had_error) {
                        cinfo.dataSocket = null;
                        if (had_error)
                            logIf(0, "Data event: close due to error", socket);
                        else
                            logIf(3, "Data event: close", socket);
                    });
                    dataSocket.addListener("end", function() {
                        logIf(3, "Data event: end", socket);
                    });
                    dataSocket.addListener("error", function(err) {
                        logIf(0, "Data event: error: " + err, socket);
                        dataSocket.destroy();
                    });
                    dataSocket.connect(cinfo.dataPort, cinfo.dataHost);
                }
            }
        };

        socket.addListener("connect", function () {
            logIf(1, "Connection", socket);
            //socket.send("220 NodeFTPd Server version 0.0.10\r\n");
            //socket.write("220 written by Andrew Johnston (apjohnsto@gmail.com)\r\n");
            //socket.write("220 Please visit http://github.com/billywhizz/NodeFTPd\r\n");
            socket.write("220 FTP server (nodeftpd) ready\r\n");
        });
        
        socket.addListener("data", function (data) {
            data = (data+'').trim();
            logIf(2, "FTP command: " + data, socket);

            var command, arg;
            var index = data.indexOf(" ");
            if (index > 0) {
                command = data.substring(0, index).trim().toUpperCase();
                commandArg = data.substring(index+1, data.length).trim();
            } else {
                command = data.trim().toUpperCase();
                commandArg = '';
            }
            
            switch(command)
            {
            case "ABOR":
                // Abort an active file transfer.
                socket.write("202 Not supported\r\n");
                break;
            case "ACCT":
                // Account information
                socket.write("202 Not supported\r\n");
                break;
            case "ADAT":
                // Authentication/Security Data (RFC 2228)
                socket.write("202 Not supported\r\n");
                break;
            case "ALLO":
                // Allocate sufficient disk space to receive a file.
                socket.write("202 Not supported\r\n");
                break;
            case "APPE":
                // Append.
                socket.write("202 Not supported\r\n");
                break;
            case "AUTH":
                // Authentication/Security Mechanism (RFC 2228)
                socket.write("202 Not supported\r\n");
                break;
            case "CCC":
                // Clear Command Channel (RFC 2228)
                socket.write("202 Not supported\r\n");
                break;
            case "CDUP":
                // Change to Parent Directory.
                if (!authenticated()) break;
                // Not sure if this is technically correct, but 'dirname' does in fact just
                // strip the last component of the path for a UNIX-style path, even if this
                // has a trailing slash. It also maps "/foo" to "/" and "/" to "/".
                cinfo.cwd = PathModule.dirname(cwd);
                socket.write("250 Directory changed to " + cinfo.cwd + "\r\n");
                break;
            case "CONF":
                // Confidentiality Protection Command (RFC 697)
                socket.write("202 Not supported\r\n");
                break;
            case "CWD":
                // Change working directory.
                if (!authenticated()) break;
                var path = PathModule.resolve(cinfo.cwd, commandArg);
                cinfo.path.exists(commandArg, function(exists) {
                    if (!exists) {
                        socket.write("550 Folder not found.\r\n");
                        return;
                    }
                    cinfo.cwd = path;
                    socket.write("250 CWD successful. \"" + cinfo.cwd + "\" is current directory\r\n");
                });
                break;
            case "DELE":
                // Delete file.
                if (!authenticated()) break;
                var filename = PathModule.join(cinfo.root, PathModule.resolve(cinfo.cwd, commandArg));
                cinfo.fs.unlink( filename, function(err){
                    if (err) {
                        logIf(0, "Error deleting file: "+filename+", "+err, socket);
                        // write error to socket
                        socket.write("550 Permission denied\r\n");
                    } else
                        socket.write("250 File deleted\r\n");
                });
                break;
            case "ENC":
                // Privacy Protected Channel (RFC 2228)
                socket.write("202 Not supported\r\n");
                break;
            case "EPRT":
                // Specifies an extended address and port to which the server should connect. (RFC 2428)
                var addr = commandArg.split("|");
                if (addr.length != 5 || addr[1] != "1" ||
                    !addr[2].match(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/) ||
                    !addr[3].match(/^\d+/)) {
                    socket.write("202 Not supported\r\n");
                }
                else {
                    cinfo.dataHost = addr[2];
                    cinfo.dataPort = parseInt(addr[3]);
                    socket.write("200 EPRT command successful.\r\n");
                }
                break;
            case "FEAT":
                // Get the feature list implemented by the server. (RFC 2389)
                socket.write("211-Features\r\n");
                socket.write(" SIZE\r\n");
                socket.write("211 end\r\n");
                break;
            case "HELP":
                // Returns usage documentation on a command if specified, else a general help document is returned.
                /*
                        214-The following commands are recognized:
                        USER   PASS   QUIT   CWD    PDD    PORT   PASV   TYPE
                        LIST   REST   CDUP   RETR   STOR   SIZE   DELE   RMD
                        MKD    RNFR   RNTO   ABOR   SYST   NOOP   APPE   NLST
                        MDTM   XPWD   XCUP   XMKD   XRMD   NOP    EPSV   EPRT
                        AUTH   ADAT   PBSZ   PROT   FEAT   MODE   OPTS   HELP
                        ALLO   MLST   MLSD   SITE   P@SW   STRU   CLNT   MFMT
                        214 Have a nice day.		
                        */
                socket.write("202 Not supported\r\n");
                break;
            case "LANG":
                // Language Negotiation (RFC 2640)
                socket.write("202 Not supported\r\n");
                break;
            case "LIST":
                // Returns information of a file or directory if specified, else information of the current working directory is returned.
                if (!authenticated()) break;

                whenDataWritable( function(pasvconn) {
                    var leftPad = function(text, width) {
                        var out = '';
                        for (var j = text.length; j < width; j++) out += ' ';
                        out += text;
                        return out;
                    };
                    // This will be called once data has ACTUALLY written out ... socket.write() is async!
                    var success = function() {
                        socket.write("226 Transfer OK\r\n");
                        pasvconn.end();
                    };
                    var failure = function() {
                        pasvconn.end();
                    };
                    if (pasvconn.readable) pasvconn.resume();
                    logIf(3, "Sending file list", socket);
                    cinfo.fs.readdir(PathModule.join(cinfo.root, cinfo.cwd), function(err, files) {
                        if (err) {
                            logIf(0, "While sending file list, reading directory: " + err, socket);
                            pasvconn.write("", failure);
                        } else {
                            // Wait until acknowledged!
                            socket.write("150 Here comes the directory listing\r\n", function() {
                                logIf(3, "Directory has " + files.length + " files", socket);
                                for (var i = 0; i < files.length; i++) {
                                    var file = files[ i ];
                                    var s = cinfo.fs.statSync( PathModule.join(cinfo.root, cinfo.cwd, file) );
                                    var line = s.isDirectory() ? 'd' : '-';
                                    if (i > 0) pasvconn.write("\r\n");
                                    line += (0400 & s.mode) ? 'r' : '-';
                                    line += (0200 & s.mode) ? 'w' : '-';
                                    line += (0100 & s.mode) ? 'x' : '-';
                                    line += (040 & s.mode) ? 'r' : '-';
                                    line += (020 & s.mode) ? 'w' : '-';
                                    line += (010 & s.mode) ? 'x' : '-';
                                    line += (04 & s.mode) ? 'r' : '-';
                                    line += (02 & s.mode) ? 'w' : '-';
                                    line += (01 & s.mode) ? 'x' : '-';
                                    line += " 1 ftp ftp ";
                                    line += leftPad(s.size.toString(), 12) + ' ';
                                    var d = new Date(s.mtime);
                                    line += leftPad(d.format('M d H:i'), 12) + ' '; // need to use a date string formatting lib
                                    line += file;
                                    pasvconn.write(line);
                                }
                                // write the last bit, so we can know when it's finished
                                pasvconn.write("\r\n", success);
                            });
                        }
                    });
                });
                break;
            case "LPRT":
                // Specifies a long address and port to which the server should connect. (RFC 1639)
                socket.write("202 Not supported\r\n");
                break;
            case "LPSV":
                // Enter long passive mode. (RFC 1639)
                socket.write("202 Not supported\r\n");
                break;
            case "MDTM":
                // Return the last-modified time of a specified file. (RFC 3659)
                socket.write("202 Not supported\r\n");
                break;
            case "MIC":
                // Integrity Protected Command (RFC 2228)
                socket.write("202 Not supported\r\n");
                break;
            case "MKD":
                // Make directory.
                if (!authenticated()) break;
                var filename = PathModule.join(cinfo.root, PathModule.resolve(cinfo.cwd, commandArg));
                cinfo.fs.mkdir( filename, 0755, function(err){
                    if(err) {
                        logIf(0, "Error making directory " + filename + " because " + err, socket);
                        // write error to socket
                        socket.write("550 \""+filename+"\" directory NOT created\r\n");
                        return;
                    }
                    socket.write("257 \""+filename+"\" directory created\r\n");
                });
                break;
            case "MLSD":
                // Lists the contents of a directory if a directory is named. (RFC 3659)
                socket.write("202 Not supported\r\n");
                break;
            case "MLST":
                // Provides data about exactly the object named on its command line, and no others. (RFC 3659)
                socket.write("202 Not supported\r\n");
                break;
            case "MODE":
                // Sets the transfer mode (Stream, Block, or Compressed).
                socket.write("202 Not supported\r\n");
                break;
            case "NLST":
                // Returns a list of file names in a specified directory.
                if (!authenticated()) break;
                
                /*
                Normally the server responds with a mark using code 150. It then stops accepting new connections, attempts to send the contents of the directory over the data connection, and closes the data connection. Finally it

                    accepts the LIST or NLST request with code 226 if the entire directory was successfully transmitted;
                    rejects the LIST or NLST request with code 425 if no TCP connection was established;
                    rejects the LIST or NLST request with code 426 if the TCP connection was established but then broken by the client or by network failure; or
                    rejects the LIST or NLST request with code 451 if the server had trouble reading the directory from disk.

                The server may reject the LIST or NLST request (with code 450 or 550) without first responding with a mark. In this case the server does not touch the data connection.
                */

                whenDataWritable( function(pasvconn) {
                    // This will be called once data has ACTUALLY written out ... socket.write() is async!
                    var success = function() {
                        socket.write("226 Transfer OK\r\n");
                        pasvconn.end();
                    };
                    var failure = function() {
                        pasvconn.end();
                    };
                    // Use temporary filesystem path maker since a path might be sent with NLST
                    var temp = '';
                    if (commandArg) {
                        // Remove double slashes or "up directory"
                        commandArg = commandArg.replace(/\/{2,}|\.{2}/g, '');
                        if (commandArg.substr(0, 1) == '/') {
                            temp = commandArg;
                        } else {
                            temp = PathModule.join(cinfo.cwd, commandArg);
                        }
                    } else temp = cinfo.cwd;
                    if (pasvconn.readable) pasvconn.resume();
                    logIf(3, "Sending file list", socket);
                    
                    glob.glob(temp, function(err, files) {
                        if (err) {
                            logIf(0, "During NLST, error globbing files: " + err, socket);
                            socket.write("451 Read error\r\n");
                            pasvconn.write("", failure);
                            return;
                        }
                        // Wait until acknowledged!
                        socket.write("150 Here comes the directory listing\r\n", function() {
                            logIf(3, "Directory has " + files.length + " files", socket);
                            pasvconn.write( files.map(PathModule.basename).join("\015\012") + "\015\012", success);
                        });
                    });
                });
                break;
            case "NOOP":
                // No operation (dummy packet; used mostly on keepalives).
                socket.write("202 Not supported\r\n");
                break;
            case "OPTS":
                // Select options for a feature. (RFC 2389)
                socket.write("202 Not supported\r\n");
                break;
            case "PASS":
                // Authentication password.
                socket.emit(
                    "command:pass",
                    commandArg,
                    function(username) { // implementor should call this on successful password check
                        socket.write("230 Logged on\r\n");
                        cinfo.username = username;
                        cinfo.fs = server.getFsModule(username);
                        cinfo.path = server.getPathModule(username);
                        cinfo.cwd = server.getInitialCwd(username);
                        cinfo.root = server.getRoot(username);
                    },
                    function() { // call second callback if password incorrect
                        socket.write("530 Invalid password\r\n");
                        cinfo.authFailures++;
                        cinfo.username = null;
                    }
                );
                break;
            case "PASV":
            case "EPSV":
                if (command == "EPSV" && commandArg && commandArg != "1") {
                    socket.write("202 Not supported\r\n");
                    break;
                }
                // Enter passive mode. This creates the listening socket.
                if (!authenticated()) break;
                // not sure whether the spec limits to 1 data connection at a time ...
                if (cinfo.dataListener) cinfo.dataListener.close(); // we're creating a new listener
                if (cinfo.dataSocket) cinfo.dataSocket.end(); // close any existing connections
                cinfo.dataListener = null;
                cinfo.dataSocket = null;
                // Passive listener needs to pause data because sometimes commands come before a data connection,
                // othertime afterwards ... depends on the client and threads
                socket.pause();
                var pasv = net.createServer(function(psocket) {
                    logIf(1, "Incoming passive data connection", socket);
                    psocket.pause();
                    psocket.buffers = [];
                    psocket.on("data", function(data) {
                        // should watch out for malicious users uploading large amounts of data outside protocol
                        logIf(3, 'Data event: received ' + (Buffer.isBuffer(data) ? 'buffer' : 'string'), socket);
                        psocket.buffers.push(data);
                    });
                    psocket.on("connect", function() {
                        logIf(1, "Passive data event: connect", socket);
                        // Once we have a completed data connection, make note of it
                        cinfo.dataSocket = psocket;
                        // 150 should be sent before we send data on the data connection
                        //socket.write("150 Connection Accepted\r\n");
                        if (socket.readable) socket.resume();
                    });
                    psocket.on("end", function () {
                        logIf(3, "Passive data event: end", socket);
                        // remove pointer
                        cinfo.dataSocket = null;
                        if (socket.readable) socket.resume(); // just in case
                    });
                    psocket.addListener("error", function(err) {
                        logIf(0, "Passive data event: error: " + err, socket);
                        cinfo.dataSocket = null;
                        if (socket.readable) socket.resume();
                    });
                    psocket.addListener("close", function(had_error) {
                        logIf(
                            (had_error ? 0 : 3),
                            "Passive data event: close " + (had_error ? " due to error" : ""),
                            socket
                        );
                        if (socket.readable) socket.resume();
                    });
                });
                // Once we're successfully listening, tell the client
                pasv.addListener("listening", function() {
                    var port = pasv.address().port;
                    cinfo.passive = true; // wait until we're actually listening
                    cinfo.dataHost = host;
                    cinfo.dataPort = port;
                    logIf(3, "Passive data connection listening on port " + port, socket);
                    var i1 = parseInt(port / 256);
                    var i2 = parseInt(port % 256);
                    if (command == "PASV") {
                        console.log("227 Entering Passive Mode (" + host.split(".").join(",") + "," + i1 + "," + i2 + ")\r\n");
                        socket.write("227 Entering Passive Mode (" + host.split(".").join(",") + "," + i1 + "," + i2 + ")\r\n");
                    }
                    else if (command == "EPSV") {
                        socket.write("229 Entering Extended Passive Mode (|||" + port + "|)\r\n");
                    }
                });
                pasv.on("close", function() {
                    logIf(3, "Passive data listener closed", socket);
                    if (socket.readable) socket.resume(); // just in case
                });
                pasv.listen(0);
                cinfo.dataListener = pasv;
                logIf(3, "Passive data connection beginning to listen", socket);
                break;
            case "PBSZ":
                // Protection Buffer Size (RFC 2228)
                socket.write("202 Not supported\r\n");
                break;
            case "PORT":
                // Specifies an address and port to which the server should connect.
                if (!authenticated()) break;
                cinfo.passive = false;
                cinfo.dataSocket = null;
                var addr = commandArg.split(",");
                cinfo.dataHost= addr[0]+"."+addr[1]+"."+addr[2]+"."+addr[3];
                cinfo.dataPort = (parseInt(addr[4]) * 256) + parseInt(addr[5]);
                socket.write("200 PORT command successful.\r\n");
                break;
            case "PWD":
                // Print working directory. Returns the current directory of the host.
                if (!authenticated()) break;
                socket.write("257 \"" + cinfo.cwd + "\" is current directory\r\n");
                break;
            case "QUIT":
                // Disconnect.
                socket.write("221 Goodbye\r\n");
                socket.end();
                closeDataConnections();
                break;
            case "REIN":
                // Re initializes the connection.
                socket.write("202 Not supported\r\n");
                break;
            case "REST":
                // Restart transfer from the specified point.
                if (!authenticated()) break;
                socket.write("202 Not supported\r\n");
                /*
                cinfo.totsize = parseInt(commandArg);
                socket.write("350 Rest supported. Restarting at " + cinfo.totsize + "\r\n");
                */
                break;
            case "RETR":
                // Retrieve (download) a remote file.
                whenDataWritable( function(pasvconn) {
                    pasvconn.setEncoding(cinfo.mode);

                    var filename = PathModule.join(cinfo.root, PathModule.resolve('/', commandArg));
                    if(filename != cinfo.filename)
                    {
                        cinfo.totsize = 0;
                        cinfo.filename = filename;
                    }
                    cinfo.fs.open( cinfo.filename, "r", function (err, fd) {
                        console.trace("DATA file " + cinfo.filename + " opened");
                        socket.write("150 Opening " + cinfo.mode.toUpperCase() + " mode data connection\r\n");
                        function readChunk() {
                            cinfo.fs.read(fd, 4096, cinfo.totsize, cinfo.mode, function(err, chunk, bytes_read) {
                                if(err) {
                                    console.trace("Erro reading chunk");
                                    throw err;
                                    return;
                                }
                                if(chunk) {
                                    cinfo.totsize += bytes_read;
                                    if(pasvconn.readyState == "open") pasvconn.write(chunk, cinfo.mode);
                                    readChunk();
                                }
                                else {
                                    console.trace("DATA file " + cinfo.filename + " closed");
                                    pasvconn.end();
                                    socket.write("226 Closing data connection, sent " + cinfo.totsize + " bytes\r\n");
                                    cinfo.fs.close(fd);
                                    cinfo.totsize = 0;
                                }
                            });
                        }
                        if(err) {
                            dotrace("Error at read");
                            throw err;
                        }
                        else {
                            readChunk();
                        }
                    });
                });
                break;
            case "RMD":
                // Remove a directory.
                if (!authenticated()) break;
                var filename = PathModule.join(cinfo.root, PathModule.resolve(cinfo.cwd, commandArg));
                cinfo.fs.rmdir( filename, function(err){
                    if(err) {
                        logIf(0, "Error removing directory "+filename, socket);
                        socket.write("550 Delete operation failed\r\n");
                    } else
                        socket.write("250 \""+filename+"\" directory removed\r\n");
                });
                break;
            case "RNFR":
                // Rename from.
                if (!authenticated()) break;
                cinfo.filefrom = PathModule.resolve(cinfo.cwd, commandArg);
                logIf(3, "Rename from " + cinfo.filefrom, socket);
                path.exists( cinfo.filefrom, function(exists) {
                    if (exists) socket.write("350 File exists, ready for destination name\r\n");
                    else socket.write("350 Command failed, file does not exist\r\n");
                });
                break;
            case "RNTO":
                // Rename to.
                if (!authenticated()) break;
                var fileto = PathModule.join(cinfo.root, PathModule.resolve(cinfo.cwd, commandArg));
                cinfo.fs.rename( cinfo.filefrom, fileto, function(err){
                    if(err) {
                        logIf(3, "Error renaming file from "+cinfo.filefrom+" to "+fileto, socket);
                        socket.write("550 Rename failed\r\n");
                    } else
                        socket.write("250 File renamed successfully\r\n");
                });
                break;
            case "SITE":
                // Sends site specific commands to remote server.
                socket.write("202 Not supported\r\n");
                break;
            case "SIZE":
                // Return the size of a file. (RFC 3659)
                if (!authenticated()) break;
                var filename = PathModule.join(cinfo.root, PathModule.resolve(cinfo.cwd, commandArg));
                cinfo.fs.stat( filename, function (err, s) {
                    if(err) { 
                        logIf(0, "Error getting size of file: "+filename, socket);
                        socket.write("450 Failed to get size of file\r\n");
                        return;
                    }
                    socket.write("213 " + s.size + "\r\n");
                });
                break;
            case "SMNT":
                // Mount file structure.
                socket.write("202 Not supported\r\n");
                break;
            case "STAT":
                // Returns the current status.
                
                /* from FileZilla
                        Connected to 192.168.2.100.
                        No proxy connection.
                        Mode: stream; Type: ascii; Form: non-print; Structure: file
                        Verbose: on; Bell: off; Prompting: on; Globbing: on
                        Store unique: off; Receive unique: off
                        Case: off; CR stripping: on
                        Ntrans: off
                        Nmap: off
                        Hash mark printing: off; Use of PORT cmds: on
                        Tick counter printing: off
                        */
                socket.write("202 Not supported\r\n");
                break;
            case "STOR":
                // Store (upload) a file.
                if (!authenticated()) break;
                whenDataWritable( function(dataSocket) {
                    // dataSocket comes to us paused, so we have a chance to create the file before accepting data
                    filename = PathModule.join(cinfo.root, PathModule.resolve(cinfo.cwd, commandArg));
                    cinfo.fs.open( filename, 'w', 0644, function(err, fd) {
                        if(err) {
                            logIf(0, 'Error opening/creating file: ' + filename, socket);
                            socket.write("553 Could not create file\r\n");
                            dataSocket.end();
                            return;
                        }
                        logIf(3, "File opened/created: " + filename, socket);

                        dataSocket.addListener("end", function () {
                            var writtenToFile = 0;
                            var doneCallback = function() {
                                cinfo.fs.close(fd, function() {
                                    socket.write("226 Closing data connection\r\n"); //, recv " + writtenToFile + " bytes\r\n");
                                });
                            };
                            var writeCallback = function(err, written) {
                                var buf;
                                if (err) {
                                    logIf(0, "Error writing " + filename + ": " + err, socket);
                                    return;
                                }
                                writtenToFile += written;
                                if (!dataSocket.buffers.length) {
                                    doneCallback();
                                    return;
                                }
                                buf = dataSocket.buffers.shift();
                                cinfo.fs.write(fd, buf, 0, buf.length, null, writeCallback);
                            };
                            writeCallback();
                        });
                        dataSocket.addListener("error", function(err) {
                            logIf(0, "Error transferring " + filename + ": " + err, socket);
                            // close file handle
                        });
                        logIf(3, "Told client ok to send file data", socket);
                        socket.write("150 Ok to send data\r\n"); // don't think resume() needs to wait for this to succeed
                        if (dataSocket.readable) dataSocket.resume();
                    });
                });
                break;
            case "STOU":
                // Store file uniquely.
                socket.write("202 Not supported\r\n");
                break;
            case "STRU":
                // Set file transfer structure.
                socket.write("202 Not supported\r\n");
                break;
            case "SYST":
                // Return system type.
                socket.write("215 UNIX emulated by NodeFTPd\r\n");
                break;
            case "TYPE":
                // Sets the transfer mode (ASCII/Binary).
                if (!authenticated()) break;
                if(commandArg == "A"){
                    cinfo.mode = "ascii";
                    socket.write("200 Type set to A\r\n");			
                }
                else{
                    cinfo.mode = "binary";
                    socket.write("200 Type set to I\r\n");			
                }
                break;
            case "USER":
                // Authentication username.
                socket.emit(
                    "command:user",
                    commandArg,
                    function() { // implementor should call this on successful password check
                        socket.write("331 Password required for " + commandArg + "\r\n");
                    },
                    function() { // call second callback if password incorrect
                        socket.write("530 Invalid username: " + commandArg + "\r\n");
                    }
                );
                break;
            case "XPWD":
                // 
                socket.write("257 " + cinfo.cwd + " is the current directory\r\n");
                break;
            default:
                socket.write("202 Not supported\r\n");
                break;
            }
        });

        socket.addListener("end", function () {
            logIf(1, "Client connection ended", socket);
        });
        socket.addListener("error", function (err) {
            logIf(0, "Client connection error: " + err, socket);
        });
    });

    server.addListener("close", function() {
        logIf(0, "Server closed");
    });

    return server;
}
util.inherits(createServer, process.EventEmitter);
exports.createServer = createServer;

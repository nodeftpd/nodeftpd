var tcp = require("tcp");
var sys = require("sys");
var posix = require("fs");
//var file = require("file");
var dummyfs = require("./dummyfs");

/*
TODO:
- Implement Full RFC 959
- Implement RFC 2428
- Implement RFC 2228
- Implement RFC 3659
- Implement TLS - http://en.wikipedia.org/wiki/FTPS

*/

String.prototype.trim = function() {
    return this.replace(/^\s+|\s+$/g,"");
}

// For some reason, the FTP server 


function dotrace(traceline)
{
//    sys.puts(traceline);
}

function createServer(host)
{
    var server = tcp.createServer(function (socket) {
	socket.setTimeout(0);
	socket.setNoDelay();
	
	socket.passive = false;
	socket.pasvport = 0;
	socket.pasvaddress = "";
	socket.mode = "ascii";
	socket.filefrom = "";
	socket.username = "";
	socket.datatransfer = null;
	socket.totsize = 0;
	socket.filename = "";
	
	socket.fs = new dummyfs.dummyfs();
	dotrace("CWD = "+socket.fs.cwd());
	
	socket.addListener("connect", function () {
	    dotrace("CMD connect");
	    //socket.send("220 NodeFTPd Server version 0.0.10\r\n");
	    //socket.write("220 written by Andrew Johnston (apjohnsto@gmail.com)\r\n");
	    //socket.write("220 Please visit http://github.com/billywhizz/NodeFTPd\r\n");
	    socket.write("220 FTP server (nodeftpd) ready\r\n");
	});
	
	socket.addListener("data", function (data) {
	    dotrace("CMD data");
	    dotrace("CMD " + data.trim());
	    var command = data.split(" ");
	    
	    switch(command[0].trim().toUpperCase())
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
		socket.write("250 Directory changed to " + socket.fs.chdir("..") + "\r\n");
		break;
	    case "CONF":
		// Confidentiality Protection Command (RFC 697)
		socket.write("202 Not supported\r\n");
		break;
	    case "CWD":
		// Change working directory.
		socket.write("250 CWD successful. \"" + socket.fs.chdir(command[1].trim()) + "\" is current directory\r\n");
		break;
	    case "DELE":
		// Delete file.
		// same problem again with size, repeating paths
		var filename = command[1].trim();
		rn = sys.exec("rm -f " + filename, function(err, stdout, stderr) {
		    if(err) {
			dotrace("Error delting file: "+filename+", "+err);
		    }
		    socket.write("250 file deleted\r\n");
		});
		break;
	    case "ENC":
		// Privacy Protected Channel (RFC 2228)
		socket.write("202 Not supported\r\n");
		break;
	    case "EPRT":
		// Specifies an extended address and port to which the server should connect. (RFC 2428)
		socket.write("202 Not supported\r\n");
		break;
	    case "EPSV":
		// Enter extended passive mode. (RFC 2428)
		socket.write("202 Not supported\r\n");
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
		socket.datatransfer = function(pasvconn) {
		    pasvconn.addListener("connect", function () {
			socket.write("150 Connection Accepted\r\n");
			dotrace("DATA connect");
			ls_cmd = "ls -l " + socket.fs.cwd();
			dotrace(ls_cmd);
			ls = sys.exec(
			    ls_cmd,
			    function (err, stdout, stderr) {
				if(err) {
				    pasvconn.write("");
				}
				else {
				    pasvconn.write(stdout);
				}
				pasvconn.close();
				socket.write("226 Transfer OK\r\n");
			    });
		    });
		};
		if(!socket.passive){
		    socket.datatransfer(tcp.createConnection(socket.pasvport, socket.pasvhost));
		}
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
		socket.write("202 Not supported\r\n");
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
		socket.datatransfer = function(pasvconn) {
		    pasvconn.addListener("connect", function () {
			socket.write("150 Connection Accepted\r\n");
			dotrace("DATA connect");
			ls_cmd = "ls -l " + socket.fs.cwd();
			dotrace(ls_cmd);
			ls = sys.exec(
			    ls_cmd,
			    function (err, stdout, stderr) {
				if(err) {
				    pasvconn.write("");
				}
				else {
				    pasvconn.write(stdout);
				}
				pasvconn.close();
				socket.write("226 Transfer OK\r\n");
			    });
		    });
		};
		if(!socket.passive){
		    socket.datatransfer(tcp.createConnection(socket.pasvport, socket.pasvhost));
		}

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
		socket.write("230 Logged on\r\n");
		break;
	    case "PASV":
		// Enter passive mode.
		socket.passive = true;
		socket.pasvhost = host;
		socket.pasvport = 0;
		var pasv = tcp.createServer(function (psocket) {
		    psocket.addListener("connect", function () {
			socket.datatransfer(psocket);
		    });
		    psocket.addListener("close", function () {
			dotrace("DATA close");
		    });
		    psocket.addListener("eof", function () {
			dotrace("DATA eof");
		    });
		    psocket.addListener("error", function(had_error) {
			dotrace("DATA error: " + had_error);
		    });
		});
		pasv.addListener("listening", function(port) {
		    socket.pasvport = port;
		    var i1 = parseInt(port / 256);
		    var i2 = parseInt(port % 256);
		    socket.write("227 Entering Passive Mode (" + host.split(".").join(",") + "," + i1 + "," + i2 + ")\r\n");
		});
		pasv.listen(0, host);
		break;
	    case "PBSZ":
		// Protection Buffer Size (RFC 2228)
		socket.write("202 Not supported\r\n");
		break;
	    case "PORT":
		// Specifies an address and port to which the server should connect.
		socket.passive = false;
		var addr = command[1].split(",");
		socket.pasvhost = addr[0]+"."+addr[1]+"."+addr[2]+"."+addr[3];
		socket.pasvport = (parseInt(addr[4]) * 256) + parseInt(addr[5]);
		socket.write("200 PORT command successful.\r\n");
		break;
	    case "PWD":
		// Print working directory. Returns the current directory of the host.
		socket.write("257 \"" + socket.fs.cwd() + "\" is current directory\r\n");
		break;
	    case "QUIT":
		// Disconnect.
		socket.write("221 Goodbye\r\n");
		socket.close();
		break;
	    case "REIN":
		// Re initializes the connection.
		socket.write("202 Not supported\r\n");
		break;
	    case "REST":
		// Restart transfer from the specified point.
		socket.totsize = parseInt(command[1].trim());
		socket.write("350 Rest supported. Restarting at " + socket.totsize + "\r\n");
		break;
	    case "RETR":
		// Retrieve (download) a remote file.
		socket.datatransfer = function(pasvconn) {
		    pasvconn.setEncoding(socket.mode);
		    pasvconn.addListener("connect", function () {
			socket.write("150 Connection Accepted\r\n");
			dotrace("DATA connect");

			// again, same issue with size regarding repeating path, eg:
			// /path/to/file//path/to/file/name.txt
			filename = command[1].trim();
			if(command[1].trim() != socket.filename) socket.totsize = 0;
			socket.filename = command[1].trim();
			posix.open(socket.filename,process.O_RDONLY, 0666, function (err, fd) {
			    dotrace("DATA file " + socket.filename + " opened");
			    function readChunk() {
				posix.read(fd, 4096, socket.totsize, socket.mode, function(err, chunk, bytes_read) {
				    if(err) {
					dotrace("Erro reading chunk");
					throw err;
					return;
				    }
				    if(chunk) {
					socket.totsize += bytes_read;
					if(pasvconn.readyState == "open") pasvconn.write(chunk, socket.mode);
					readChunk();
				    }
				    else {
					dotrace("DATA file " + socket.filename + " closed");
					pasvconn.close();
					socket.write("226 Closing data connection, sent " + socket.totsize + " bytes\r\n");
					posix.close(fd);
					socket.totsize = 0;
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
		    pasvconn.addListener("close", function () {
			dotrace("DATA close");
		    });
		    pasvconn.addListener("end", function () {
			dotrace("DATA eof");
		    });
		    pasvconn.addListener("error", function(had_error) {
			dotrace("DATA error: " + had_error);
		    });
		};
		if(!socket.passive){
		    socket.datatransfer(tcp.createConnection(socket.pasvport, socket.pasvhost));
		}
		break;
	    case "RMD":
		// Remove a directory.
		socket.write("202 Not supported\r\n");
		break;
	    case "RNFR":
		// Rename from.
		socket.filefrom = socket.fs.cwd() + command[1].trim();
		dotrace("Rename from "+socket.filefrom);
		socket.write("350 File exists, ready for destination name.\r\n");
		break;
	    case "RNTO":
		// Rename to.
		// as ever, problem with repeat paths
		var fileto = socket.fs.cwd() + command[1].trim();
		var mv_cmd = "mv " + socket.filefrom + " " + fileto
		rn = sys.exec(mv_cmd, function(err, stdout, stderr) {
		    if(err) {
			dotrace("Error renaming file from "+socket.filefrom+" to "+fileto);
		    }
		    socket.write("250 file renamed successfully\r\n");
		});
		break;
	    case "SITE":
		// Sends site specific commands to remote server.
		socket.write("202 Not supported\r\n");
		break;
	    case "SIZE":
		// Return the size of a file. (RFC 3659)
		// for some reason, I am getting a repeated file path within
		// cwd(0 and the command, resulting in an error 
		//var filename = socket.fs.cwd() + command[1].trim();
		var filename = command[1].trim();
		posix.stat(filename, function (err, s) {
		    if(err) { 
			dotrace("Error getting size of file: "+filename);
			throw err;
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
		socket.datatransfer = function(pasvconn) {
		    dotrace(pasvconn);
		    pasvconn.setEncoding(socket.mode);
		    filename = command[1].trim();

		    posix.open(filename, 'w', 0644, function(err, fd) {
			if(err) {
			    dotrace('Error opening file: '+filename);
			    throw err;
			}

			var size = 0;
			var paused = false;
			var npauses = 0;
			pasvconn.addListener("data", function(data) {
			    size += data.length;

			    posix.write(fd, data, null, socket.mode, function(err, bytes_written) {
				if(err) {
				    dotrace("Error writing file");
				    throw err;
				}
				else {
				    dotrace("Bytes written: "+bytes_written);
				}
				if (!paused) {
				    pasvconn.pause();
				    npauses += 1;
				    paused = true;
				    setTimeout(function () {
					pasvconn.resume();
					paused = false;
				    }, 1);
				}
			    });
			});
			pasvconn.addListener("connect", function () {
			    dotrace("DATA connect");
			    socket.write("150 Connection Accepted\r\n");
			});
			pasvconn.addListener("close", function () {
			    dotrace("DATA close");
			});
			pasvconn.addListener("end", function () {
			    posix.close(fd, function(err) {
				dotrace("Error closing file: "+fd);
				//throw err;
				// always seems to throw an error??
			    });
			    dotrace("DATA eof");
			    socket.write("226 Closing data connection, recv " + size + " bytes\r\n");
			});
			pasvconn.addListener("error", function(had_error) {
			    dotrace("DATA error: " + had_error);
			});
		    });
		}
		if(!socket.passive){
		    socket.datatransfer(tcp.createConnection(socket.pasvport, socket.pasvhost));
		}
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
		if(command[1].trim() == "A"){
		    socket.mode = "ascii";
		    socket.write("200 Type set to A\r\n");			
		}
		else{
		    socket.mode = "binary";
		    socket.write("200 Type set to I\r\n");			
		}
		break;
	    case "USER":
		// Authentication username.
		socket.username = command[1].trim();
		socket.write("331 password required for " + socket.username + "\r\n");
		break;
	    case "XPWD":
		// 
		socket.write("257 " + socket.fs.cwd() + " is the current directory\r\n");
		break;
	    default:
		socket.write("202 Not supported\r\n");
		break;
	    }
	});
	
	socket.addListener("end", function () {
	    dotrace("CMD end");
	    socket.close();
	});
	
	socket.addListener("close", function () {
	    dotrace("CMD close");
	});
	
    });

    return server;
}
sys.inherits(createServer, process.EventEmitter);
// for testing
//createServer("localhost").listen(7001);
exports.createServer = createServer;
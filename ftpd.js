var tcp = require("tcp");
var sys = require("sys");
var posix = require("posix");
var file = require("file");
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

function dotrace(traceline)
{
	//sys.puts(traceline);
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
		
		socket.addListener("connect", function () {
			dotrace("CMD connect");
			//socket.send("220 NodeFTPd Server version 0.0.10\r\n");
			//socket.send("220 written by Andrew Johnston (apjohnsto@gmail.com)\r\n");
			//socket.send("220 Please visit http://github.com/billywhizz/NodeFTPd\r\n");
			socket.send("220 FTP server (nodeftpd) ready\r\n");
		});
	
		socket.addListener("receive", function (data) {
			dotrace("CMD receive");
			dotrace("CMD " + data.trim());
			var command = data.split(" ");
			
			switch(command[0].trim().toUpperCase())
			{
				case "ABOR":
					// Abort an active file transfer.
					socket.send("202 Not supported\r\n");
					break;
				case "ACCT":
					// Account information
					socket.send("202 Not supported\r\n");
					break;
				case "ADAT":
					// Authentication/Security Data (RFC 2228)
					socket.send("202 Not supported\r\n");
					break;
				case "ALLO":
					// Allocate sufficient disk space to receive a file.
					socket.send("202 Not supported\r\n");
					break;
				case "APPE":
					// Append.
					socket.send("202 Not supported\r\n");
					break;
				case "AUTH":
					// Authentication/Security Mechanism (RFC 2228)
					socket.send("202 Not supported\r\n");
					break;
				case "CCC":
					// Clear Command Channel (RFC 2228)
					socket.send("202 Not supported\r\n");
					break;
				case "CDUP":
					// Change to Parent Directory.
					socket.send("250 Directory changed to " + socket.fs.chdir("..") + "\r\n");
					break;
				case "CONF":
					// Confidentiality Protection Command (RFC 697)
					socket.send("202 Not supported\r\n");
					break;
				case "CWD":
					// Change working directory.
					socket.send("250 CWD successful. \"" + socket.fs.chdir(command[1].trim()) + "\" is current directory\r\n");
					break;
				case "DELE":
					// Delete file.
					rn = sys.exec("rm -f " + socket.fs.cwd() + command[1].trim());
					rn.addCallback(function (stdout, stderr) {
						socket.send("250 file deleted\r\n");
					});
					rn.addErrback(function () {
						socket.send("250 file deleted\r\n");
					});
					break;
				case "ENC":
					// Privacy Protected Channel (RFC 2228)
					socket.send("202 Not supported\r\n");
					break;
				case "EPRT":
					// Specifies an extended address and port to which the server should connect. (RFC 2428)
					socket.send("202 Not supported\r\n");
					break;
				case "EPSV":
					// Enter extended passive mode. (RFC 2428)
					socket.send("202 Not supported\r\n");
					break;
				case "FEAT":
					// Get the feature list implemented by the server. (RFC 2389)
					socket.send("211-Features\r\n");
					socket.send(" SIZE\r\n");
					socket.send("211 end\r\n");
					break;
				case "HELP":
					// Returns usage documentation on a command if specified, else a general help document is returned.
					/*
					214-The following commands are recognized:
					USER   PASS   QUIT   CWD    PWD    PORT   PASV   TYPE
					LIST   REST   CDUP   RETR   STOR   SIZE   DELE   RMD
					MKD    RNFR   RNTO   ABOR   SYST   NOOP   APPE   NLST
					MDTM   XPWD   XCUP   XMKD   XRMD   NOP    EPSV   EPRT
					AUTH   ADAT   PBSZ   PROT   FEAT   MODE   OPTS   HELP
					ALLO   MLST   MLSD   SITE   P@SW   STRU   CLNT   MFMT
					214 Have a nice day.		
					*/
					socket.send("202 Not supported\r\n");
					break;
				case "LANG":
					// Language Negotiation (RFC 2640)
					socket.send("202 Not supported\r\n");
					break;
				case "LIST":
					// Returns information of a file or directory if specified, else information of the current working directory is returned.
					socket.datatransfer = function(pasvconn) {
						pasvconn.addListener("connect", function () {
							socket.send("150 Connection Accepted\r\n");
							dotrace("DATA connect");
							ls = sys.exec("ls -l " + socket.fs.cwd());
							ls.addCallback(function (stdout, stderr) {
								pasvconn.send(stdout);
								pasvconn.close();
								socket.send("226 Transfer OK\r\n");
							});
							ls.addErrback(function () {
								pasvconn.send("");
								pasvconn.close();
								socket.send("226 Transfer OK\r\n");
							});
						});
					};
					if(!socket.passive){
						socket.datatransfer(tcp.createConnection(socket.pasvport, socket.pasvhost));
					}
					break;
				case "LPRT":
					// Specifies a long address and port to which the server should connect. (RFC 1639)
					socket.send("202 Not supported\r\n");
					break;
				case "LPSV":
					// Enter long passive mode. (RFC 1639)
					socket.send("202 Not supported\r\n");
					break;
				case "MDTM":
					// Return the last-modified time of a specified file. (RFC 3659)
					socket.send("202 Not supported\r\n");
					break;
				case "MIC":
					// Integrity Protected Command (RFC 2228)
					socket.send("202 Not supported\r\n");
					break;
				case "MKD":
					// Make directory.
					socket.send("202 Not supported\r\n");
					break;
				case "MLSD":
					// Lists the contents of a directory if a directory is named. (RFC 3659)
					socket.send("202 Not supported\r\n");
					break;
				case "MLST":
					// Provides data about exactly the object named on its command line, and no others. (RFC 3659)
					socket.send("202 Not supported\r\n");
					break;
				case "MODE":
					// Sets the transfer mode (Stream, Block, or Compressed).
					socket.send("202 Not supported\r\n");
					break;
				case "NLST":
					// Returns a list of file names in a specified directory.
					socket.datatransfer = function(pasvconn) {
						pasvconn.addListener("connect", function () {
							socket.send("150 Connection Accepted\r\n");
							dotrace("DATA connect");
							ls = sys.exec("ls -l " + socket.fs.cwd());
							ls.addCallback(function (stdout, stderr) {
								pasvconn.send(stdout);
								pasvconn.close();
								socket.send("226 Transfer OK\r\n");
							});
							ls.addErrback(function () {
								pasvconn.send("");
								pasvconn.close();
								socket.send("226 Transfer OK\r\n");
							});
						});
					};
					if(!socket.passive){
						socket.datatransfer(tcp.createConnection(socket.pasvport, socket.pasvhost));
					}
					break;
				case "NOOP":
					// No operation (dummy packet; used mostly on keepalives).
					socket.send("202 Not supported\r\n");
					break;
				case "OPTS":
					// Select options for a feature. (RFC 2389)
					socket.send("202 Not supported\r\n");
					break;
				case "PASS":
					// Authentication password.
					socket.send("230 Logged on\r\n");
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
						socket.send("227 Entering Passive Mode (" + host.split(".").join(",") + "," + i1 + "," + i2 + ")\r\n");
					});
					pasv.listen(0, host);
					break;
				case "PBSZ":
					// Protection Buffer Size (RFC 2228)
					socket.send("202 Not supported\r\n");
					break;
				case "PORT":
					// Specifies an address and port to which the server should connect.
					socket.passive = false;
					var addr = command[1].split(",");
					socket.pasvhost = addr[0]+"."+addr[1]+"."+addr[2]+"."+addr[3];
					socket.pasvport = (parseInt(addr[4]) * 256) + parseInt(addr[5]);
					socket.send("200 PORT command successful.\r\n");
					break;
				case "PWD":
					// Print working directory. Returns the current directory of the host.
					socket.send("257 " + socket.fs.cwd() + " is current directory\r\n");
					break;
				case "QUIT":
					// Disconnect.
					socket.send("221 Goodbye\r\n");
					socket.close();
					break;
				case "REIN":
					// Re initializes the connection.
					socket.send("202 Not supported\r\n");
					break;
				case "REST":
					// Restart transfer from the specified point.
					socket.totsize = parseInt(command[1].trim());
					socket.send("350 Rest supported. Restarting at " + socket.totsize + "\r\n");
					break;
				case "RETR":
					// Retrieve (download) a remote file.
					socket.datatransfer = function(pasvconn) {
						pasvconn.setEncoding(socket.mode);
						pasvconn.addListener("connect", function () {
							socket.send("150 Connection Accepted\r\n");
							dotrace("DATA connect");
							if(socket.fs.cwd() + command[1].trim() != socket.filename) socket.totsize = 0;
							socket.filename = socket.fs.cwd() + command[1].trim();
							posix.open(socket.filename,process.O_RDONLY, 0666).addCallback(function (fd) {
								dotrace("DATA file " + socket.fs.cwd() + command[1].trim() + " opened");
								function readChunk() {
									posix.read(fd, 4096, socket.totsize, socket.mode).addCallback(function(chunk, bytes_read) {
										if(chunk) {
											socket.totsize += bytes_read;
											if(pasvconn.readyState == "open") pasvconn.send(chunk, socket.mode);
											readChunk();
										}
										else {
											dotrace("DATA file " + socket.fs.cwd() + command[1].trim() + " closed");
											pasvconn.close();
											socket.send("226 Closing data connection, sent " + socket.totsize + " bytes\r\n");
											posix.close(fd);
											socket.totsize = 0;
										}
									});
								}	
								readChunk();
							});
						});
						pasvconn.addListener("close", function () {
							dotrace("DATA close");
						});
						pasvconn.addListener("eof", function () {
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
					socket.send("202 Not supported\r\n");
					break;
				case "RNFR":
					// Rename from.
					socket.filefrom = socket.fs.cwd() + command[1].trim();
					socket.send("350 File exists, ready for destination name.\r\n");
					break;
				case "RNTO":
					// Rename to.
					var fileto = socket.fs.cwd() + command[1].trim();
					rn = sys.exec("mv " + socket.filefrom + " " + fileto);
					rn.addCallback(function (stdout, stderr) {
						socket.send("250 file renamed successfully\r\n");
					});
					rn.addErrback(function () {
						socket.send("250 file renamed successfully\r\n");
					});
					break;
				case "SITE":
					// Sends site specific commands to remote server.
					socket.send("202 Not supported\r\n");
					break;
				case "SIZE":
					// Return the size of a file. (RFC 3659)
					var filename = socket.fs.cwd() + command[1].trim();
					posix.stat(filename).addCallback(function (s) {
						socket.send("213 " + s.size + "\r\n");
					}).addErrback(function () {

					});
					break;
				case "SMNT":
					// Mount file structure.
					socket.send("202 Not supported\r\n");
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
					socket.send("202 Not supported\r\n");
					break;
				case "STOR":
					// Store (upload) a file.
					socket.datatransfer = function(pasvconn) {
						pasvconn.setEncoding(socket.mode);
						var fd = new file.File(socket.fs.cwd() + command[1].trim(), 'w+', {encoding: socket.mode});
						var size = 0;
						var paused = false;
						var npauses = 0;
						pasvconn.addListener("receive", function(data) {
							size += data.length;
							fd.write(data);
							if (!paused) {
								pasvconn.readPause();
								npauses += 1;
								paused = true;
								setTimeout(function () {
									pasvconn.readResume();
									paused = false;
								}, 1);
							}
						});
						pasvconn.addListener("connect", function () {
							dotrace("DATA connect");
							socket.send("150 Connection Accepted\r\n");
						});
						pasvconn.addListener("close", function () {
							dotrace("DATA close");
						});
						pasvconn.addListener("eof", function () {
							fd.close();
							dotrace("DATA eof");
							socket.send("226 Closing data connection, recv " + size + " bytes\r\n");
						});
						pasvconn.addListener("error", function(had_error) {
							dotrace("DATA error: " + had_error);
						});
					};
					if(!socket.passive){
						socket.datatransfer(tcp.createConnection(socket.pasvport, socket.pasvhost));
					}
					break;
				case "STOU":
					// Store file uniquely.
					socket.send("202 Not supported\r\n");
					break;
				case "STRU":
					// Set file transfer structure.
					socket.send("202 Not supported\r\n");
					break;
				case "SYST":
					// Return system type.
					socket.send("215 UNIX emulated by NodeFTPd\r\n");
					break;
				case "TYPE":
					// Sets the transfer mode (ASCII/Binary).
					if(command[1].trim() == "A"){
						socket.mode = "ascii";
						socket.send("200 Type set to A\r\n");			
					}
					else{
						socket.mode = "binary";
						socket.send("200 Type set to I\r\n");			
					}
					break;
				case "USER":
					// Authentication username.
					socket.username = command[1].trim();
					socket.send("331 password required for " + socket.username + "\r\n");
					break;
				case "XPWD":
					// 
					socket.send("257 " + socket.fs.cwd() + " is the current directory\r\n");
					break;
				default:
					socket.send("202 Not supported\r\n");
				break;
			}
		});
	
		socket.addListener("eof", function () {
			dotrace("CMD eof");
			socket.close();
		});
		
		socket.addListener("close", function () {
			dotrace("CMD close");
		});
		
	});

	return server;
}
sys.inherits(createServer, process.EventEmitter);
exports.createServer = createServer;
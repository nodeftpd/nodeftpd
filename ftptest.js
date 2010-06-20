var sys = require("sys");
var net = require("net");
var ftpd = require("./ftpd");
var spf = require("./sprintf");
ftpd.createServer("localhost").listen(7002);

var responses = {"RSS":0,"VSZ":0,"CON":0,"ERR":0,"EOF":0,"CLO":0,"TIM":0,"220": 0,"331":0};

setInterval(function() {
	if(responses["CON"] < 50000) {
		var client = net.createConnection(7002, "localhost");
		client.setTimeout(0);
		client.setEncoding("ascii"); // force data String not Buffer
		client.addListener("data", function (data) {
			status = data.substr(0,3);
			switch(status)
			{
				case "220":
					this.write("USER root\r\n");
					break;
				case "331":
					this.write("PASS root\r\n");
					break;
				case "230":
					this.write("PWD\r\n");
					break;
				default:
					//isend++;
					//this.send("PWD\r\n");
					break;
			}
			if(!responses[status]) responses[status] = 0;
			responses[status]++;
		});
		client.addListener("connect", function () {
			responses["CON"]++;
		});
		client.addListener("end", function () {
			responses["EOF"]++;
			responses["CON"]--;
		});
		client.addListener("close", function () {
			responses["CLO"]++;
		});
		client.addListener("timeout", function () {
			responses["TIM"]++;
		});
		client.addListener("drain", function () {
			//sys.puts("drain");
		});
		client.addListener("error", function () {
			responses["ERR"]++;
		});
	}
}, 25);

setInterval(function() {
	var mem = process.memoryUsage();
	responses["RSS"] = parseInt(mem.rss/(1024*1024));
	responses["VSZ"] = parseInt(mem.vsize/(1024*1024));
	sys.puts(JSON.stringify(responses));
}, 3000);

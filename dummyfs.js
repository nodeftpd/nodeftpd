var sys = require("sys");

function dummyfs(sandbox) {
	/*
	TODO
	- ensure sandbox is valid path and has trailing slash
	*/
	// should create a sandbox of sorts, to ensure we don't go above a certain level
	this.sandbox = sandbox;
	this.dir = sandbox; // curent directory
}
// this is deprecated in future versions of node, in favor of: util.inherits(...)
sys.inherits(dummyfs, process.EventEmitter);
exports.dummyfs = dummyfs;

dummyfs.prototype.chdir = function(dir) {
	if(dir.charAt(dir.length-1) != "/") dir += "/";
	if(dir.charAt(0) != "/"){
		if(dir.substr(0,2) == ".."){
			x = dir.split("/");
			for(i=0; i<x.length; i++){
				if(x[i] == ".."){
					part = this.dir.split("/");
					part.splice(part.length -2, 1);
					ret = part.join("/");
					if(ret.charAt(ret.length-1) != "/") ret += "/";
					this.dir = ret;
				}
				else{
					this.dir += x[i];
				}
			}
		}
		else{
			if(dir.substr(0,2) == "./"){
				this.dir += dir.substr(2,dir.length);
			}
			else{
				this.dir += dir;
			}
		}
	}
	else{
		this.dir = dir;
	}
	if(this.dir.charAt(this.dir.length-1) != "/") this.dir += "/";
	return(this.dir);
}

dummyfs.prototype.cwd = function() {
	return(this.dir)
}

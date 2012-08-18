// Apply glob function to path specified on command line.

var glob = require('./glob');

if (process.argv.length != 3) {
    console.log("Bad usage");
    process.exit(1);
}

glob.glob(process.argv[2], function (err, files) {
    if (err) {
	console.log(err);
    }
    else {
	files.forEach(function (file) {
	    console.log(file);
	});
    }
});
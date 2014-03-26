// Apply glob function to path specified on command line.

var glob = require('./glob'),
    fs = require('fs');

if (process.argv.length != 3) {
  console.log("Bad usage");
  process.exit(1);
}

glob.glob(process.argv[2], fs, function(err, files) {
  if (err) {
    console.log(err);
  }
  else {
    files.forEach(function(file) {
      console.log(file);
    });
  }
});

var PathModule = require('path'),
    fs = require('fs'),
	events = require("events");

// Wildcard directory listing


// Should create using "new WildcardList"
function glob(path, callback) {

	var traversing = 0;

	// Use relatve path if doesn't start with slash, riight?

	// Preparation
	var parts = path.split('/');
	var base = '/';
	var results = [];
	// Internal events
	var ev = new events.EventEmitter;

	var init = function() {
        //console.log('got: ' + path);
        var pair = skipNonWildcards(base, parts);
        parts = pair.pop();
        base = pair.pop();
        // Emitted when we start looping over items in a directory
        /*
        ev.on('begin', function() {
        });
        */
        // After we're done looping over a directory
        // Check whether we're REALLY done
        ev.on('end', function() {
            // Are we done traversing?
            if (traversing) {
                //console.log('still traversing');
                return;
            }
            // Looks like we're done
            callback(false, results);
        });
        // For debugging
        //console.log('Prepared path and wildcard: ' + base + ' ' +  parts);
        walky(base, parts);
	};
    
    // Skip the prefix of folders that have no wildcards
    var skipNonWildcards = function(folder, patterns) {
        var basePath = folder;
        var parts = patterns.slice(0); // Make a copy so we can modify
        while (parts.length) {
            var part = parts.shift();
            if (!part.length) continue;
            if (part.indexOf('*') == -1) {
                // wildcard not found
                basePath = PathModule.join(basePath, part);
            } else {
                parts.unshift( part );
                break;
            }
        }
        return [ basePath, parts ];
    };


    var walky = function(folder, patterns) {
        var part;
        var pair = skipNonWildcards(folder, patterns);
        var parts = pair.pop();
        folder = pair.pop();
        part = (parts.length ? parts.shift() : null);

        traversing++;

        //console.log('Reading ' + folder);
        PathModule.exists(folder, function(exists) {
            if (!exists) {
                traversing--;
                ev.emit('end');
                return;
            }

            fs.readdir(folder, function(err, files) {
                if (err) {
                    console.trace('Shit: ' + err);
                    return;
                }
                for (var i = 0; i < files.length; i++) {
                    var file = files[i];
                    var full = PathModule.join(folder, file);
                    //console.log('Found: ' + full);
                    if (part && part.indexOf('*') > -1) { // pattern to check
                        // protect periods and replace asterisks
                        var pattern = '^' + part.replace(/\./g, '\\.').replace(/\*/g, '.+') + '$';
                        //console.log('using pattern: ' + pattern);
                        var pattern = new RegExp(pattern);
                        if (!pattern.test( file )) continue;
                    }
                    var s = fs.statSync(full);
                    if (s.isDirectory()) {
                        if (parts.length) {
                        //console.log('recursing into ' + full);
                        walky(full, parts, results, callback);
                        }
                    } else {
                        //console.log('file: ' + full);
                        if (!parts.length) results.push(full);
                    }
                }
                traversing--;
                ev.emit('end');
            });
        });
    };

    init();
    return this;
};


// Boom
exports.glob = glob;

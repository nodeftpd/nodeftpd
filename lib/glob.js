var PathModule = require('path'),
    events = require('events'),
    constants = require('constants');

// Wildcard directory listing

// Should create using "new WildcardList"
function glob(path, fsm, callback) {
    if (! callback) {
        callback = fsm;
        fsm = require('fs');
    }

    var traversing = 0;
    
    // Use relatve path if doesn't start with slash, riight?
    
    // Preparation
    var parts = path.split('/');
    var base = '/';
    var results = [];
    // Internal events
    var ev = new events.EventEmitter;
    
    var init = function() {
        var pair = skipNonWildcards(base, parts);
        parts = pair.pop();
        base = pair.pop();

        // After we're done looping over a directory
        // Check whether we're REALLY done
	var erroredOut = false;
        ev.on('end', function(err) {
	    if (erroredOut) {
		;
	    }
	    else if (err) {
		callback(err);
		erroredOut = true;
	    }
	    else if (! traversing) {
		// Looks like we're done
		callback(null, results);
	    }
        });
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

        fsm.readdir(folder, function(err, files) {
            if (err) {
		// If the error is simply that the directory doesn't exist, or
		// is not a directory, then decrement
		// our traversal count and emit 'end' without an error.
		if (err.errno == constants.ENOENT || err.errno == constants.ENOTDIR) {
		    --traversing;
		    ev.emit('end');
		}
		else {
		    // It's a real (unexpected) error
		    ev.emit('end', err);
			return;
		}
            }
            for (var i = 0; i < files.length; i++) {
                var file = files[i];
                var full = PathModule.join(folder, file);
                if (part && part.indexOf('*') > -1) { // pattern to check
                    // protect periods and replace asterisks
                    var pattern = '^' + part.replace(/\./g, '\\.').replace(/\*/g, '.+') + '$';
                    var pattern = new RegExp(pattern);
                    if (!pattern.test( file )) continue;
                }
		
		fsm.stat(full, function (err, s) {
		    if (err) {
			ev.emit('end', err);
		    }
		    else if (s.isDirectory()) {
                        if (parts.length) {
			    walky(full, parts, results, callback);
                        }
		    }
		    else {
                        if (!parts.length) results.push(full);
		    }
		});
            }
            traversing--;
            ev.emit('end');
        });
    };

    init();
    return this;
};


// Boom
exports.glob = glob;

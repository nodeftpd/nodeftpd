var util = require('util');
var events = require('events');
var EventEmitter = events.EventEmitter;

function PassiveListener() {
  EventEmitter.call(this);
}
util.inherits(PassiveListener, EventEmitter);

module.exports = PassiveListener;

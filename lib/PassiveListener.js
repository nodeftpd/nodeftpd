const util = require('util');
const events = require('events');

const { EventEmitter } = events;

function PassiveListener() {
  EventEmitter.call(this);
}
util.inherits(PassiveListener, EventEmitter);

module.exports = PassiveListener;

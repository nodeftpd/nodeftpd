import events from 'events';

const {EventEmitter} = events;

export default class PassiveListener extends EventEmitter {}

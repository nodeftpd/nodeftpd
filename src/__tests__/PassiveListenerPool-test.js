/*eslint-env node, mocha */
import net from 'net';
import {EventEmitter} from 'events';
import PassiveListenerPool from '../PassiveListenerPool';
import toBase256 from '../helpers/toBase256';
import expect from 'expect';

const BIND_ADDRESS = '127.0.0.1';

class MockControlConnection extends EventEmitter {
  constructor({remoteAddress}) {
    super();
    this.remoteAddress = remoteAddress;
    this.messages = [];
    this.writable = false;
    process.nextTick(() => {
      this.writable = true;
    });
  }

  respond(message) {
    this.messages.push(message);
  }

  address() {
    return {address: this.remoteAddress};
  }

  destroy() {
    this.writable = false;
    this.emit('close');
  }
}

const getMessageOK = (address, port) => {
  let encoded = address.split('.').join(',') + ',' + toBase256(port).join(',');
  return `227 Entering Passive Mode (${encoded})`;
};

describe('PassiveListenerPool', () => {
  let MIN_PORT = 2000;
  let MAX_PORT = 2002;
  let listenerPool = new PassiveListenerPool({
    bindAddress: BIND_ADDRESS,
    portRange: [MIN_PORT, MAX_PORT],
  });

  it('should listen on a port after a connection is requested', (done) => {
    let eventLog = [];
    let log = (message) => {
      eventLog.push(message);
    };
    let finished = () => {
      expect(eventLog).toEqual([
        'listening on port 2000',
        'data connection received on listening port',
        'data connection closed',
      ]);
      done();
    };
    let controlConnection = new MockControlConnection({
      remoteAddress: '127.0.0.1',
    });
    let remoteAddress = controlConnection.address().address;
    listenerPool.createDataConnection(remoteAddress, (error, dataConnection) => {
      let {port} = dataConnection;
      log(`listening on port ${port}`);
      expect(port).toBe(MIN_PORT);
      // TODO: test that listenerPool has stopped listening?
      controlConnection.respond(
        getMessageOK(BIND_ADDRESS, port)
      );
      // TODO: This test is useless besides testing our mock control connection.
      expect(controlConnection.messages).toEqual([
        getMessageOK(BIND_ADDRESS, port),
      ]);
      // TODO: Ensure that if the controlConnection closes, our associated data
      // connection gets closed also.
      // controlConnection.on('close', () => {
      //   dataConnection.destroy();
      // });
      dataConnection.on('error', (error) => {
        throw error;
      });
      dataConnection.on('ready', (socket) => {
        log('data connection received on listening port');
        expect(socket.writable).toBe(true);
      });
      dataConnection.on('close', () => {
        log('data connection closed');
        finished();
      });
      let clientConnection = net.createConnection(port, BIND_ADDRESS);
      clientConnection.on('connect', () => {
        setTimeout(() => {
          // This will cause a close event on dataConnection.
          clientConnection.destroy();
        }, 10);
      });
    });
  });

});

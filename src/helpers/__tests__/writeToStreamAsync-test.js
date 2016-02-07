/* @//flow */
/*eslint-env node, mocha */
const {describe, it} = global;
import writeToStreamAsync from '../writeToStreamAsync';
import expect from 'expect';

class MockWriteStream {
  // _data: Array<Buffer>;
  // _bytesWritten: number;
  // _isBufferFull: number;
  // _internalBufferSize: number;

  constructor(bufferSize = 10) {
    this._data = [];
    this._bytesWritten = 0;
    this._bytesFlushed = 0;
    this._isBufferFull = 0;
    this._internalBufferSize = bufferSize;
  }

  write(data, callback) {
    this._data.push(data);
    this._bytesWritten += data.length;
    if (this._isBufferFull || data.length > this._internalBufferSize) {
      this._isBufferFull += 1;
      setTimeout(() => {
        this._bytesFlushed += data.length;
        this._isBufferFull -= 1;
        callback && callback();
      }, 20);
      return false;
    } else {
      this._bytesFlushed += data.length;
      callback && process.nextTick(callback);
      return true;
    }
  }

  getBytesWritten() {
    return this._bytesWritten;
  }

  getBytesFlushed() {
    return this._bytesFlushed;
  }

  isBufferFull() {
    return this._isBufferFull !== 0;
  }
}

describe('helpers/writeToStreamAsync', () => {
  it('should handle empty array', (done) => {
    let writeStream = new MockWriteStream();
    writeToStreamAsync([], writeStream, () => {
      expect(writeStream.getBytesWritten()).toBe(0);
      done();
    });
  });

  it('should write data to stream', (done) => {
    let writeStream = new MockWriteStream(10);
    let data = [
      new Buffer('abcdefghijkl', 'utf8'),
      new Buffer('abcdefghijkl', 'utf8'),
      new Buffer('abcdefghijkl', 'utf8'),
    ];
    let result = writeStream.write(new Buffer('a', 'utf8'));
    expect(result).toBe(true);
    result = writeStream.write(data.shift());
    expect(result).toBe(false);
    expect(writeStream.isBufferFull()).toBe(true);
    expect(writeStream.getBytesWritten()).toBe(13);
    writeToStreamAsync(data, writeStream, () => {
      expect(writeStream.isBufferFull()).toBe(false);
      expect(writeStream.getBytesWritten()).toBe(37);
      expect(writeStream.getBytesFlushed()).toBe(37);
      done();
    });
  });
});

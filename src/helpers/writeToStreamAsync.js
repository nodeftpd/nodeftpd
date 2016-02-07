/* @flow */

type WriteStream = {
  write: (data: Buffer) => boolean;
  once: (name: string, handler: Function) => any;
};

// This will take an array of data and write it to a write stream, waiting
// for it to flush to the underlying socket.
export default function writeToStreamAsync(
  buffers: Array<Buffer>,
  writeStream: WriteStream,
  callback: (error: ?Error) => any
) {
  let index = 0;
  const writeData = () => {
    if (index >= buffers.length) {
      callback();
    } else {
      let data = buffers[index++];
      writeStream.write(data, writeData);
    }
  };
  process.nextTick(writeData);
}

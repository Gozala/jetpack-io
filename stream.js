/* vim:set ts=2 sw=2 sts=2 expandtab */

'use strict';

const { EventEmitter } = require('raw.github.com/Gozala/events/v0.5.0/events');
const { Buffer } = require('./buffer');
const { setTimeout } = require('timer');
const { ns } = require('api-utils/namespace');

function isFunction(value) { return typeof value === 'function'; }
const _ = ns();

/**
 * Utility function / hack that we use to figure if output stream is closed.
 */
function isClosed(stream) {
  // We assume that stream is not closed.
  let isClosed = false;
  stream.asyncWait({
    // If `onClose` callback is called before outer function returns
    // (synchronously) `isClosed` will be set to `true` identifying
    // that stream is closed.
    onOutputStreamReady: function onClose() isClosed = true

  // `WAIT_CLOSURE_ONLY` flag overrides the default behavior, causing the
  // `onOutputStreamReady` notification to be suppressed until the stream
  // becomes closed.
  }, stream.WAIT_CLOSURE_ONLY, 0, null);
  return isClosed;
}
/**
 * Utility function takes output `stream`, `onDrain`, `onClose` callbacks and
 * calls one of this callbacks depending on stream state. It is guaranteed
 * that only one called will be called and it will be called asynchronously.
 * @param {nsIAsyncOutputStream} stream
 * @param {Function} onDrain
 *    callback that is called when stream becomes writable.
 * @param {Function} onClose
 *    callback that is called when stream becomes closed.
 */
function onStateChange(stream, onDrain, onClose) {
  let isAsync = false;
  stream.asyncWait({
    onOutputStreamReady: function onOutputStreamReady() {
      // If `isAsync` was not yet set to `true` by the last line we know that
      // `onOutputStreamReady` was called synchronously. In such case we just
      // defer execution until next turn of event loop.
      if (!isAsync)
        return setTimeout(onOutputStreamReady, 0);

      // As it's not clear what is a state of the stream (TODO: Is there really
      // no better way ?) we employ hack (see details in `isClosed`) to verify
      // if stream is closed.
      isClosed(stream) ? onClose() : onDrain();
    }
  }, 0, 0, null);
  isAsync = true;
}

const Stream = EventEmitter.extend({
  constructor: function Stream() {
  },
  readable: false,
  writable: false,
  encoding: null,
  setEncoding: function setEncoding(encoding) {
    this.encoding = String(encoding).toUpperCase();
  },
  pipe: function pipe(target, options) {
    let source = this;
    function onData(chunk) {
      if (target.writable) {
        if (false === target.write(chunk))
          source.pause();
      }
    }
    function onDrain() {
      if (source.readable) source.resume();
    }
    function onEnd() {
      target.end();
    }
    function onPause() {
      source.pause();
    }
    function onResume() {
      if (source.readable)
        source.resume();
    }

    function cleanup() {
      source.removeListener('data', onData);
      target.removeListener('drain', onDrain);
      source.removeListener('end', onEnd);

      target.removeListener('pause', onPause);
      target.removeListener('resume', onResume);

      source.removeListener('end', cleanup);
      source.removeListener('close', cleanup);

      target.removeListener('end', cleanup);
      target.removeListener('close', cleanup);
    }

    if (!options || options.end !== false)
      target.on('end', onEnd);

    source.on('data', onData);
    target.on('drain', onDrain);
    target.on('resume', onResume);
    target.on('pause', onPause);

    source.on('end', cleanup);
    source.on('close', cleanup);

    target.on('end', cleanup);
    target.on('close', cleanup);

    target.emit('pipe', source);
  },
  pause: function pause() {
    this.emit('pause');
  },
  resume: function resume() {
    this.emit('resume');
  },
  destroySoon: function destroySoon() {
    this.destroy();
  }
});
exports.Stream = Stream;

const InputStream = Stream.extend({
  constructor: function ReadStream(options) {
    let { input, pump } = options;
    _(this).input = input;
    _(this).pump = pump;
  },
  readable: true,
  paused: false,
  get status() { return _(this).pump.status; },
  read: function read() {
    let stream = this;
    let { input, pump } = _(this);
    pump.asyncRead({
      onStartRequest: function onStartRequest() { stream.emit('start'); },
      onDataAvailable: function onDataAvailable(req, c, is, offset, count) {
        try {
          let bytes = input.readByteArray(count);
          stream.emit('data', new Buffer(bytes, stream.encoding));
        } catch (error) {
          stream.emit('error', error);
          stream.readable = false;
        }
      },
      onStopRequest: function onStopRequest() {
        stream.readable = false;
        stream.emit('end');
      }
    }, null);
  },
  pause: function pause() {
    this.paused = true;
    _(this).pump.suspend();
    this.emit('paused');
  },
  resume: function resume() {
    this.paused = false;
    _(this).pump.resume();
    this.emit('resume');
  },
  destroy: function destroy() {
    this.readable = false;
    try {
      this.emit('close', null);
      _(this).pump.cancel(null);
      delete _(this).pump;
      _(this).input.close();
      delete _(this).input;
    } catch (error) {
      this.emit('error', error);
    }
  }
});
exports.InputStream = InputStream;

const OutputStream = Stream.extend({
  constructor: function OutputStream(options) {
    let { output, asyncOutputStream } = options;
    _(this).output = output;
    _(this).asyncOutputStream = asyncOutputStream;
    _(this).drain = this.emit.bind(this, 'drain');
    _(this).close = this.emit.bind(this, 'close');
  },
  writable: true,
  write: function write(content, encoding, callback) {
    let { asyncOutputStream, output, drain, close } = _(this);
    let stream = this;

    if (isFunction(encoding)) {
      callback = encoding;
      encoding = callback;
    }

    // Flag indicating whether or not content has been flushed to the kernel
    // buffer.
    let isWritten = false;
    // If stream is not writable we throw an error.
    if (!stream.writable)
      throw Error('stream not writable');

    try {
      // If content is not a buffer then we create one out of it.
      if (!Buffer.isBuffer(content))
        content = new Buffer(content, encoding);

      // We write content as a byte array as this will avoid any transcoding
      // if content was a buffer.
      output.writeByteArray(content.valueOf(), content.length);
      output.flush();

      if (callback) this.once('drain', callback);
      onStateChange(asyncOutputStream, drain, close);
      return true;
    } catch (error) {
      // If errors occur we emit appropriate event.
      stream.emit('error', error);
    }
  },
  flush: function flush() {
    _(this).output.flush();
  },
  end: function end(content, encoding, callback) {
    if (isFunction(content)) {
      callback = content
      content = callback
    }
    if (isFunction(encoding)) {
      callback = encoding
      encoding = callback
    }

    // Setting a listener to 'close' event if passed.
    if (isFunction(callback))
      this.once('close', callback);

    // If content is passed then we defer closing until we finish with writing.
    if (content)
      this.write(content, encoding, end.bind(this));
    // If we don't write anything, then we close an outputStream.
    else
      _(this).output.close();
  },
  destroy: function destroy(callback) {
    try {
      this.end(callback);
      delete _(this).output;
      this._events = null;
    } catch (error) {
      this.emit('error', error);
    }
  }
});
exports.OutputStream = OutputStream;

const DuplexStream = Stream.extend({
  writable: true,
  readable: true,
  encoding: null,
  constructor: function DuplexStream(options) {
    let { input, output, pump } = options;
    _(this).input = input;
    _(this).output = output;
    _(this).pump = pump;
  },
  read: InputStream.prototype.read,
  pause: InputStream.prototype.pause,
  resume: InputStream.prototype.resume,

  write: OutputStream.prototype.write,
  flush: OutputStream.prototype.flush,
  end: OutputStream.prototype.end,

  destroy: function destroy(error) {
    if (error)
      this.emit('error', error);
    InputStream.prototype.destroy.call(this);
    OutputStream.prototype.destroy.call(this);
  }
});
exports.DuplexStream = DuplexStream;

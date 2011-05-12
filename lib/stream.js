/* vim:set ts=2 sw=2 sts=2 expandtab */

"use strict";

const { EventEmitter } = require("./events");
const { Buffer } = require("./buffer");
// `Namespace` declared by E4X so `const` fails.
let { Namespace } = require("./namespace");

function isFunction(value) { return typeof value === "function"; }
const _ = new Namespace();

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
      source.removeListener("data", onData);
      target.removeListener("drain", onDrain);
      source.removeListener("end", onEnd);

      target.removeListener("pause", onPause);
      target.removeListener("resume", onResume);

      source.removeListener("end", cleanup);
      source.removeListener("close", cleanup);

      target.removeListener("end", cleanup);
      target.removeListener("close", cleanup);
    }

    if (!options || options.end !== false)
      target.on("end", onEnd);

    source.on("data", onData);
    target.on("drain", onDrain);
    target.on("resume", onResume);
    target.on("pause", onPause);

    source.on("end", cleanup);
    source.on("close", cleanup);

    target.on("end", cleanup);
    target.on("close", cleanup);

    target.emit("pipe", source);
  },
  pause: function pause() {
    this.emit("pause");
  },
  resume: function resume() {
    this.emit("resume");
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
    let [ stream, { input, pump } ] = [ this, _(this) ];
    pump.asyncRead({
      onStartRequest: function onStartRequest() { stream.emit("start"); },
      onDataAvailable: function onDataAvailable(req, c, is, offset, count) {
        try {
          let bytes = input.readByteArray(count);
          stream.emit("data", new Buffer(bytes, stream.encoding));
        } catch (error) {
          stream.emit("error", error);
          stream.readable = false;
        }
      },
      onStopRequest: function onStopRequest() {
        stream.readable = false;
        stream.emit("end");
      }
    }, null);
  },
  pause: function pause() {
    this.paused = true;
    _(this).pump.suspend();
    this.emit("paused");
  },
  resume: function resume() {
    this.paused = false;
    _(this).pump.resume();
    this.emit("resume");
  },
  destroy: function destroy() {
    this.readable = false;
    try {
      this.emit("close", null);
      _(this).pump.cancel(null);
      delete _(this).pump;
      _(this).input.close();
      delete _(this).input;
    } catch (error) {
      this.emit("error", error);
    }
  }
});
exports.InputStream = InputStream;

const OutputStream = Stream.extend({
  constructor: function OutputStream(options) {
    let { output } = options;
  },
  writable: true,
  write: function write(content, encoding, callback) {
    let { asyncOutputStream, binaryOutputStream } = _(this);
    let stream = this;

    if (isFunction(encoding))
      [ callback, encoding ] = [ encoding, callback ];

    // Flag indicating whether or not content has been flushed to the kernel
    // buffer.
    let isWritten = false;
    // If stream is not writable we throw an error.
    if (!stream.writable)
      throw new Error('stream not writable');

    try {
      // If content is not a buffer then we create one out of it.
      if (!Buffer.isBuffer(content))
        content = new Buffer(content, encoding);

      // We write content as a byte array as this will avoid any transcoding
      // if content was a buffer.
      output.writeByteArray(content.valueOf(), content.length);
      output.flush();

      // Setting an `nsIOutputStreamCallback` to be notified when stream is
      // writable again. Which may be synchronously called before we return.
      pump.asyncWait({
        onOutputStreamReady: function onDrain() {
          // If callback is called earlier then outer function returned then
          // we know that stream is writable so users don't need to wait for
          // "drain" events. In such cases node returns `true` so we override
          // `isWritable` to let caller know they can continue writing to this
          // stream.
          isWritten = stream.writable = true;
          stream.emit("drain");
          // Calling a callback if one was passed.
          if (callback)
            callback();
        }
      }, 0, 0, null);
      // Using `nsIOutputStreamCallback` with a special flag that overrides
      // the default behavior causing the `OnOutputStreamReady` notification
      // to be suppressed until the  stream becomes closed (either as a result of
      // closeWithStatus/close being called on the stream or possibly due to
      // some error in the underlying stream).
      pump.asyncWait({
        onOutputStreamReady: function onClose() {
          stream.writable = false;
          stream.emit("close", null);
        }
      }, pump.WAIT_CLOSURE_ONLY, 0, null);
      // Return `true` if the string has been flushed to the kernel buffer.
      // Return false to indicate that the kernel buffer is full, and the data
      // will be sent out in the future.
      return isWritten;
    } catch (error) {
      // If errors occur we emit appropriate event.
      stream.emit("error", error);
    }
  },
  flush: function flush() {
    _(this).output.flush();
  },
  end: function end(content, encoding, callback) {
    if (isFunction(content))
      [ callback, content ] = [ content, callback ];
    if (isFunction(encoding))
      [ callback, encoding ] = [ encoding, callback ];

    // Setting a listener to "close" event if passed.
    if (isFunction(callback))
      this.once("close", callback);

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
    } catch (error) {
      this.emit("error", error);
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
      this.emit("error", error);
    InputStream.prototype.destroy.call(this);
    OutputStream.prototype.destroy.call(this);
  }
});
exports.DuplexStream = DuplexStream;

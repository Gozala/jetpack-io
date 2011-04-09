"use strict";

const { Cc, Ci, components: { Constructor: CC } } = require("chrome");
const { Buffer } = require("buffer");
const { EventEmitterTrait: EventEmitter } = require("events");
const StreamReader = CC("@mozilla.org/binaryinputstream;1",
                        "nsIBinaryInputStream", "setInputStream");

function Stream(channel) {
  return this instanceof Stream ? this : Object.create(Stream.prototype);
}
Stream.prototype = EventEmitter.create(Stream.prototype);
Object.defineProperties(Stream.prototype, {
  open: { value: function open(channel) {
    let emit = this._emit.bind(this);
    channel.asyncOpen({
      onDataAvailable: function onData(request, context, inputStream, offset, length) {
        try {
          emit("data", new Buffer(StreamReader(inputStream).readByteArray(length)));
        } catch (error) {
          emit("error", error);
        }
      },
      onStartRequest: function onStartRequest() { emit("start"); },
      onStopRequest: function onStopRequest() { emit("end"); }
    }, null);
  }}
});
exports.Stream = Stream;

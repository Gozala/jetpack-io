"use strict";

const { EventEmitterTrait: EventEmitter } = require("events");

function Stream() {
  return this instanceof Stream ? this : Object.create(Stream.prototype);
}
Stream.prototype = EventEmitter.create(Stream.prototype);
exports.Stream = Stream;

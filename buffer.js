/* vim:set ts=2 sw=2 sts=2 expandtab */
/*jshint undef: true es5: true node: true devel: true globalstrict: true
         forin: true latedef: false supernew: true */
/*global define: true */

"use strict";

const { Extendable } = require('https!raw.github.com/Gozala/extendables/v0.2.0/extendables.js');
const { Cc, Ci, components: { Constructor: CC } } = require("chrome");
const Transcoder = CC("@mozilla.org/intl/scriptableunicodeconverter",
                      "nsIScriptableUnicodeConverter");

var Buffer = Extendable.extend({
  constructor: function Buffer(subject, encoding) {
    if (!(this instanceof Buffer))
      return new Buffer(subject, encoding);

    subject = subject ? subject.valueOf() : 0;
    let length = typeof subject === 'number' ? subject : 0;
    this.encoding = encoding || 'utf-8';
    this.valueOf(Array.isArray(subject) ? subject : new Array(length));

    if (typeof subject === 'string') this.write(subject);
  },
  encoding: 'utf-8',
  get length() {
    return this.valueOf().length;
  },
  get: function get(index) {
    return this.valueOf()[index];
  },
  set: function set(index, value) {
    return this.valueOf()[index] = value;
  },
  valueOf: function valueOf(value) {
    Object.defineProperty(this, 'valueOf', {
      value: Array.prototype.valueOf.bind(value),
      configurable: false,
      writable: false,
      enumerable: false
    });
  },
  toString: function toString(encoding, start, end) {
    let bytes = this.valueOf().slice(start || 0, end || this.length);
    let transcoder = Transcoder();
    transcoder.charset = String(encoding || this.encoding).toUpperCase();
    return transcoder.convertFromByteArray(bytes, this.length);
  },
  write: function write(string, offset, encoding) {
    offset = Math.max(offset || 0, 0);
    let value = this.valueOf();
    let transcoder = Transcoder();
    transcoder.charset = String(encoding || this.encoding).toUpperCase();
    let bytes = transcoder.convertToByteArray(string, {});
    value.splice.apply(value, [
      offset,
      Math.min(value.length - offset, bytes.length, bytes)
    ].concat(bytes));
    return bytes;
  },
  slice: function slice(start, end) {
    return new Buffer(this.valueOf().slice(start, end));
  },
  copy: function copy(target, offset, start, end) {
    offset = Math.max(offset || 0, 0);
    target = target.valueOf();
    let bytes = this.valueOf();
    bytes.slice(Math.max(start || 0, 0), end);
    target.splice.apply(target, [
      offset,
      Math.min(target.length - offset, bytes.length),
    ].concat(bytes));
  }
});
Buffer.isBuffer = function isBuffer(buffer) {
  return buffer instanceof Buffer
};
exports.Buffer = Buffer;
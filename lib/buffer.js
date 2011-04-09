const { Cc, Ci, components: { Constructor: CC } } = require("chrome");
const Transcoder = CC("@mozilla.org/intl/scriptableunicodeconverter",
                      "nsIScriptableUnicodeConverter");

function Buffer(subject, encoding) {
  if (!(this instanceof Buffer))
    return new Buffer(subject, encoding);

  subject = subject ? subject.valueOf() : 0;
  let length = typeof subject === 'number' ? subject : 0;
  this.encoding = encoding || 'utf-8';
  this.valueOf(Array.isArray(subject) ? subject : new Array(length));

  if (typeof subject === 'string') this.write(subject);
}
Buffer.isBuffer = function isBuffer(buffer) { return buffer instanceof Buffer };
Object.defineProperties(Buffer.prototype, {
  length: {
    get: function length() {
      return this.valueOf().length;
    }
  },
  get: {
    value: function get(index) {
      return this.valueOf()[index];
    },
    enumerable: true
  },
  set: {
    value: function set(index, value) {
      return this.valueOf()[index] = value;
    },
    enumerable: true
  },
  encoding: {
    value: 'utf-8',
    enumerable: true,
    writable: true
  },
  valueOf: {
    value: function valueOf(value) {
      Object.defineProperty(this, 'valueOf', {
        value: Array.prototype.valueOf.bind(value),
        configurable: false
      });
      return this.valueOf();
    }, configurable: true
  },
  toString: {
    value: function toString(encoding, start, end) {
      let bytes = this.valueOf().slice(start || 0, end || this.length);
      let transcoder = Transcoder();
      transcoder.charset = String(encoding || this.encoding).toUpperCase();
      return transcoder.convertFromByteArray(bytes, this.length);
    }
  },
  write: {
    value: function write(string, offset, encoding) {
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
    enumerable: true
  },
  slice: {
    value: function slice(start, end) {
      return new Buffer(this.valueOf().slice(start, end));
    },
    enumerable: true
  },
  copy: {
    value: function copy(target, offset, start, end) {
      offset = Math.max(offset || 0, 0);
      target = target.valueOf();
      let bytes = this.valueOf();
      bytes.slice(Math.max(start || 0, 0), end);
      target.splice.apply(target, [
        offset,
        Math.min(target.length - offset, bytes.length),
      ].concat(bytes));
    },
    enumerable: true
  }
});

exports.Buffer = Buffer;

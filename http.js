const stream = require('./stream');

// const END_OF_FILE = {};

const IncomingMessage = stream.Stream.extend({
  constructor: function IncomingMessage(socket) {
    this.socket = socket;
    this.readable = true;
  },

  headers: {},
  trailers: {},

  method: null,
  httpVersion: null,
  url: '',
  complete: false,

  // _paused: false,
  // _pendings: [],

  // _endEmitted: false,

  _dummy: null
});

exports.IncomingMessage = IncomingMessage;

IncomingMessage.prototype.destroy = function(error) {
  this.socket.destroy(error);
};

IncomingMessage.prototype.setEncoding = function(encoding) {
  throw Error('`setEncoding` not yet implemented');
};

IncomingMessage.prototype.pause = function() {
  throw Error('`pause` not yet implemented');
};

IncomingMessage.prototype.resume = function() {
  throw Error('`resume` not yet implemented');
};

// IncomingMessage.prototype._emitPending = function() {
//   if (this._pendings.length) {
//     // TODO: Here was used process.nextTick to defer next actions to be called asynchronously. Don't quite understand why.
//     while (!this._paused && this._pendings.length) {
//       var chunk = this._pendings.shift();
//       if (chunk !== END_OF_FILE) {
//         // assert(Buffer.isBuffer(chunk));
//         this._emitData(chunk);
//       } else {
//         // assert(this._pendings.length === 0);
//         this.readable = false;
//         this._emitEnd();
//       }
//     }
//   }
// };

// IncomingMessage.prototype._emitData = function(d) {
//   if (this._decoder) {
//     var string = this._decoder.write(d);
//     if (string.length) {
//       this.emit('data', string);
//     }
//   } else {
//     this.emit('data', d);
//   }
// };


// IncomingMessage.prototype._emitEnd = function() {
//   if (!this._endEmitted) {
//     this.emit('end');
//   }
//   this._endEmitted = true;
// };


// Add the given (field, value) pair to the message
//
// Per RFC2616, section 4.2 it is acceptable to join multiple instances of the
// same header with a ', ' if the header in question supports specification of
// multiple values this way. If not, we declare the first instance the winner
// and drop the second. Extended header fields (those beginning with 'x-') are
// always joined.
IncomingMessage.prototype._addHeaderLine = function(field, value) {
  var dest = this.complete ? this.trailers : this.headers;

  switch (field) {
    // Array headers:
    case 'set-cookie':
      if (field in dest) {
        dest[field].push(value);
      } else {
        dest[field] = [value];
      }
      break;

    // Comma separate. Maybe make these arrays?
    case 'accept':
    case 'accept-charset':
    case 'accept-encoding':
    case 'accept-language':
    case 'connection':
    case 'cookie':
    case 'pragma':
    case 'link':
    case 'www-authenticate':
    case 'sec-websocket-extensions':
    case 'sec-websocket-protocol':
      if (field in dest) {
        dest[field] += ', ' + value;
      } else {
        dest[field] = value;
      }
      break;

    default:
      if (field.slice(0, 2) == 'x-') {
        // except for x-
        if (field in dest) {
          dest[field] += ', ' + value;
        } else {
          dest[field] = value;
        }
      } else {
        // drop duplicates
        if (!(field in dest)) dest[field] = value;
      }
      break;
  }
};







const net = require("./net");

function connectionListener(socket) {
  socket.end('Server not yet implemented');
  throw Error('Not yet implemented');
}
exports._connectionListener = connectionListener;

const Server = net.Server.extend({
  constructor: function Server(requestListener) {
    if (!(this instanceof Server)) return new Server(requestListener);

    net.Server.call(this, {}, connectionListener);

    if (requestListener) {
      this.on('request', requestListener);
    }
  }
});
exports.Server = Server;

function createServer(requestListener) {
  return new Server(requestListener);
};
exports.createServer = createServer;

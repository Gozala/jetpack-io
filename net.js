'use strict';

const { Cc, Ci, CC } = require('chrome');

const { DuplexStream, InputStream, OutputStream } = require('./stream');
const { EventEmitter } = require('raw.github.com/Gozala/events/v0.5.0/events');
const { Buffer } = require('./buffer');
const { ns } = require('api-utils/namespace');
const _ = ns();


const { createTransport } = Cc['@mozilla.org/network/socket-transport-service;1'].
                            getService(Ci.nsISocketTransportService);
const RawSocketServer = CC('@mozilla.org/network/server-socket;1',
                        'nsIServerSocket');
const StreamPump = CC('@mozilla.org/network/input-stream-pump;1',
                      'nsIInputStreamPump', 'init');
const StreamCopier = CC('@mozilla.org/network/async-stream-copier;1',
                        'nsIAsyncStreamCopier', 'init');
const BinaryInputStream = CC('@mozilla.org/binaryinputstream;1',
                             'nsIBinaryInputStream', 'setInputStream');
const BinaryOutputStream = CC('@mozilla.org/binaryoutputstream;1',
                              'nsIBinaryOutputStream', 'setOutputStream');

const {
  STATUS_RESOLVING, STATUS_CONNECTING_TO,
  STATUS_CONNECTED_TO, STATUS_SENDING_TO,
  STATUS_WAITING_FOR, STATUS_RECEIVING_FROM,

  TIMEOUT_CONNECT, TIMEOUT_READ_WRITE
} = Ci.nsISocketTransport;

const BACKLOG = -1;
const CONNECTING = 'opening';
const OPEN  = 'open';
const CLOSED = 'closed';
const READ = 'readOnly';
const WRITE = 'writeOnly';
const ENCODING_UTF8 = 'utf-8';
const ENCODING_BINARY = 'binary';

function isPort(x) parseInt(x) >= 0

function onStatus(socket, transport, previous) {
  let state = socket.readyState;
  if (previous !== state) {
    socket.emit('readyState', state);
    switch (state) {
      case CONNECTING:
        break;
      case OPEN:
        socket.emit('connect');
        break;
      case WRITE:
        socket.emit('end');
        break;
      case READ:
        break;
      case CLOSED:
        socket.emit('close')
        break;
    }
  }
}

const Socket = DuplexStream.extend({
  constructor: function Socket(options) {
    options = options || {};

    if ('server' in options)
      this.server = options.server;
    // This is client connected to your server.
    if ('transport' in options) {
      let transport = _(this).transport = options.transport;
      let asyncInputStream = transport.openInputStream(null, 0, 0);
      let asyncOutputStream = transport.openOutputStream(null, 0, 0);
      let binaryInputStream = BinaryInputStream(asyncInputStream);
      let binaryOutputStream = BinaryOutputStream(asyncOutputStream);
      let pump = StreamPump(asyncInputStream, -1, -1, 0, 0, false);
      transport.setEventSink({
        onTransportStatus: function onTransportStatus(transport, status, progress, total) {
          let state = this.readyState;
          switch (status) {
            case STATUS_RESOLVING:
              this._connecting = true;
              break;
            case STATUS_CONNECTING_TO:
              this._connecting = true;
              break;
            case STATUS_CONNECTED_TO:
              this._connecting = false;
              this.readable = true;
              this.writable = true;
              break;
            case STATUS_SENDING_TO:
              break;
            case STATUS_WAITING_FOR:
              break;
            case STATUS_RECEIVING_FROM:
              break;
          }
          onStatus(this, transport, socket.readyState);
        }.bind(this)
      }, null);

      OutputStream.call(this, {
        asyncOutputStream: asyncOutputStream,
        output: binaryOutputStream
      });
      InputStream.call(this, {
        input: binaryInputStream,
        pump: pump
      });

      this.read();
    }
  },
  bufferSize: 0,
  fd: null,
  type: null,
  resolving: false,
  get readyState() {
    if (this._connecting) return CONNECTING;
    else if (this.readable && this.writable) return OPEN;
    else if (this.readable && !this.writable) return READ;
    else if (!this.readable && this.writable) return WRITE;
    else return CLOSED;
  },
  get remoteAddress() {
    if (!this._connecting) {
      let { host, port } = _(this).transport
      return host + ':' + port
    }
    return null;
  },
  address: function address() {
  },
  setNoDelay: function setNoDelay() {
  },
  setKeepAlive: function setKeepAlive() {
  },
  setSecure: function setSecure() {
  },
  setTimeout: function setTimeout(time, callback) {
    if (callback)
      this.once('timeout', callback);

    _(this).transport.setTimeout(time, TIMEOUT_READ_WRITE);
  },
  open: function open(fd, type) {
    throw Error('Not yet implemented');
  },
  connect: function connect (port, host) {
    try {
      Socket.call(this, {
        transport: createTransport(null, 0, host, port, null)
      });
    } catch(e) {
      this._emit('error', e)
    }
  },
  setEncoding: function setEncoding(encoding) {
  },
  end: function end(data, encoding) {
     try {
      this.readable = false;
      this.writable = false;

      _(this).transport.close(0);
      onStatus(this);
    } catch(e) {
      this.emit('error', e)
    }
  }
});
exports.Socket = Socket;

const Server = EventEmitter.extend({
  constructor: function Server(options, listener) {
     if (!(this instanceof Server))
       return new Server(options, listener);

    options = options || {};
    if ('loopbackOnly' in options)
      this.loopbackOnly = !!options.loopbackOnly;
    if ('maxConnections' in options)
      this.maxConnections = options.maxConnections;
    if ('connections' in options)
      this.connections = options.connections;

    _(this).rawServer = RawSocketServer();

    if (listener)
      this.on('connection', listener);

  },
  type: null,
  get port() _(this).rawServer && _(this).rawServer.port,
  host: null,
  /**
   * The number of concurrent connections on the server.
   */
  connections: 0,
  /**
   * Set this property to reject connections when the server's connection
   * count gets high.
   */
  maxConnections: -1,
  /**
   * Returns the bound address of the server as seen by the operating system.
   * Useful to find which port was assigned when giving getting an OS-assigned
   * address.
   */
  address: function address() {
    return this.host + ':' + this.port;
  },
  listenFD: function listenFD(fd, type) {
    throw Error('Not implemented');
  },
  listen: function listen(port, host, callback) {
    let server = this;
    let connections = 0;

    if (this.fd)
      throw Error('Server already opened');

    if (!callback) {
      callback = host
      host = 'localhost'
    }

    if (callback)
      this.on('listening', callback)

    if (isPort(port)) {
      this.type = 'tcp'
      this.host = host;
      let { rawServer } = _(this);
      rawServer.init(port, this.loopbackOnly, this.maxConnections);
      rawServer.asyncListen({
        onSocketAccepted: function onConnect(rawServer, transport) {
          try {
            let socket = new Socket({
              transport: transport,
              server: server
            });
            server.connections = ++ connections;
            server.emit('connection', socket);
          } catch (error) {
            server.emit('error', error);
          }
        },
        onStopListening: function onDisconnect(rawServer, status) {
          try {
            server.emit('close');
          } catch (error) {
            server.emit('error', error)
          }
        }
      });

      this.emit('listening');
    }
  },
  pause: function pause(time) {
    throw Error('Net implemented');
  },
  /**
   * Stops the server from accepting new connections. This function is
   * asynchronous, the server is finally closed when the server emits a
   * `'close'` event.
   */
  close: function close() {
    this.removeAllListeners('connection')
    this.removeAllListeners('error')
    this.removeAllListeners('listening')
    _(this).rawServer.close();
  },
  destroy: function destroy(error) {
    this.close();
    if (error)
      this.emit('error', error);
    delete _(this).rawServer;
  }
});
exports.Server = Server;

exports.createServer = function createServer(options, listener) {
  return Server(options, listener);
};
exports.createConnection = function createConnection(port, host) {
  let socket = new Socket();
  socket.connect(port, host);
  return socket;
};

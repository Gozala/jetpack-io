"use strict";

const { Cc, Ci, components: { Constructor: CC } } = require("chrome");

const { DuplexStream } = require("./stream");
const { EventEmitter } = require("./events");
const { Buffer } = require("./buffer");
// `Namespace` declared by E4X so `const` fails.
let { Namespace } = require("./namespace");
const _ = new Namespace();


const RawSocketServer = CC("@mozilla.org/network/server-socket;1",
                        "nsIServerSocket");

const { createTransport } = Cc("@mozilla.org/network/socket-transport-service;1", 
                           "nsISocketTransportService")();
const StreamPump = CC("@mozilla.org/network/input-stream-pump;1",
                      "nsIInputStreamPump", "init");
const StreamCopier = CC("@mozilla.org/network/async-stream-copier;1",
                        "nsIAsyncStreamCopier", "init");
const BinaryInputStream = CC("@mozilla.org/binaryinputstream;1",
                             "nsIBinaryInputStream", "setInputStream");
const BinaryOutputStream = CC("@mozilla.org/binaryoutputstream;1",
                              "nsIBinaryOutputStream", "setOutputStream");

const {
  STATUS_RESOLVING, STATUS_CONNECTING_TO,
  STATUS_CONNECTED_TO, STATUS_SENDING_TO,
  STATUS_WAITING_FOR, STATUS_RECEIVING_FROM,

  TIMEOUT_CONNECT, TIMEOUT_READ_WRITE
} = Ci.nsISocketTransport;

const _ = new Namespace();

const BACKLOG = -1;
const CONNECTING = 'opening';
const OPEN  = 'open';
const CLOSED = 'closed';
const READ = 'readOnly';
const WRITE = 'writeOnly';
const ENCODING_UTF8 = 'utf-8';
const ENCODING_BINARY = 'binary';

const servers = {};
const streams = {};

let GUID = 0

function isPort(x) parseInt(x) >= 0

function onStatus(socket, transport, previous) {
  if (previous !== socket.readyState) {
    this.emit('readyState', socket.readyState);
    switch (state) {
      case CONNECTING:
        break;
      case OPEN:
        socket.emit("connect");
        break;
      case WRITE:
        socket.emit("end");
        break;
      case READ:
        break;
      case CLOSED:
        this.emit("close")
        break;
    }
  }
}

function pumpSocket(socket, transport) {
  let asyncInputStream = transport.openOutputStream(0, 0, 0);
  let asyncOutputStream = transport.openInputStream(0, 0, 0);

  let binaryInputStream = BinaryInputStream(asyncInputStream);
  _(socket).binaryInputStream = binaryInputStream;
  let binaryOutputStream = BinaryOutputStream(asyncOutputStream);
  _(socket).binaryOutputStream = binaryOutputStream;


  let pump = StreamPump(asyncInputStream, -1, -1, 0, 0, false);
  _(socket).pump = pump;
  pump.asyncRead({
    onStartRequest: function onStartRequest() { socket.emit("start"); },
    onDataAvailable: function onDataAvailable(req, c, input, offset, count) {
      try {
        let bytes = binaryInputStream.readByteArray(count);
        socket.emit("data", new Buffer(bytes, stream.encoding));
      } catch (error) {
        socket.emit("error", error);
        socket.readable = false;
      }
    },
    onStopRequest: function onStopRequest() {
      socket.readable = false;
      socket.emit("end");
    }
  }, null);

  transport.setEventSink({
    onTransportStatus: function onTransportStatus(transport, status, progress, total) {
    let state = socket.readyState;
    switch (status) {
      case STATUS_RESOLVING:
        socket._connecting = true;
        break;
      case STATUS_CONNECTING_TO:
        socket._connecting = true;
        break;
      case STATUS_CONNECTED_TO:
        socket._connecting = false;
        socket.readable = true;
        socket.writable = true;
        break
      case STATUS_SENDING_TO:
        break
      case STATUS_WAITING_FOR:
        break
      case STATUS_RECEIVING_FROM:
        break
    }
    onStatus(socket, transport, socket.readyState);
  }, null);
}


const Socket = DuplexStream.extend({
  constructor: function Socket(options) {
    if ('transport' in options)
      _(this).transport = options.transport;
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
  }
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
      this.once("timeout", callback);

    _(this).transport.setTimeout(time, TIMEOUT_READ_WRITE);
  },
  pause: function pause() {
  },
  resume: function resume() {
  },
  open: function open(fd, type) {
    throw new Error('Not yet implemented');
  },
  connect: function connect (port, host) {
    try {
      _(this).transport = createTransport(null, 0, host, port, null)
      this._connect()
    } catch(e) {
      this._emit('error', e)
    }
  },
  write: function write(data, encoding, fd, callback) {
  },
  flush: function flush() {
  },
  setEncoding: function setEncoding(encoding) {
  },
  destroy: function destroy(error) {
    delete _(this).transport;
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

function Server = EventEmitter.extend({
  constructor: function Server(options, listener) {
    if ("loopbackOnly" in options)
      this.loopbackOnly = !!options.loopbackOnly;
    if ("maxConnections" in options)
      this.maxConnections = options.maxConnections;
    if ("connections" in options)
      this.connections = options.connections;

    _(this).rawServer = RawSocketServer();

    if (listener)
      this.on("connection", listener);

  },
  type: null,
  get port() this._(rawServer) && _(this).rawServer.port,
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
    return this.host + ":" + this.port;
  },
  listenFD: function listenFD(fd, type) {
    throw new Error("Not implemented");
  },
  listen: function listen(port, host, callback) {
    let server = this;
    let connections = 0;

    if (this.fd)
      throw new Error('Server already opened');

    if (!callback)
      [ host, callback ] = [ "localhost", callback ]

    if (callback)
      this.on("listening", callback)

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
              readable: true,
              writable: true,
              server: server
            });
            server.connections = ++ connections;
            server.emit('connection', socket);
          } catch (error) {
            server.emit("error", error);
          }
        },
        onStopListening: function onDisconnect(rawServer, status) {
          try {
            server.emit('close');
          } catch (error) {
            server.emit("error", error)
          }
        }
      });

      this.emit("listening");
    }
  },
  pause: function pause(time) {
    throw new Error("Net implemented");
  },
  /**
   * Stops the server from accepting new connections. This function is
   * asynchronous, the server is finally closed when the server emits a
   * `"close"` event.
   */
  close: function close() {
    this.removeAllListeners("connection")
    this.removeAllListeners("error")
    this.removeAllListeners("listening")
    _(this).rawServer.close();
  },
  destroy: function destroy(error) {
    this.close();
    if (error)
      this.emit("error", error);
    delete _(this).rawServer;
  }
});
exports.Server = Server;

exports.createServer = function createServer(options, listener) {
  return Server(options, listener);
};
exports.createConnection = function createConnection(port, host) {
  let socket = Socket();
  socket.connect(port, host);
  return socket;
};

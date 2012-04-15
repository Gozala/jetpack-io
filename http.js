const net = require("./net");

function connectionListener(socket) {
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

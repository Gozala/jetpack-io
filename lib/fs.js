/* vim:set ts=2 sw=2 sts=2 expandtab */
/*jshint undef: true es5: true node: true devel: true globalstrict: true
         forin: true latedef: false supernew: true */
/*global define: true */

"use strict";

const { setTimeout } = require("timer");
const { Stream } = require("./stream");
const { Buffer } = require("./buffer");
const { Cc, Ci, components: { Constructor: CC } } = require("chrome");

const ioService = Cc["@mozilla.org/network/io-service;1"].
                  getService(Ci.nsIIOService);

const FileDescriptor = CC("@mozilla.org/file/local;1", "nsILocalFile",
                          "initWithPath");
const FileOutputStream = CC("@mozilla.org/network/file-output-stream;1",
                            "nsIFileOutputStream");

const ConverterStream = CC("@mozilla.org/intl/converter-output-stream;1",
                           "nsIConverterOutputStream");
const StreamCopier = CC("@mozilla.org/network/async-stream-copier;1",
                        "nsIAsyncStreamCopier");
const StringStream = CC("@mozilla.org/io/string-input-stream;1",
                        "nsIStringInputStream", "setData");

const StreamReader = CC("@mozilla.org/binaryinputstream;1",
                        "nsIBinaryInputStream", "setInputStream");
const StreamWriter = CC("@mozilla.org/binaryoutputstream;1",
                        "nsIBinaryOutputStream", "setOutputStream");

const KEY = { valueOf: function valueOf() { return "Privates accessor" } };



function toArray(enumerator) {
  let value = [];
  while(enumerator.hasMoreElements())
    value.push(enumerator.getNext())
  return value
}
function getFileName(file) {
  return file.QueryInterface(Ci.nsIFile).leafName;
}
function getFileURI(file) {
  return ioService.newFileURI(file);
}
function getFileChannel(file) {
  return ioService.newChannelFromURI(getFileURI(file));
}

const ReadStream = Stream.extend({
  constructor: function ReadStream(path) {
    let fd = FileDescriptor(path);
    let channel = getFileChannel(fd);
    let emit = this.emit.bind(this);
    channel.asyncOpen({
      onDataAvailable: function onDataAvailable(request, context, inputStream, offset, length) {
        try {
          emit("data", new Buffer(StreamReader(inputStream).readByteArray(length)));
        } catch (error) {
          emit("error", error);
        }
      },
      onStartRequest: function onStartRequest() { emit("start"); },
      onStopRequest: function onStopRequest() { emit("end"); }
    }, null);
  },
  readable: true,
  setEncoding: function setEncoding(encoding) {
      this.encoding = String(encoding).toUpperCase();
  },
  pause: function pause() {
  },
  resume: function resume() {
  },
  destroy: function destroy() {
  }
});

const WriteStream = Stream.extend({
  constructor: function WriteStream(path) {
    let emit = this.emit.bind(this);
    let _ = {
      fd: new FileDescriptor(path),
      observer: {
        onStartRequest: function onStartRequest() { emit("start"); },
        onStopRequest: function onStopRequest() { emit("drain"); }
      }
    };
    this.valueOf = function valueOf(key) { return key === KEY ? _ : this; };
  },
  writable: true,
  write: function write(content) {
    let { fd, observer } = this.valueOf(KEY);
    let copier = new StreamCopier();
    let target = new FileOutputStream();
    target.init(fd, 0x04 | 0x08 | 0x20, parseInt("0666"),
                target.DEFER_OPEN);
    let source = new StringStream(content, content.length);
    copier.init(source, target, null, true, false, null, true, true);
    copier.asyncCopy(observer, null);
  },
  end: function end(content, encoding) {
  },
  destroy: function destroy() {
  }
});

function readdirSync(path) {
  return toArray(FileDescriptor(path).directoryEntries).map(getFileName);
}
exports.readdirSync = readdirSync;

function readdir(path, callback) {
  setTimeout(function() {
    try {
      callback(null, readdirSync(path));
    } catch (error) {
      callback(error);
    }
  });
}
exports.readdir = readdir;

function readFile(path, callback) {
  let buffer = new Buffer();
  let stream = new ReadStream(path);
    stream.on("data", function(chunck) {
    chunck.copy(buffer, buffer.length);
  });
  stream.on("error", callback);
  stream.on("end", callback.bind(null, null, buffer));
}
exports.readFile = readFile;

function writeFile(path, content, encoding, callback) {
  try {
    if (!callback)
      [ callback, encoding ] = [ encoding, callback ];

    let stream =  new WriteStream(path);
    if (callback)
      stream.once("drain", callback.bind(null, null))

    if (typeof content === "string")
    content = typeof content === "string" ? new Buffer(content) : content;
    stream.write(content);
  } catch (error) {
    callback(error);
  }
}
exports.writeFile = writeFile;

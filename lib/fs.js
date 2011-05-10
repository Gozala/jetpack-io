/* vim:set ts=2 sw=2 sts=2 expandtab */
/*jshint undef: true es5: true node: true devel: true globalstrict: true
         forin: true latedef: false supernew: true */
/*global define: true */

"use strict";

const { setTimeout } = require("timer");
const { Stream } = require("./stream");
const { Buffer } = require("./buffer");
const { Extendable } = require("./extendables");
var { Namespace } = require("./namespace");
const { Cc, Ci, components: { Constructor: CC } } = require("chrome");

const ioService = Cc["@mozilla.org/network/io-service;1"].
                  getService(Ci.nsIIOService);

const FileDescriptor = CC("@mozilla.org/file/local;1", "nsILocalFile",
                          "initWithPath");
const FileOutputStream = CC("@mozilla.org/network/file-output-stream;1",
                            "nsIFileOutputStream");
const FileInputStream = CC("@mozilla.org/network/file-input-stream;1",
                           "nsIFileInputStream");
const StreamCopier = CC("@mozilla.org/network/async-stream-copier;1",
                        "nsIAsyncStreamCopier");
const StringStream = CC("@mozilla.org/io/string-input-stream;1",
                        "nsIStringInputStream", "setData");

const StreamReader = CC("@mozilla.org/binaryinputstream;1",
                        "nsIBinaryInputStream", "setInputStream");
const StreamWriter = CC("@mozilla.org/binaryoutputstream;1",
                        "nsIBinaryOutputStream", "setOutputStream");
const StreamPump = CC("@mozilla.org/network/input-stream-pump;1",
                      "nsIInputStreamPump", "init");


const FILE_PERMISSION = parseInt("0666");

const PR_UINT32_MAX = 0xfffffff;
// Values taken from:
// http://mxr.mozilla.org/mozilla-central/source/nsprpub/pr/include/prio.h#615
const PR_RDONLY =       0x01;
const PR_WRONLY =       0x02;
const PR_RDWR =         0x02;
const PR_CREATE_FILE =  0x08;
const PR_APPEND =       0x10;
const PR_TRUNCATE =     0x20;
const PR_SYNC =         0x40;
const PR_EXCL =         0x80;

const FLAGS = {
  'r':                  PR_RDONLY,
  'r+':                 PR_RDWR,
  'w':                  PR_CREATE_FILE | PR_TRUNCATE | PR_WRONLY,
  'w+':                 PR_CREATE_FILE | PR_TRUNCATE | PR_RDWR,
  'a':                  PR_APPEND | PR_CREATE_FILE | PR_WRONLY,
  'a+':                 PR_APPEND | PR_CREATE_FILE | PR_WRONLY
};

const _ = new Namespace();

function isString(value) { return typeof value === "string"; }
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
function remove(path) {
  return new FileDescriptor(path).remove(false);
function Mode(mode, fallback) {
  return isString(mode) ? parseInt(mode) : mode || fallback;
}
function Flags(flag) {
  return !isString(flag) ? flag :
         FLAGS[flag] || new Error('Unknown file open flag: ' + flag);
}

const ReadStream = Stream.extend({
  constructor: function ReadStream(path, options) {
    options = options || {}
    if ('mode' in options)
      this.mode = options.mode;
    if ('flags' in options)
      this.flags = options.flags;
    if ('bufferSize' in options)
      this.bufferSize = options.bufferSize;
    let fd = FileDescriptor(path);
    let channel = getFileChannel(fd);
    let emit = this.emit.bind(this);
    channel.asyncOpen({
      onDataAvailable: function onDataAvailable(request, context, inputStream, offset, length) {
        try {
          emit("data", new Buffer(StreamReader(inputStream).readByteArray(length)));
        } catch (error) { emit("error", error); }
      },
      onStartRequest: function onStartRequest() { emit("start"); },
      onStopRequest: function onStopRequest() {  emit("end"); }
    }, null);


    let stream = this;
    let source = new FileInputStream(fd, Flags(this.flags), Mode(this.mode), fd.DEFER_OPEN);
    let pump = _(this).request = new StreamPump(source, -1, -1, 0, 0, true);
    pump.asyncRead({
      onStartRequest: function onStartRequest() { emit("start"); },
      onDataAvailable: function onDataAvailable(request, context, inputStream, offset, count) {
        try {
          let bytes = StreamReader(inputStream).readByteArray(length);
          emit("data", new Buffer(bytes, this.encoding));
        } catch (error) {
          emit("error", error);
          stream.readable = false;
        }
      },
      onStopRequest: function onStopRequest() {
        stream.readable = false;
        emit("end");
        stream.destroy();
      }
    }, null);
  },
  path: null,
  encoding: null,
  readable: true,
  paused: false,
  flags: 'r',
  mode: FILE_PERMISSION,
  bufferSize: 64 * 1024,
  get status() {
    return _(this).request.status;
  },
  setEncoding: function setEncoding(encoding) {
      this.encoding = String(encoding).toUpperCase();
  },
  pause: function pause() {
    this.paused = true;
    _(this).request.suspend();
  },
  resume: function resume() {
    this.paused = false;
    _(this).request.resume();
  },
  destroy: function destroy() {
    this.readable = false;
    try {
      _(this).request.cancel(null);
      delete _(this).request;
      this.emit("close", null);
    } catch (error) {
      this.emit("error", error);
    }
  }
});
exports.ReadStream = ReadStream;
exports.createReadStream = function createReadStream(path, options) {
  return new ReadStream(path, options);
};

const WriteStream = Stream.extend({
  constructor: function WriteStream(path) {
    let emit = this.emit.bind(this);
    _(this).fd = new FileDescriptor(path);
    _(this).observer = {
      onStartRequest: function onStartRequest() { emit("start"); },
      onStopRequest: function onStopRequest() { emit("drain"); }
    }
  },
  writable: true,
  write: function write(content) {
    let { fd, observer } = _(this);
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
exports.WriteStream = WriteStream;
exports.createWriteStream = function createWriteStream(path, options) {
  return new Write(path, options);
};

var Stats = Extendable.extend({
  constructor: function Stats(path) {
    _(this).fd = new FileDescriptor(path);
  },
  isDirectory: function isDirectory() {
    return _(this).fd.isDirectory();
  },
  isFile: function isFile() {
    return _(this).fd.isFile();
  },
  isSymbolicLink: function isSymbolicLink() {
    return _(this).fd.isSymlink();
  },


  get mode() {
  },
  get size() {
    return _(this).fd.fileSize;
  },
  get mtime() {
    return _(this).fd.lastModifiedTime;
  },

  isBlockDevice: function isBlockDevice() {
    return _(this).fd.isSpecial();
  },
  isCharacterDevice: function isCharacterDevice() {
    return _(this).fd.isSpecial();
  },
  isFIFO: function isFIFO() {
    return _(this).fd.isSpecial();
  },
  isSocket: function isSocket() {
    return _(this).fd.isSpecial();
  },

  // non standard
  get exists() {
    return _(this).fd.exists();
  },
  get hidden() {
    return _(this).fd.isHidden();
  },
  get writable() {
    return _(this).fd.isWritable();
  },
  get readable() {
    return _(this).fd.isReadable();
  },
  get permissions() {
    return _(this).fd.permissions;
  }
});
exports.Stats = Stats;

var LStats = Stats.extend({
  get size() {
    return this.isSymbolicLink() ? _(this).fd.fileSizeOfLink :
                                   _(this).fd.fileSize;
  },
  get mtime() {
    return this.isSymbolicLink() ? _(this).fd.lastModifiedTimeOfLink :
                                   _(this).fd.lastModifiedTime;
  },

  // non standard
  get permissions() {
    return this.isSymbolicLink() ? _(this).fd.permissionsOfLink :
                                   _(this).fd.permissions;
  }
});
var FStat = Stats.extend({
  constructor: function Stats(descriptor) {
    _(this).fd = _(descriptor).fd;
  }
});

function Async(wrapped) {
  return function (path, callback) {
    let args = Array.slice(arguments);
    callback = args.pop();
    setTimeout(function() {
      try {
        callback(null, wrapped.apply(this, args));
      } catch (error) {
        callback(error);
      }
    }, 0);
  }
}


/**
 * Synchronous rename(2)
 */
exports.renameSync = function renameSync(source, target) {
  let source = new FileDescriptor(source);
  let target = new FileDescriptor(target);
  return source.moveTo(target.parent, target.leafName);
};
/**
 * Asynchronous rename(2). No arguments other than a possible exception are
 * given to the completion callback.
 */
exports.rename = Async(exports.renameSync);

/**
 * Synchronous ftruncate(2).
 */
exports.truncateSync = function truncateSync(fd, length) {
  throw new Error("Not implemented yet!!");
};
/**
 * Asynchronous ftruncate(2). No arguments other than a possible exception are
 * given to the completion callback.
 */
exports.truncate = Async(exports.truncateSync);

/**
 * Synchronous chmod(2).
 */
exports.chmodSync = function chmodSync (path, mode) {
  throw new Error("Not implemented yet!!");
};
/**
 * Asynchronous chmod(2). No arguments other than a possible exception are
 * given to the completion callback.
 */
exports.chmod = Async(exports.chmod);

/**
 * Synchronous stat(2). Returns an instance of `fs.Stats`
 */
exports.statSync = function statSync(path) {
  return new Stats(path);
};
/**
 * Asynchronous stat(2). The callback gets two arguments (err, stats) where
 * stats is a `fs.Stats` object. It looks like this:
 */
exports.stat = Async(exports.statSync);

/**
 * Synchronous lstat(2). Returns an instance of `fs.Stats`.
 */
exports.lstatSync = function lstatSync(path) {
  return new LStats(path);
};
/**
 * Asynchronous lstat(2). The callback gets two arguments (err, stats) where
 * stats is a fs.Stats object. lstat() is identical to stat(), except that if
 * path is a symbolic link, then the link itself is stat-ed, not the file that
 * it refers to.
 */
exports.lstat = Async(exports.lstartSync);

/**
 * Synchronous fstat(2). Returns an instance of `fs.Stats`.
 */
exports.fstatSync = function fstatSync(fd) {
  return new FStat(fd);
};
/**
 * Asynchronous fstat(2). The callback gets two arguments (err, stats) where
 * stats is a fs.Stats object.
 */
exports.fstat = Async(exports.fstatSync);

/**
 * Synchronous link(2).
 */
exports.linkSync = function linkSync(source, target) {
  throw new Error("Not implemented yet!!");
};
/**
 * Asynchronous link(2). No arguments other than a possible exception are given
 * to the completion callback.
 */
exports.link = Async(exports.linkSync);

/**
 * Synchronous symlink(2).
 */
exports.symlinkSync = function symlinkSync(source, target) {
  throw new Error("Not implemented yet!!");
};
/**
 * Asynchronous symlink(2). No arguments other than a possible exception are
 * given to the completion callback.
 */
exports.symlink = Async(exports.symlinkSync);

/**
 * Synchronous readlink(2). Returns the resolved path.
 */
exports.readlinkSync = function readlinkSync(path) {
  throw new Error("Not implemented yet!")
};
/**
 * Asynchronous readlink(2). The callback gets two arguments
 * `(error, resolvedPath)`.
 */
exports.readlink = Async(exports.readlinkSync);

/**
 * Synchronous realpath(2). Returns the resolved path.
 */
exports.realpathSync = function realpathSync(path) {
  return new FileDescriptor(path).path;
};
/**
 * Asynchronous realpath(2). The callback gets two arguments
 * `(err, resolvedPath)`.
 */
exports.realpath = Async(exports.realpathSync);

/**
 * Synchronous unlink(2).
 */
exports.unlinkSync = remove;
/**
 * Asynchronous unlink(2). No arguments other than a possible exception are
 * given to the completion callback.
 */
exports.unlink = Async(exports.unlinkSync);

/**
 * Synchronous rmdir(2).
 */
exports.rmdirSync = remove;
/**
 * Asynchronous rmdir(2). No arguments other than a possible exception are
 * given to the completion callback.
 */
exports.rmdir = Async(exports.rmdirSync);

/**
 * Synchronous mkdir(2).
 */
exports.mkdirSync = function mkdirSync(path, mode) {
  throw new Error("Not implemented");
};
/**
 * Asynchronous mkdir(2). No arguments other than a possible exception are
 * given to the completion callback.
 */
exports.mkdir = Async(exports.mkdirSync);

/**
 * Synchronous readdir(3). Returns an array of filenames excluding `'.'` and
 * `'..'`.
 */
exports.readdirSync = function readdirSync(path) {
  return toArray(FileDescriptor(path).directoryEntries).map(getFileName);
}
/**
 * Asynchronous readdir(3). Reads the contents of a directory. The callback
 * gets two arguments `(error, files)` where `files` is an array of the names
 * of the files in the directory excluding `'.'` and `'..'`.
 */
exports.readdir = Async(exports.readdirSync);

/**
 * Synchronous close(2).
 */
exports.closeSync = function closeSync(path) {
  throw new Error("Not implemented");
};
/**
 * Asynchronous close(2). No arguments other than a possible exception are
 * given to the completion callback.
 */
exports.close = Async(exports.closeSync);

/**
 * Synchronous open(2).
 */
exports.openSync = function openSync(path, flags, mode) {
  throw new Error("Not implemented yet!!");
}
/**
 * Asynchronous file open. See open(2). Flags can be
 * `'r', 'r+', 'w', 'w+', 'a'`, or `'a+'`. mode defaults to `0666`.
 * The callback gets two arguments `(error, fd).
 */
exports.open = Async(exports.openSync);

/**
 * Synchronous version of buffer-based fs.write(). Returns the number of bytes
 * written.
 */
exports.writeSync = function writeSync(fd, buffer, offset, length, position) {
  throw new Error("Not implemented");
};
/**
 * Write buffer to the file specified by fd.
 *
 * `offset` and `length` determine the part of the buffer to be written.
 *
 * `position` refers to the offset from the beginning of the file where this
 * data should be written. If `position` is `null`, the data will be written
 * at the current position. See pwrite(2).
 *
 * The callback will be given three arguments `(error, written, buffer)` where
 * written specifies how many bytes were written into buffer.
 *
 * Note that it is unsafe to use `fs.write` multiple times on the same file
 * without waiting for the callback.
 */
exports.write = Async(exports.writeSync);

/**
 * Synchronous version of string-based fs.read. Returns the number of
 * bytes read.
 */
exports.readSync = function readSync(fd, buffer, offset, length, position) {
  throw new Error("Not implemented");
}
/**
 * Read data from the file specified by `fd`.
 *
 * `buffer` is the buffer that the data will be written to.
 * `offset` is offset within the buffer where writing will start.
 *
 * `length` is an integer specifying the number of bytes to read.
 *
 * `position` is an integer specifying where to begin reading from in the file.
 * If `position` is `null`, data will be read from the current file position.
 *
 * The callback is given the three arguments, `(error, bytesRead, buffer)`.
 */
exports.read = function read(fd, buffer, offset, length, position, callback) {
  offset = offset || 0;
  fd = _(fd).fd;

  if (Buffer.isBuffer(buffer)) {
    [ offset, length, position, callback ] = Array.slice(arguments, 1);
    buffer = new Buffer(length);
  }
  let source = new FileInputStream(fd, fd.flags, fd.permissions, fd.DEFER_OPEN);
  let pump = new StreamPump(source, position, length, 0, 0, true);
  let bytesRead = 0;
  pump.asyncRead({
    onStartRequest: function onStartRequest() {},
    onDataAvailable: function onDataAvailable(request, context, inputStream, position, count) {
      try {
        bytesRead += count;
        buffer.write(StreamReader(inputStream).readByteArray(length), offset + position);
      } catch (error) {
        callback(error);
      }
    },
    onStopRequest: function onStopRequest() {
      callback(null, bytesRead, buffer);
    }
  }, null);
};

/**
 * Asynchronously reads the entire contents of a file.
 * The callback is passed two arguments `(error, data)`, where data is the
 * contents of the file.
 */
exports.readFile = function readFile(path, callback) {
  let buffer = new Buffer();
  let stream = new ReadStream(path);
    stream.on("data", function(chunck) {
    chunck.copy(buffer, buffer.length);
  });
  stream.on("error", callback);
  stream.on("end", callback.bind(null, null, buffer));
};

/**
 * Synchronous version of `fs.readFile`. Returns the contents of the path.
 * If encoding is specified then this function returns a string.
 * Otherwise it returns a buffer.
 */
exports.readFileSync = function readFileSync(path, encoding) {
  throw new Error("Not implemented");
};

/**
 * Asynchronously writes data to a file, replacing the file if it already
 * exists. data can be a string or a buffer.
 */
exports.writeFile = function writeFile(path, content, encoding, callback) {
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
};
/**
 * The synchronous version of `fs.writeFile`.
 */
exports.writeFileSync = function writeFileSync(filename, data, encoding) {
  throw new Error("Not implemented");
};

/**
 * Watch for changes on filename. The callback listener will be called each
 * time the file is accessed.
 *
 * The second argument is optional. The options if provided should be an object
 * containing two members a boolean, persistent, and interval, a polling value
 * in milliseconds. The default is { persistent: true, interval: 0 }.
 */
exports.watchFile = function watchFile(path, options, listener) {
  throw new Error("Not implemented");
};

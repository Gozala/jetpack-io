/* vim:set ts=2 sw=2 sts=2 expandtab */
"use strict";

const { setTimeout } = require("timer");
const { Stream } = require("./stream");
const { Buffer } = require("./buffer");
const { Extendable } = require("./extendables");
const { Cc, Ci, components: { Constructor: CC } } = require("chrome");
// `Namespace` declared by E4X so `const` fails.
let { Namespace } = require("./namespace");

const ioService = CC("@mozilla.org/network/io-service;1", "nsIIOService")();
const ioUtils = CC("@mozilla.org/io-util;1", "nsIIOUtil")();

const RawFile = CC("@mozilla.org/file/local;1", "nsILocalFile",
                          "initWithPath");
const FileOutputStream = CC("@mozilla.org/network/file-output-stream;1",
                            "nsIFileOutputStream", "init");
const FileInputStream = CC("@mozilla.org/network/file-input-stream;1",
                           "nsIFileInputStream", "init");
const StreamCopier = CC("@mozilla.org/network/async-stream-copier;1",
                        "nsIAsyncStreamCopier", "init");
const StringStream = CC("@mozilla.org/io/string-input-stream;1",
                        "nsIStringInputStream", "setData");

const BinaryInputStream = CC("@mozilla.org/binaryinputstream;1",
                             "nsIBinaryInputStream", "setInputStream");
const BinaryOutputStream = CC("@mozilla.org/binaryoutputstream;1",
                              "nsIBinaryOutputStream", "setOutputStream");
const StreamPump = CC("@mozilla.org/network/input-stream-pump;1",
                      "nsIInputStreamPump", "init");
const StreamPipe = CC("@mozilla.org/pipe;1", "nsIPipe", "init");

const { createOutputTransport, createInputTransport } =
  CC("@mozilla.org/network/stream-transport-service;1",
     "nsIStreamTransportService")();


const FILE_PERMISSION = parseInt("0666", 8);
const DEFER_OPEN = Ci.nsIFileInputStream.DEFER_OPEN || null;

const { DIRECTORY_TYPE, NORMAL_FILE_TYPE } = Ci.nsIFile;

const PR_UINT32_MAX = 0xfffffff;
// Values taken from:
// http://mxr.mozilla.org/mozilla-central/source/nsprpub/pr/include/prio.h#615
const PR_RDONLY =       0x01;
const PR_WRONLY =       0x02;
const PR_RDWR =         0x04;
const PR_CREATE_FILE =  0x08;
const PR_APPEND =       0x10;
const PR_TRUNCATE =     0x20;
const PR_SYNC =         0x40;
const PR_EXCL =         0x80;

const FLAGS = {
  "r":                  PR_RDONLY,
  "r+":                 PR_RDWR,
  "w":                  PR_CREATE_FILE | PR_TRUNCATE | PR_WRONLY,
  "w+":                 PR_CREATE_FILE | PR_TRUNCATE | PR_RDWR,
  "a":                  PR_APPEND | PR_CREATE_FILE | PR_WRONLY,
  "a+":                 PR_APPEND | PR_CREATE_FILE | PR_RDWR
};

const _ = new Namespace();

function isWritable(mode) { return !!(mode & PR_WRONLY || mode & PR_RDWR); }
function isReadable(mode) { return !!(mode & PR_RDONLY || mode & PR_RDWR); }

function isString(value) { return typeof value === "string"; }
function isFunction(value) { return typeof value === "function"; }

function toArray(enumerator) {
  let value = [];
  while(enumerator.hasMoreElements())
    value.push(enumerator.getNext())
  return value
}

function defer(wrapped) {
  return function deferred() {
    setTimeout(function(self, args) {
      wrapped.apply(self, args);
    }, 0, this, Array.slice(arguments));
  }
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
function remove(path, recursive) {
  return new RawFile(path).remove(recursive || false);
}
function Mode(mode, fallback) {
  return isString(mode) ? parseInt(mode) : mode || fallback;
}
function Flags(flag) {
  return !isString(flag) ? flag :
         FLAGS[flag] || new Error('Unknown file open flag: ' + flag);
}

const ReadStream = Stream.extend({
  constructor: function ReadStream(path, options) {
    options = options || {};

    if ('mode' in options && options.mode)
      this.mode = options.mode;
    if ('flags' in options && options.flags)
      this.flags = options.flags;
    if ('bufferSize' in options && options.bufferSize)
      this.bufferSize = options.bufferSize;
    if ('length' in options && options.length)
      this.length = options.length;
    if ('position' in options && options.position)
      this.position = options.position;

    let { flags, mode, position, length } = this;
    let { input } = _(isString(path) ? openSync(path, flags, mode) : path);
    // We use `nsIStreamTransportService` service to transform blocking
    // file input stream into a fully asynchronous stream that can be written
    // without blocking the main thread.
    let transport = createInputTransport(input, position, length, false);
    // Open an input stream on a transport. We don't pass flags to guarantee
    // non-blocking stream semantics. Also we use defaults for segment size &
    // count.
    let asyncInputStream = transport.openInputStream(null, 0, 0);
    _(this).asyncInputStream = asyncInputStream;
    let pump = StreamPump(asyncInputStream, position, length, 0, 0, false);
    _(this).pump = pump;
    let binaryInputStream = BinaryInputStream(asyncInputStream);
    _(this).binaryInputStream = binaryInputStream;
    this.read();
  },
  path: null,
  encoding: null,
  position: -1,
  length: -1,
  readable: true,
  paused: false,
  flags: 'r',
  mode: FILE_PERMISSION,
  bufferSize: 64 * 1024,
  get status() { return _(this).request.status; },
  setEncoding: function setEncoding(encoding) {
    this.encoding = String(encoding).toUpperCase();
  },
  read: function read() {
    let [ stream, { binaryInputStream, pump } ] = [ this, _(this) ];
    pump.asyncRead({
      onStartRequest: function onStartRequest() { stream.emit("start"); },
      onDataAvailable: function onDataAvailable(req, c, input, offset, count) {
        try {
          let bytes = binaryInputStream.readByteArray(count);
          stream.emit("data", new Buffer(bytes, stream.encoding));
        } catch (error) {
          stream.emit("error", error);
          stream.readable = false;
        }
      },
      onStopRequest: function onStopRequest() {
        stream.readable = false;
        stream.emit("end");
      }
    }, null);
  },
  pause: function pause() {
    this.paused = true;
    _(this).pump.suspend();
  },
  resume: function resume() {
    this.paused = false;
    _(this).pump.resume();
  },
  destroy: function destroy() {
    this.readable = false;
    try {
      this.emit("close", null);
      _(this).pump.cancel(null);
      delete _(this).pump;
      _(this).binaryInputStream.close();
      delete _(this).binaryInputStream;
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
  constructor: function WriteStream(path, options) {
    options = options || {};

    if ('flags' in options && options.flags)
      this.flags = options.flags;
    if ('mode' in options && options.mode)
      this.mode = options.flags;
    if ('position' in options && options.position !== undefined)
      this.position = options.position;

    try {
      let { mode, flags } = this;
      // If pass was passed we create a file descriptor out of it. Otherwise
      // we just use given file descriptor.
      let { output } = isString(path) ? openSync(path, flags, mode) : _(path);
      // We use `nsIStreamTransportService` service to transform blocking
      // file output stream into a fully asynchronous stream that can be written
      // without blocking the main thread.
      let transport = createOutputTransport(output, this.position, -1, false);
      // Open an output stream on a transport. We don't pass flags to guarantee
      // non-blocking stream semantics. Also we use defaults for segment size &
      // count.
      let asyncOutputStream = transport.openOutputStream(null, 0, 0);
      _(this).asyncOutputStream = asyncOutputStream;
      // Finally we create a non-blocking binary output stream. This will allows
      // us to write buffers as byte arrays without any further transcoding.
      let binaryOutputStream = BinaryOutputStream(asyncOutputStream);
      // Storing output stream so that it can be accessed later.
      _(this).binaryOutputStream = binaryOutputStream;
    } catch (error) {
      this.emit("error", error);
    }
  },
  writable: true,
  drainable: true,
  encoding: null,
  position: -1,
  flags: 'w',
  mode: FILE_PERMISSION,
  write: function write(content, encoding, callback) {
    let { asyncOutputStream, binaryOutputStream } = _(this);
    let stream = this;

    if (isFunction(encoding))
      [ callback, encoding ] = [ encoding, callback ];

    // Flag indicating whether or not content has been flushed to the kernel
    // buffer.
    let isWritten = false;
    // If stream is not writable we throw an error.
    if (!stream.writable)
      throw new Error('stream not writable');

    try {
      // If content is not a buffer then we create one out of it.
      if (!Buffer.isBuffer(content))
        content = new Buffer(content, encoding);

      // We write content as a byte array as this will avoid any transcoding
      // if content was a buffer.
      binaryOutputStream.writeByteArray(content.valueOf(), content.length);
      binaryOutputStream.flush();

      // Setting an `nsIOutputStreamCallback` to be notified when stream is
      // writable again. Which may be synchronously called before we return.
      asyncOutputStream.asyncWait({
        onOutputStreamReady: function onDrain() {
          // If callback is called earlier then outer function returned then
          // we know that stream is writable so users don't need to wait for
          // "drain" events. In such cases node returns `true` so we override
          // `isWritable` to let caller know they can continue writing to this
          // stream.
          isWritten = stream.writable = true;
          stream.emit("drain");
          // Calling a callback if one was passed.
          if (callback)
            callback();
        }
      }, 0, 0, null);
      // Using `nsIOutputStreamCallback` with a special flag that overrides
      // the default behavior causing the `OnOutputStreamReady` notification
      // to be suppressed until the  stream becomes closed (either as a result of
      // closeWithStatus/close being called on the stream or possibly due to
      // some error in the underlying stream).
      asyncOutputStream.asyncWait({
        onOutputStreamReady: function onClose() {
          stream.writable = false;
          stream.emit("close", null);
        }
      }, asyncOutputStream.WAIT_CLOSURE_ONLY, 0, null);
      // Return `true` if the string has been flushed to the kernel buffer.
      // Return false to indicate that the kernel buffer is full, and the data
      // will be sent out in the future.
      return isWritten;
    } catch (error) {
      // If errors occur we emit appropriate event.
      stream.emit("error", error);
    }
  },
  flush: function flush() {
    _(this).binaryOutputStream.flush();
  },
  end: function end(content, encoding, callback) {
    if (isFunction(content))
      [ callback, content ] = [ content, callback ];
    if (isFunction(encoding))
      [ callback, encoding ] = [ encoding, callback ];

    // Setting a listener to "close" event if passed.
    if (isFunction(callback))
      this.once("close", callback);

    // If content is passed then we defer closing until we finish with writing.
    if (content)
      this.write(content, encoding, end.bind(this));
    // If we don't write anything, then we close an outputStream.
    else
      _(this).asyncOutputStream.close();
  },
  destroy: function destroy(callback) {
    try {
      this.end(callback);
      delete _(this).asyncOutputStream;
      delete _(this).binaryOutputStream;
    } catch (error) {
      this.emit("error", error);
    }
  },
  destroySoon: function destroySoon() {
    this.destroy();
  }
});
exports.WriteStream = WriteStream;
exports.createWriteStream = function createWriteStream(path, options) {
  return new WriteStream(path, options);
};

var Stats = Extendable.extend({
  constructor: function Stats(path) {
    _(this).rawFile = new RawFile(path);
  },
  isDirectory: function isDirectory() {
    return _(this).rawFile.isDirectory();
  },
  isFile: function isFile() {
    return _(this).rawFile.isFile();
  },
  isSymbolicLink: function isSymbolicLink() {
    return _(this).rawFile.isSymlink();
  },


  get mode() {
    return _(this).rawFile.permissions;
  },
  get size() {
    return _(this).rawFile.fileSize;
  },
  get mtime() {
    return _(this).rawFile.lastModifiedTime;
  },

  isBlockDevice: function isBlockDevice() {
    return _(this).rawFile.isSpecial();
  },
  isCharacterDevice: function isCharacterDevice() {
    return _(this).rawFile.isSpecial();
  },
  isFIFO: function isFIFO() {
    return _(this).rawFile.isSpecial();
  },
  isSocket: function isSocket() {
    return _(this).rawFile.isSpecial();
  },

  // non standard
  get exists() {
    return _(this).rawFile.exists();
  },
  get hidden() {
    return _(this).rawFile.isHidden();
  },
  get writable() {
    return _(this).rawFile.isWritable();
  },
  get readable() {
    return _(this).rawFile.isReadable();
  }
});
exports.Stats = Stats;

var LStats = Stats.extend({
  get size() {
    return this.isSymbolicLink() ? _(this).rawFile.fileSizeOfLink :
                                   _(this).rawFile.fileSize;
  },
  get mtime() {
    return this.isSymbolicLink() ? _(this).rawFile.lastModifiedTimeOfLink :
                                   _(this).rawFile.lastModifiedTime;
  },

  // non standard
  get permissions() {
    return this.isSymbolicLink() ? _(this).rawFile.permissionsOfLink :
                                   _(this).rawFile.permissions;
  }
});
var FStat = Stats.extend({
  constructor: function Stats(fd) {
    _(this).rawFile = _(fd).rawFile;
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
  let source = new RawFile(source);
  let target = new RawFile(target);
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
  return RawFile(path).create(NORMAL_FILE_TYPE, PR_TRUNCATE | PR_CREATE_FILE);
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
  return new RawFile(path).target;
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
  return new RawFile(path).path;
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
  return RawFile(path).create(DIRECTORY_TYPE, Mode(mode));
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
  return toArray(new RawFile(path).directoryEntries).map(getFileName);
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
exports.closeSync = function closeSync(fd) {
  fd = _(fd);

  delete fd.rawFile;
  // Closing input stream and removing reference.
  if (fd.input)
    fd.close();
  delete fd.input;
  // Closing output stream and removing reference.
  if (fd.output)
    fd.close();
  delete fd.output;
};
/**
 * Asynchronous close(2). No arguments other than a possible exception are
 * given to the completion callback.
 */
exports.close = Async(exports.closeSync);

/**
 * Synchronous open(2).
 */
function openSync(path, flags, mode) {
  let [ fd, flags, mode, rawFile ] =
      [ { path: path }, Flags(flags), Mode(mode), RawFile(path) ];

  _(fd).rawFile = rawFile;
  // If we want to open file in read mode we initialize input stream.
  _(fd).input = isReadable(flags) ?
                FileInputStream(rawFile, flags, mode, DEFER_OPEN) : null;

  // If we want to open file in write mode we initialize output stream for it.
  _(fd).output = isWritable(flags) ?
                 FileOutputStream(rawFile, flags, mode, DEFER_OPEN) : null;

  return fd;
}
exports.openSync = openSync;
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
exports.write = function write(fd, buffer, offset, length, position, callback) {
  if (!Buffer.isBuffer(buffer)) {
    // (fd, data, position, encoding, callback)
    let encoding = null;
    [ position, encoding, callback ] = Array.slice(arguments, 1);
    buffer = new Buffer(String(buffer), encoding);
    offset = 0;
  } else if (length + offset > buffer.length) {
    throw new Error("Length is extends beyond buffer");
  } else if (length + offset !== buffer.length) {
    buffer = buffer.slice(offset, offset + length);
  }

  let { mode, flags } = _(fd);
  let writeStream = new WriteStream(fd, {
    mode: mode,
    flags: flags
  });
  writeStream.on("error", callback);
  writeStream.write(buffer, function onEnd() {
    writeStream.destroy();
    if (callback)
      callback(null, buffer.length, buffer);
  });
};

/**
 * Synchronous version of string-based fs.read. Returns the number of
 * bytes read.
 */
exports.readSync = function readSync(fd, buffer, offset, length, position) {
  throw new Error("Not implemented");
};
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
  if (!Buffer.isBuffer(buffer)) { // (fd, length, position, encoding, callback)
    [ length, position, encoding, callback ] = Array.slice(arguments, 1);
    buffer = new Buffer(length, encoding);
  }
  let bytesRead = 0;
  let readStream = new ReadStream(fd, { position: position, length: length });
  readStream.on("data", function onData(chunck) {
      chunck.copy(buffer, offset + bytesRead);
      bytesRead += buffer.length;
      if (bytesRead >= length) {
        callback(null, bytesRead, buffer);
      }
  });
};

/**
 * Asynchronously reads the entire contents of a file.
 * The callback is passed two arguments `(error, data)`, where data is the
 * contents of the file.
 */
exports.readFile = function readFile(path, encoding, callback) {
  if (isFunction(encoding))
    [ callback, encoding ] = [ encoding, null ];

  let buffer = new Buffer();
  let readStream = new ReadStream(path);
  readStream.on("data", function(chunck) {
    chunck.copy(buffer, buffer.length);
  });
  readStream.on("error", function onError(error) {
    callback(error);
    readStream.destroy();
  });
  readStream.on("end", function onEnd() {
    callback(null, buffer);
    readStream.destroy();
  });
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
    if (isFunction(encoding))
      [ callback, encoding ] = [ encoding, null ];
    if (isString(content))
      content = new Buffer(content, encoding);

    let writeStream = new WriteStream(path);
    writeStream.on("error", function onError(error) {
      callback(error);
      writeStream.destroy();
    });
    writeStream.write(content, function onDrain() {
      callback(null);
      writeStream.destroy();
    });
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

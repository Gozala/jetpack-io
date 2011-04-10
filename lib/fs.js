/* vim:set ts=2 sw=2 sts=2 et: */
/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Initial Developer of the Original Code is
 * the Mozilla Foundation.
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Irakli Gozalishvili <rfobic@gmail.com> (Original Author)
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

"use strict";

const { Cc, Ci, components: { Constructor: CC } } = require("chrome");
const { setTimeout } = require("timer");
const { Stream } = require("stream");
const { Buffer } = require("buffer");
const ioService = Cc["@mozilla.org/network/io-service;1"].
                  getService(Ci.nsIIOService);

const FileDescriptor = CC("@mozilla.org/file/local;1",
              "nsILocalFile", "initWithPath");
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


function ReadStream(path) {
  let fd = FileDescriptor(path);
  let channel = getFileChannel(fd);
  let emit = this._emit.bind(this);
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
}
ReadStream.prototype = Object.create(Stream.prototype, {
  constructor: {
    value: ReadStream
  },
  readable: {
    value: true,
    writable: true,
    enumerable: true
  },
  setEncoding: {
    value: function setEncoding(encoding) {
      this.encoding = String(encoding).toUpperCase();
    }
  },
  pause: {
    value: function pause() {
    }
  },
  resume: {
    value: function resume() {
    }
  },
  destroy: {
    value: function destroy() {
    }
  }
});

function WriteStream(path) {
  let emit = this._emit.bind(this);
  let _ = {
    fd: new FileDescriptor(path),
    observer: {
      onStartRequest: function onStartRequest() { emit("start"); },
      onStopRequest: function onStopRequest() { emit("drain"); }
    }
  };
  this.valueOf = function valueOf(key) { return key === KEY ? _ : this; };
}
WriteStream.prototype = Object.create(Stream.prototype, {
  constructor: {
    value: WriteStream
  },
  writable: {
    value: true,
    writable: true,
    enumerable: true
  },
  write: {
    value: function write(content) {
      let { fd, observer } = this.valueOf(KEY);
      let copier = new StreamCopier();
      let target = new FileOutputStream();
      target.init(fd, 0x04 | 0x08 | 0x20, parseInt("0666"),
                  target.DEFER_OPEN);
      let source = new StringStream(content, content.length);
      copier.init(source, target, null, true, false, null, true, true);
      copier.asyncCopy(observer, null);
    },
    enumerable: true
  },
  end: {
    value: function end(content, encoding) {
    },
    enumerable: true
  },
  destroy: {
    value: function destroy() {
    }
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
    if (!callback) {
      callback = encoding;
      encoding = undefined;
    }

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

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
const { EventEmitterTrait: EventEmitter } = require("events");
const { Buffer } = require("buffer");
const ioService = Cc["@mozilla.org/network/io-service;1"].
                  getService(Ci.nsIIOService);

const StreamLoader = CC("@mozilla.org/network/stream-loader;1",
                        "nsIStreamLoader", "init");
const StreamListener = CC("@mozilla.org/network/simple-stream-listener;1",
                          "nsISimpleStreamListener", "init");
const RawPump = CC("@mozilla.org/network/input-stream-pump;1",
                "nsIInputStreamPump", "init");
const FileDescriptor = CC("@mozilla.org/file/local;1",
              "nsILocalFile", "initWithPath");
const StreamReader = CC("@mozilla.org/binaryinputstream;1",
                        "nsIBinaryInputStream", "setInputStream");

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


function Pump(inputStream) {
  var pump = new RawPump(inputStream, -1, -1, 0, 0, false);
  return pump;
}

function Stream(channel) {
  return this instanceof Stream ? this : Object.create(Stream.prototype);
}
Stream.prototype = EventEmitter.create(Stream.prototype);
Object.defineProperties(Stream.prototype, {
  open: { value: function open(channel) {
    let emit = this._emit.bind(this);
    channel.asyncOpen({
      onDataAvailable: function onData(request, context, inputStream, offset, length) {
        try {
          emit("data", new Buffer(StreamReader(inputStream).readByteArray(length)));
        } catch (error) {
          emit("error", error);
        }
      },
      onStartRequest: function onStartRequest() { emit("start"); },
      onStopRequest: function onStopRequest() { emit("end"); }
    }, null);
  }}
});

function readFile(path, encoding) {
  
}

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
  let fd = FileDescriptor(path);
  let channel = getFileChannel(fd);
  let stream = Stream();
  let buffer = Buffer();
  exports.stream = stream;
  stream.open(channel);
  stream.on("data", function(chunck) {
    chunck.copy(buffer, buffer.length);
  });
  stream.on("error", callback);
  stream.on("end", callback.bind(null, null, buffer));
}
exports.readFile = readFile;

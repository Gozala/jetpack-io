/* vim:set ts=2 sw=2 sts=2 expandtab */
/*jshint undef: true es5: true node: true devel: true, globalstrict: true
         forin: true latedef: false supernew: true */
/*global define: true */

"use strict";

const { EventEmitter } = require("./events");
exports.Stream = EventEmitter.extend({
  constructor: function Stream() {}
});

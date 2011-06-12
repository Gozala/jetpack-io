/* vim:set ts=2 sw=2 sts=2 expandtab */
/*jshint newcap: true undef: true es5: true node: true devel: true forin: true
         latedef: false supernew: true */
/*global define: true */

(typeof define === "undefined" ? function ($) { $(require, exports, module); } : define)(function (require, exports, module, undefined) {

"use strict";

function getOwnPropertyDescriptors(object) {
  var descriptors = {};
  Object.getOwnPropertyNames(object).forEach(function(name) {
    descriptors[name] = Object.getOwnPropertyDescriptor(object, name);
  });
  return descriptors;
}

/**
 * Returns `true` if given object has a given `namespace`.
 */
function hasNamespace(object, namespace) {
  return object.valueOf(namespace).namespace === namespace;
}
exports.hasNamespace = hasNamespace;

function createNamespace(object, namespace) {
  var descriptors = getOwnPropertyDescriptors(namespace.prototype);
  descriptors.namespace = { value: namespace };
  return Object.create(object, descriptors);
}

/**
 *
 */
function defineNamespace(object, namespace) {
  var base = object.valueOf;
  var names = namespace || new Namespace;
  var namespaced = createNamespace(object, names);
  return Object.defineProperties(object, {
    valueOf: {
      value: function valueOf(namespace) {
        return namespace === names ? namespaced : base.apply(object, arguments);
      },
      configurable: true
    }
  }).valueOf(names);
}

/**
 * Function creates a new namespace. Optionally object `properties` may be
 * passed which will be defined under the given namespace.
 */
function Namespace(prototype) {
  // Creating a `namespace` function that may be called on any object to return
  // a version with a properties in the given namespace.
  function namespace(object) {
    return hasNamespace(object, namespace) ? object.valueOf(namespace) :
           defineNamespace(object, namespace);
  }
  namespace.prototype = prototype || namespace.prototype;
  return namespace;
}
Namespace.hasNamespace = hasNamespace;
exports.Namespace = Namespace;

});

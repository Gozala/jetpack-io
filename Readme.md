# This is in process of being intergrated into SDK:
https://github.com/mozilla/addon-sdk/pull/646

# fs #

NodeJS filesystem API for Jetpack.

## Install ##

To use this package you will need [npm][http://npmjs.org/] and [graphquire].

    git clone git://github.com/Gozala/jetpack-io.git
    cd jetpack-io
    npm install graphquire -g
    npm link

## Use ##

You can use this package with a help of [graphquire]. To do so just use one of
the following requires in your module:

    require('https://raw.github.com/Gozala/jetpack-io/v0.1.0/fs.js')
    require('https://raw.github.com/Gozala/jetpack-io/v0.1.0/net.js')
    require('https://raw.github.com/Gozala/jetpack-io/v0.1.0/stream.js')

And make sure to run `npm link` in your project before running.

Alternatively you can install package as described in a previous section and
use this it as a dependency.

[graphquire]:https://github.com/Gozala/graphquire/

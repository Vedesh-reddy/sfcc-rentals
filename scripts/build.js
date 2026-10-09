'use strict';

const path = require('path');
const webpack = require('webpack');

const cartridge = path.resolve(__dirname, '../cartridges/plugin_rentals/cartridge');

// The bundle only adds the date quote and the size-trial form; it needs no framework.
const compiler = webpack({
    mode: 'production',
    entry: path.join(cartridge, 'client/default/js/rentals.js'),
    output: { path: path.join(cartridge, 'static/default/js'), filename: 'rentals.js' }
});

compiler.run(function (error, stats) {
    compiler.close(function (closeError) {
        if (error || closeError || stats.hasErrors()) {
            console.error(error || closeError || stats.toString({ all: false, errors: true }));
            process.exitCode = 1;
            return;
        }
        console.log('Built rentals.js in cartridge/static/default/js.');
    });
});

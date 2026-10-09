'use strict';

const fs = require('fs');
const path = require('path');
const linter = require('isml-linter');
const config = require('../ismllinter.config');

let total = 0;
let issues = 0;

function inspect(directory) {
    fs.readdirSync(directory, { withFileTypes: true }).forEach(function (entry) {
        const filename = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            inspect(filename);
        } else if (filename.endsWith('.isml')) {
            const result = linter.parse(filename, fs.readFileSync(filename, 'utf8'), Object.assign({}, config, {
                enableCache: false
            }));
            total += result.totalTemplatesQty;
            issues += result.issueQty;
            if (result.issueQty) console.error(filename, JSON.stringify(result));
        }
    });
}

inspect(path.resolve(__dirname, '../cartridges/plugin_rentals/cartridge/templates'));
if (total !== 7) throw new Error('Expected to inspect all 7 ISML templates; checked ' + total);
console.log('ISML templates checked: ' + total + '; issues: ' + issues);
process.exitCode = issues ? 1 : 0;

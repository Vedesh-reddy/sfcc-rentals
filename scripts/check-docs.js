'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
let checked = 0;
let failures = 0;

function inspect(directory) {
    fs.readdirSync(directory, { withFileTypes: true }).forEach(function (entry) {
        if (['node_modules', '.git', 'dist'].indexOf(entry.name) !== -1) return;
        const filename = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            inspect(filename);
        } else if (entry.name.endsWith('.md')) {
            // Code fences show markup to copy, not links to check.
            const source = fs.readFileSync(filename, 'utf8').replace(/```[\s\S]*?```/g, '');
            const expressions = [/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, /(?:src|href)="([^"]+)"/g];
            expressions.forEach(function (expression) {
                let match = expression.exec(source);
                while (match) {
                    const target = match[1];
                    if (!/^(?:https?:|mailto:|#)/.test(target)) {
                        const local = decodeURIComponent(target.split('#')[0]);
                        checked++;
                        if (!fs.existsSync(path.resolve(path.dirname(filename), local))) {
                            failures++;
                            console.error(path.relative(root, filename) + ': missing link target ' + local);
                        }
                    }
                    match = expression.exec(source);
                }
            });
        }
    });
}

inspect(root);
console.log('Local documentation and image links checked: ' + checked + '; missing: ' + failures);
process.exitCode = failures ? 1 : 0;

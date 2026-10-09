'use strict';

const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const root = path.resolve(__dirname, '..');
const directory = path.join(root, 'dist');
fs.mkdirSync(directory, { recursive: true });
const destination = path.join(directory, 'rentals-metadata.zip');
const output = fs.createWriteStream(destination);
const archive = archiver('zip', { zlib: { level: 9 } });

output.on('close', function () {
    console.log('Created dist/rentals-metadata.zip (' + archive.pointer() + ' bytes).');
});
output.on('error', function (error) { throw error; });
archive.on('error', function (error) { throw error; });
archive.on('warning', function (error) { throw error; });
archive.pipe(output);
// The whole site archive: metadata, jobs and the per-site preference values.
archive.directory(path.join(root, 'metadata/rentals'), 'rentals');
archive.finalize();

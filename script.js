#!/usr/bin/env node
'use strict';
const runServer = require('./index');

if (process.argv.length !== 3 || ['dev', 'dist'].indexOf(process.argv[2]) < 0) {
  console.log('Usage: node server.js [dev|dist]');
  process.exit(1);
}

runServer(process.argv[2] === 'dist');

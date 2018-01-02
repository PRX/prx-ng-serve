'use strict';
const dotenv   = require('dotenv');
const fs       = require('fs');
const path     = require('path');
const pug      = require('pug');
const newrelic = require('newrelic');
const spawn    = require('child_process').spawn
const getport  = require('get-port');
const APP_ROOT = path.resolve(__dirname).split('/node_modules')[0];

// TODO: parameterize
const APP_EXAMPLE = `${APP_ROOT}/env-example`;
const APP_ENV     = `${APP_ROOT}/.env`;
const APP_DIST    = `${APP_ROOT}/dist`;
const APP_INDEX   = `${APP_ROOT}/src/index.pug`;
const APP_NG      = `${APP_ROOT}/node_modules/.bin/ng`;
const SERVER_ENVS = ['HOST', 'PORT', 'NEW_RELIC_APP_NAME', 'NEW_RELIC_LICENSE_KEY'];

/**
 * Read dotenv (.env + ENV)
 */
exports.readEnv = (forServer) => {
  let exampleKeys = [];
  try {
    exampleKeys = Object.keys(dotenv.parse(fs.readFileSync(APP_EXAMPLE)));
  } catch (err) {}

  let dots = {};
  try {
    let dottext = fs.readFileSync(APP_ENV);
    dots = dotenv.parse(dottext);
  } catch (err) {}

  let env = {};
  let isDefined = (k) => process.env[k] !== undefined || (dots[k] && dots[k] !== '');
  for (let key of exampleKeys) {
    if (isDefined(key) && (forServer || SERVER_ENVS.indexOf(key) < 0)) {
      let val = process.env[key] || dots[key];
      if (val === 'true') {
        env[key] = true;
      } else if (val === 'false') {
        env[key] = false;
      } else if (isNaN(val) || val == '') {
        env[key] = val;
      } else {
        env[key] = parseInt(val);
      }
    }
  }
  return env;
};

/**
 * Find the script tags to include
 */
exports.findScripts = (isDist) => {
  let names = ['inline', 'polyfills', 'vendor', 'main'];
  let scripts = [];

  // styles are js-bundled in dev
  if (!isDist) {
    names.splice(2, 0, 'styles');
  }

  // scripts are optional
  let cliJson = require(`${APP_ROOT}/.angular-cli.json`);
  if (cliJson && cliJson.apps.some(a => a.scripts.length > 0)) {
    names.splice(2, 0, 'scripts');
  }

  // figure out actual filenames
  if (isDist) {
    let distFiles = [];
    try { distFiles = fs.readdirSync(APP_DIST); } catch (e) {}
    scripts = names.map(n => {
      return distFiles.find(f => f.match(/\.bundle\.js$/) && f.split('.')[0] === n);
    }).filter(s => s);
  } else {
    scripts = names.map(n => `${n}.bundle.js`);
  }

  if (scripts.length !== names.length) {
    console.error('ERROR: could not find built scripts in ./dist/');
    console.error('       did you forget to run npm build?');
    process.exit(1);
  }
  return scripts;
};

/**
 * Find inline css to include (dist only)
 */
exports.findStyles = (isDist) => {
  let styles = [];
  if (isDist) {
    let distFiles = [];
    try { distFiles = fs.readdirSync(APP_DIST); } catch (e) {}
    styles = distFiles.filter(f => f.match(/\.bundle\.css$/));
  }
  return styles;
};

/**
 * Compile the index
 */
exports.buildIndex = (isDist) => {
  let tpl = cache('html', isDist, () => pug.compileFile(APP_INDEX));
  let data = {
    env: cache('env', isDist, () => exports.readEnv()),
    js:  cache('js',  isDist, () => exports.findScripts(isDist)),
    css: cache('css', isDist, () => exports.findStyles(isDist))
  };

  // DON'T cache newrelic header (will be disabled if NR ENVs aren't set)
  data.newRelicHeader = newrelic.getBrowserTimingHeader();
  return tpl(data);
};

/**
 * Determine if a request looks like a path (vs a file)
 */
exports.isIndex = (path) => {
  if (path.match(/^\/sockjs-node/)) {
    return false;
  } else if (path === '/' || path === '/index.html') {
    return true;
  } else {
    let lastToken = path.substr(path.lastIndexOf('/') + 1).split(/\?|;/)[0];
    return lastToken.indexOf('.') === -1;
  }
};

/**
 * Spawn a process to run ng serve on a random open port
 */
exports.ngServe = (publicHost, callback) => {
  getport().then(port => {
    spawn(APP_NG, ['serve', '--port', port, '--public-host', publicHost], {stdio: 'inherit'});
    callback(port);
  });
};

/**
 * Cache helper
 */
 const CACHED = {};
 function cache(key, useCached, cacheFn) {
   if (useCached && CACHED[key]) {
     return CACHED[key];
   } else {
     return CACHED[key] = cacheFn();
   }
 }

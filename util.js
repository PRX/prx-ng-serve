'use strict';
const dotenv   = require('dotenv');
const fs       = require('fs');
const spawn    = require('child_process').spawn
const getport  = require('get-port');
const APP_ROOT = process.cwd();

// TODO: parameterize
const APP_EXAMPLE = `${APP_ROOT}/env-example`;
const APP_ENV     = `${APP_ROOT}/.env`;
const APP_DIST    = `${APP_ROOT}/dist`;
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
 * Compile the index from file
 */
exports.buildIndex = () => {
  let html;
  try {
    html = fs.readFileSync(`${APP_DIST}/index.html`).toString('utf-8');
  } catch (e) {
    console.error('ERROR: could not find built index.html in ./dist/');
    console.error('       did you forget to run npm build?');
    process.exit(1);
  }
  return exports.injectIndex(html);
}

/**
 * Rewrite a proxied response as it happens
 */
exports.rewriteProxyIndex = (proxyRes, req, res) => {
  const data = [];
  proxyRes.on('data', d => data.push(d));
  proxyRes.on('end', () => {
    res.status(proxyRes.statusCode);
    Object.keys(proxyRes.headers).forEach(k => {
      res.append(k, proxyRes.headers[k]);
    });
    res.send(exports.injectIndex(Buffer.concat(data).toString()));
    res.end();
  });
}

/**
 * Inject ENVs into the index.html string
 */
exports.injectIndex = (html) => {
  const { NEW_RELIC_APP_NAME, NEW_RELIC_LICENSE_KEY } = exports.readEnv(true);
  if (NEW_RELIC_LICENSE_KEY) {
    process.env.NEW_RELIC_APP_NAME = NEW_RELIC_APP_NAME;
    process.env.NEW_RELIC_LICENSE_KEY = NEW_RELIC_LICENSE_KEY;
    const newRelicTag = require('newrelic').getBrowserTimingHeader() || '';
    html = html.replace('</head>', newRelicTag + '</head>');
  }

  const envJson = JSON.stringify(exports.readEnv())
  const envTag = `<script type="text/javascript">window.ENV=${envJson}</script>`;
  html = html.replace('</body>', envTag + '</body>');

  return html;
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
    const proc = spawn(APP_NG, ['serve', '--port', port, '--public-host', publicHost, '--disable-host-check'], {stdio: 'inherit'});
    process.on('exit', () => proc.kill('SIGINT'))
    callback(port);
  });
};

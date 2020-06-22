'use strict';
const express  = require('express');
const proxy    = require('http-proxy-middleware');
const gzip     = require('connect-gzip-static');
const morgan   = require('morgan');
const util     = require('./util');

module.exports = function runServer(isDist, middlewareFn) {
  let app = express();
  let env = util.readEnv(true);
  let port = parseInt(env.PORT || process.env.PORT || 4200);
  app.use(morgan('combined', { skip: req => !util.isIndex(req.path) }));

  // actual listener (called async in dev mode)
  function startListening() {
    app.listen(port);
    console.log('+---------------------------+');
    console.log(`| express listening on ${port} |`);
    console.log('+---------------------------+\n');
  }

  // optionally insert middleware
  if (middlewareFn) {
    middlewareFn(app);
  }

  // proxy CMS public urls (302s) to avoid CORS problems on audio playback
  if (env.CMS_HOST) {
    let url = env.CMS_HOST;
    if (!url.startsWith('http')) {
      url = url.match(/\.docker$/) ? `http://${url}` : `https://${url}`;
    }
    app.use('/pub', proxy({target: url, changeOrigin: true, logLevel: 'warn'}));
  }

  // redirect to https for index requests
  app.use(function redirectHttps(req, res, next) {
    if (util.isIndex(req.path) && req.headers['x-forwarded-proto'] === 'http' && !req.headers['host'].match(/\.docker/)) {
      res.redirect(`https://${req.headers.host}${req.url}`);
    } else {
      next();
    }
  });

  // serve static files from dist, or proxy to "ng serve"
  if (isDist) {
    let serveStatic = gzip('dist');
    let indexHtml = util.buildIndex()
    app.use(function serveIndex(req, res, next) {
      if (util.isIndex(req.path)) {
        res.setHeader('Content-Type', 'text/html');
        res.setHeader('Content-Length', indexHtml.length);
        res.send(indexHtml);
      } else {
        next();
      }
    });
    app.use(function serveAssets(req, res, next) {
      serveStatic(req, res, next);
    });
    app.use(function fileNotFound(req, res, next) {
      res.status(404).send('Not found');
    });
    startListening();
  } else if (env.HOST || process.env.HOST) {
    util.ngServe(env.HOST || process.env.HOST, function serveDev(ngServePort) {
      let target = `http://127.0.0.1:${ngServePort}`
      app.use(proxy(util.isIndex, {target, logLevel: 'warn', selfHandleResponse: true, onProxyRes: util.rewriteProxyIndex}))
      app.use(proxy({target, logLevel: 'warn', ws: true}))
      startListening();
    });
  } else {
    throw new Error('You must set a HOST to run the dev server');
  }
}

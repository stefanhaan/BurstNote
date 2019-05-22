'use strict';

const { logProcess } = require('./dev-functions');

const chalk = require('chalk');
const electron = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const webpack = require('webpack');
const WebpackDevServer = require('webpack-dev-server');
const webpackHotMiddleware = require('webpack-hot-middleware');

const mainConfig = require('./webpack.main.config');
const rendererConfig = require('./webpack.renderer.config');

let electronProcess = null;
let manualRestart = false;
let hotMiddleware;
//
// function logStats (proc, data, color) {
//   let log = '';
//
//   log += color.bold(`┏ ${proc} Process ${new Array((19 - proc.length) + 1).join('-')}`);
//   log += '\n\n';
//
//   if (typeof data === 'object') {
//     data.toString({
//       colors: true,
//       chunks: false
//     }).split(/\r?\n/).forEach(line => {
//       log += '  ' + line + '\n'
//     })
//   } else {
//     log += `  ${data}\n`
//   }
//
//   log += '\n' + color.bold(`┗ ${new Array(28 + 1).join('-')}`) + '\n';
//
//   console.log(log);
// }

function startRenderer () {
  return new Promise((resolve, reject) => {
    rendererConfig.entry.renderer = [path.join(__dirname, 'dev-client')].concat(rendererConfig.entry.renderer);
    rendererConfig.mode = 'development';

    const compiler = webpack(rendererConfig);
    hotMiddleware = webpackHotMiddleware(compiler, {
      log: false,
      heartbeat: 2500
    });

    compiler.hooks.watchRun.tapAsync('watch-run', (data, cb) => {
      logProcess('Renderer', 'Compiling...', chalk.blue);
      cb();
    });

    compiler.hooks.compilation.tap('compilation', compilation => {
      compilation.hooks.htmlWebpackPluginAfterEmit.tapAsync('html-webpack-plugin-after-emit', (data, cb) => {
        hotMiddleware.publish({ action: 'reload' });
        cb();
      })
    });

    compiler.hooks.done.tap('done', stats => {
      logProcess('Renderer', stats, chalk.blue);
    });

    const server = new WebpackDevServer(
      compiler,
      {
        contentBase: path.join(__dirname, '../../'),
        quiet: true,
        before (app, ctx) {
          app.use(hotMiddleware);
          ctx.middleware.waitUntilValid(() => {
            resolve()
          })
        }
      }
    );

    server.listen(9080)
  })
}

function startMain () {
  return new Promise((resolve, reject) => {
    mainConfig.mode = 'development';
    const compiler = webpack(mainConfig);

    compiler.hooks.watchRun.tapAsync('watch-run', (compilation, done) => {
      logProcess('Main', "Compiling...", chalk.yellow);
      hotMiddleware.publish({ action: 'compiling' });
      done()
    });

    compiler.watch({}, (err, stats) => {
      if (err) {
        console.log(err);
        return
      }

      logProcess('Main', stats, chalk.yellow);

      if (electronProcess && electronProcess.kill) {
        manualRestart = true;
        process.kill(electronProcess.pid);
        electronProcess = null;
        startElectron();

        setTimeout(() => {
          manualRestart = false
        }, 5000)
      }

      resolve()
    })
  })
}

function startElectron () {
  var args = [
    '--inspect=5858',
    path.join(__dirname, '../../dist/main.js')
  ];

  // detect yarn or npm and process commandline args accordingly
  if (process.env.npm_execpath.endsWith('yarn.js')) {
    args = args.concat(process.argv.slice(3))
  } else if (process.env.npm_execpath.endsWith('npm-cli.js')) {
    args = args.concat(process.argv.slice(2))
  }

  electronProcess = spawn(electron, args);
  
  electronProcess.stdout.on('data', data => {
    logProcess('Electron', data, chalk.orange);
  });
  electronProcess.stderr.on('data', data => {
    logProcess('Electron', data, chalk.red);
  });

  electronProcess.on('close', () => {
    if (!manualRestart) process.exit()
  })
}

function greeting () {
  console.log(chalk.blue.bold('Booting BurstNote dev environment') + '\n')
}

function init () {
  greeting();

  Promise.all([startRenderer(), startMain()])
    .then(() => {
      startElectron()
    })
    .catch(err => {
      console.error(err)
    })
}

init();
'use strict';

// App lifecycle: window creation, the `qaflow-media` custom protocol, and
// REST API boot. IPC wiring lives in ipc.js; the contextBridge surface
// lives in preload.js. This file is the only one that knows about the
// BrowserWindow / protocol / app singleton.

const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, protocol } = require('electron');

const { createStore } = require('../engine/store.js');
const { createApi } = require('../engine/api.js');
const { runSuite } = require('../engine/runner.js');
const { registerIpc } = require('./ipc.js');

const isSmoke = process.argv.includes('--smoke');

protocol.registerSchemesAsPrivileged([
  { scheme: 'qaflow-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

const baseDir = path.join(app.getPath('userData'), 'qaflow-data');
const store = createStore(baseDir);

let mainWindow = null;

function registerMediaProtocol() {
  protocol.handle('qaflow-media', (request) => {
    const url = new URL(request.url);
    const runId = url.hostname;
    // Leading slash on pathname — strip it, then reject any traversal
    // outside the run directory (e.g. `../../secrets.json`).
    const relPath = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    const runDir = store.runDir(runId);
    const resolved = path.resolve(runDir, relPath);

    if (resolved !== runDir && !resolved.startsWith(runDir + path.sep)) {
      return new Response('Forbidden', { status: 403 });
    }
    if (!fs.existsSync(resolved)) {
      return new Response('Not found', { status: 404 });
    }

    return new Response(fs.readFileSync(resolved));
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1500,
    height: 980,
    minWidth: 1200,
    minHeight: 800,
    title: 'QA Flow',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'dist', 'index.html'));
  return win;
}

async function bootApi() {
  const settings = store.getSettings();
  const port = settings.apiPort || 4317;
  const api = createApi({ store, runSuiteFn: runSuite });
  try {
    await api.listen(port);
  } catch (e) {
    console.warn(`[qaflow] REST API failed to bind port ${port}: ${e.message}`);
  }
  return api;
}

app.whenReady().then(async () => {
  registerMediaProtocol();
  mainWindow = createWindow();
  registerIpc({ store, getMainWindow: () => mainWindow });
  await bootApi();

  if (isSmoke) {
    mainWindow.webContents.once('did-finish-load', () => {
      console.log('SMOKE OK');
      app.exit(0);
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

process.on('uncaughtException', (err) => {
  console.error('[qaflow] uncaught exception:', err);
  if (isSmoke) app.exit(1);
});

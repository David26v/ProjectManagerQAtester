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
const { createScheduler } = require('./scheduler.js');
const { createBrowserBootstrap } = require('./browser-bootstrap.js');
const { createUpdates } = require('./updates.js');

const isSmoke = process.argv.includes('--smoke');

protocol.registerSchemesAsPrivileged([
  { scheme: 'qaflow-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

// Dev checkouts must never share the installed app's data. Packaged dir name
// 'qa-flow' is permanent — renaming orphans client data.
if (!app.isPackaged) app.setPath('userData', app.getPath('userData') + '-dev');

const baseDir = path.join(app.getPath('userData'), 'qaflow-data');
const store = createStore(baseDir);

let mainWindow = null;

// A legal `runId` is a bare directory-name segment — no `/`, `\`, or `..`.
// This must be checked BEFORE calling `store.runDir(runId)`: `path.join`
// normalizes `..` segments, so a hostname of `..` would otherwise resolve
// `runDir` itself to the qaflow-data root, and the relPath containment
// check below would then trivially pass against that already-escaped dir
// — leaking settings.json / credentials / other runs to the renderer.
const SAFE_RUN_ID = /^[A-Za-z0-9_-]+$/;

function registerMediaProtocol() {
  protocol.handle('qaflow-media', (request) => {
    const url = new URL(request.url);
    const runId = url.hostname;
    if (!SAFE_RUN_ID.test(runId)) {
      return new Response('Forbidden', { status: 403 });
    }

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

// `ensureChromium()` can resolve (or fail) fast enough to race the
// renderer's `browser:status` listener mount — `webContents.send()` doesn't
// queue for a listener that isn't attached yet, so a send that happens
// before React's `useEffect` subscribes is silently lost, which would
// defeat the failure-toast contract. Buffering the last-sent payload here
// and re-sending it once on `did-finish-load` (below) covers that: by the
// time that event fires the page's scripts have already run and mounted
// the listener, so whatever was last known is guaranteed to land.
let lastBrowserStatus = null;

function sendBrowserStatus(payload) {
  lastBrowserStatus = payload;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('browser:status', payload);
  }
}

// Fire-and-forget: resolves/installs the Playwright Chromium build the
// engine drives at runtime. Never awaited from `whenReady` — the app must
// stay usable while a first-run download is in flight. Skipped entirely in
// `--smoke`, which has no browser-dependent assertions and exits as soon as
// the renderer finishes its first paint.
function bootBrowser() {
  const bootstrap = createBrowserBootstrap({
    onStatus: (status) => sendBrowserStatus({ status }),
  });

  bootstrap.ensureChromium().then((result) => {
    if (!result.ok) {
      sendBrowserStatus({
        status: 'error',
        error: `Browser install failed — recording/runs unavailable: ${result.error}`,
      });
    }
  });
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
  const updates = createUpdates({ getMainWindow: () => mainWindow });
  const { executeRun } = registerIpc({
    store,
    getMainWindow: () => mainWindow,
    updates,
    getBrowserStatus: () => lastBrowserStatus,
  });

  // Attach BEFORE awaiting bootApi() — `loadFile` above is unawaited, so if
  // the static dist/index.html finishes loading while bootApi() is still
  // in flight, a listener attached only after that await would miss the
  // event entirely and `--smoke` would hang forever.
  if (isSmoke) {
    mainWindow.webContents.once('did-finish-load', () => {
      console.log('SMOKE OK');
      app.exit(0);
    });
  } else {
    bootBrowser();
    // Guards the event-drop race described above `sendBrowserStatus` — by
    // the time `did-finish-load` fires the renderer's listener is mounted,
    // so re-flush whatever status was last known (a no-op if nothing has
    // been decided yet, or if the live send already got through). Same
    // pattern for updates:status — `createUpdates` pushes on its own timers
    // and boot check, which can beat the renderer's listener mount too.
    mainWindow.webContents.once('did-finish-load', () => {
      if (lastBrowserStatus && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('browser:status', lastBrowserStatus);
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('updates:status', updates.lastStatus());
      }
    });
  }

  await bootApi();

  // Scheduler is best-effort — a failure here (e.g. a corrupt
  // schedules.json) must not take down the app; `--smoke` already exits
  // via the `did-finish-load` listener above regardless of this.
  try {
    const scheduler = createScheduler({
      store,
      executeRun,
      notify: (schedule, status) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('schedules:fired', { schedule, status });
        }
      },
    });
    scheduler.start();
  } catch (e) {
    console.warn(`[qaflow] scheduler failed to start: ${e.message}`);
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

'use strict';

// App lifecycle: window creation, the `qaflow-media` custom protocol, and
// REST API boot. IPC wiring lives in ipc.js; the contextBridge surface
// lives in preload.js. This file is the only one that knows about the
// BrowserWindow / protocol / app singleton.

// Must load before anything reads `process.env.*` below (Supabase/Prisma
// clients, auth.js) — `.env` lives at the app root, which in dev IS the
// repo root (cwd), but in a packaged app or `--smoke` it may be absent
// entirely; `dotenv.config()` silently no-ops rather than throwing when the
// file doesn't exist, so no extra guard is needed here.
require('dotenv').config();

const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, protocol } = require('electron');

const { createStore } = require('../engine/store.js');
const { createCloudStore } = require('../engine/cloud-store.js');
const { createApi } = require('../engine/api.js');
const { runSuite } = require('../engine/runner.js');
const { registerIpc } = require('./ipc.js');
const { createAuth } = require('./auth.js');
const { createScheduler } = require('./scheduler.js');
const { createBrowserBootstrap } = require('./browser-bootstrap.js');
const { createUpdates } = require('./updates.js');
const { createPrisma } = require('../engine/cloud/db.js');
const { createSupabaseAdmin } = require('../engine/cloud/supabase.js');
const { ensureBucket } = require('../engine/cloud/media.js');

const isSmoke = process.argv.includes('--smoke');

protocol.registerSchemesAsPrivileged([
  { scheme: 'qaflow-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

// Dev checkouts must never share the installed app's data. Packaged dir name
// 'qa-flow' is permanent — renaming orphans client data.
if (!app.isPackaged) app.setPath('userData', app.getPath('userData') + '-dev');

const userDataDir = app.getPath('userData');
const baseDir = path.join(userDataDir, 'qaflow-data');

// `localStore` is always built — it's the JSON store used for engine tests,
// AND (per the cloud store's contract) the device-local half of the cloud
// store (credential blobs, settings.json, in-flight run scratch dir). It is
// also the fallback store itself when cloud construction fails below, so
// the app keeps working offline-ish instead of white-screening.
const localStore = createStore(baseDir);

// Cloud construction (Prisma + Supabase admin client + the cloud store
// wrapping them) is guarded end-to-end: `--smoke` runs with no `.env` and no
// network at all, and even outside smoke, a broken/unreachable Supabase
// project must not crash app boot — only degrade to local-only data.
let prisma = null;
try {
  prisma = createPrisma();
} catch (e) {
  console.warn(`[qaflow] Prisma client unavailable — falling back to local data: ${e.message}`);
}

let supabaseAdmin = null;
try {
  supabaseAdmin = createSupabaseAdmin();
} catch (e) {
  console.warn(`[qaflow] Supabase admin client unavailable: ${e.message}`);
}

let store = localStore;
if (prisma && supabaseAdmin) {
  try {
    store = createCloudStore({ prisma, supabase: supabaseAdmin, localStore });
  } catch (e) {
    console.warn(`[qaflow] cloud store unavailable — running on local data: ${e.message}`);
    store = localStore;
  }
} else {
  console.warn('[qaflow] cloud unavailable — running on local data');
}

// Auth module — separate from the admin client above: it uses the
// PUBLISHABLE key (user-facing sign-in), never the service role key. Same
// guard rule: missing env (smoke, or a dev checkout with no `.env`) must not
// crash boot — `auth` stays `null` and `registerIpc`'s login gate is simply
// not applied (pre-Task-4 unrestricted behavior), since there is no login
// surface to gate behind in that case.
//
// Construction is deferred to `app.whenReady()` (see below), NOT done here
// at module scope like `localStore`/`prisma`/`supabaseAdmin` — `createAuth`
// restores the persisted session synchronously off `client.auth.getSession()`,
// which reads through the safeStorage-backed storage adapter, and
// `safeStorage` throws "cannot be used before app is ready" if touched
// before Electron's `app` singleton is actually ready.
let auth = null;

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
    title: 'Astreus Tech Tester Tool',
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

// Same event-drop race as `lastBrowserStatus` above, for `auth:changed`:
// the restored-session listener (`auth.onChange`, wired in `whenReady`
// below) can fire before the renderer's own listener mounts — auth restore
// races the page's first paint the same way browser/update status do.
// Buffered here and re-flushed on `did-finish-load` alongside the other two.
let lastAuthStatus = null;

function sendAuthStatus(payload) {
  lastAuthStatus = payload;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('auth:changed', payload);
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

async function bootMediaBucket() {
  if (!supabaseAdmin) return;
  try {
    await ensureBucket(supabaseAdmin);
  } catch (e) {
    console.warn(`[qaflow] failed to ensure Supabase Storage bucket: ${e.message}`);
  }
}

// REST API boot is gated behind login when auth is wired: while logged out
// pre-first-boot it simply hasn't been started at all (connection refused —
// acceptable per the brief). Once booted it is left running for the rest of
// the process's life even across a later logout — restarting express on
// every login/logout edge isn't worth the complexity for a single-tenant
// local tool — but a per-request `isSignedIn` gate (wired below) still
// 503s every route once a session that WAS active logs out, so "logged out"
// is never silently served cloud data either way.
let apiBooted = false;
async function bootApiOnce() {
  if (apiBooted) return;
  apiBooted = true;
  const settings = store.getSettings();
  const port = (settings && settings.apiPort) || 4317;
  const api = createApi({ store, runSuiteFn: runSuite, isSignedIn: auth ? () => auth.getUser() != null : undefined });
  try {
    await api.listen(port);
  } catch (e) {
    console.warn(`[qaflow] REST API failed to bind port ${port}: ${e.message}`);
  }
  return api;
}

app.whenReady().then(async () => {
  registerMediaProtocol();

  // Now safe to touch `safeStorage` — build the auth module here, not at
  // module scope (see the comment above `let auth = null`).
  try {
    auth = createAuth({ userDataDir });
  } catch (e) {
    console.warn(`[qaflow] auth unavailable — IPC will run ungated: ${e.message}`);
  }

  mainWindow = createWindow();
  const updates = createUpdates({ getMainWindow: () => mainWindow });
  const { executeRun } = registerIpc({
    store,
    getMainWindow: () => mainWindow,
    updates,
    getBrowserStatus: () => lastBrowserStatus,
    supabase: supabaseAdmin,
    auth,
    notifyAuthStatus: sendAuthStatus,
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
      if (lastAuthStatus && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('auth:changed', lastAuthStatus);
      }
    });
  }

  // API boot: if auth isn't wired at all (no env — smoke, or a dev checkout
  // with no `.env`), there's no login surface to gate behind, so boot
  // immediately like before Task 4. If auth IS wired, boot once a session is
  // confirmed — either already-restored (checked after `auth.ready`) or via
  // the first `auth:changed` with `loggedIn: true`.
  if (auth) {
    auth.ready.then(() => {
      if (auth.getUser()) bootApiOnce();
    });
    auth.onChange((status) => {
      if (status.loggedIn) bootApiOnce();
    });
  } else {
    bootApiOnce();
  }

  await bootMediaBucket();

  // Scheduler is best-effort — a failure here (e.g. a corrupt
  // schedules.json, or an unreachable cloud store) must not take down the
  // app; `--smoke` already exits via the `did-finish-load` listener above
  // regardless of this.
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


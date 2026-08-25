'use strict';

// Wraps electron-updater's `autoUpdater` behind a small state machine that's
// safe to construct unconditionally from main.js. In dev (`!app.isPackaged`)
// every method is a no-op returning `{ state: 'dev' }` — `electron-updater`
// is never even required, so `npm run smoke` / `npm start` never make an
// update-check network call. In a packaged build it checks on boot
// (after a short delay, so it never competes with first-paint) and on a
// 4-hour interval, downloads automatically, and reports `ready` once the
// download finishes so the renderer can offer a restart.
//
// Reuses main.js's `lastBrowserStatus` buffering pattern: `webContents.send`
// drops silently if the renderer's listener isn't mounted yet, so the last
// status is cached here and callers re-flush it on `did-finish-load`.

const BOOT_CHECK_DELAY_MS = 10_000;
const PERIODIC_CHECK_MS = 4 * 60 * 60 * 1000;

function createUpdates({ getMainWindow }) {
  const { app } = require('electron');

  if (!app.isPackaged) {
    // Dev checkout: no autoUpdater require, no network, no timers.
    const devState = { state: 'dev' };
    return {
      status: () => devState,
      check: async () => devState,
      quitAndInstall: () => devState,
      lastStatus: () => devState,
    };
  }

  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = true;

  let current = { state: 'idle' };

  function send(payload) {
    current = payload;
    const win = getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send('updates:status', payload);
  }

  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }));
  autoUpdater.on('update-available', (info) => send({ state: 'downloading', version: info.version }));
  autoUpdater.on('update-not-available', () => send({ state: 'idle' }));
  autoUpdater.on('download-progress', (progress) => send({ state: 'downloading', version: current.version, progress: progress.percent }));
  autoUpdater.on('update-downloaded', (info) => send({ state: 'ready', version: info.version }));
  autoUpdater.on('error', (err) => send({ state: 'error', error: err.message }));

  function check() {
    // `checkForUpdates()` rejects (network down, no release yet, etc.) —
    // swallow it into the same `error` state the `error` event above
    // reports, rather than letting an unhandled rejection surface.
    return autoUpdater.checkForUpdates().catch((err) => {
      send({ state: 'error', error: err.message });
    });
  }

  setTimeout(check, BOOT_CHECK_DELAY_MS);
  setInterval(check, PERIODIC_CHECK_MS);

  return {
    status: () => current,
    check: async () => {
      await check();
      return current;
    },
    quitAndInstall: () => {
      autoUpdater.quitAndInstall();
      return current;
    },
    lastStatus: () => current,
  };
}

module.exports = { createUpdates };

'use strict';

// Ensures the Playwright-managed Chromium build the engine drives at runtime
// is present on disk. Packaged builds don't bundle the ~150MB browser — this
// installs it on first launch instead, so `npm run dist` output stays small
// and the download only happens once per machine (Playwright caches it under
// the user's home directory, not inside the app).

const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

// `playwright`'s package.json `exports` map only lists a handful of
// subpaths (not `./cli.js`), so `require.resolve('playwright/cli.js')`
// throws ERR_PACKAGE_PATH_NOT_EXPORTED under Node's strict exports
// resolution. Resolving the exported `package.json` first and joining
// `cli.js` onto its directory sidesteps that — and still resolves correctly
// through `asarUnpack` in a packaged build, since `playwright/package.json`
// unpacks alongside `cli.js`.
function resolveCliPath() {
  const pkgJsonPath = require.resolve('playwright/package.json');
  return path.join(path.dirname(pkgJsonPath), 'cli.js');
}

function createBrowserBootstrap({ onStatus } = {}) {
  const emit = (status) => {
    if (typeof onStatus === 'function') onStatus(status);
  };

  function installChromium() {
    return new Promise((resolve, reject) => {
      const cliPath = resolveCliPath();
      const child = spawn(process.execPath, [cliPath, 'install', 'chromium'], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: 'ignore',
      });

      child.once('error', (err) => reject(err));
      child.once('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`playwright install chromium exited with code ${code}`));
      });
    });
  }

  async function ensureChromium() {
    try {
      const { chromium } = require('playwright');
      const executablePath = chromium.executablePath();

      if (executablePath && fs.existsSync(executablePath)) {
        return { ok: true };
      }

      emit('installing');
      await installChromium();
      emit('done');
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  return { ensureChromium };
}

module.exports = { createBrowserBootstrap };

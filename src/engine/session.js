'use strict';

// Login session capture — launches a headed Chromium at a login URL, lets
// the user sign in by hand, then hands back the Playwright storageState
// (cookies + localStorage per origin) as a JSON string once the caller
// calls `finish()` (or the user closes the window). Never `require('electron')`
// — the caller (main process) is responsible for encrypting the returned
// JSON with `safeStorage` before persisting it.

const { chromium } = require('playwright');

function start({ loginUrl }) {
  let resolveFinished;
  const finished = new Promise((resolve) => {
    resolveFinished = resolve;
  });

  let browser = null;
  let context = null;
  let settled = false;

  const ready = (async () => {
    browser = await chromium.launch({ headless: false });
    context = await browser.newContext({ viewport: null });

    // If the user closes the window before calling finish(), resolve with
    // no storageState rather than hanging forever.
    context.on('close', () => {
      if (settled) return;
      settled = true;
      resolveFinished(null);
    });

    const page = await context.newPage();
    await page.goto(loginUrl, { timeout: 30000 });
  })();

  async function finish() {
    await ready;
    if (settled) return;
    settled = true;

    const storageStateJson = JSON.stringify(await context.storageState());
    resolveFinished(storageStateJson);

    try {
      await browser.close();
    } catch {
      // Already closed — nothing to do.
    }
  }

  async function cancel() {
    await ready;
    if (settled) return;
    settled = true;
    resolveFinished(null);

    try {
      await browser.close();
    } catch {
      // Already closed — nothing to do.
    }
  }

  return { finished, finish, cancel };
}

module.exports = { start };

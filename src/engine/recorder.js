'use strict';

// Browser action recorder — launches a headed Chromium, injects
// `recorder-inject.js` into every page, and turns the events it reports
// (via `context.exposeBinding`) into Step objects from the Shared Data
// Model. Never `require('electron')` — engine code stays unit-testable
// with plain `node --test`.

const { chromium } = require('playwright');
const qaflowRecorderInit = require('./recorder-inject.js');

// Only append an automatic `goto` step (from a same-page navigation the
// user triggered, e.g. via the address bar or a full page reload) if
// nothing else was recorded in the last 2s — otherwise a navigation caused
// by a click we already recorded would be double-counted.
const GOTO_QUIET_WINDOW_MS = 2000;

function clickStepName(payload) {
  const label = payload.text || payload.selector;
  return `Click ${label}`;
}

function stepFromPayload(payload) {
  switch (payload.type) {
    case 'click':
      return {
        type: 'click',
        name: clickStepName(payload),
        selector: payload.selector,
        value: undefined,
        timeout: 10000,
      };
    case 'fill': {
      const isPassword = payload.name === 'Input password';
      return {
        type: 'fill',
        name: isPassword ? 'Input password' : `Input ${payload.selector}`,
        selector: payload.selector,
        value: payload.value,
        timeout: 10000,
      };
    }
    case 'select':
      return {
        type: 'select',
        name: `Select ${payload.value}`,
        selector: payload.selector,
        value: payload.value,
        timeout: 10000,
      };
    case 'press':
      return {
        type: 'press',
        name: `Press ${payload.value}`,
        selector: undefined,
        value: payload.value,
        timeout: 10000,
      };
    default:
      return null;
  }
}

function createRecorder() {
  let browser = null;
  let context = null;
  let page = null;
  let steps = [];
  let running = false;
  let lastStepAt = 0;

  function pushStep(step, onStep) {
    steps.push(step);
    lastStepAt = Date.now();
    if (onStep) onStep(step);
  }

  async function start({ url, storageStatePath = null, onStep = null }) {
    steps = [];
    running = true;

    browser = await chromium.launch({ headless: false });
    context = await browser.newContext({
      storageState: storageStatePath || undefined,
      viewport: null,
    });

    await context.exposeBinding('__qaflowRecord', (source, payload) => {
      const step = stepFromPayload(payload);
      if (!step) return;
      pushStep(step, onStep);
    });

    await context.addInitScript(qaflowRecorderInit);

    page = await context.newPage();

    // Guard the initial navigation below from also being recorded by the
    // `framenavigated` listener — the explicit goto step is pushed after
    // `page.goto` resolves and is always steps[0].
    lastStepAt = Date.now();

    page.on('framenavigated', (frame) => {
      if (!page || frame !== page.mainFrame()) return;
      const frameUrl = frame.url();
      if (frameUrl === 'about:blank') return;
      if (Date.now() - lastStepAt < GOTO_QUIET_WINDOW_MS) return;
      pushStep({ type: 'goto', name: `Navigate to ${frameUrl}`, value: frameUrl, timeout: 10000 }, onStep);
    });

    context.on('close', () => {
      running = false;
    });

    await page.goto(url, { timeout: 30000 });
    pushStep({ type: 'goto', name: `Navigate to ${url}`, value: url, timeout: 10000 }, onStep);
  }

  async function stop() {
    running = false;
    if (browser) {
      try {
        await browser.close();
      } catch {
        // Already closed (e.g. the user closed the window) — nothing to do.
      }
    }
    return steps;
  }

  function isRunning() {
    return running;
  }

  return {
    start,
    stop,
    isRunning,
    get _page() {
      return page;
    },
  };
}

module.exports = { createRecorder };

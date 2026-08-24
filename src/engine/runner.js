'use strict';

// Playwright runner engine — the heart of the product. Executes a Suite's
// steps against a real Chromium instance, capturing video + failure
// screenshots + console/network errors, and persists a Run report via the
// store from Task 1. Never `require('electron')` — engine code must stay
// unit-testable with plain `node --test`.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');

function slug(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '') || 'step';
}

function resolveUrl(value, targetUrl) {
  if (/^https?:\/\//i.test(value)) return value;
  return new URL(value, targetUrl).toString();
}

async function runStep(page, step, targetUrl) {
  const timeout = step.timeout || 10000;

  switch (step.type) {
    case 'goto':
      await page.goto(resolveUrl(step.value, targetUrl), { timeout });
      return;
    case 'click':
      await page.click(step.selector, { timeout });
      return;
    case 'fill':
      await page.fill(step.selector, step.value, { timeout });
      return;
    case 'press':
      await page.keyboard.press(step.value);
      return;
    case 'select':
      await page.selectOption(step.selector, step.value, { timeout });
      return;
    case 'waitFor':
      await page.waitForSelector(step.selector, { timeout });
      return;
    case 'assertVisible':
      await page.waitForSelector(step.selector, { state: 'visible', timeout });
      return;
    case 'assertText': {
      const el = await page.waitForSelector(step.selector, { timeout });
      const actual = (await el.textContent()) || '';
      if (!actual.includes(step.value)) {
        throw new Error(`Expected "${step.value}" but found "${actual}"`);
      }
      return;
    }
    default:
      throw new Error(`Unknown step type: ${step.type}`);
  }
}

async function runSuite({ store, suite, project, environment, storageStatePath = null, headless = true, onProgress = null }) {
  const targetUrl = (environment && environment.baseUrl) || project.baseUrl;
  const runId = `run-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
  const dir = store.runDir(runId);
  fs.mkdirSync(dir, { recursive: true });

  const startedAt = new Date().toISOString();
  const consoleErrors = [];
  const networkFailures = [];
  const steps = [];
  const capturedMedia = [];
  let status = 'passed';

  const browser = await chromium.launch({ headless });
  let context;
  try {
    context = await browser.newContext({
      recordVideo: { dir },
      storageState: storageStatePath || undefined,
      viewport: { width: 1280, height: 800 },
    });

    const page = await context.newPage();

    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push({ text: msg.text() });
    });
    page.on('requestfailed', (r) => {
      networkFailures.push({ url: r.url(), failure: r.failure() && r.failure().errorText });
    });
    page.on('response', (res) => {
      if (res.status() >= 400) {
        consoleErrors.push({ text: `${res.status()} ${res.statusText()} - ${res.url()}` });
      }
    });

    let failed = false;

    for (let index = 0; index < suite.steps.length; index += 1) {
      const step = suite.steps[index];

      if (failed) {
        steps.push({ name: step.name, status: 'skipped' });
        if (onProgress) onProgress({ type: 'step-end', index, name: step.name, status: 'skipped' });
        continue;
      }

      if (onProgress) onProgress({ type: 'step-start', index, name: step.name });
      const startedStep = Date.now();

      try {
        await runStep(page, step, targetUrl);
        const durationMs = Date.now() - startedStep;
        steps.push({ name: step.name, status: 'passed', durationMs });
        if (onProgress) onProgress({ type: 'step-end', index, name: step.name, status: 'passed' });
      } catch (e) {
        const durationMs = Date.now() - startedStep;
        const screenshotName = `${slug(step.name)}-${Date.now()}.png`;
        const screenshotPath = path.join(dir, screenshotName);
        try {
          await page.screenshot({ path: screenshotPath });
          capturedMedia.push({ id: crypto.randomUUID(), type: 'screenshot', path: screenshotName, stepIndex: index });
        } catch {
          // Screenshot capture is best-effort — the step failure itself is what matters.
        }

        steps.push({ name: step.name, status: 'failed', error: e.message, screenshot: screenshotName, durationMs });
        if (onProgress) onProgress({ type: 'step-end', index, name: step.name, status: 'failed', error: e.message });

        failed = true;
        status = 'failed';
      }
    }
  } finally {
    let videoSourcePath = null;
    if (context) {
      const page = context.pages()[0];
      const video = page ? page.video() : null;
      await context.close();
      if (video) {
        try {
          videoSourcePath = await video.path();
        } catch {
          videoSourcePath = null;
        }
      }
    }

    if (videoSourcePath && fs.existsSync(videoSourcePath)) {
      const finalVideoPath = path.join(dir, 'video.webm');
      if (videoSourcePath !== finalVideoPath) {
        fs.renameSync(videoSourcePath, finalVideoPath);
      }
      capturedMedia.unshift({ id: crypto.randomUUID(), type: 'video', path: 'video.webm' });
    }

    await browser.close();
  }

  const report = {
    runId,
    suiteId: suite.id,
    projectId: project.id,
    suiteName: suite.name,
    targetUrl,
    environment: environment && environment.name,
    startedAt,
    finishedAt: new Date().toISOString(),
    status,
    triggeredBy: 'manual',
    steps,
    consoleErrors,
    networkFailures,
    videoPath: 'video.webm',
    capturedMedia,
    reportSelection: null,
  };

  return store.saveRun(report);
}

module.exports = { runSuite };

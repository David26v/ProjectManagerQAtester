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

const DEFAULT_STEP_TIMEOUT = 10000;

// Redacts the password from an error message before it can ever reach a
// report, a thrown Error, or a log line. Applied even when the underlying
// Playwright error is unlikely to contain it — belt and suspenders, since
// the secrets rule is a hard requirement, not a best-effort one.
function redact(message, secret) {
  if (!secret) return message;
  return String(message).split(secret).join('[REDACTED]');
}

// Runs the manual-login flow against `page`, before step 1 of the suite.
// Any failure (selector not found, navigation error, timeout) is turned
// into a single `Manual login failed: <reason>` Error with the password
// redacted out of the reason text.
async function performManualLogin(page, manualLogin, timeout) {
  const { loginUrl, username, password } = manualLogin;
  try {
    await page.goto(loginUrl, { timeout });

    const userInput = await page.waitForSelector('input[type="email"], input[type="text"]', {
      state: 'visible',
      timeout,
    });
    await userInput.fill(username);

    const passInput = await page.waitForSelector('input[type="password"]', { state: 'visible', timeout });
    await passInput.fill(password);

    const submit = await page.$('button[type="submit"], input[type="submit"]');
    if (submit) {
      await submit.click({ timeout });
    } else {
      await passInput.press('Enter');
    }

    await page.waitForLoadState('networkidle', { timeout });
  } catch (e) {
    throw new Error(`Manual login failed: ${redact(e.message, password)}`);
  }
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

// Runs one full attempt of the suite (fresh browser, fresh run dir) and
// returns the report for that attempt without persisting it. `runSuite`
// below owns the retry loop and decides which attempt's report — and run
// dir — survives.
async function runAttempt({
  store,
  suite,
  project,
  environment,
  storageStatePath,
  headless,
  onProgress,
  triggeredBy,
  manualLogin,
  attempt,
  captureVideo,
}) {
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

  // Tags every progress event with which attempt (1-based) emitted it, so a
  // listener watching a suite across retries — or across two independent
  // runs of the same suite overlapping in time (e.g. a manual run and a
  // scheduled run) — can tell events apart instead of blindly summing them.
  const emit = onProgress ? (payload) => onProgress({ ...payload, attempt }) : null;

  const browser = await chromium.launch({ headless });
  let context;
  try {
    context = await browser.newContext({
      ...(captureVideo === false ? {} : { recordVideo: { dir } }),
      storageState: storageStatePath || undefined,
      viewport: { width: 1280, height: 800 },
    });

    const page = await context.newPage();

    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push({ text: msg.text() });
    });
    // Uncaught in-page exceptions never reach the console listener above —
    // they surface only through 'pageerror'. Without this, a page that blows
    // up in an event handler (but still renders) would pass silently.
    page.on('pageerror', (err) => {
      consoleErrors.push({ text: `Uncaught exception: ${err.message}` });
    });
    // A renderer crash (OOM, GPU fault) kills the tab mid-run; the current
    // step's action will throw and fail the run, but the report should say
    // WHY rather than leaving only a cryptic "target closed" step error.
    page.on('crash', () => {
      consoleErrors.push({ text: 'Page crashed (browser tab died mid-run)' });
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

    if (manualLogin) {
      if (emit) emit({ type: 'step-start', index: -1, name: 'Manual login' });
      const startedStep = Date.now();
      try {
        await performManualLogin(page, manualLogin, DEFAULT_STEP_TIMEOUT);
        const durationMs = Date.now() - startedStep;
        steps.push({ name: 'Manual login', status: 'passed', durationMs });
        if (emit) emit({ type: 'step-end', index: -1, name: 'Manual login', status: 'passed' });
      } catch (e) {
        const durationMs = Date.now() - startedStep;
        steps.push({ name: 'Manual login', status: 'failed', error: e.message, durationMs });
        if (emit) emit({ type: 'step-end', index: -1, name: 'Manual login', status: 'failed', error: e.message });
        failed = true;
        status = 'failed';
      }
    }

    for (let index = 0; index < suite.steps.length; index += 1) {
      const step = suite.steps[index];

      if (failed) {
        steps.push({ name: step.name, status: 'skipped' });
        if (emit) emit({ type: 'step-end', index, name: step.name, status: 'skipped' });
        continue;
      }

      if (emit) emit({ type: 'step-start', index, name: step.name });
      const startedStep = Date.now();

      try {
        await runStep(page, step, targetUrl);
        const durationMs = Date.now() - startedStep;
        steps.push({ name: step.name, status: 'passed', durationMs });
        if (emit) emit({ type: 'step-end', index, name: step.name, status: 'passed' });
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
        if (emit) emit({ type: 'step-end', index, name: step.name, status: 'failed', error: e.message });

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

  // Only set when a video was actually captured (see the `capturedMedia`
  // push above) — otherwise RunDetail's `<video>` tag would point at a
  // file that was never written.
  const videoMedia = capturedMedia.find((m) => m.type === 'video');

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
    triggeredBy,
    steps,
    consoleErrors,
    networkFailures,
    videoPath: videoMedia ? videoMedia.path : null,
    capturedMedia,
    reportSelection: null,
  };

  return { report, dir };
}

async function runSuite({
  store,
  suite,
  project,
  environment,
  storageStatePath = null,
  headless = true,
  onProgress = null,
  triggeredBy = 'manual',
  manualLogin = null,
  retries = 0,
  captureVideo = true,
}) {
  let attempts = 0;
  let report;
  let dir;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempts += 1;
    const attempt = await runAttempt({
      store,
      suite,
      project,
      environment,
      storageStatePath,
      headless,
      onProgress,
      triggeredBy,
      manualLogin,
      attempt: attempts,
      captureVideo,
    });

    // A discarded attempt's run dir (video/screenshots) is cleaned up —
    // only the final attempt's artifacts are worth keeping.
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }

    report = attempt.report;
    dir = attempt.dir;

    if (report.status === 'failed' && attempts <= retries) {
      continue;
    }
    break;
  }

  report.attempts = attempts;
  if (manualLogin) report.manualLogin = true;

  return store.saveRun(report);
}

module.exports = { runSuite };

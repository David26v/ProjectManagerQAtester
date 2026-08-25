'use strict';

// IPC handlers — the thin adapter layer between the renderer's
// `window.qaflow` bridge and the pure-Node engine (Tasks 1-5). Every
// handler stays thin: parse args, call the engine, translate the result.
// Secrets never cross this boundary as plaintext — credential blobs are
// decrypted to a temp file only for the lifetime of a run/recorder session
// and deleted in a `finally`; IPC responses for credentials carry index
// metadata only (never the storageState JSON).

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { app, ipcMain, safeStorage, shell, dialog } = require('electron');

const { runSuite } = require('../engine/runner.js');
const { computeNextRunAt } = require('../engine/schedule.js');
const { createRecorder } = require('../engine/recorder.js');
const sessionEngine = require('../engine/session.js');
const { exportRunsToExcel } = require('../engine/exporters/excel.js');
const { generateTicketText, ticketFromRun } = require('../engine/exporters/ticket.js');
const { createBundle } = require('../engine/exporters/bundle.js');

// Mirrors `resolveEnvironment` in engine/api.js (kept local — that function
// isn't exported, and it's a small enough helper that duplicating it here
// beats widening api.js's exports just for this).
function resolveEnvironment(project, environmentName) {
  const envs = project.environments || [];
  if (environmentName) {
    return envs.find((e) => e.name === environmentName) || { name: environmentName, baseUrl: project.baseUrl };
  }
  if (project.defaultEnvironment) {
    return envs.find((e) => e.name === project.defaultEnvironment) || null;
  }
  return envs[0] || null;
}

function decryptCredential(store, credentialProfileId) {
  const meta = store.listCredentials().find((c) => c.id === credentialProfileId);
  if (!meta) throw new Error(`Credential profile "${credentialProfileId}" not found`);
  const blob = store.readCredentialBlob(credentialProfileId);
  if (!blob) throw new Error(`Credential profile "${credentialProfileId}" has no stored session`);
  const plaintext = meta.encrypted ? safeStorage.decryptString(blob) : blob.toString('utf8');
  return { meta, plaintext };
}

function writeTempStorageState(storageStateJson) {
  const file = path.join(os.tmpdir(), `qaflow-storagestate-${crypto.randomUUID()}.json`);
  fs.writeFileSync(file, storageStateJson);
  return file;
}

// Step types the runner engine actually knows how to execute — see
// runner.js's `executeStep` switch. Import validation rejects anything
// outside this set rather than silently accepting suites the runner would
// blow up on mid-run.
const KNOWN_STEP_TYPES = new Set([
  'goto',
  'click',
  'fill',
  'press',
  'select',
  'waitFor',
  'assertVisible',
  'assertText',
]);

function registerIpc({ store, getMainWindow }) {
  function send(channel, payload) {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  }

  function handle(channel, fn) {
    ipcMain.handle(channel, async (_event, ...args) => fn(...args));
  }

  // ---- projects ----
  handle('projects:list', () => store.listProjects());
  handle('projects:get', (id) => store.getProject(id));
  handle('projects:save', (project) => store.saveProject(project));
  handle('projects:remove', (id) => {
    store.deleteProject(id);
    return true;
  });

  // ---- suites ----
  handle('suites:list', (projectId) => store.listSuites(projectId));
  handle('suites:get', (id) => store.getSuite(id));
  handle('suites:save', (suite) => store.saveSuite(suite));
  handle('suites:remove', (id) => {
    store.deleteSuite(id);
    return true;
  });

  handle('suites:importFromFile', async () => {
    const win = getMainWindow();
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Import suite',
      filters: [{ name: 'Suite JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (canceled || !filePaths || !filePaths[0]) return null;

    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
    } catch {
      throw new Error('Not a valid suite JSON file');
    }

    const stepsValid = Array.isArray(parsed.steps) && parsed.steps.every((s) => KNOWN_STEP_TYPES.has(s && s.type));
    if (typeof parsed.name !== 'string' || !stepsValid) {
      throw new Error('Not a valid suite JSON file');
    }

    return store.saveSuite({ ...parsed, id: crypto.randomUUID() });
  });

  // ---- runs ----
  handle('runs:list', (filter) => store.listRuns(filter));
  handle('runs:get', (runId) => store.getRun(runId));

  // Shared by the IPC handler (triggeredBy 'manual') and the scheduler
  // (triggeredBy 'schedule') — the only difference between the two call
  // sites is who's calling and where opts come from. Credential handling
  // branches on the profile's `mode`: 'session' (default) decrypts a
  // Playwright storageState JSON to a temp file exactly as before; 'manual'
  // decrypts a `{username,password}` blob and hands it to runSuite as
  // `manualLogin` — that plaintext only ever lives in this function's
  // scope and is zeroed in `finally`, never returned or logged.
  async function executeRun(suiteId, opts = {}, triggeredBy) {
    const { environment, headless = true, credentialProfileId, retries = 0 } = opts;

    const suite = store.getSuite(suiteId);
    if (!suite) throw new Error(`Suite "${suiteId}" not found`);
    const project = store.getProject(suite.projectId);
    if (!project) throw new Error(`Project "${suite.projectId}" not found`);

    const resolvedEnvironment = resolveEnvironment(project, environment);

    let storageStatePath = null;
    let manualLogin = null;
    try {
      if (credentialProfileId) {
        const { meta, plaintext } = decryptCredential(store, credentialProfileId);
        if (meta.mode === 'manual') {
          const { username, password } = JSON.parse(plaintext);
          manualLogin = { loginUrl: meta.loginUrl, username, password };
        } else {
          storageStatePath = writeTempStorageState(plaintext);
        }
      }

      return await runSuite({
        store,
        suite,
        project,
        environment: resolvedEnvironment,
        storageStatePath,
        headless,
        triggeredBy,
        manualLogin,
        retries,
        onProgress: (event) => send('run:progress', { suiteId, ...event }),
      });
    } finally {
      if (storageStatePath && fs.existsSync(storageStatePath)) fs.unlinkSync(storageStatePath);
      if (manualLogin) {
        manualLogin.username = '';
        manualLogin.password = '';
        manualLogin = null;
      }
    }
  }

  handle('runs:run', async (suiteId, opts = {}) => executeRun(suiteId, opts, 'manual'));

  handle('runs:openDir', (runId) => {
    shell.openPath(store.runDir(runId));
    return true;
  });

  // ---- recorder ----
  // Single active recorder at a time — matches the one-headed-browser UX.
  let recorder = null;
  let recordedStepCount = 0;

  handle('recorder:start', async ({ url, projectId, credentialProfileId } = {}) => {
    if (recorder && recorder.isRunning()) throw new Error('A recording is already in progress');

    let storageStatePath = null;
    if (credentialProfileId) {
      const { meta, plaintext } = decryptCredential(store, credentialProfileId);
      if (meta.mode === 'manual') {
        throw new Error("Manual-entry profiles can't seed the recorder — use a captured session profile");
      }
      storageStatePath = writeTempStorageState(plaintext);
    }

    recorder = createRecorder();
    recordedStepCount = 0;

    try {
      await recorder.start({
        url,
        storageStatePath,
        onStep: (step) => {
          recordedStepCount += 1;
          send('recorder:step', step);
        },
      });
    } finally {
      if (storageStatePath && fs.existsSync(storageStatePath)) fs.unlinkSync(storageStatePath);
    }

    return { running: true, projectId };
  });

  handle('recorder:stop', async () => {
    if (!recorder) return { steps: [] };
    const steps = await recorder.stop();
    recorder = null;
    return { steps };
  });

  handle('recorder:status', () => ({
    running: Boolean(recorder && recorder.isRunning()),
    stepCount: recordedStepCount,
  }));

  // ---- session capture ----
  // engine/session.js exposes {start, finish, cancel} rather than the
  // single `capture()` the bridge surface names — `capture` here starts
  // the headed-login flow and resolves once the flow is finished (either
  // via `session:finish` or by the user closing the login window, which
  // resolves with no storageState). `session:finish` / `session:cancel`
  // are additive IPC channels (not in the original bridge list) needed to
  // let the renderer signal "I'm done logging in" — see task report.
  let pendingCapture = null;

  handle('session:capture', async ({ loginUrl, projectId, environment, name, meta } = {}) => {
    if (pendingCapture) throw new Error('A session capture is already in progress');

    const ctrl = sessionEngine.start({ loginUrl });
    pendingCapture = ctrl;

    let storageStateJson;
    try {
      storageStateJson = await ctrl.finished;
    } finally {
      pendingCapture = null;
    }

    if (!storageStateJson) return null; // user closed the window without finishing

    const encrypted = safeStorage.isEncryptionAvailable();
    const blob = encrypted
      ? safeStorage.encryptString(storageStateJson)
      : Buffer.from(storageStateJson, 'utf8');

    const savedMeta = store.saveCredential(
      {
        id: crypto.randomUUID(),
        name: name || `Session ${new Date().toLocaleString()}`,
        projectId,
        environment,
        loginUrl,
        username: (meta && meta.username) || null,
        encrypted,
        mode: 'session',
        createdAt: new Date().toISOString(),
        lastUsedAt: null,
      },
      blob
    );

    return savedMeta;
  });

  // `session:saveManual` stores a manual username/password pair instead of
  // a captured storageState — same encrypt-with-safeStorage-fallback shape
  // as the capture path, just a different plaintext payload. The password
  // is never echoed back in `savedMeta` (it isn't part of the credential
  // meta object at all — only the encrypted blob holds it).
  handle('session:saveManual', async ({ name, projectId, environment, loginUrl, username, password } = {}) => {
    if (!name || !username || !password || !loginUrl) {
      throw new Error('Name, login URL, username and password are required');
    }

    const plaintext = JSON.stringify({ username, password });
    const encrypted = safeStorage.isEncryptionAvailable();
    const blob = encrypted ? safeStorage.encryptString(plaintext) : Buffer.from(plaintext, 'utf8');

    const savedMeta = store.saveCredential(
      {
        id: crypto.randomUUID(),
        name,
        projectId,
        environment,
        loginUrl,
        username,
        encrypted,
        mode: 'manual',
        createdAt: new Date().toISOString(),
        lastUsedAt: null,
      },
      blob
    );

    return savedMeta;
  });

  handle('session:finish', async () => {
    if (!pendingCapture) return false;
    await pendingCapture.finish();
    return true;
  });

  handle('session:cancel', async () => {
    if (!pendingCapture) return false;
    await pendingCapture.cancel();
    return true;
  });

  handle('session:list', (projectId) => store.listCredentials(projectId));
  handle('session:remove', (id) => {
    store.deleteCredential(id);
    return true;
  });

  // ---- reports ----
  handle('reports:saveSelection', (runId, reportSelection) => {
    const run = store.getRun(runId);
    if (!run) throw new Error(`Run "${runId}" not found`);
    return store.saveRun({ ...run, reportSelection });
  });

  handle('reports:exportExcel', async (runId) => {
    const run = store.getRun(runId);
    if (!run) throw new Error(`Run "${runId}" not found`);

    const win = getMainWindow();
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Export Excel report',
      defaultPath: `${run.suiteName}-report.xlsx`,
      filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
    });
    if (canceled || !filePath) return null;

    await exportRunsToExcel([run], () => store.runDir(runId), filePath);
    return filePath;
  });

  handle('reports:exportJson', async (runId) => {
    const run = store.getRun(runId);
    if (!run) throw new Error(`Run "${runId}" not found`);

    const win = getMainWindow();
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Export JSON report',
      defaultPath: `${run.suiteName}-report.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (canceled || !filePath) return null;

    fs.writeFileSync(filePath, JSON.stringify(run, null, 2));
    return filePath;
  });

  handle('reports:bundle', async (runId) => {
    const run = store.getRun(runId);
    if (!run) throw new Error(`Run "${runId}" not found`);

    const win = getMainWindow();
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Send to David — save bug report bundle',
      defaultPath: `bugreport_${run.suiteName}.zip`,
      filters: [{ name: 'Zip archive', extensions: ['zip'] }],
    });
    if (canceled || !filePath) return null;

    const outputDir = path.dirname(filePath);
    return createBundle(run, store.runDir(runId), outputDir);
  });

  handle('reports:ticketText', (runId) => {
    const run = store.getRun(runId);
    if (!run) throw new Error(`Run "${runId}" not found`);
    const project = store.getProject(run.projectId);
    if (!project) throw new Error('Project not found for this run');
    return generateTicketText(run, project);
  });

  handle('reports:createTicket', (runId) => {
    const run = store.getRun(runId);
    if (!run) throw new Error(`Run "${runId}" not found`);
    const project = store.getProject(run.projectId);
    if (!project) throw new Error('Project not found for this run');
    return store.saveTicket(ticketFromRun(run, project));
  });

  // ---- tickets ----
  handle('tickets:list', () => store.listTickets());
  handle('tickets:save', (ticket) => store.saveTicket(ticket));
  handle('tickets:remove', (id) => {
    store.deleteTicket(id);
    return true;
  });

  // ---- settings ----
  handle('settings:get', () => store.getSettings());
  handle('settings:save', (patch) => store.saveSettings(patch));

  // ---- app ----
  handle('app:version', () => app.getVersion());
  handle('app:mediaUrl', (runId, relPath) => `qaflow-media://${runId}/${relPath}`);
  handle('app:revealPath', (p) => {
    shell.showItemInFolder(p);
    return true;
  });

  // ---- schedules ----
  handle('schedules:list', () => store.listSchedules());
  // Enabling a schedule (fresh save, or a renderer toggle) whose nextRunAt
  // is missing or already in the past must recompute it — otherwise a
  // re-enabled daily/weekly schedule would sit there enabled but never
  // picked up by the scheduler's `nextRunAt <= now` due check. Recompute
  // stays in the one pure engine function; this is just the thin adapter
  // rule that decides when to call it.
  handle('schedules:save', (schedule) => {
    const now = new Date().toISOString();
    if (schedule.enabled && (!schedule.nextRunAt || schedule.nextRunAt < now)) {
      return store.saveSchedule({ ...schedule, nextRunAt: computeNextRunAt(schedule, now) });
    }
    return store.saveSchedule(schedule);
  });
  handle('schedules:remove', (id) => {
    store.deleteSchedule(id);
    return true;
  });

  // `executeRun` is returned so main.js can wire it into the scheduler
  // (triggeredBy 'schedule') without duplicating the credential-decrypt /
  // resolveEnvironment logic above.
  return { executeRun };
}

module.exports = { registerIpc };

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
  return meta.encrypted ? safeStorage.decryptString(blob) : blob.toString('utf8');
}

function writeTempStorageState(storageStateJson) {
  const file = path.join(os.tmpdir(), `qaflow-storagestate-${crypto.randomUUID()}.json`);
  fs.writeFileSync(file, storageStateJson);
  return file;
}

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

  // ---- runs ----
  handle('runs:list', (filter) => store.listRuns(filter));
  handle('runs:get', (runId) => store.getRun(runId));

  handle('runs:run', async (suiteId, opts = {}) => {
    const { environment, headless = true, credentialProfileId } = opts;

    const suite = store.getSuite(suiteId);
    if (!suite) throw new Error(`Suite "${suiteId}" not found`);
    const project = store.getProject(suite.projectId);
    if (!project) throw new Error(`Project "${suite.projectId}" not found`);

    const resolvedEnvironment = resolveEnvironment(project, environment);

    let storageStatePath = null;
    try {
      if (credentialProfileId) {
        const storageStateJson = decryptCredential(store, credentialProfileId);
        storageStatePath = writeTempStorageState(storageStateJson);
      }

      return await runSuite({
        store,
        suite,
        project,
        environment: resolvedEnvironment,
        storageStatePath,
        headless,
        triggeredBy: 'manual',
        onProgress: (event) => send('run:progress', { suiteId, ...event }),
      });
    } finally {
      if (storageStatePath && fs.existsSync(storageStatePath)) fs.unlinkSync(storageStatePath);
    }
  });

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
      const storageStateJson = decryptCredential(store, credentialProfileId);
      storageStatePath = writeTempStorageState(storageStateJson);
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
}

module.exports = { registerIpc };

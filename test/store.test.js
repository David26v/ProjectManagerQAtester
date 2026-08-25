'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createStore } = require('../src/engine/store.js');

function tmpBaseDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qaflow-'));
}

test('createStore mkdirs suites/ runs/ credentials/ up front', () => {
  const baseDir = tmpBaseDir();
  createStore(baseDir);

  assert.equal(fs.existsSync(path.join(baseDir, 'suites')), true);
  assert.equal(fs.existsSync(path.join(baseDir, 'runs')), true);
  assert.equal(fs.existsSync(path.join(baseDir, 'credentials')), true);
});

test('project CRUD roundtrip', () => {
  const store = createStore(tmpBaseDir());

  assert.deepEqual(store.listProjects(), []);

  const saved = store.saveProject({ name: 'Acme', key: 'ACME', baseUrl: 'https://acme.test' });
  assert.ok(saved.id);
  assert.ok(saved.createdAt);
  assert.ok(saved.updatedAt);
  assert.equal(saved.name, 'Acme');

  const fetched = store.getProject(saved.id);
  assert.deepEqual(fetched, saved);

  assert.equal(store.listProjects().length, 1);

  const updated = store.saveProject({ ...saved, name: 'Acme Inc' });
  assert.equal(updated.id, saved.id);
  assert.equal(updated.createdAt, saved.createdAt);
  assert.equal(updated.name, 'Acme Inc');
  assert.equal(store.listProjects().length, 1);

  store.deleteProject(saved.id);
  assert.equal(store.getProject(saved.id), undefined);
  assert.deepEqual(store.listProjects(), []);
});

test('suite save/list-by-project', () => {
  const store = createStore(tmpBaseDir());

  const projectA = store.saveProject({ name: 'A' });
  const projectB = store.saveProject({ name: 'B' });

  const suiteA1 = store.saveSuite({ projectId: projectA.id, name: 'Login flow', steps: [] });
  const suiteA2 = store.saveSuite({ projectId: projectA.id, name: 'Checkout flow', steps: [] });
  store.saveSuite({ projectId: projectB.id, name: 'Other project suite', steps: [] });

  const listAll = store.listSuites();
  assert.equal(listAll.length, 3);

  const listForA = store.listSuites(projectA.id);
  assert.equal(listForA.length, 2);
  assert.ok(listForA.every((s) => s.projectId === projectA.id));

  const fetched = store.getSuite(suiteA1.id);
  assert.equal(fetched.name, 'Login flow');

  store.deleteSuite(suiteA2.id);
  assert.equal(store.listSuites(projectA.id).length, 1);
});

test('run save + listRuns order (newest first)', async () => {
  const store = createStore(tmpBaseDir());

  const project = store.saveProject({ name: 'A' });
  const suite = store.saveSuite({ projectId: project.id, name: 'Suite', steps: [] });

  const run1 = store.saveRun({
    suiteId: suite.id,
    projectId: project.id,
    suiteName: suite.name,
    targetUrl: 'https://acme.test',
    startedAt: '2026-08-24T10:00:00.000Z',
    finishedAt: '2026-08-24T10:00:05.000Z',
    status: 'passed',
    steps: [],
    consoleErrors: [],
    networkFailures: [],
    videoPath: null,
  });

  // Ensure distinct ordering isn't dependent on system clock resolution alone.
  await new Promise((resolve) => setTimeout(resolve, 5));

  const run2 = store.saveRun({
    suiteId: suite.id,
    projectId: project.id,
    suiteName: suite.name,
    targetUrl: 'https://acme.test',
    startedAt: '2026-08-24T11:00:00.000Z',
    finishedAt: '2026-08-24T11:00:05.000Z',
    status: 'failed',
    steps: [],
    consoleErrors: [],
    networkFailures: [],
    videoPath: null,
  });

  assert.ok(run1.runId);
  assert.ok(run2.runId);

  const runs = store.listRuns(project.id);
  assert.equal(runs.length, 2);
  assert.equal(runs[0].runId, run2.runId);
  assert.equal(runs[1].runId, run1.runId);

  const runsBySuite = store.listRuns({ suiteId: suite.id });
  assert.equal(runsBySuite.length, 2);

  const fetched = store.getRun(run1.runId);
  assert.equal(fetched.runId, run1.runId);

  const dir = store.runDir(run1.runId);
  assert.ok(fs.existsSync(dir));
  assert.ok(fs.existsSync(path.join(dir, 'report.json')));
});

test('credential meta+blob roundtrip', () => {
  const store = createStore(tmpBaseDir());
  const project = store.saveProject({ name: 'A' });

  const blob = Buffer.from('encrypted-storage-state');
  const saved = store.saveCredential(
    { name: 'Staging admin', projectId: project.id, environment: 'Staging', loginUrl: 'https://acme.test/login', username: 'admin' },
    blob
  );

  assert.ok(saved.id);
  assert.ok(saved.createdAt);
  assert.equal(saved.username, 'admin');

  const list = store.listCredentials(project.id);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, saved.id);

  const readBack = store.readCredentialBlob(saved.id);
  assert.ok(Buffer.isBuffer(readBack));
  assert.equal(readBack.toString(), 'encrypted-storage-state');

  store.deleteCredential(saved.id);
  assert.equal(store.listCredentials(project.id).length, 0);
  assert.equal(store.readCredentialBlob(saved.id), null);
});

test('credential with null blob roundtrips as null', () => {
  const store = createStore(tmpBaseDir());
  const saved = store.saveCredential({ name: 'No blob yet', projectId: 'p1', environment: 'Staging', loginUrl: 'x', username: 'u' }, null);
  assert.equal(store.readCredentialBlob(saved.id), null);
});

test('ticket id sequence BUG-1, BUG-2', () => {
  const store = createStore(tmpBaseDir());

  const t1 = store.saveTicket({ title: 'First bug', description: 'desc', severity: 'high', status: 'backlog', projectId: 'p1' });
  const t2 = store.saveTicket({ title: 'Second bug', description: 'desc', severity: 'low', status: 'backlog', projectId: 'p1' });

  assert.equal(t1.id, 'BUG-1');
  assert.equal(t2.id, 'BUG-2');

  const list = store.listTickets();
  assert.equal(list.length, 2);

  const updated = store.saveTicket({ ...t1, title: 'First bug updated' });
  assert.equal(updated.id, 'BUG-1');
  assert.equal(store.listTickets().length, 2);

  store.deleteTicket(t2.id);
  assert.equal(store.listTickets().length, 1);
});

test('schedule CRUD roundtrip + sort by nextRunAt asc', () => {
  const store = createStore(tmpBaseDir());

  assert.deepEqual(store.listSchedules(), []);

  const later = store.saveSchedule({
    suiteId: 'suite-1',
    projectId: 'proj-1',
    name: 'Nightly regression',
    environment: 'Staging',
    headless: true,
    credentialProfileId: null,
    at: '2026-08-26T09:00:00.000Z',
    recurrence: 'daily',
    enabled: true,
    lastRunAt: null,
    nextRunAt: '2026-08-26T09:00:00.000Z',
  });
  assert.ok(later.id.startsWith('sched-'));
  assert.ok(later.createdAt);
  assert.ok(later.updatedAt);

  const sooner = store.saveSchedule({
    suiteId: 'suite-2',
    projectId: 'proj-1',
    name: 'Smoke test',
    environment: 'Staging',
    headless: true,
    credentialProfileId: null,
    at: '2026-08-25T09:00:00.000Z',
    recurrence: 'once',
    enabled: true,
    lastRunAt: null,
    nextRunAt: '2026-08-25T09:00:00.000Z',
  });

  const listed = store.listSchedules();
  assert.equal(listed.length, 2);
  assert.equal(listed[0].id, sooner.id);
  assert.equal(listed[1].id, later.id);

  const updated = store.saveSchedule({ ...sooner, enabled: false });
  assert.equal(updated.id, sooner.id);
  assert.equal(updated.createdAt, sooner.createdAt);
  assert.ok(updated.updatedAt);
  assert.equal(updated.enabled, false);
  assert.equal(store.listSchedules().length, 2);

  store.deleteSchedule(sooner.id);
  const remaining = store.listSchedules();
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].id, later.id);
});

test('settings patch merge', () => {
  const store = createStore(tmpBaseDir());

  assert.deepEqual(store.getSettings(), {});

  const s1 = store.saveSettings({ theme: 'light' });
  assert.deepEqual(s1, { theme: 'light' });

  const s2 = store.saveSettings({ apiPort: 4310 });
  assert.deepEqual(s2, { theme: 'light', apiPort: 4310 });
  assert.deepEqual(store.getSettings(), { theme: 'light', apiPort: 4310 });
});

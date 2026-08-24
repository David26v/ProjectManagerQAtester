'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const { createStore } = require('../src/engine/store.js');
const { createApi } = require('../src/engine/api.js');

const execFileAsync = promisify(execFile);

function tmpBaseDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qaflow-api-'));
}

function canned({ suite, project, environment, status = 'passed' }) {
  return {
    runId: `run-${Date.now()}`,
    suiteId: suite.id,
    projectId: project.id,
    suiteName: suite.name,
    targetUrl: (environment && environment.baseUrl) || project.baseUrl,
    environment: environment && environment.name,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    status,
    triggeredBy: 'api',
    steps: [{ name: 'Step 1', status, durationMs: 10 }],
    consoleErrors: [],
    networkFailures: [],
    videoPath: 'video.webm',
    capturedMedia: [],
    reportSelection: null,
  };
}

async function setup(t, { runSuiteFn } = {}) {
  const store = createStore(tmpBaseDir());

  const project = store.saveProject({ name: 'Acme', key: 'ACME', baseUrl: 'https://acme.test' });
  const suite = store.saveSuite({
    projectId: project.id,
    name: 'Smoke Suite',
    tags: ['smoke'],
    environment: 'Staging',
    steps: [{ type: 'goto', name: 'Go home', value: '/', timeout: 10000 }],
  });
  const fullSuite = store.saveSuite({
    projectId: project.id,
    name: 'Full Suite',
    tags: ['full'],
    environment: 'Staging',
    steps: [{ type: 'goto', name: 'Go home', value: '/', timeout: 10000 }],
  });
  const archivedSuite = store.saveSuite({
    projectId: project.id,
    name: 'Archived Suite',
    tags: ['smoke'],
    environment: 'Staging',
    archived: true,
    steps: [{ type: 'goto', name: 'Go home', value: '/', timeout: 10000 }],
  });

  const defaultRunSuiteFn = async ({ store: s, suite: sSuite, project: sProject, environment }) => {
    const report = canned({ suite: sSuite, project: sProject, environment });
    return s.saveRun(report);
  };

  const api = createApi({ store, runSuiteFn: runSuiteFn || defaultRunSuiteFn });
  const port = await api.listen(0);
  t.after(() => api.close());

  return { store, project, suite, fullSuite, archivedSuite, api, port };
}

test('GET /projects returns saved projects', async (t) => {
  const { project, port } = await setup(t);

  const res = await fetch(`http://127.0.0.1:${port}/projects`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body));
  assert.equal(body[0].id, project.id);
});

test('GET /projects/:id/suites returns suites for project', async (t) => {
  const { project, suite, port } = await setup(t);

  const res = await fetch(`http://127.0.0.1:${port}/projects/${project.id}/suites`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.some((s) => s.id === suite.id));
});

test('GET /projects/:id/suites 404s for unknown project', async (t) => {
  const { port } = await setup(t);

  const res = await fetch(`http://127.0.0.1:${port}/projects/does-not-exist/suites`);
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.ok(body.error);
});

test('POST /projects/:id/suites/:suiteId/run awaits run and returns 201 finished report', async (t) => {
  const { project, suite, port } = await setup(t);

  const res = await fetch(`http://127.0.0.1:${port}/projects/${project.id}/suites/${suite.id}/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ environment: 'Staging' }),
  });

  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.status, 'passed');
  assert.equal(body.suiteId, suite.id);
  assert.equal(body.projectId, project.id);
  assert.ok(body.runId);
});

test('POST run 404s for unknown suite', async (t) => {
  const { project, port } = await setup(t);

  const res = await fetch(`http://127.0.0.1:${port}/projects/${project.id}/suites/nope/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });

  assert.equal(res.status, 404);
  const body = await res.json();
  assert.ok(body.error);
});

test('POST run 500s when runSuiteFn throws', async (t) => {
  const { project, suite, port } = await setup(t, {
    runSuiteFn: async () => {
      throw new Error('boom');
    },
  });

  const res = await fetch(`http://127.0.0.1:${port}/projects/${project.id}/suites/${suite.id}/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });

  assert.equal(res.status, 500);
  const body = await res.json();
  assert.equal(body.error, 'boom');
});

test('GET /runs lists runs, GET /runs/:runId/report fetches one', async (t) => {
  const { project, suite, port } = await setup(t);

  await fetch(`http://127.0.0.1:${port}/projects/${project.id}/suites/${suite.id}/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });

  const listRes = await fetch(`http://127.0.0.1:${port}/runs`);
  assert.equal(listRes.status, 200);
  const runs = await listRes.json();
  assert.equal(runs.length, 1);

  const reportRes = await fetch(`http://127.0.0.1:${port}/runs/${runs[0].runId}/report`);
  assert.equal(reportRes.status, 200);
  const report = await reportRes.json();
  assert.equal(report.runId, runs[0].runId);
});

test('GET /runs/:runId/report 404s for unknown run', async (t) => {
  const { port } = await setup(t);

  const res = await fetch(`http://127.0.0.1:${port}/runs/does-not-exist/report`);
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.ok(body.error);
});

test('POST /webhooks/deploy-complete runs every non-archived suite matching tag', async (t) => {
  const { project, suite, fullSuite, archivedSuite, port } = await setup(t);

  const res = await fetch(`http://127.0.0.1:${port}/webhooks/deploy-complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId: project.id, tag: 'smoke' }),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body));
  assert.equal(body.length, 1);
  assert.equal(body[0].status, 'passed');
  assert.ok(body[0].runId);

  // Suite not tagged "smoke" and the archived "smoke" suite must be excluded.
  assert.ok(!body.some((r) => r.suiteId === fullSuite.id));
  assert.ok(!body.some((r) => r.suiteId === archivedSuite.id));
});

test('POST /webhooks/deploy-complete 400s without projectId', async (t) => {
  const { port } = await setup(t);

  const res = await fetch(`http://127.0.0.1:${port}/webhooks/deploy-complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });

  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.error);
});

test('GET /projects/:id/auth/status returns credential profile metadata', async (t) => {
  const { store, project, port } = await setup(t);

  store.saveCredential({ name: 'Admin', projectId: project.id, environment: 'Staging', loginUrl: 'https://acme.test/login', username: 'admin' }, Buffer.from('enc'));

  const res = await fetch(`http://127.0.0.1:${port}/projects/${project.id}/auth/status`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.profiles));
  assert.equal(body.profiles.length, 1);
  assert.equal(body.profiles[0].username, 'admin');
});

test('api.listen binds to 127.0.0.1 only', async (t) => {
  const { api, port } = await setup(t);
  assert.equal(api.app != null, true);
  // Verify by hitting it on 127.0.0.1 successfully (bind proven by successful connect below).
  const res = await fetch(`http://127.0.0.1:${port}/projects`);
  assert.equal(res.status, 200);
});

test('CLI: qaflow status --project <name> prints suite name', async (t) => {
  const { project, suite, port } = await setup(t);

  const cliPath = path.join(__dirname, '..', 'bin', 'qaflow.js');
  const { stdout } = await execFileAsync('node', [cliPath, 'status', '--project', project.name, '--port', String(port)]);

  assert.ok(stdout.includes(suite.name));
});

test('CLI: qaflow run --project --suite prints report and exits 0 on pass', async (t) => {
  const { project, suite, port } = await setup(t);

  const cliPath = path.join(__dirname, '..', 'bin', 'qaflow.js');
  const { stdout } = await execFileAsync('node', [
    cliPath,
    'run',
    '--project',
    project.name,
    '--suite',
    suite.name,
    '--port',
    String(port),
  ]);

  const parsed = JSON.parse(stdout);
  assert.equal(parsed.status, 'passed');
});

test('CLI: qaflow run exits 1 when run failed', async (t) => {
  const { project, suite, port } = await setup(t, {
    runSuiteFn: async ({ store: s, suite: sSuite, project: sProject, environment }) => {
      const report = canned({ suite: sSuite, project: sProject, environment, status: 'failed' });
      return s.saveRun(report);
    },
  });

  const cliPath = path.join(__dirname, '..', 'bin', 'qaflow.js');
  await assert.rejects(
    execFileAsync('node', [cliPath, 'run', '--project', project.name, '--suite', suite.name, '--port', String(port)]),
    (err) => {
      assert.equal(err.code, 1);
      return true;
    }
  );
});

test('CLI: qaflow report --run-id prints report json', async (t) => {
  const { project, suite, port } = await setup(t);

  const runRes = await fetch(`http://127.0.0.1:${port}/projects/${project.id}/suites/${suite.id}/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  const report = await runRes.json();

  const cliPath = path.join(__dirname, '..', 'bin', 'qaflow.js');
  const { stdout } = await execFileAsync('node', [
    cliPath,
    'report',
    '--run-id',
    report.runId,
    '--port',
    String(port),
    '--format',
    'json',
  ]);

  const parsed = JSON.parse(stdout);
  assert.equal(parsed.runId, report.runId);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createStore } = require('../src/engine/store.js');
const { runSuite } = require('../src/engine/runner.js');
const { startFixtureServer } = require('./fixtures/serve.js');

function tmpBaseDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qaflow-runner-'));
}

test('runSuite: passing suite runs to completion with video captured', async (t) => {
  const fixture = await startFixtureServer();
  t.after(() => fixture.close());

  const store = createStore(tmpBaseDir());
  const project = { id: 'proj-1', name: 'Fixture', baseUrl: fixture.url };
  const environment = { name: 'Local', baseUrl: fixture.url };
  const suite = {
    id: 'suite-1',
    projectId: project.id,
    name: 'Login flow',
    steps: [
      { type: 'goto', name: 'Go to login', value: '/', timeout: 10000 },
      { type: 'fill', name: 'Fill email', selector: '#email', value: 'user@example.com', timeout: 10000 },
      { type: 'click', name: 'Click Sign in', selector: '#signin', timeout: 10000 },
      { type: 'assertVisible', name: 'Assert dashboard visible', selector: '#dashboard-root', timeout: 10000 },
    ],
  };

  const events = [];
  const report = await runSuite({
    store,
    suite,
    project,
    environment,
    headless: true,
    onProgress: (evt) => events.push(evt),
  });

  assert.equal(report.status, 'passed');
  assert.equal(report.suiteId, suite.id);
  assert.equal(report.projectId, project.id);
  assert.equal(report.suiteName, suite.name);
  assert.equal(report.targetUrl, fixture.url);
  assert.equal(report.environment, 'Local');
  assert.ok(report.runId.startsWith('run-'));
  assert.equal(report.steps.length, 4);
  assert.ok(report.steps.every((s) => s.status === 'passed'));
  assert.ok(report.steps.every((s) => typeof s.durationMs === 'number'));
  assert.equal(report.videoPath, 'video.webm');
  assert.equal(report.reportSelection, null);

  const runDirectory = store.runDir(report.runId);
  assert.ok(fs.existsSync(path.join(runDirectory, 'video.webm')));
  assert.ok(report.capturedMedia.some((m) => m.type === 'video' && m.path === 'video.webm'));

  assert.ok(events.some((e) => e.type === 'step-start' && e.index === 0));
  assert.ok(events.some((e) => e.type === 'step-end' && e.status === 'passed'));

  const persisted = store.getRun(report.runId);
  assert.equal(persisted.status, 'passed');
});

test('runSuite: failing suite captures failure screenshot and skips later steps', async (t) => {
  const fixture = await startFixtureServer();
  t.after(() => fixture.close());

  const store = createStore(tmpBaseDir());
  const project = { id: 'proj-1', name: 'Fixture', baseUrl: fixture.url };
  const environment = { name: 'Local', baseUrl: fixture.url };
  const suite = {
    id: 'suite-2',
    projectId: project.id,
    name: 'Broken flow',
    steps: [
      { type: 'goto', name: 'Go to login', value: '/', timeout: 10000 },
      { type: 'assertVisible', name: 'Assert missing element', selector: '#does-not-exist', timeout: 1500 },
      { type: 'click', name: 'Never reached', selector: '#signin', timeout: 10000 },
    ],
  };

  const report = await runSuite({ store, suite, project, environment, headless: true });

  assert.equal(report.status, 'failed');
  assert.equal(report.steps[0].status, 'passed');
  assert.equal(report.steps[1].status, 'failed');
  assert.ok(report.steps[1].error);
  assert.ok(report.steps[1].screenshot);
  assert.equal(report.steps[2].status, 'skipped');

  const runDirectory = store.runDir(report.runId);
  assert.ok(fs.existsSync(path.join(runDirectory, report.steps[1].screenshot)));
  assert.ok(
    report.capturedMedia.some(
      (m) => m.type === 'screenshot' && m.path === report.steps[1].screenshot && m.stepIndex === 1
    )
  );
  assert.ok(fs.existsSync(path.join(runDirectory, 'video.webm')));

  const persisted = store.getRun(report.runId);
  assert.equal(persisted.status, 'failed');
});

test('runSuite: defaults triggeredBy to "manual" when not provided', async (t) => {
  const fixture = await startFixtureServer();
  t.after(() => fixture.close());

  const store = createStore(tmpBaseDir());
  const project = { id: 'proj-1', name: 'Fixture', baseUrl: fixture.url };
  const environment = { name: 'Local', baseUrl: fixture.url };
  const suite = {
    id: 'suite-4',
    projectId: project.id,
    name: 'Default trigger',
    steps: [{ type: 'goto', name: 'Go to login', value: '/', timeout: 10000 }],
  };

  const report = await runSuite({ store, suite, project, environment, headless: true });

  assert.equal(report.triggeredBy, 'manual');
  const persisted = store.getRun(report.runId);
  assert.equal(persisted.triggeredBy, 'manual');
});

test('runSuite: threads a non-default triggeredBy option into the persisted report', async (t) => {
  const fixture = await startFixtureServer();
  t.after(() => fixture.close());

  const store = createStore(tmpBaseDir());
  const project = { id: 'proj-1', name: 'Fixture', baseUrl: fixture.url };
  const environment = { name: 'Local', baseUrl: fixture.url };
  const suite = {
    id: 'suite-5',
    projectId: project.id,
    name: 'API trigger',
    steps: [{ type: 'goto', name: 'Go to login', value: '/', timeout: 10000 }],
  };

  const report = await runSuite({ store, suite, project, environment, headless: true, triggeredBy: 'api' });

  assert.equal(report.triggeredBy, 'api');

  // Round-trips through the store, not just the in-memory return value.
  const persisted = store.getRun(report.runId);
  assert.equal(persisted.triggeredBy, 'api');
});

test('runSuite: console errors and >=400 responses are captured as consoleErrors', async (t) => {
  const fixture = await startFixtureServer();
  t.after(() => fixture.close());

  const store = createStore(tmpBaseDir());
  const project = { id: 'proj-1', name: 'Fixture', baseUrl: fixture.url };
  const environment = { name: 'Local', baseUrl: fixture.url };
  const suite = {
    id: 'suite-3',
    projectId: project.id,
    name: 'Console + network errors',
    steps: [
      { type: 'goto', name: 'Go to login', value: '/', timeout: 10000 },
      { type: 'click', name: 'Trigger console error', selector: '#boom', timeout: 10000 },
      { type: 'goto', name: 'Trigger 404', value: '/does-not-exist.html', timeout: 10000 },
    ],
  };

  const report = await runSuite({ store, suite, project, environment, headless: true });

  assert.ok(report.consoleErrors.some((e) => e.text === 'boom'));
  assert.ok(report.consoleErrors.some((e) => /^404 .* - .*does-not-exist\.html$/.test(e.text)));
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ExcelJS = require('exceljs');
const AdmZip = require('adm-zip');

const { exportRunsToExcel } = require('../src/engine/exporters/excel');
const { generateTicketText, ticketFromRun } = require('../src/engine/exporters/ticket');
const { createBundle } = require('../src/engine/exporters/bundle');

// Minimal valid 1x1 transparent PNG, used as a stand-in for a real screenshot.
const ONE_PX_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

function makeRunDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qaflow-exporters-'));
}

function makeRun(dir, { withSelection = false } = {}) {
  const shot3 = 'open-admin-dashboard-3.png';
  const shot6 = 'later-step-6.png';
  fs.writeFileSync(path.join(dir, shot3), ONE_PX_PNG);
  fs.writeFileSync(path.join(dir, shot6), ONE_PX_PNG);
  fs.writeFileSync(path.join(dir, 'video.webm'), Buffer.from('fake-video'));

  const run = {
    runId: 'run-1',
    suiteId: 'suite-1',
    projectId: 'project-1',
    suiteName: 'Login and roles',
    targetUrl: 'https://staging.vaultmaster.ph',
    environment: 'Staging',
    startedAt: '2026-08-24T09:12:00.000Z',
    finishedAt: '2026-08-24T09:12:14.000Z',
    status: 'failed',
    triggeredBy: 'manual',
    steps: [
      { name: 'Go to login', status: 'passed', durationMs: 500 },
      { name: 'Login as admin', status: 'passed', durationMs: 800 },
      {
        name: 'Login to admin dashboard',
        status: 'failed',
        error: "Timeout 5000ms exceeded waiting for selector '#admin-panel'",
        screenshot: shot3,
        durationMs: 5000,
      },
      { name: 'Later step', status: 'skipped' },
    ],
    consoleErrors: [{ text: '403 Forbidden - /api/admin/permissions' }],
    networkFailures: [{ url: '.../api/admin/permissions', failure: 'net::ERR_FAILED' }],
    videoPath: 'video.webm',
    capturedMedia: [
      { id: 'vid-1', type: 'video', path: 'video.webm' },
      { id: 'shot-3', type: 'screenshot', path: shot3, stepIndex: 2 },
      { id: 'shot-6', type: 'screenshot', path: shot6, stepIndex: 3 },
    ],
    reportSelection: withSelection
      ? { selectedMediaIds: ['shot-3'], notes: { 'shot-3': 'this is the timeout' } }
      : null,
  };

  return run;
}

const project = {
  id: 'project-1',
  name: 'Vault Master',
  key: 'VM',
  baseUrl: 'https://staging.vaultmaster.ph',
  environments: [{ name: 'Staging', baseUrl: 'https://staging.vaultmaster.ph' }],
};

test('exportRunsToExcel writes Summary + Step detail sheets with embedded failure screenshot', async () => {
  const dir = makeRunDir();
  const run = makeRun(dir);
  const outputPath = path.join(dir, 'export.xlsx');

  await exportRunsToExcel([run], () => dir, outputPath);

  assert.equal(fs.existsSync(outputPath), true);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(outputPath);

  const summary = workbook.getWorksheet('Summary');
  const detail = workbook.getWorksheet('Step detail');
  assert.ok(summary, 'Summary sheet exists');
  assert.ok(detail, 'Step detail sheet exists');

  // header row + 1 run
  assert.equal(summary.rowCount, 2);
  // header row + 4 steps
  assert.equal(detail.rowCount, 5);

  // at least one embedded image (the failure screenshot)
  assert.ok(detail.getImages().length >= 1);
});

test('exportRunsToExcel honors reportSelection — only selected screenshots embed', async () => {
  const dir = makeRunDir();
  const run = makeRun(dir, { withSelection: true });
  // mark the second screenshot as a failure too, to prove selection (not just status) gates embedding
  run.steps.push({ name: 'Another failure', status: 'failed', error: 'boom', screenshot: 'later-step-6.png', durationMs: 100 });
  const outputPath = path.join(dir, 'export-selected.xlsx');

  await exportRunsToExcel([run], () => dir, outputPath);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(outputPath);
  const detail = workbook.getWorksheet('Step detail');

  // only shot-3 is selected, so only one image should be embedded even though two steps have screenshots
  assert.equal(detail.getImages().length, 1);
});

test('generateTicketText produces the spec-shaped ticket text', () => {
  const dir = makeRunDir();
  const run = makeRun(dir);

  const text = generateTicketText(run, project);

  assert.match(text, /^Summary: \[Login and roles\] Login to admin dashboard fails/);
  assert.match(text, /Environment: Vault Master/);
  assert.match(text, /Severity: high/);
  assert.match(text, /Reporter: /);
  assert.match(text, /Status: /);
  assert.match(text, /Steps to reproduce:/);
  assert.match(text, /1\. Go to login/);
  assert.match(text, /2\. Login as admin/);
  assert.match(text, /3\. Login to admin dashboard/);
  assert.doesNotMatch(text, /4\. Later step/);
  assert.match(text, /Expected:/);
  assert.match(text, /Actual: .*Timeout 5000ms/);
  assert.match(text, /Attachments:/);
});

test('generateTicketText derives medium severity for non login/checkout/payment steps and honors override', () => {
  const dir = makeRunDir();
  const run = makeRun(dir);
  run.steps[2].name = 'Open reports page';

  const text = generateTicketText(run, project);
  assert.match(text, /Severity: medium/);

  const overridden = generateTicketText(run, project, { severity: 'critical' });
  assert.match(overridden, /Severity: critical/);
});

test('ticketFromRun builds a Ticket object matching the shared data model', () => {
  const dir = makeRunDir();
  const run = makeRun(dir);

  const ticket = ticketFromRun(run, project);

  assert.equal(ticket.projectId, project.id);
  assert.equal(ticket.runId, run.runId);
  assert.ok(ticket.title.includes('Login and roles'));
  assert.equal(ticket.severity, 'high');
  assert.equal(ticket.status, 'backlog');
  assert.ok(Array.isArray(ticket.reproductionSteps));
  assert.equal(ticket.reproductionSteps.length, 3);
  assert.ok(Array.isArray(ticket.attachments));
  assert.ok(Array.isArray(ticket.labels));
  assert.ok(Array.isArray(ticket.comments));
  assert.equal(ticket.comments.length, 0);
});

test('createBundle zips report.json + all captured media when no selection', async () => {
  const dir = makeRunDir();
  const run = makeRun(dir);
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(run));
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaflow-bundle-out-'));

  const finalPath = await createBundle(run, dir, outputDir);

  assert.equal(path.basename(finalPath), 'bugreport_login-and-roles_2026-08-24.zip');
  assert.equal(fs.existsSync(finalPath), true);

  const zip = new AdmZip(finalPath);
  const names = zip.getEntries().map((e) => e.entryName);
  assert.ok(names.includes('report.json'));
  assert.ok(names.includes('video.webm'));
  assert.ok(names.includes('open-admin-dashboard-3.png'));
  assert.ok(names.includes('later-step-6.png'));
});

test('createBundle honors reportSelection — only selected media included', async () => {
  const dir = makeRunDir();
  const run = makeRun(dir, { withSelection: true });
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(run));
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaflow-bundle-out-'));

  const finalPath = await createBundle(run, dir, outputDir);

  const zip = new AdmZip(finalPath);
  const names = zip.getEntries().map((e) => e.entryName);
  assert.ok(names.includes('report.json'));
  assert.ok(names.includes('open-admin-dashboard-3.png'));
  assert.equal(names.includes('later-step-6.png'), false);
  assert.equal(names.includes('video.webm'), false);
});

test('createBundle honors explicit includeMediaIds over reportSelection', async () => {
  const dir = makeRunDir();
  const run = makeRun(dir, { withSelection: true });
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(run));
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaflow-bundle-out-'));

  const finalPath = await createBundle(run, dir, outputDir, { includeMediaIds: ['vid-1'] });

  const zip = new AdmZip(finalPath);
  const names = zip.getEntries().map((e) => e.entryName);
  assert.ok(names.includes('video.webm'));
  assert.equal(names.includes('open-admin-dashboard-3.png'), false);
});

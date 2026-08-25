'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
require('dotenv').config();

const PREFIX = 'astreus-test-';

function tmpBaseDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qaflow-cloud-'));
}

// Every row created in this suite carries an `astreus-test-` prefixed id so
// the `finally` cleanup below can find and delete exactly what it created —
// this DB is live and shared with other test runs / the real app.
async function cleanup(prisma) {
  await prisma.run.deleteMany({ where: { runId: { startsWith: PREFIX } } });
  await prisma.suite.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await prisma.project.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await prisma.ticket.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await prisma.credentialProfile.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await prisma.schedule.deleteMany({ where: { id: { startsWith: PREFIX } } });
}

test('cloud store round-trips the v1 store interface', async (t) => {
  if (!process.env.DATABASE_URL) return t.skip('DATABASE_URL not set');

  const { createPrisma } = require('../src/engine/cloud/db.js');
  const { createStore } = require('../src/engine/store.js');
  const { createCloudStore } = require('../src/engine/cloud-store.js');

  const prisma = createPrisma();
  const localStore = createStore(tmpBaseDir());
  const store = createCloudStore({ prisma, supabase: null, localStore });

  try {
    // ---- projects ----
    assert.deepEqual(await store.listProjects().then((l) => l.filter((p) => p.id.startsWith(PREFIX))), []);

    const project = await store.saveProject({
      id: `${PREFIX}project-1`,
      name: 'Acme',
      key: 'ACME',
      baseUrl: 'https://acme.test',
    });
    assert.equal(project.id, `${PREFIX}project-1`);
    assert.ok(project.createdAt);
    assert.ok(project.updatedAt);
    assert.equal(typeof project.createdAt, 'string');

    const fetchedProject = await store.getProject(project.id);
    assert.equal(fetchedProject.name, 'Acme');

    const updatedProject = await store.saveProject({ id: project.id, name: 'Acme Inc' });
    assert.equal(updatedProject.createdAt, project.createdAt);
    assert.equal(updatedProject.name, 'Acme Inc');
    assert.notEqual(updatedProject.updatedAt, project.updatedAt === undefined);

    // ---- suites ----
    const suiteA = await store.saveSuite({ id: `${PREFIX}suite-a`, projectId: project.id, name: 'Login flow', steps: [] });
    const suiteB = await store.saveSuite({ id: `${PREFIX}suite-b`, projectId: project.id, name: 'Checkout flow', steps: [] });

    const suitesForProject = await store.listSuites(project.id);
    assert.equal(suitesForProject.length, 2);
    assert.ok(suitesForProject.every((s) => s.projectId === project.id));

    const fetchedSuite = await store.getSuite(suiteA.id);
    assert.equal(fetchedSuite.name, 'Login flow');

    // ---- runs ----
    const run1 = await store.saveRun({
      runId: `${PREFIX}run-1`,
      suiteId: suiteA.id,
      projectId: project.id,
      suiteName: suiteA.name,
      targetUrl: 'https://acme.test',
      startedAt: '2026-08-24T10:00:00.000Z',
      finishedAt: '2026-08-24T10:00:05.000Z',
      status: 'passed',
      steps: [],
      consoleErrors: [],
      networkFailures: [],
      videoPath: null,
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const run2 = await store.saveRun({
      runId: `${PREFIX}run-2`,
      suiteId: suiteB.id,
      projectId: project.id,
      suiteName: suiteB.name,
      targetUrl: 'https://acme.test',
      startedAt: '2026-08-24T11:00:00.000Z',
      finishedAt: '2026-08-24T11:00:05.000Z',
      status: 'failed',
      steps: [],
      consoleErrors: [],
      networkFailures: [],
      videoPath: null,
    });

    const runsForProject = await store.listRuns(project.id);
    assert.equal(runsForProject.length, 2);
    assert.equal(runsForProject[0].runId, run2.runId, 'newest first');
    assert.equal(runsForProject[1].runId, run1.runId);

    const runsForSuiteA = await store.listRuns({ projectId: project.id, suiteId: suiteA.id });
    assert.equal(runsForSuiteA.length, 1);
    assert.equal(runsForSuiteA[0].runId, run1.runId);

    const fetchedRun = await store.getRun(run1.runId);
    assert.equal(fetchedRun.runId, run1.runId);
    assert.equal(fetchedRun.status, 'passed');

    const dir = store.runDir(run1.runId);
    assert.ok(typeof dir === 'string' && dir.length > 0);

    // ---- credentials ----
    const blob = Buffer.from('encrypted-storage-state');
    const savedCred = await store.saveCredential(
      { id: `${PREFIX}cred-1`, name: 'Staging admin', projectId: project.id, environment: 'Staging', loginUrl: 'https://acme.test/login', username: 'admin' },
      blob
    );
    assert.equal(savedCred.username, 'admin');

    const listedCreds = await store.listCredentials(project.id);
    assert.equal(listedCreds.length, 1);
    assert.equal(listedCreds[0].id, savedCred.id);

    const readBack = await store.getCredentialBlob(savedCred.id);
    assert.ok(Buffer.isBuffer(readBack));
    assert.equal(readBack.toString(), 'encrypted-storage-state');

    await store.deleteCredential(savedCred.id);
    assert.equal((await store.listCredentials(project.id)).length, 0);
    assert.equal(await store.getCredentialBlob(savedCred.id), null);

    // ---- tickets + atomic nextTicketId ----
    const ids = await Promise.all(Array.from({ length: 5 }, () => store.nextTicketId()));
    const numbers = ids.map((id) => Number(id.replace('BUG-', '')));
    assert.equal(new Set(numbers).size, 5, 'all 5 concurrent ids must be distinct');
    const sorted = [...numbers].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      assert.equal(sorted[i], sorted[i - 1] + 1, 'ids must be strictly sequential');
    }
    for (const id of ids) assert.match(id, /^BUG-\d+$/);

    const ticket = await store.saveTicket({ id: `${PREFIX}bug-1`, title: 'First bug', description: 'desc', severity: 'high', status: 'backlog', projectId: project.id });
    assert.equal(ticket.id, `${PREFIX}bug-1`);
    assert.ok(ticket.createdAt);

    const updatedTicket = await store.saveTicket({ id: ticket.id, title: 'First bug updated' });
    assert.equal(updatedTicket.createdAt, ticket.createdAt);
    assert.equal(updatedTicket.title, 'First bug updated');

    const listedTickets = await store.listTickets();
    assert.ok(listedTickets.some((t2) => t2.id === ticket.id));

    await store.deleteTicket(ticket.id);
    assert.ok(!(await store.listTickets()).some((t2) => t2.id === ticket.id));

    // ---- schedules ----
    const later = await store.saveSchedule({
      id: `${PREFIX}sched-later`,
      suiteId: suiteA.id,
      projectId: project.id,
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
    const sooner = await store.saveSchedule({
      id: `${PREFIX}sched-sooner`,
      suiteId: suiteB.id,
      projectId: project.id,
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

    const listedSchedules = (await store.listSchedules()).filter((s) => s.id.startsWith(PREFIX));
    assert.equal(listedSchedules.length, 2);
    assert.equal(listedSchedules[0].id, sooner.id, 'ascending by nextRunAt');
    assert.equal(listedSchedules[1].id, later.id);

    const updatedSchedule = await store.saveSchedule({ id: sooner.id, enabled: false });
    assert.equal(updatedSchedule.createdAt, sooner.createdAt);
    assert.equal(updatedSchedule.enabled, false);

    await store.deleteSchedule(sooner.id);
    const remainingSchedules = (await store.listSchedules()).filter((s) => s.id.startsWith(PREFIX));
    assert.equal(remainingSchedules.length, 1);
    assert.equal(remainingSchedules[0].id, later.id);
    await store.deleteSchedule(later.id);

    // ---- settings (delegated to localStore) ----
    const settings = await store.saveSettings({ theme: 'light' });
    assert.deepEqual(settings, { theme: 'light' });
    assert.deepEqual(await store.getSettings(), { theme: 'light' });

    // ---- delete cascades ----
    await store.deleteSuite(suiteB.id);
    assert.equal((await store.listRuns({ projectId: project.id, suiteId: suiteB.id })).length, 0);
    assert.equal(await store.getSuite(suiteB.id), undefined);

    await store.deleteProject(project.id);
    assert.equal(await store.getProject(project.id), undefined);
    assert.equal((await store.listSuites(project.id)).length, 0);
    assert.equal((await store.listRuns({ projectId: project.id })).length, 0);
  } finally {
    await cleanup(prisma);
    await prisma.$disconnect();
  }
});

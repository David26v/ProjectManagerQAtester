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
  await prisma.run.deleteMany({ where: { OR: [{ runId: { startsWith: PREFIX } }, { workspaceId: { startsWith: PREFIX } }] } });
  await prisma.suite.deleteMany({ where: { OR: [{ id: { startsWith: PREFIX } }, { workspaceId: { startsWith: PREFIX } }] } });
  await prisma.project.deleteMany({ where: { OR: [{ id: { startsWith: PREFIX } }, { workspaceId: { startsWith: PREFIX } }] } });
  await prisma.ticket.deleteMany({ where: { workspaceId: { startsWith: PREFIX } } });
  await prisma.ticketCounter.deleteMany({ where: { workspaceId: { startsWith: PREFIX } } });
  await prisma.credentialProfile.deleteMany({ where: { OR: [{ id: { startsWith: PREFIX } }, { workspaceId: { startsWith: PREFIX } }] } });
  await prisma.schedule.deleteMany({ where: { OR: [{ id: { startsWith: PREFIX } }, { workspaceId: { startsWith: PREFIX } }] } });
}

test('cloud store round-trips the v1 store interface', async (t) => {
  if (!process.env.DATABASE_URL) return t.skip('DATABASE_URL not set');

  const { createPrisma } = require('../src/engine/cloud/db.js');
  const { createStore } = require('../src/engine/store.js');
  const { createCloudStore } = require('../src/engine/cloud-store.js');

  const prisma = createPrisma();
  const localStore = createStore(tmpBaseDir());
  const store = createCloudStore({ prisma, supabase: null, localStore, getWorkspaceId: () => `${PREFIX}ws-main` });

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

    // Guard against the two timestamps landing in the same millisecond.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const updatedProject = await store.saveProject({ id: project.id, name: 'Acme Inc' });
    assert.equal(updatedProject.createdAt, project.createdAt);
    assert.equal(updatedProject.name, 'Acme Inc');
    assert.notEqual(updatedProject.updatedAt, project.updatedAt);

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

// A stub `supabase` — cloud-store only ever reaches Supabase through
// `storage.from(bucket).upload(...)` (via `uploadRunMedia`), so a minimal
// fake covering just that call is enough to drive `saveRun`'s upload/gating
// logic deterministically, without touching the real bucket.
function stubSupabase(failFilenames) {
  return {
    storage: {
      from() {
        return {
          async upload(key) {
            const filename = key.split('/').pop();
            if (failFilenames.has(filename)) {
              return { error: new Error(`stub upload failure for ${filename}`) };
            }
            return { error: null };
          },
        };
      },
    },
  };
}

test('cloud store: saveRun keeps the local run dir on partial media upload failure, removes it on full success', async (t) => {
  if (!process.env.DATABASE_URL) return t.skip('DATABASE_URL not set');

  const { createPrisma } = require('../src/engine/cloud/db.js');
  const { createStore } = require('../src/engine/store.js');
  const { createCloudStore } = require('../src/engine/cloud-store.js');

  const prisma = createPrisma();
  const localStore = createStore(tmpBaseDir());

  const baseRun = (runId, capturedMedia, steps) => ({
    runId,
    suiteId: `${PREFIX}suite-media`,
    projectId: `${PREFIX}project-media`,
    suiteName: 'Media suite',
    targetUrl: 'https://acme.test',
    startedAt: '2026-08-25T10:00:00.000Z',
    finishedAt: '2026-08-25T10:00:05.000Z',
    status: 'failed',
    steps,
    consoleErrors: [],
    networkFailures: [],
    capturedMedia,
  });

  try {
    // ---- partial failure: one file uploads, one doesn't ----
    const partialRunId = `${PREFIX}run-media-partial`;
    const partialStore = createCloudStore({ prisma, supabase: stubSupabase(new Set(['bad.png'])), localStore, getWorkspaceId: () => `${PREFIX}ws-main` });
    const partialDir = localStore.runDir(partialRunId);
    fs.mkdirSync(partialDir, { recursive: true });
    fs.writeFileSync(path.join(partialDir, 'ok.png'), 'ok-bytes');
    fs.writeFileSync(path.join(partialDir, 'bad.png'), 'bad-bytes');

    const partialSaved = await partialStore.saveRun(
      baseRun(
        partialRunId,
        [
          { id: 'a', type: 'screenshot', path: 'ok.png', stepIndex: 0 },
          { id: 'b', type: 'screenshot', path: 'bad.png', stepIndex: 1 },
        ],
        [{ name: 'step 2', status: 'failed', error: 'boom', screenshot: 'bad.png' }]
      )
    );

    assert.ok(fs.existsSync(partialDir), 'local run dir must survive a partial upload failure');

    const okEntry = partialSaved.capturedMedia.find((m) => m.id === 'a');
    assert.equal(okEntry.path, `storage:${partialRunId}/ok.png`, 'succeeded file is rewritten to a storage: path');
    assert.equal(okEntry.mediaUploadError, undefined);

    const badEntry = partialSaved.capturedMedia.find((m) => m.id === 'b');
    assert.equal(badEntry.path, 'bad.png', 'failed file keeps its local filename so the qaflow-media:// fallback still resolves it');
    assert.match(badEntry.mediaUploadError, /stub upload failure/);

    // The failed screenshot field must also stay local — its backing file is
    // still on disk (the dir wasn't removed), unlike a field pointing at a
    // file that did upload successfully.
    assert.equal(partialSaved.steps[0].screenshot, 'bad.png');

    // Re-fetching from Postgres confirms the mutated report (with the
    // partial storage: rewrite + mediaUploadError) was persisted, not just
    // returned in memory.
    const refetched = await partialStore.getRun(partialRunId);
    assert.equal(refetched.capturedMedia.find((m) => m.id === 'a').path, `storage:${partialRunId}/ok.png`);
    assert.ok(refetched.capturedMedia.find((m) => m.id === 'b').mediaUploadError);

    // ---- full success: every file uploads, dir is reclaimed ----
    const fullRunId = `${PREFIX}run-media-full`;
    const fullStore = createCloudStore({ prisma, supabase: stubSupabase(new Set()), localStore, getWorkspaceId: () => `${PREFIX}ws-main` });
    const fullDir = localStore.runDir(fullRunId);
    fs.mkdirSync(fullDir, { recursive: true });
    fs.writeFileSync(path.join(fullDir, 'ok.png'), 'ok-bytes');

    const fullSaved = await fullStore.saveRun(
      baseRun(fullRunId, [{ id: 'c', type: 'screenshot', path: 'ok.png', stepIndex: 0 }], [])
    );

    assert.equal(fullSaved.capturedMedia[0].path, `storage:${fullRunId}/ok.png`);
    assert.ok(!fs.existsSync(fullDir), 'local run dir is reclaimed once every file uploads successfully');
  } finally {
    if (fs.existsSync(localStore.runDir(`${PREFIX}run-media-partial`))) {
      fs.rmSync(localStore.runDir(`${PREFIX}run-media-partial`), { recursive: true, force: true });
    }
    await cleanup(prisma);
    await prisma.$disconnect();
  }
});

test('cloud store: rows are invisible across workspaces and limits are enforced', async (t) => {
  if (!process.env.DATABASE_URL) return t.skip('DATABASE_URL not set');

  const { createPrisma } = require('../src/engine/cloud/db.js');
  const { createStore } = require('../src/engine/store.js');
  const { createCloudStore } = require('../src/engine/cloud-store.js');

  const prisma = createPrisma();
  const wsA = `${PREFIX}ws-a`;
  const wsB = `${PREFIX}ws-b`;
  const storeA = createCloudStore({ prisma, supabase: null, localStore: createStore(tmpBaseDir()), getWorkspaceId: () => wsA });
  const storeB = createCloudStore({ prisma, supabase: null, localStore: createStore(tmpBaseDir()), getWorkspaceId: () => wsB });
  const now = new Date();

  try {
    // B is a real workspace row with a 1-project cap; A has no row (unlimited).
    await prisma.workspace.create({
      data: { id: wsB, name: 'B', slug: wsB, plan: 'free', maxProjects: 1, createdAt: now, updatedAt: now },
    });

    const pA = await storeA.saveProject({ id: `${PREFIX}iso-p-a`, name: 'A proj', key: 'A', baseUrl: 'https://a.test' });
    const pB = await storeB.saveProject({ id: `${PREFIX}iso-p-b`, name: 'B proj', key: 'B', baseUrl: 'https://b.test' });

    // lists are scoped
    assert.deepEqual((await storeA.listProjects()).map((p) => p.id), [pA.id]);
    assert.deepEqual((await storeB.listProjects()).map((p) => p.id), [pB.id]);
    // gets across the fence are "not found"
    assert.equal(await storeA.getProject(pB.id), undefined);
    assert.equal(await storeB.getProject(pA.id), undefined);
    // a write with a foreign id is refused, never an overwrite
    await assert.rejects(() => storeB.saveProject({ id: pA.id, name: 'hijack' }), /not found/i);
    assert.equal((await storeA.getProject(pA.id)).name, 'A proj');
    // deletes across the fence are no-ops
    await storeB.deleteProject(pA.id);
    assert.ok(await storeA.getProject(pA.id));

    // suites/runs/tickets/schedules/credentials follow the same rule
    const sA = await storeA.saveSuite({ id: `${PREFIX}iso-s-a`, projectId: pA.id, name: 'S', steps: [] });
    assert.equal(await storeB.getSuite(sA.id), undefined);
    await storeA.saveRun({ runId: `${PREFIX}iso-run-a`, suiteId: sA.id, projectId: pA.id, suiteName: 'S', status: 'passed', startedAt: now.toISOString(), finishedAt: now.toISOString(), steps: [], capturedMedia: [] });
    assert.equal((await storeB.listRuns()).length, 0);
    assert.equal(await storeB.getRun(`${PREFIX}iso-run-a`), undefined);
    // a saveRun with a foreign runId is refused, never an overwrite
    await assert.rejects(
      () => storeB.saveRun({ runId: `${PREFIX}iso-run-a`, suiteId: 'x', projectId: 'x', suiteName: 'hijack', status: 'failed', startedAt: now.toISOString(), steps: [], capturedMedia: [] }),
      /not found/i
    );
    assert.equal((await storeA.getRun(`${PREFIX}iso-run-a`)).suiteName, 'S');

    // independent ticket numbering per workspace
    assert.equal(await storeA.nextTicketId(), 'BUG-1');
    assert.equal(await storeB.nextTicketId(), 'BUG-1');
    const tA = await storeA.saveTicket({ title: 'A bug', severity: 'low', status: 'backlog' });
    const tB = await storeB.saveTicket({ title: 'B bug', severity: 'low', status: 'backlog' });
    assert.equal(tA.id, 'BUG-2');
    assert.equal(tB.id, 'BUG-2');
    assert.deepEqual((await storeA.listTickets()).map((x) => x.title), ['A bug']);

    await storeA.saveSchedule({ id: `${PREFIX}iso-sched-a`, suiteId: sA.id, projectId: pA.id, name: 'n', at: now.toISOString(), recurrence: 'once' });
    assert.equal((await storeB.listSchedules()).length, 0);
    await storeA.saveCredential({ id: `${PREFIX}iso-cred-a`, name: 'c', projectId: pA.id }, null);
    assert.equal((await storeB.listCredentials()).length, 0);

    // plan limit: B already has 1 project and maxProjects = 1
    await assert.rejects(
      () => storeB.saveProject({ id: `${PREFIX}iso-p-b2`, name: 'B proj 2', key: 'B2', baseUrl: 'https://b2.test' }),
      /Project limit reached for your plan \(1\)/
    );
    // updates to the existing project are still allowed under the cap
    assert.equal((await storeB.saveProject({ id: pB.id, name: 'B renamed' })).name, 'B renamed');

    // no workspace → refuse
    const storeNone = createCloudStore({ prisma, supabase: null, localStore: createStore(tmpBaseDir()), getWorkspaceId: () => null });
    await assert.rejects(() => storeNone.listProjects(), /No active workspace/);
  } finally {
    await cleanup(prisma);
    await prisma.workspace.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  }
});

'use strict';

// Prisma-backed store implementing the same interface as `engine/store.js`
// (`createStore(baseDir)`), so every consumer (ipc.js, api.js) can keep
// calling `store.*` unchanged — this is just the cloud-primary shape of it.
// Every method returns a Promise; v1's methods are sync, but every call
// site already `await`s (or tolerates a Promise from) `store.*`.
//
// Rows store `createdAt`/`updatedAt`/etc. as Postgres `DateTime`; the
// interface hands back ISO strings exactly like the JSON store did.
//
// `localStore` (a v1 `createStore(baseDir)` instance) is used ONLY for:
// credential blobs (the encrypted storageState half of `saveCredential` /
// `getCredentialBlob`), `getSettings`/`saveSettings`, and `runDir` (the
// local scratch dir for a run in flight, before Task 3 uploads its media).
// Credential/project/etc. *metadata* always lives in Postgres — only the
// secret bytes and this device's own settings stay local.

const crypto = require('node:crypto');
const fs = require('node:fs');

const { uploadRunMedia } = require('./cloud/media.js');

function toIso(date) {
  return date instanceof Date ? date.toISOString() : date;
}

function serializeProject(row) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    key: row.key,
    baseUrl: row.baseUrl,
    type: row.type,
    environments: row.environments,
    defaultEnvironment: row.defaultEnvironment,
    description: row.description,
    primary: row.primary,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function serializeSuite(row) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    name: row.name,
    description: row.description,
    tags: row.tags,
    environment: row.environment,
    steps: row.steps,
    archived: row.archived,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function serializeCredential(row) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    projectId: row.projectId,
    environment: row.environment,
    loginUrl: row.loginUrl,
    username: row.username,
    encrypted: row.encrypted,
    deviceLabel: row.deviceLabel,
    mode: row.mode,
    createdAt: toIso(row.createdAt),
    lastUsedAt: toIso(row.lastUsedAt),
  };
}

function serializeTicket(row) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    title: row.title,
    description: row.description,
    severity: row.severity,
    status: row.status,
    projectId: row.projectId,
    runId: row.runId,
    labels: row.labels,
    assignee: row.assignee,
    reporter: row.reporter,
    reproductionSteps: row.reproductionSteps,
    attachments: row.attachments,
    comments: row.comments,
    checklist: row.checklist,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function serializeSchedule(row) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    suiteId: row.suiteId,
    projectId: row.projectId,
    name: row.name,
    environment: row.environment,
    headless: row.headless,
    credentialProfileId: row.credentialProfileId,
    at: toIso(row.at),
    recurrence: row.recurrence,
    enabled: row.enabled,
    lastRunAt: toIso(row.lastRunAt),
    nextRunAt: toIso(row.nextRunAt),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function hasLocalMedia(report) {
  return (report.capturedMedia || []).some((m) => typeof m.path === 'string' && !m.path.startsWith('storage:'));
}

function createCloudStore({ prisma, supabase, localStore, getWorkspaceId }) {
  if (typeof getWorkspaceId !== 'function') throw new Error('createCloudStore requires getWorkspaceId()');

  // Every tenant query goes through here. Returning null (signed in but no
  // workspace, or workspace suspended) refuses the call outright — the
  // renderer's gate screens normally prevent reaching this, but the store
  // is the last line of defense and must not depend on the UI.
  const ws = () => {
    const id = getWorkspaceId();
    if (!id) throw new Error('No active workspace');
    return id;
  };
  const notFound = () => new Error('Not found in this workspace');

  // ---- projects ----

  async function listProjects() {
    const rows = await prisma.project.findMany({ where: { workspaceId: ws() }, orderBy: { createdAt: 'asc' } });
    return rows.map(serializeProject);
  }

  async function getProject(id) {
    const row = await prisma.project.findFirst({ where: { id, workspaceId: ws() } });
    return row ? serializeProject(row) : undefined;
  }

  async function saveProject(p) {
    const workspaceId = ws();
    const id = p.id || crypto.randomUUID();
    const existingAny = p.id ? await prisma.project.findUnique({ where: { id: p.id } }) : null;
    if (existingAny && existingAny.workspaceId !== workspaceId) throw notFound();
    const existing = existingAny;
    if (!existing) {
      const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
      if (workspace && workspace.maxProjects != null) {
        const count = await prisma.project.count({ where: { workspaceId } });
        if (count >= workspace.maxProjects) {
          throw new Error(`Project limit reached for your plan (${workspace.maxProjects}). Contact KriJax to upgrade.`);
        }
      }
    }
    const now = new Date();
    const data = {
      name: p.name ?? existing?.name,
      key: p.key ?? existing?.key,
      baseUrl: p.baseUrl ?? existing?.baseUrl,
      type: p.type ?? existing?.type ?? 'web',
      environments: p.environments ?? existing?.environments ?? [],
      defaultEnvironment: p.defaultEnvironment !== undefined ? p.defaultEnvironment : existing?.defaultEnvironment ?? null,
      description: p.description !== undefined ? p.description : existing?.description ?? null,
      primary: p.primary !== undefined ? p.primary : existing?.primary ?? false,
      updatedAt: now,
    };
    const row = await prisma.project.upsert({
      where: { id },
      create: { id, workspaceId, ...data, createdAt: existing?.createdAt || (p.createdAt ? new Date(p.createdAt) : now) },
      update: data,
    });
    return serializeProject(row);
  }

  async function deleteProject(id) {
    // Run rows aren't FK-linked to Project (only to Suite by plain id), so
    // clear them explicitly before the delete — Suite rows cascade via the
    // `onDelete: Cascade` relation, but that stops at Suite.
    const workspaceId = ws();
    const suites = await prisma.suite.findMany({ where: { projectId: id, workspaceId }, select: { id: true } });
    if (suites.length) {
      await prisma.run.deleteMany({ where: { suiteId: { in: suites.map((s) => s.id) }, workspaceId } });
    }
    await prisma.project.deleteMany({ where: { id, workspaceId } });
  }

  // ---- suites ----

  async function listSuites(projectId) {
    const rows = await prisma.suite.findMany({
      where: { workspaceId: ws(), ...(projectId ? { projectId } : {}) },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(serializeSuite);
  }

  async function getSuite(id) {
    const row = await prisma.suite.findFirst({ where: { id, workspaceId: ws() } });
    return row ? serializeSuite(row) : undefined;
  }

  async function saveSuite(s) {
    const workspaceId = ws();
    const id = s.id || crypto.randomUUID();
    const existingAny = s.id ? await prisma.suite.findUnique({ where: { id: s.id } }) : null;
    if (existingAny && existingAny.workspaceId !== workspaceId) throw notFound();
    const existing = existingAny;
    const now = new Date();
    const data = {
      projectId: s.projectId ?? existing?.projectId,
      name: s.name ?? existing?.name,
      description: s.description !== undefined ? s.description : existing?.description ?? null,
      tags: s.tags ?? existing?.tags ?? [],
      environment: s.environment !== undefined ? s.environment : existing?.environment ?? null,
      steps: s.steps ?? existing?.steps ?? [],
      archived: s.archived !== undefined ? s.archived : existing?.archived ?? false,
      updatedAt: now,
    };
    const row = await prisma.suite.upsert({
      where: { id },
      create: { id, workspaceId, ...data, createdAt: existing?.createdAt || (s.createdAt ? new Date(s.createdAt) : now) },
      update: data,
    });
    return serializeSuite(row);
  }

  async function deleteSuite(id) {
    // Mirrors v1's per-entity delete, but also clears the runs that
    // reference this suite (v1's JSON runs live independently on disk and
    // are never cleaned up on suite delete; leaving orphan Postgres rows
    // behind isn't acceptable for shared cloud storage, so this cloud store
    // does the cleanup the plan/brief call for).
    const workspaceId = ws();
    await prisma.run.deleteMany({ where: { suiteId: id, workspaceId } });
    await prisma.suite.deleteMany({ where: { id, workspaceId } });
  }

  // ---- runs ----

  function runDir(runId) {
    return localStore.runDir(runId);
  }

  async function saveRun(report) {
    const runId = report.runId || crypto.randomUUID();
    let saved = { ...report, runId };
    const columnsFor = (r) => ({
      workspaceId: ws(),
      suiteId: r.suiteId,
      projectId: r.projectId,
      suiteName: r.suiteName,
      status: r.status,
      environment: r.environment ?? null,
      triggeredBy: r.triggeredBy ?? 'manual',
      startedAt: new Date(r.startedAt),
      finishedAt: r.finishedAt ? new Date(r.finishedAt) : null,
      report: r,
    });

    await prisma.run.upsert({
      where: { runId },
      create: { runId, ...columnsFor(saved) },
      update: columnsFor(saved),
    });

    // Local media (screenshots/video written by the runner into
    // `localStore.runDir(runId)`) still needs to move to Supabase Storage
    // before this run report is "done" — best-effort per file (see
    // `uploadRunMedia`), then re-persist the mutated report (paths now
    // `storage:<runId>/<filename>`) and reclaim the local disk.
    //
    // The local dir is only removed on FULL success: if any file failed to
    // upload (`mediaUploadError`), deleting it would destroy that file's
    // only remaining copy — the `qaflow-media://` fallback and any future
    // retry both depend on it still being on disk. Partial failures leave
    // the dir behind; only a run whose every media file made it to storage
    // reclaims its local disk.
    if (supabase && hasLocalMedia(saved)) {
      const runDirPath = localStore.runDir(runId);
      saved = await uploadRunMedia(supabase, runId, runDirPath, saved);
      await prisma.run.update({ where: { runId }, data: columnsFor(saved) });
      const hasUploadError = (saved.capturedMedia || []).some((m) => m.mediaUploadError);
      if (!hasUploadError) {
        await fs.promises.rm(runDirPath, { recursive: true, force: true });
      }
    }

    return saved;
  }

  async function getRun(runId) {
    const row = await prisma.run.findFirst({ where: { runId, workspaceId: ws() } });
    return row ? row.report : undefined;
  }

  async function listRuns(filter) {
    const projectId = typeof filter === 'string' ? filter : filter && typeof filter === 'object' ? filter.projectId : undefined;
    const suiteId = filter && typeof filter === 'object' ? filter.suiteId : undefined;

    const where = { workspaceId: ws() };
    if (projectId) where.projectId = projectId;
    if (suiteId) where.suiteId = suiteId;

    const rows = await prisma.run.findMany({ where, orderBy: { startedAt: 'desc' } });
    return rows.map((r) => r.report);
  }

  // ---- credentials ----
  // Metadata lives in Postgres (shared workspace data); the encrypted
  // storageState blob is device-local secret material and never leaves
  // `localStore`.

  async function listCredentials(projectId) {
    const rows = await prisma.credentialProfile.findMany({
      where: { workspaceId: ws(), ...(projectId ? { projectId } : {}) },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(serializeCredential);
  }

  async function saveCredential(meta, encryptedBuffer) {
    const workspaceId = ws();
    const id = meta.id || crypto.randomUUID();
    const existingAny = meta.id ? await prisma.credentialProfile.findUnique({ where: { id: meta.id } }) : null;
    if (existingAny && existingAny.workspaceId !== workspaceId) throw notFound();
    const existing = existingAny;
    const now = new Date();
    const data = {
      name: meta.name ?? existing?.name,
      projectId: meta.projectId !== undefined ? meta.projectId : existing?.projectId ?? null,
      environment: meta.environment !== undefined ? meta.environment : existing?.environment ?? null,
      loginUrl: meta.loginUrl !== undefined ? meta.loginUrl : existing?.loginUrl ?? null,
      username: meta.username !== undefined ? meta.username : existing?.username ?? null,
      encrypted: meta.encrypted !== undefined ? meta.encrypted : existing?.encrypted ?? true,
      deviceLabel: meta.deviceLabel !== undefined ? meta.deviceLabel : existing?.deviceLabel ?? null,
      mode: meta.mode ?? existing?.mode ?? 'session',
      lastUsedAt: meta.lastUsedAt !== undefined ? (meta.lastUsedAt ? new Date(meta.lastUsedAt) : null) : existing?.lastUsedAt ?? null,
    };
    const row = await prisma.credentialProfile.upsert({
      where: { id },
      create: { id, workspaceId, ...data, createdAt: existing?.createdAt || (meta.createdAt ? new Date(meta.createdAt) : now) },
      update: data,
    });

    // Blob half goes to the device-local store, keyed by the same id — it
    // handles the null-buffer case (no-op) itself, same as v1.
    localStore.saveCredential({ id }, encryptedBuffer);

    return serializeCredential(row);
  }

  function getCredentialBlob(id) {
    return localStore.readCredentialBlob(id);
  }

  async function deleteCredential(id) {
    await prisma.credentialProfile.deleteMany({ where: { id, workspaceId: ws() } });
    localStore.deleteCredential(id);
  }

  // ---- tickets ----

  async function nextTicketId() {
    // Assumes every ticket id comes through this counter — it is never
    // reconciled against manually-inserted/imported ticket ids, so a ticket
    // written with an id outside this sequence (e.g. seeded/migrated data)
    // could collide with a future generated id.
    // INSERT ... ON CONFLICT DO UPDATE (what `upsert` compiles to) is a
    // single atomic statement in Postgres, so concurrent callers serialize
    // on the row lock and each gets a distinct, strictly increasing value
    // without an explicit SELECT-then-UPDATE race. Wrapped in `$transaction`
    // for a single round trip and to keep the atomicity contract explicit.
    const workspaceId = ws();
    const counter = await prisma.$transaction(async (tx) =>
      tx.ticketCounter.upsert({
        where: { workspaceId },
        create: { workspaceId, value: 1 },
        update: { value: { increment: 1 } },
      })
    );
    return `BUG-${counter.value}`;
  }

  async function listTickets() {
    const rows = await prisma.ticket.findMany({ where: { workspaceId: ws() }, orderBy: { createdAt: 'asc' } });
    return rows.map(serializeTicket);
  }

  async function saveTicket(t) {
    const workspaceId = ws();
    const existing = t.id
      ? await prisma.ticket.findUnique({ where: { workspaceId_id: { workspaceId, id: t.id } } })
      : null;
    const id = t.id || (await nextTicketId());
    const now = new Date();
    const data = {
      title: t.title ?? existing?.title,
      description: t.description !== undefined ? t.description : existing?.description ?? null,
      severity: t.severity ?? existing?.severity,
      status: t.status ?? existing?.status,
      projectId: t.projectId !== undefined ? t.projectId : existing?.projectId ?? null,
      runId: t.runId !== undefined ? t.runId : existing?.runId ?? null,
      labels: t.labels ?? existing?.labels ?? [],
      assignee: t.assignee !== undefined ? t.assignee : existing?.assignee ?? null,
      reporter: t.reporter !== undefined ? t.reporter : existing?.reporter ?? null,
      reproductionSteps: t.reproductionSteps ?? existing?.reproductionSteps ?? [],
      attachments: t.attachments ?? existing?.attachments ?? [],
      comments: t.comments ?? existing?.comments ?? [],
      checklist: t.checklist !== undefined ? t.checklist : existing?.checklist ?? null,
      updatedAt: now,
    };
    const row = await prisma.ticket.upsert({
      where: { workspaceId_id: { workspaceId, id } },
      create: { id, workspaceId, ...data, createdAt: existing?.createdAt || (t.createdAt ? new Date(t.createdAt) : now) },
      update: data,
    });
    return serializeTicket(row);
  }

  async function deleteTicket(id) {
    await prisma.ticket.deleteMany({ where: { id, workspaceId: ws() } });
  }

  // ---- settings ----
  // Device-local, same as v1 — not workspace-shared data.

  function getSettings() {
    return localStore.getSettings();
  }

  function saveSettings(patch) {
    return localStore.saveSettings(patch);
  }

  // ---- schedules ----
  // Shared workspace data (any signed-in device should see/edit the same
  // schedules), so — unlike credentials/settings — these live in Postgres.

  async function listSchedules() {
    const rows = await prisma.schedule.findMany({ where: { workspaceId: ws() } });
    const schedules = rows.map(serializeSchedule);
    // Nulls (no future occurrence, e.g. a lapsed "once") sort last — mirrors
    // v1's in-memory sort exactly.
    return schedules.sort((a, b) => {
      const av = a.nextRunAt ? new Date(a.nextRunAt).getTime() : Infinity;
      const bv = b.nextRunAt ? new Date(b.nextRunAt).getTime() : Infinity;
      return av - bv;
    });
  }

  async function saveSchedule(s) {
    const workspaceId = ws();
    const id = s.id || `sched-${crypto.randomUUID()}`;
    const existingAny = s.id ? await prisma.schedule.findUnique({ where: { id: s.id } }) : null;
    if (existingAny && existingAny.workspaceId !== workspaceId) throw notFound();
    const existing = existingAny;
    const now = new Date();
    const data = {
      suiteId: s.suiteId ?? existing?.suiteId,
      projectId: s.projectId ?? existing?.projectId,
      name: s.name ?? existing?.name,
      environment: s.environment !== undefined ? s.environment : existing?.environment ?? null,
      headless: s.headless !== undefined ? s.headless : existing?.headless ?? true,
      credentialProfileId: s.credentialProfileId !== undefined ? s.credentialProfileId : existing?.credentialProfileId ?? null,
      at: s.at ? new Date(s.at) : existing?.at,
      recurrence: s.recurrence ?? existing?.recurrence,
      enabled: s.enabled !== undefined ? s.enabled : existing?.enabled ?? true,
      lastRunAt: s.lastRunAt !== undefined ? (s.lastRunAt ? new Date(s.lastRunAt) : null) : existing?.lastRunAt ?? null,
      nextRunAt: s.nextRunAt !== undefined ? (s.nextRunAt ? new Date(s.nextRunAt) : null) : existing?.nextRunAt ?? null,
      updatedAt: now,
    };
    const row = await prisma.schedule.upsert({
      where: { id },
      create: { id, workspaceId, ...data, createdAt: existing?.createdAt || (s.createdAt ? new Date(s.createdAt) : now) },
      update: data,
    });
    return serializeSchedule(row);
  }

  async function deleteSchedule(id) {
    await prisma.schedule.deleteMany({ where: { id, workspaceId: ws() } });
  }

  return {
    listProjects,
    getProject,
    saveProject,
    deleteProject,
    listSuites,
    getSuite,
    saveSuite,
    deleteSuite,
    listRuns,
    getRun,
    runDir,
    saveRun,
    listCredentials,
    saveCredential,
    getCredentialBlob,
    deleteCredential,
    listTickets,
    saveTicket,
    deleteTicket,
    getSettings,
    saveSettings,
    nextTicketId,
    listSchedules,
    saveSchedule,
    deleteSchedule,
  };
}

module.exports = { createCloudStore };

# Desktop Workspaces (Multi-Tenant) + KriJaxAutomation Rename — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the desktop app multi-tenant — every company gets an isolated workspace with roles and plan limits — and rename the product to KriJaxAutomation.

**Architecture:** Shared Postgres tables in the existing `astreus` schema gain a `workspaceId` column; the cloud store scopes every query through one injected `getWorkspaceId()`. A new pure-Node `workspaces.js` service owns membership/roles/limits; `main/tenant.js` resolves the signed-in user's workspace after Supabase sign-in and feeds both the store and the renderer's gate screens.

**Tech Stack:** existing — Electron 32, plain JS (CommonJS engine/main, React 19 JSX renderer, arrow functions only), Prisma 6 (`prisma db push`), supabase-js 2 (Auth admin API via service role), `node --test`.

**Spec:** `docs/superpowers/specs/2026-08-27-workspaces-multitenant-design.md` — sub-project 1 (§1.1–§1.7). Read it first.

## Global Constraints

- Repo `D:\personal-project\CritalCaller\qa-flow`, branch `feature/workspaces` off `main`. Plain JS; **arrow functions only** in new/changed code (React error boundaries excepted). `src/engine/**` never `require('electron')`.
- **SHARED-PROJECT ISOLATION:** only the `astreus` Postgres schema and the `astreus-run-media` bucket may change. Schema deployment is `npm run db:push`. Live tests use `astreus-test-` prefixed ids and clean up in `finally`; `npm test` stays green offline (cloud tests `t.skip()` without `DATABASE_URL`).
- Internal identifiers stay `qaflow` / `astreus` / `ASTREUS_*`. User-visible product name becomes exactly **"KriJaxAutomation"**; vendor line is exactly **"Made by KriJax Software and Development"**.
- House workspace id is the literal `"ws-krijax"` (name "KriJax", slug "krijax", plan "vendor", limits null). Default billing currency `"PHP"`.
- Roles are the literal strings `owner | admin | member`; workspace status `active | suspended`.
- Verification floor per task: `npm test` green AND `unset ELECTRON_RUN_AS_NODE && npx electron . --smoke` prints `SMOKE OK` (this dev shell sets `ELECTRON_RUN_AS_NODE`; always unset it first).
- Commits: conventional messages, one per task, each ending with the line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

### Task 1: Schema, drift test, seed script

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `test/cloud-db.test.js`
- Create: `scripts/seed-workspaces.mjs`
- Modify: `package.json` (scripts), `.env.example`

**Interfaces:**
- Produces: Prisma models `Workspace`, `WorkspaceMember`, `Invoice`; `workspaceId` on `Project`, `Suite`, `Run`, `Ticket`, `CredentialProfile`, `Schedule`; `Ticket` compound id `@@id([workspaceId, id])` (Prisma where key `workspaceId_id`); `TicketCounter { id autoincrement, workspaceId @unique, value }`; `npm run db:seed-workspaces`; env `ASTREUS_PLATFORM_ADMINS`.

- [ ] **Step 1: Edit the drift test to expect the 10 tables (RED)**

In `test/cloud-db.test.js` replace the `ASTREUS_TABLES` line and the model loop:

```js
const ASTREUS_TABLES = ['Project', 'Suite', 'Run', 'Ticket', 'CredentialProfile', 'TicketCounter', 'Schedule', 'Workspace', 'WorkspaceMember', 'Invoice'];
```
```js
    for (const model of ['project', 'suite', 'run', 'ticket', 'credentialProfile', 'ticketCounter', 'schedule', 'workspace', 'workspaceMember', 'invoice']) {
```
Also fix the stale comment `exactly the 6 expected tables` → `exactly the 10 expected tables`.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/cloud-db.test.js`
Expected: FAIL — `prisma.workspace` is undefined (model missing) / table count 7 ≠ 10.

- [ ] **Step 3: Update `prisma/schema.prisma`**

Add `workspaceId String @default("ws-krijax")` + `@@index([workspaceId])` to `Project`, `Suite`, `Run`, `CredentialProfile`, `Schedule`. Replace the `Ticket` and `TicketCounter` models and append the three new models:

```prisma
model Ticket {
  id                String
  workspaceId       String   @default("ws-krijax")
  title             String
  description       String?
  severity          String
  status            String
  projectId         String?
  runId             String?
  labels            String[] @default([])
  assignee          String?
  reporter          String?
  reproductionSteps Json     @default("[]")
  attachments       Json     @default("[]")
  comments          Json     @default("[]")
  checklist         Json?
  createdAt         DateTime
  updatedAt         DateTime
  @@id([workspaceId, id])
}

model TicketCounter {
  id          Int    @id @default(autoincrement())
  workspaceId String @unique @default("ws-krijax")
  value       Int    @default(0)
}

model Workspace {
  id               String    @id
  name             String
  slug             String    @unique
  plan             String    @default("free")
  maxMembers       Int?
  maxProjects      Int?
  status           String    @default("active")
  pricePerMonth    Decimal?  @db.Decimal(10, 2)
  currency         String    @default("PHP")
  billingEmail     String?
  stripeCustomerId String?
  createdAt        DateTime
  updatedAt        DateTime
  members          WorkspaceMember[]
  invoices         Invoice[]
}

model WorkspaceMember {
  id          String    @id
  workspaceId String
  email       String
  userId      String?
  role        String
  createdAt   DateTime
  joinedAt    DateTime?
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  @@unique([workspaceId, email])
  @@index([userId])
}

model Invoice {
  id               String    @id
  workspaceId      String
  periodStart      DateTime
  periodEnd        DateTime
  amount           Decimal   @db.Decimal(10, 2)
  currency         String
  status           String    @default("draft")
  dueDate          DateTime
  paidAt           DateTime?
  paymentMethod    String?
  stripeCheckoutId String?
  notes            String?
  createdAt        DateTime
  updatedAt        DateTime
  workspace        Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  @@index([workspaceId, status])
}
```

(Keep every existing field of `Ticket` exactly as listed above — only `@id` moved to the compound `@@id` and `workspaceId` was added.)

- [ ] **Step 4: Push the schema and regenerate**

Run: `npm run db:push` then `npx prisma generate`.
Expected: "Your database is now in sync". If Prisma asks to confirm the `Ticket` primary-key change, re-run with `node scripts/db-push.mjs -- --accept-data-loss` is NOT available — instead run `npx prisma db push --accept-data-loss --skip-generate` with the direct-URL env the wrapper prints guidance for; the PK swap keeps rows (every row already has `workspaceId = 'ws-krijax'`). Verify afterwards: `npx prisma db execute --stdin <<< "select count(*) from astreus.\"Ticket\""` returns the previous ticket count.

- [ ] **Step 5: Run the drift test to verify it passes**

Run: `node --test test/cloud-db.test.js`
Expected: PASS (10 tables in `astreus`, none in `public`).

- [ ] **Step 6: Write the seed script**

Create `scripts/seed-workspaces.mjs`:

```js
// Idempotent: creates the KriJax house workspace and an owner membership
// for every platform admin. Safe to re-run; never touches tenant rows.
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const VENDOR = { id: 'ws-krijax', name: 'KriJax', slug: 'krijax', plan: 'vendor' };

const admins = (process.env.ASTREUS_PLATFORM_ADMINS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

const prisma = new PrismaClient();
try {
  const now = new Date();
  await prisma.workspace.upsert({
    where: { id: VENDOR.id },
    create: { ...VENDOR, maxMembers: null, maxProjects: null, status: 'active', createdAt: now, updatedAt: now },
    update: { name: VENDOR.name, plan: VENDOR.plan },
  });
  for (const email of admins) {
    await prisma.workspaceMember.upsert({
      where: { workspaceId_email: { workspaceId: VENDOR.id, email } },
      create: { id: randomUUID(), workspaceId: VENDOR.id, email, role: 'owner', createdAt: now },
      update: { role: 'owner' },
    });
  }
  console.log(`[seed-workspaces] ${VENDOR.id} ready; ${admins.length} owner(s) ensured.`);
} finally {
  await prisma.$disconnect();
}
```

Add to `package.json` scripts: `"db:seed-workspaces": "node scripts/seed-workspaces.mjs"`. Append to `.env.example`:

```
# Comma-separated emails of KriJax staff (platform admins). They always own the ws-krijax workspace.
ASTREUS_PLATFORM_ADMINS=you@krijax.com
```

Add your own email to the real `.env` as `ASTREUS_PLATFORM_ADMINS=` (never commit `.env`).

- [ ] **Step 7: Run the seed, then the full suite**

Run: `npm run db:seed-workspaces` → prints `ws-krijax ready; 1 owner(s) ensured.`
Run: `npm test` → all green (existing cloud-store test still passes because every column has a default).

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma test/cloud-db.test.js scripts/seed-workspaces.mjs package.json .env.example
git commit -m "feat: workspace, member, invoice models; workspaceId on every tenant table; seed script

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Roles matrix (pure)

**Files:**
- Create: `src/engine/roles.js`
- Test: `test/roles.test.js`

**Interfaces:**
- Produces: `ROLES = ['owner','admin','member']`, `ACTIONS`, `can(role, action) → boolean`.

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { can, ROLES, ACTIONS } = require('../src/engine/roles.js');

test('roles: owner can do everything', () => {
  for (const action of ACTIONS) assert.equal(can('owner', action), true, action);
});

test('roles: admin can do everything except delete_workspace', () => {
  for (const action of ACTIONS) {
    assert.equal(can('admin', action), action !== 'delete_workspace', action);
  }
});

test('roles: member has no management powers', () => {
  for (const action of ACTIONS) assert.equal(can('member', action), false, action);
});

test('roles: unknown role or action is always false', () => {
  assert.equal(can('god', 'invite'), false);
  assert.equal(can('owner', 'launch_missiles'), false);
  assert.equal(can(null, 'invite'), false);
});

test('roles: exports the canonical lists', () => {
  assert.deepEqual(ROLES, ['owner', 'admin', 'member']);
  assert.deepEqual(ACTIONS, ['invite', 'remove_member', 'change_role', 'edit_workspace', 'delete_workspace', 'delete_project']);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/roles.test.js` — Expected: FAIL, `Cannot find module '../src/engine/roles.js'`.

- [ ] **Step 3: Implement**

```js
'use strict';

// Single source of truth for what each workspace role may do. Every QA
// action (projects, suites, runs, reports, tickets, credentials, schedules,
// repository) is open to all roles and deliberately NOT listed here — only
// management powers are gated.

const ROLES = ['owner', 'admin', 'member'];
const ACTIONS = ['invite', 'remove_member', 'change_role', 'edit_workspace', 'delete_workspace', 'delete_project'];

const GRANTS = {
  owner: new Set(ACTIONS),
  admin: new Set(ACTIONS.filter((a) => a !== 'delete_workspace')),
  member: new Set(),
};

const can = (role, action) => Boolean(GRANTS[role] && GRANTS[role].has(action));

module.exports = { ROLES, ACTIONS, can };
```

- [ ] **Step 4: Run to verify it passes** — `node --test test/roles.test.js` → 5 pass.

- [ ] **Step 5: Commit**

```bash
git add src/engine/roles.js test/roles.test.js
git commit -m "feat: workspace role matrix

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Scope the cloud store by workspace

**Files:**
- Modify: `src/engine/cloud-store.js`
- Modify: `test/cloud-store.test.js`

**Interfaces:**
- Consumes: Task 1 schema.
- Produces: `createCloudStore({ prisma, supabase, localStore, getWorkspaceId })` — `getWorkspaceId: () => string | null` is **required**; every tenant method scopes by it and throws `Error('No active workspace')` when it returns null. `saveProject` throws `Error('Project limit reached for your plan (N). Contact KriJax to upgrade.')` on create when the workspace row has a non-null `maxProjects` that is already met.

- [ ] **Step 1: Add the isolation test (RED)**

Append to `test/cloud-store.test.js`:

```js
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
```

Update `cleanup()` at the top of the file to also clear workspace-keyed rows (ticket ids are `BUG-n` now, not prefixed):

```js
async function cleanup(prisma) {
  await prisma.run.deleteMany({ where: { OR: [{ runId: { startsWith: PREFIX } }, { workspaceId: { startsWith: PREFIX } }] } });
  await prisma.suite.deleteMany({ where: { OR: [{ id: { startsWith: PREFIX } }, { workspaceId: { startsWith: PREFIX } }] } });
  await prisma.project.deleteMany({ where: { OR: [{ id: { startsWith: PREFIX } }, { workspaceId: { startsWith: PREFIX } }] } });
  await prisma.ticket.deleteMany({ where: { workspaceId: { startsWith: PREFIX } } });
  await prisma.ticketCounter.deleteMany({ where: { workspaceId: { startsWith: PREFIX } } });
  await prisma.credentialProfile.deleteMany({ where: { OR: [{ id: { startsWith: PREFIX } }, { workspaceId: { startsWith: PREFIX } }] } });
  await prisma.schedule.deleteMany({ where: { OR: [{ id: { startsWith: PREFIX } }, { workspaceId: { startsWith: PREFIX } }] } });
}
```

In the two existing tests, pass a test workspace to every `createCloudStore(...)` call: `getWorkspaceId: () => \`${PREFIX}ws-main\``. In the first test delete the `counterSnapshot` variable, its assignment, and the `if (counterSnapshot) … else …` block in `finally` (the per-workspace counter now lives under a `${PREFIX}` workspace and is removed by `cleanup`).

- [ ] **Step 2: Run to verify the new test fails**

Run: `node --test test/cloud-store.test.js`
Expected: the new test FAILS (A sees B's project; `getWorkspaceId` ignored). The two old tests may also fail on ticket assertions — that's expected until Step 3.

- [ ] **Step 3: Implement scoping in `src/engine/cloud-store.js`**

Change the factory signature and add helpers right after it:

```js
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
```

Then apply these exact edits (the rest of each function is unchanged):

Projects:
```js
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
    const data = { /* unchanged field mapping */ };
    const row = await prisma.project.upsert({
      where: { id },
      create: { id, workspaceId, ...data, createdAt: existing?.createdAt || (p.createdAt ? new Date(p.createdAt) : now) },
      update: data,
    });
    return serializeProject(row);
  }

  async function deleteProject(id) {
    const workspaceId = ws();
    const suites = await prisma.suite.findMany({ where: { projectId: id, workspaceId }, select: { id: true } });
    if (suites.length) {
      await prisma.run.deleteMany({ where: { suiteId: { in: suites.map((s) => s.id) }, workspaceId } });
    }
    await prisma.project.deleteMany({ where: { id, workspaceId } });
  }
```

Suites: `listSuites` → `where: { workspaceId: ws(), ...(projectId ? { projectId } : {}) }`; `getSuite` → `findFirst({ where: { id, workspaceId: ws() } })`; `saveSuite` → same `existingAny` ownership check as projects and `create: { id, workspaceId: ws(), ...data, … }`; `deleteSuite` → both `deleteMany` calls gain `workspaceId: ws()`.

Runs: in `saveRun`, `columnsFor` gains `workspaceId: ws(),` as its first property; `getRun` → `findFirst({ where: { runId, workspaceId: ws() } })`; `listRuns` → `const where = { workspaceId: ws() };`.

Credentials: `listCredentials` → `where: { workspaceId: ws(), ...(projectId ? { projectId } : {}) }`; `saveCredential` → ownership check + `create: { id, workspaceId: ws(), …}`; `deleteCredential` → `deleteMany({ where: { id, workspaceId: ws() } })`.

Tickets (compound key):
```js
  async function nextTicketId() {
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
    const existing = t.id ? await prisma.ticket.findUnique({ where: { workspaceId_id: { workspaceId, id: t.id } } }) : null;
    const id = t.id || (await nextTicketId());
    const now = new Date();
    const data = { /* unchanged field mapping */ };
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
```

Schedules: `listSchedules` → `findMany({ where: { workspaceId: ws() } })`; `saveSchedule` → ownership check + `create: { id, workspaceId: ws(), …}`; `deleteSchedule` → `deleteMany({ where: { id, workspaceId: ws() } })`.

Also add `workspaceId: row.workspaceId` to `serializeProject`, `serializeSuite`, `serializeTicket`, `serializeCredential`, `serializeSchedule` (harmless extra field; useful in the UI/debugging).

- [ ] **Step 4: Run all cloud-store tests**

Run: `node --test test/cloud-store.test.js` → 3 pass. Then `npm test` → all green (main.js is not yet wired but no test loads it).

- [ ] **Step 5: Commit**

```bash
git add src/engine/cloud-store.js test/cloud-store.test.js
git commit -m "feat: scope every cloud store query by workspace; per-workspace ticket numbering and project limits

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Workspace service (membership, invites, provisioning)

**Files:**
- Create: `src/engine/workspaces.js`
- Test: `test/workspaces.test.js`

**Interfaces:**
- Consumes: Task 1 models; `createSupabaseAdmin()` (service role) for `supabase.auth.admin.createUser/deleteUser`; Task 2 `can()`.
- Produces: `createWorkspaceService({ prisma, supabase, platformAdminEmails = [] })` →
  - `isPlatformAdmin(email) → boolean`
  - `resolveMembership({ userId, email }) → { workspace, member } | null` (claims a pending email membership by setting `userId`/`joinedAt`)
  - `ensureVendorWorkspace(email) → { workspace, member }`
  - `getWorkspace(id) → workspace | null`, `usage(id) → { members, maxMembers, projects, maxProjects }`
  - `listMembers(workspaceId) → member[]`
  - `inviteMember(workspaceId, { email, role }, actorRole) → { member, tempPassword | null }`
  - `changeRole(workspaceId, memberId, role, actorRole) → member`
  - `removeMember(workspaceId, memberId, actorRole) → true`
  - `renameWorkspace(id, name, actorRole) → workspace`, `deleteWorkspace(id, actorRole) → true`
  - `createWorkspace({ name, slug, plan, maxMembers, maxProjects, ownerEmail }) → { workspace, owner, tempPassword | null }`, `updateWorkspace(id, patch) → workspace`, `listWorkspaces() → workspace[]` (vendor/seed/portal use; no actor check)
  - serialized workspace `{ id, name, slug, plan, maxMembers, maxProjects, status, pricePerMonth (number|null), currency, billingEmail, createdAt, updatedAt }`; member `{ id, workspaceId, email, userId, role, createdAt, joinedAt }` (dates ISO).

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('dotenv').config();

const PREFIX = 'astreus-test-';

test('workspaces: provisioning, membership claim, invites, limits, role guards', async (t) => {
  if (!process.env.DATABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return t.skip('cloud env not set');

  const { createPrisma } = require('../src/engine/cloud/db.js');
  const { createSupabaseAdmin } = require('../src/engine/cloud/supabase.js');
  const { createWorkspaceService } = require('../src/engine/workspaces.js');

  const prisma = createPrisma();
  const supabase = createSupabaseAdmin();
  const rand = Math.random().toString(36).slice(2, 8);
  const ownerEmail = `${PREFIX}${rand}-owner@example.invalid`;
  const memberEmail = `${PREFIX}${rand}-member@example.invalid`;
  const slug = `${PREFIX}${rand}`;
  const createdUserIds = [];
  const svc = createWorkspaceService({ prisma, supabase, platformAdminEmails: ['Admin@KriJax.com'] });

  try {
    assert.equal(svc.isPlatformAdmin('admin@krijax.com'), true);
    assert.equal(svc.isPlatformAdmin('nobody@x.com'), false);

    // provision a company with a brand-new owner login
    const created = await svc.createWorkspace({ name: 'Acme QA', slug, plan: 'team', maxMembers: 2, maxProjects: 3, ownerEmail: ownerEmail.toUpperCase() });
    assert.equal(created.workspace.id, `ws-${slug}`);
    assert.equal(created.owner.role, 'owner');
    assert.equal(created.owner.email, ownerEmail);
    assert.match(created.tempPassword, /^[A-Za-z0-9_-]{16}$/);
    createdUserIds.push(created.owner.userId);
    assert.ok(created.owner.userId, 'owner login created up front');

    // stranger resolves to nothing; owner resolves by userId
    assert.equal(await svc.resolveMembership({ userId: 'nope', email: 'nobody@x.com' }), null);
    const resolved = await svc.resolveMembership({ userId: created.owner.userId, email: ownerEmail });
    assert.equal(resolved.workspace.id, created.workspace.id);
    assert.equal(resolved.member.role, 'owner');

    // invite: creates login, returns temp password; admin cannot grant owner
    const invited = await svc.inviteMember(created.workspace.id, { email: memberEmail, role: 'member' }, 'owner');
    assert.equal(invited.member.role, 'member');
    assert.match(invited.tempPassword, /^[A-Za-z0-9_-]{16}$/);
    createdUserIds.push(invited.member.userId);
    await assert.rejects(() => svc.inviteMember(created.workspace.id, { email: `${PREFIX}x@example.invalid`, role: 'owner' }, 'admin'), /owner/i);
    // member role may not invite at all
    await assert.rejects(() => svc.inviteMember(created.workspace.id, { email: `${PREFIX}y@example.invalid`, role: 'member' }, 'member'), /permission/i);
    // seat limit (maxMembers = 2, already 2)
    await assert.rejects(() => svc.inviteMember(created.workspace.id, { email: `${PREFIX}z@example.invalid`, role: 'member' }, 'owner'), /Member limit reached/);

    // claim by email: a membership created without userId is claimed at first login
    await prisma.workspaceMember.update({ where: { id: invited.member.id }, data: { userId: null, joinedAt: null } });
    const claimed = await svc.resolveMembership({ userId: invited.member.userId, email: memberEmail });
    assert.equal(claimed.member.userId, invited.member.userId);
    assert.ok(claimed.member.joinedAt);

    // usage
    const usage = await svc.usage(created.workspace.id);
    assert.deepEqual(usage, { members: 2, maxMembers: 2, projects: 0, maxProjects: 3 });

    // role changes + last-owner protection
    const promoted = await svc.changeRole(created.workspace.id, invited.member.id, 'admin', 'owner');
    assert.equal(promoted.role, 'admin');
    await assert.rejects(() => svc.changeRole(created.workspace.id, created.owner.id, 'member', 'owner'), /at least one owner/);
    await assert.rejects(() => svc.removeMember(created.workspace.id, created.owner.id, 'owner'), /at least one owner/);
    await svc.removeMember(created.workspace.id, invited.member.id, 'owner');
    assert.equal((await svc.listMembers(created.workspace.id)).length, 1);

    // vendor safety net
    const vendor = await svc.ensureVendorWorkspace(`${PREFIX}${rand}-vendor@example.invalid`);
    assert.equal(vendor.workspace.id, 'ws-krijax');
    assert.equal(vendor.member.role, 'owner');

    // rename + delete guards
    assert.equal((await svc.renameWorkspace(created.workspace.id, 'Acme Renamed', 'owner')).name, 'Acme Renamed');
    await assert.rejects(() => svc.deleteWorkspace(created.workspace.id, 'admin'), /permission/i);
    await svc.deleteWorkspace(created.workspace.id, 'owner');
    assert.equal(await svc.getWorkspace(created.workspace.id), null);
  } finally {
    await prisma.workspaceMember.deleteMany({ where: { email: { startsWith: PREFIX } } });
    await prisma.workspace.deleteMany({ where: { id: { startsWith: 'ws-' + PREFIX } } });
    for (const id of createdUserIds) if (id) await supabase.auth.admin.deleteUser(id);
    await prisma.$disconnect();
  }
});
```

- [ ] **Step 2: Run it to verify it fails** — `node --test test/workspaces.test.js` → `Cannot find module '../src/engine/workspaces.js'`.

- [ ] **Step 3: Implement `src/engine/workspaces.js`**

```js
'use strict';

// Workspace (tenant) service — membership resolution, invites/provisioning
// with Supabase Auth logins, roles and plan limits. Pure Node: Prisma and
// the service-role supabase-js client are injected. Nothing here reads
// tenant data; that is the cloud store's job.

const crypto = require('node:crypto');
const { can } = require('./roles.js');

const VENDOR_WORKSPACE = { id: 'ws-krijax', name: 'KriJax', slug: 'krijax', plan: 'vendor' };

const toIso = (d) => (d instanceof Date ? d.toISOString() : d);
const normalizeEmail = (e) => String(e || '').trim().toLowerCase();
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '');

const serializeWorkspace = (row) =>
  row && {
    id: row.id,
    name: row.name,
    slug: row.slug,
    plan: row.plan,
    maxMembers: row.maxMembers,
    maxProjects: row.maxProjects,
    status: row.status,
    pricePerMonth: row.pricePerMonth == null ? null : Number(row.pricePerMonth),
    currency: row.currency,
    billingEmail: row.billingEmail,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };

const serializeMember = (row) =>
  row && {
    id: row.id,
    workspaceId: row.workspaceId,
    email: row.email,
    userId: row.userId,
    role: row.role,
    createdAt: toIso(row.createdAt),
    joinedAt: toIso(row.joinedAt),
  };

const createWorkspaceService = ({ prisma, supabase, platformAdminEmails = [] }) => {
  const admins = new Set(platformAdminEmails.map(normalizeEmail).filter(Boolean));

  const isPlatformAdmin = (email) => admins.has(normalizeEmail(email));

  const requireCan = (role, action) => {
    if (!can(role, action)) throw new Error(`Your role (${role || 'none'}) does not have permission to ${action.replace('_', ' ')}.`);
  };

  // Creates a Supabase Auth login for an invited email. Returns the one-time
  // temp password (never stored). An already-registered email gets no
  // password — the existing account claims the membership at first login.
  const ensureLogin = async (email) => {
    const password = crypto.randomBytes(12).toString('base64url').slice(0, 16);
    const { data, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) {
      if (/already|exists|registered/i.test(error.message)) return { userId: null, tempPassword: null };
      throw new Error(`Could not create login for ${email}: ${error.message}`);
    }
    return { userId: data.user.id, tempPassword: password };
  };

  const getWorkspace = async (id) => serializeWorkspace(await prisma.workspace.findUnique({ where: { id } }));

  const listWorkspaces = async () => {
    const rows = await prisma.workspace.findMany({ orderBy: { createdAt: 'asc' } });
    return rows.map(serializeWorkspace);
  };

  const usage = async (workspaceId) => {
    const [workspace, members, projects] = await Promise.all([
      prisma.workspace.findUnique({ where: { id: workspaceId } }),
      prisma.workspaceMember.count({ where: { workspaceId } }),
      prisma.project.count({ where: { workspaceId } }),
    ]);
    return { members, maxMembers: workspace ? workspace.maxMembers : null, projects, maxProjects: workspace ? workspace.maxProjects : null };
  };

  const listMembers = async (workspaceId) => {
    const rows = await prisma.workspaceMember.findMany({ where: { workspaceId }, orderBy: { createdAt: 'asc' } });
    return rows.map(serializeMember);
  };

  const addMembership = async (workspaceId, email, role, userId) => {
    const now = new Date();
    const row = await prisma.workspaceMember.upsert({
      where: { workspaceId_email: { workspaceId, email } },
      create: { id: crypto.randomUUID(), workspaceId, email, role, userId, createdAt: now, joinedAt: userId ? now : null },
      update: { role, userId: userId ?? undefined },
    });
    return serializeMember(row);
  };

  const resolveMembership = async ({ userId, email }) => {
    const normalized = normalizeEmail(email);
    let member = userId ? await prisma.workspaceMember.findFirst({ where: { userId } }) : null;
    if (!member && normalized) {
      const pending = await prisma.workspaceMember.findFirst({ where: { email: normalized } });
      if (pending) {
        member = await prisma.workspaceMember.update({
          where: { id: pending.id },
          data: { userId: userId || pending.userId, joinedAt: pending.joinedAt || new Date() },
        });
      }
    }
    if (!member) return null;
    const workspace = await prisma.workspace.findUnique({ where: { id: member.workspaceId } });
    if (!workspace) return null;
    return { workspace: serializeWorkspace(workspace), member: serializeMember(member) };
  };

  const ensureVendorWorkspace = async (email) => {
    const now = new Date();
    const workspace = await prisma.workspace.upsert({
      where: { id: VENDOR_WORKSPACE.id },
      create: { ...VENDOR_WORKSPACE, maxMembers: null, maxProjects: null, status: 'active', createdAt: now, updatedAt: now },
      update: {},
    });
    const member = await addMembership(VENDOR_WORKSPACE.id, normalizeEmail(email), 'owner', null);
    return { workspace: serializeWorkspace(workspace), member };
  };

  const createWorkspace = async ({ name, slug, plan = 'free', maxMembers = null, maxProjects = null, ownerEmail }) => {
    const email = normalizeEmail(ownerEmail);
    if (!name || !email) throw new Error('Workspace name and owner email are required');
    const cleanSlug = slugify(slug || name);
    const id = `ws-${cleanSlug}`;
    if (await prisma.workspace.findUnique({ where: { id } })) throw new Error(`A workspace with slug "${cleanSlug}" already exists`);
    const login = await ensureLogin(email);
    const now = new Date();
    const workspace = await prisma.workspace.create({
      data: { id, name, slug: cleanSlug, plan, maxMembers, maxProjects, status: 'active', createdAt: now, updatedAt: now },
    });
    const owner = await addMembership(id, email, 'owner', login.userId);
    return { workspace: serializeWorkspace(workspace), owner, tempPassword: login.tempPassword };
  };

  const updateWorkspace = async (id, patch) => {
    const allowed = ['name', 'plan', 'maxMembers', 'maxProjects', 'status', 'pricePerMonth', 'currency', 'billingEmail'];
    const data = { updatedAt: new Date() };
    for (const key of allowed) if (patch[key] !== undefined) data[key] = patch[key];
    return serializeWorkspace(await prisma.workspace.update({ where: { id }, data }));
  };

  const inviteMember = async (workspaceId, { email, role = 'member' }, actorRole) => {
    requireCan(actorRole, 'invite');
    if (role === 'owner' && actorRole !== 'owner') throw new Error('Only an owner can grant the owner role.');
    const normalized = normalizeEmail(email);
    if (!normalized) throw new Error('Email is required');
    const current = await usage(workspaceId);
    if (current.maxMembers != null && current.members >= current.maxMembers) {
      throw new Error(`Member limit reached for your plan (${current.maxMembers}). Contact KriJax to upgrade.`);
    }
    const login = await ensureLogin(normalized);
    const member = await addMembership(workspaceId, normalized, role, login.userId);
    return { member, tempPassword: login.tempPassword };
  };

  const ownerCount = (workspaceId) => prisma.workspaceMember.count({ where: { workspaceId, role: 'owner' } });

  const changeRole = async (workspaceId, memberId, role, actorRole) => {
    requireCan(actorRole, 'change_role');
    if (role === 'owner' && actorRole !== 'owner') throw new Error('Only an owner can grant the owner role.');
    const target = await prisma.workspaceMember.findFirst({ where: { id: memberId, workspaceId } });
    if (!target) throw new Error('Member not found');
    if (target.role === 'owner' && role !== 'owner' && (await ownerCount(workspaceId)) <= 1) {
      throw new Error('A workspace must keep at least one owner.');
    }
    return serializeMember(await prisma.workspaceMember.update({ where: { id: memberId }, data: { role } }));
  };

  const removeMember = async (workspaceId, memberId, actorRole) => {
    requireCan(actorRole, 'remove_member');
    const target = await prisma.workspaceMember.findFirst({ where: { id: memberId, workspaceId } });
    if (!target) throw new Error('Member not found');
    if (target.role === 'owner' && (await ownerCount(workspaceId)) <= 1) throw new Error('A workspace must keep at least one owner.');
    await prisma.workspaceMember.delete({ where: { id: memberId } });
    return true;
  };

  const renameWorkspace = async (id, name, actorRole) => {
    requireCan(actorRole, 'edit_workspace');
    if (!name || !name.trim()) throw new Error('Workspace name is required');
    return updateWorkspace(id, { name: name.trim() });
  };

  const deleteWorkspace = async (id, actorRole) => {
    requireCan(actorRole, 'delete_workspace');
    if (id === VENDOR_WORKSPACE.id) throw new Error('The KriJax workspace cannot be deleted.');
    await prisma.$transaction([
      prisma.run.deleteMany({ where: { workspaceId: id } }),
      prisma.schedule.deleteMany({ where: { workspaceId: id } }),
      prisma.suite.deleteMany({ where: { workspaceId: id } }),
      prisma.project.deleteMany({ where: { workspaceId: id } }),
      prisma.ticket.deleteMany({ where: { workspaceId: id } }),
      prisma.ticketCounter.deleteMany({ where: { workspaceId: id } }),
      prisma.credentialProfile.deleteMany({ where: { workspaceId: id } }),
      prisma.workspace.deleteMany({ where: { id } }), // members + invoices cascade
    ]);
    return true;
  };

  return {
    VENDOR_WORKSPACE,
    isPlatformAdmin,
    resolveMembership,
    ensureVendorWorkspace,
    getWorkspace,
    listWorkspaces,
    usage,
    listMembers,
    inviteMember,
    changeRole,
    removeMember,
    renameWorkspace,
    deleteWorkspace,
    createWorkspace,
    updateWorkspace,
  };
};

module.exports = { createWorkspaceService, VENDOR_WORKSPACE };
```

- [ ] **Step 4: Run to verify it passes** — `node --test test/workspaces.test.js` → PASS (creates and deletes two throwaway auth users). Then `npm test` → all green.

- [ ] **Step 5: Commit**

```bash
git add src/engine/workspaces.js test/workspaces.test.js
git commit -m "feat: workspace service - membership resolution, invites with temp logins, roles, limits, provisioning

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Tenant wiring in main — auth → workspace, IPC surface, preload

**Files:**
- Create: `src/main/tenant.js`
- Modify: `src/main/main.js` (cloud store construction ~line 73; whenReady auth block ~lines 236–256)
- Modify: `src/main/ipc.js` (auth handlers ~lines 149–162; `projects:remove` ~line 229; new `workspace:*` handlers)
- Modify: `src/main/preload.js`

**Interfaces:**
- Consumes: Task 3 `getWorkspaceId`, Task 4 service, Task 2 `can`.
- Produces: `createTenant({ auth, workspaces })` → `{ resolve() → tenantState, get(), getWorkspaceId(), status() }` where `tenantState = { workspaceId, role, platformAdmin, workspace }` and `status()` returns `{ workspace: {id,name,plan,status}|null, role, platformAdmin }`. `auth:status`/`auth:login` results and `auth:changed` payloads are `{ loggedIn, email, name, configured, workspace, role, platformAdmin }`. IPC: `workspace:current`, `workspace:members:list`, `workspace:members:invite`, `workspace:members:changeRole`, `workspace:members:remove`, `workspace:rename`, `workspace:delete`. Preload: `qaflow.workspace.{current, listMembers, invite, changeRole, removeMember, rename, remove}`.

- [ ] **Step 1: Create `src/main/tenant.js`**

```js
'use strict';

// Holds "which workspace is this session in" — resolved from the signed-in
// Supabase user after every auth change, handed to the cloud store as the
// scope function and to the renderer as part of auth status. `getWorkspaceId`
// returns null while signed out, without a membership, or when the
// workspace is suspended — the store refuses every call in those states.

const createTenant = ({ auth, workspaces }) => {
  let state = { workspaceId: null, role: null, platformAdmin: false, workspace: null };

  const resolve = async () => {
    const user = auth && auth.getUser();
    if (!user || !workspaces) {
      state = { workspaceId: null, role: null, platformAdmin: false, workspace: null };
      return state;
    }
    const email = (user.email || '').toLowerCase();
    const platformAdmin = workspaces.isPlatformAdmin(email);
    let membership = null;
    try {
      membership = await workspaces.resolveMembership({ userId: user.id, email });
      if (!membership && platformAdmin) {
        await workspaces.ensureVendorWorkspace(email);
        membership = await workspaces.resolveMembership({ userId: user.id, email });
      }
    } catch (e) {
      console.warn(`[qaflow] workspace resolution failed: ${e.message}`);
    }
    state = membership
      ? { workspaceId: membership.workspace.id, role: membership.member.role, platformAdmin, workspace: membership.workspace }
      : { workspaceId: null, role: null, platformAdmin, workspace: null };
    return state;
  };

  const get = () => state;
  const getWorkspaceId = () => (state.workspace && state.workspace.status === 'active' ? state.workspaceId : null);
  const status = () => ({
    workspace: state.workspace
      ? { id: state.workspace.id, name: state.workspace.name, plan: state.workspace.plan, status: state.workspace.status }
      : null,
    role: state.role,
    platformAdmin: state.platformAdmin,
  });

  return { resolve, get, getWorkspaceId, status };
};

module.exports = { createTenant };
```

- [ ] **Step 2: Wire `main.js`**

Near the top with the other engine requires: `const { createWorkspaceService } = require('../engine/workspaces.js');` and `const { createTenant } = require('./tenant.js');`. Replace the cloud store construction:

```js
let workspaces = null;
let tenant = null; // assigned in whenReady once auth exists

let store = localStore;
if (prisma && supabaseAdmin) {
  try {
    workspaces = createWorkspaceService({
      prisma,
      supabase: supabaseAdmin,
      platformAdminEmails: (process.env.ASTREUS_PLATFORM_ADMINS || '').split(',').map((e) => e.trim()).filter(Boolean),
    });
    store = createCloudStore({
      prisma,
      supabase: supabaseAdmin,
      localStore,
      getWorkspaceId: () => (tenant ? tenant.getWorkspaceId() : null),
    });
  } catch (e) {
    console.warn(`[qaflow] cloud store unavailable — running on local data: ${e.message}`);
    store = localStore;
  }
} else {
  console.warn('[qaflow] cloud unavailable — running on local data');
}
```

In `whenReady`, right after `auth = createAuth({ userDataDir });` succeeds: `tenant = createTenant({ auth, workspaces });`. Pass `tenant` and `workspaces` into `registerIpc({ …, tenant, workspaces })`. Change the API boot gate to require a workspace: `if (auth.getUser() && tenant.getWorkspaceId()) bootApiOnce();` in both the `auth.ready.then` and `auth.onChange` callbacks (resolve first: `auth.onChange(async () => { await tenant.resolve(); if (tenant.getWorkspaceId()) bootApiOnce(); })`).

- [ ] **Step 3: Wire `ipc.js`**

Add params `tenant = null, workspaces = null` to `registerIpc`. Add `const { can } = require('../engine/roles.js');` at the top. Replace the auth handlers:

```js
  const authPayload = () => ({ ...auth.status(), configured: true, ...(tenant ? tenant.status() : { workspace: null, role: null, platformAdmin: false }) });

  handle('auth:status', async () => {
    if (!auth) return { loggedIn: false, email: null, name: null, configured: false, workspace: null, role: null, platformAdmin: false };
    await auth.ready;
    if (tenant) await tenant.resolve();
    return authPayload();
  });
  handle('auth:login', async ({ email, password } = {}) => {
    if (!auth) throw new Error('Cloud auth is not configured');
    await auth.login(email, password);
    if (tenant) await tenant.resolve();
    return authPayload();
  });
  handle('auth:logout', async () => {
    if (!auth) throw new Error('Cloud auth is not configured');
    await auth.logout();
    if (tenant) await tenant.resolve();
    return true;
  });
  if (auth) {
    auth.onChange(async () => {
      if (tenant) await tenant.resolve();
      (notifyAuthStatus || ((s) => send('auth:changed', s)))(authPayload());
    });
  }
```

Add role helpers and the workspace handlers (place after the `---- settings ----` block):

```js
  // ---- workspace ----
  const requireWorkspace = () => {
    if (!tenant || !workspaces) throw new Error('Workspaces are unavailable in local mode');
    const t = tenant.get();
    if (!t.workspaceId) throw new Error('You are not a member of a workspace');
    return t;
  };
  const requireCan = (action) => {
    const t = requireWorkspace();
    if (!can(t.role, action)) throw new Error(`Your role (${t.role}) cannot ${action.replace('_', ' ')}.`);
    return t;
  };

  handle('workspace:current', async () => {
    const t = requireWorkspace();
    return { workspace: t.workspace, role: t.role, platformAdmin: t.platformAdmin, usage: await workspaces.usage(t.workspaceId) };
  });
  handle('workspace:members:list', () => workspaces.listMembers(requireWorkspace().workspaceId));
  handle('workspace:members:invite', ({ email, role } = {}) => {
    const t = requireCan('invite');
    return workspaces.inviteMember(t.workspaceId, { email, role }, t.role);
  });
  handle('workspace:members:changeRole', ({ memberId, role } = {}) => {
    const t = requireCan('change_role');
    return workspaces.changeRole(t.workspaceId, memberId, role, t.role);
  });
  handle('workspace:members:remove', ({ memberId } = {}) => {
    const t = requireCan('remove_member');
    return workspaces.removeMember(t.workspaceId, memberId, t.role);
  });
  handle('workspace:rename', async ({ name } = {}) => {
    const t = requireCan('edit_workspace');
    const ws = await workspaces.renameWorkspace(t.workspaceId, name, t.role);
    await tenant.resolve();
    return ws;
  });
  handle('workspace:delete', async () => {
    const t = requireCan('delete_workspace');
    await workspaces.deleteWorkspace(t.workspaceId, t.role);
    await tenant.resolve();
    return true;
  });
```

Guard project deletion:

```js
  handle('projects:remove', async (id) => {
    if (tenant && workspaces) requireCan('delete_project');
    await store.deleteProject(id);
    return true;
  });
```

- [ ] **Step 4: Preload**

Add after the `auth` group:

```js
  workspace: {
    current: invoke('workspace:current'),
    listMembers: invoke('workspace:members:list'),
    invite: invoke('workspace:members:invite'),
    changeRole: invoke('workspace:members:changeRole'),
    removeMember: invoke('workspace:members:remove'),
    rename: invoke('workspace:rename'),
    remove: invoke('workspace:delete'),
  },
```

- [ ] **Step 5: Verify** — `npm test` green; `unset ELECTRON_RUN_AS_NODE && npx electron . --smoke` → `SMOKE OK`. Then `npx electron .` (with `.env`), sign in as the platform admin, confirm Projects still lists your data (now scoped to `ws-krijax`), and that the main-process console shows no "workspace resolution failed" warning. Close the app.

- [ ] **Step 6: Commit**

```bash
git add src/main/tenant.js src/main/main.js src/main/ipc.js src/main/preload.js
git commit -m "feat: resolve the signed-in user's workspace, scope the store and REST API, workspace IPC surface

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Renderer gates, sidebar workspace name, vendor line

**Files:**
- Create: `src/renderer/src/screens/WorkspaceGate.jsx`
- Modify: `src/renderer/src/App.jsx` (`AuthGate`, ~line 397), `src/renderer/src/components/Sidebar.jsx` (props + footer ~lines 76–96), `src/renderer/src/screens/Settings.jsx` (Account card ~line 148), `src/renderer/src/screens/Login.jsx` (footer ~line 77)

**Interfaces:**
- Consumes: Task 5 auth payload fields `workspace`, `role`, `platformAdmin`.
- Produces: `WorkspaceGate({ status, kind: 'none' | 'suspended' })`; `Sidebar` accepts `workspaceName`; vendor string constant `VENDOR = 'Made by KriJax Software and Development'` exported from `src/renderer/src/lib/brand.js` (also exports `PRODUCT = 'KriJaxAutomation'` — Task 8 switches every string to it).

- [ ] **Step 1: Brand constants** — create `src/renderer/src/lib/brand.js`:

```js
export const PRODUCT = 'KriJaxAutomation';
export const VENDOR = 'Made by KriJax Software and Development';
```

- [ ] **Step 2: Gate screen** — create `src/renderer/src/screens/WorkspaceGate.jsx`:

```jsx
import { Building2, ShieldOff, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { VENDOR } from '@/lib/brand';

// Shown INSTEAD of the app shell when the signed-in user has no workspace
// membership ("none") or their workspace is suspended ("suspended").
export const WorkspaceGate = ({ status, kind }) => {
  const suspended = kind === 'suspended';
  const Icon = suspended ? ShieldOff : Building2;
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent text-primary">
          <Icon className="h-6 w-6" />
        </div>
        <h1 className="mt-4 text-lg font-semibold text-foreground">
          {suspended ? 'This workspace is suspended' : "You're not in a workspace yet"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {suspended
            ? `"${status.workspace?.name}" has been suspended. Contact KriJax Software and Development to restore access.`
            : `You're signed in as ${status.email}, but this account isn't a member of any workspace. Ask your administrator to invite you.`}
        </p>
        <Button variant="outline" className="mt-6" onClick={() => window.qaflow.auth.logout()}>
          <LogOut className="h-4 w-4" /> Sign out
        </Button>
        <p className="mt-6 text-xs text-muted-foreground">{VENDOR}</p>
      </div>
    </div>
  );
};
```

- [ ] **Step 3: Gate in `App.jsx`** — import `WorkspaceGate`, then replace `AuthGate`:

```jsx
const AuthGate = () => {
  const { status, refresh } = useAuth();

  if (!status) {
    return <div className="flex h-screen w-screen items-center justify-center bg-background text-sm text-muted-foreground">Starting…</div>;
  }
  if (status.configured && !status.loggedIn) {
    return <Login onLoggedIn={refresh} />;
  }
  if (status.configured && !status.workspace) {
    return <WorkspaceGate status={status} kind="none" />;
  }
  if (status.configured && status.workspace.status === 'suspended') {
    return <WorkspaceGate status={status} kind="suspended" />;
  }
  return <AppShell authStatus={status.configured ? status : null} />;
};
```

In `AppShell`, pass `workspaceName={authStatus?.workspace?.name}` to `<Sidebar … />`.

- [ ] **Step 4: Sidebar** — accept `workspaceName`; under the wordmark block add:

```jsx
      {workspaceName && (
        <div className="-mt-3 px-5 pb-3">
          <span className="inline-flex max-w-full items-center gap-1.5 truncate rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-medium text-primary" title="Your workspace">
            {workspaceName}
          </span>
        </div>
      )}
```

Replace the footer status card's two lines with:

```jsx
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
            {PRODUCT} {version ? `v${version}` : '—'}
          </div>
          <div className="mt-0.5 pl-3">All systems operational</div>
          <div className="mt-1.5 border-t border-border/60 pt-1.5 text-[10px] leading-tight text-muted-foreground/80">{VENDOR}</div>
```

(import `{ PRODUCT, VENDOR } from '@/lib/brand'`).

- [ ] **Step 5: Login + Settings** — in `Login.jsx` change the footer paragraph to two lines: keep "Access is invite-only…" and add `<p className="mt-2 text-center text-[11px] text-muted-foreground/80">{VENDOR}</p>`. In `Settings.jsx` Account card replace the "Signed in to the shared Astreus cloud workspace." line with:

```jsx
              <p className="mt-1 text-xs text-muted-foreground">
                Workspace: <span className="font-medium text-foreground">{account.workspace?.name || '—'}</span>
                {account.role && <> · {account.role}</>}
                {account.platformAdmin && <> · KriJax staff</>}
              </p>
```

and in the About card add a row `<div className="flex justify-between"><span className="text-muted-foreground">Vendor</span><span className="font-medium text-foreground">KriJax Software and Development</span></div>`.

- [ ] **Step 6: Verify** — `npm run build:renderer` clean; smoke `SMOKE OK`; launch, confirm the sidebar shows the "KriJax" chip and the vendor line; in Supabase temporarily set `astreus."Workspace".status = 'suspended'` for `ws-krijax`, relaunch → Suspended screen appears; set back to `active`.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/lib/brand.js src/renderer/src/screens/WorkspaceGate.jsx src/renderer/src/App.jsx src/renderer/src/components/Sidebar.jsx src/renderer/src/screens/Settings.jsx src/renderer/src/screens/Login.jsx
git commit -m "feat: workspace gate screens, workspace chip and vendor line in the shell

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Workspace screen

**Files:**
- Create: `src/renderer/src/screens/Workspace.jsx`, `src/renderer/src/components/TempPasswordDialog.jsx`
- Modify: `src/renderer/src/App.jsx` (lazy import + route `workspace`), `src/renderer/src/components/Sidebar.jsx` (nav item)

**Interfaces:**
- Consumes: `qaflow.workspace.*` (Task 5), `can` semantics via the `role` returned by `workspace:current`.
- Produces: route `#/workspace`.

- [ ] **Step 1: Temp-password dialog** — `src/renderer/src/components/TempPasswordDialog.jsx`:

```jsx
import { Copy, KeyRound } from 'lucide-react';
import { Dialog, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/lib/toast';

// Shown exactly once after an invite that created a brand-new login. The
// password is never stored anywhere — closing this is the last chance.
export const TempPasswordDialog = ({ open, email, password, onClose }) => {
  const toast = useToast();
  if (!open) return null;
  const copy = () => {
    navigator.clipboard?.writeText(`Email: ${email}\nTemporary password: ${password}`);
    toast('Login details copied.', 'success');
  };
  return (
    <Dialog open onClose={onClose} className="max-w-md">
      <div className="flex items-start justify-between p-5 pb-0">
        <div className="flex items-center gap-2 text-base font-semibold text-foreground">
          <KeyRound className="h-4 w-4 text-primary" /> Login created
        </div>
        <DialogClose onClick={onClose} />
      </div>
      <div className="flex flex-col gap-3 p-5 text-sm">
        <p className="text-muted-foreground">Hand these to the person out-of-band. This password is shown only once.</p>
        <div className="rounded-md bg-secondary px-3 py-2 font-mono text-xs">
          <div>Email: {email}</div>
          <div className="mt-1">Temporary password: <span className="font-semibold text-foreground">{password}</span></div>
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-border bg-secondary/40 px-5 py-3">
        <Button variant="outline" size="sm" onClick={onClose}>Done</Button>
        <Button size="sm" onClick={copy}><Copy className="h-4 w-4" /> Copy</Button>
      </div>
    </Dialog>
  );
};
```

- [ ] **Step 2: Workspace screen** — `src/renderer/src/screens/Workspace.jsx`:

```jsx
import { useEffect, useState } from 'react';
import { Building2, Users, Plus, Trash2, Pencil, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { TempPasswordDialog } from '@/components/TempPasswordDialog';
import { timeAgo } from '@/lib/format';
import { useToast } from '@/lib/toast';

const ROLES = ['member', 'admin', 'owner'];
const manages = (role) => role === 'owner' || role === 'admin';

const UsageBar = ({ label, used, max }) => {
  const pct = max ? Math.min(100, Math.round((used / max) * 100)) : 0;
  return (
    <div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span className="tabular-nums">{used} / {max ?? '∞'}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary">
        <div className={`h-full rounded-full ${pct >= 100 ? 'bg-danger' : 'bg-primary'}`} style={{ width: `${max ? pct : 15}%` }} />
      </div>
    </div>
  );
};

export const Workspace = () => {
  const toast = useToast();
  const [info, setInfo] = useState(null);
  const [members, setMembers] = useState([]);
  const [invite, setInvite] = useState({ email: '', role: 'member' });
  const [busy, setBusy] = useState(false);
  const [tempCreds, setTempCreds] = useState(null);
  const [removeTarget, setRemoveTarget] = useState(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [deleteText, setDeleteText] = useState('');

  const load = async () => {
    try {
      const [current, list] = await Promise.all([window.qaflow.workspace.current(), window.qaflow.workspace.listMembers()]);
      setInfo(current);
      setMembers(list);
      setName(current.workspace.name);
    } catch (e) {
      toast(`Failed to load workspace: ${e.message}`, 'error');
    }
  };
  useEffect(() => { load(); }, []);

  const run = async (fn, successMsg) => {
    setBusy(true);
    try {
      const result = await fn();
      if (successMsg) toast(successMsg, 'success');
      await load();
      return result;
    } catch (e) {
      toast(e.message, 'error');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const doInvite = async () => {
    const result = await run(() => window.qaflow.workspace.invite(invite), `Invited ${invite.email.trim().toLowerCase()}.`);
    if (result) {
      if (result.tempPassword) setTempCreds({ email: result.member.email, password: result.tempPassword });
      setInvite({ email: '', role: 'member' });
    }
  };

  if (!info) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  const { workspace, role, usage } = info;
  const canManage = manages(role);

  return (
    <div className="flex flex-col gap-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Workspace</h1>
        <p className="mt-1 text-sm text-muted-foreground">Your company's members, plan, and settings.</p>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_340px]">
        <div className="rounded-xl border border-border bg-card shadow-sm">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div className="flex items-center gap-2 text-base font-semibold text-foreground"><Users className="h-4 w-4 text-muted-foreground" /> Members ({members.length})</div>
          </div>
          {canManage && (
            <div className="flex flex-wrap items-end gap-2 border-b border-border px-5 py-4">
              <div className="flex min-w-64 flex-1 flex-col gap-1.5">
                <Label htmlFor="inv-email">Invite by email</Label>
                <Input id="inv-email" type="email" placeholder="teammate@company.com" value={invite.email} onChange={(e) => setInvite((f) => ({ ...f, email: e.target.value }))} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="inv-role">Role</Label>
                <Select id="inv-role" className="w-36" value={invite.role} onChange={(e) => setInvite((f) => ({ ...f, role: e.target.value }))}>
                  {ROLES.filter((r) => r !== 'owner' || role === 'owner').map((r) => <option key={r} value={r}>{r}</option>)}
                </Select>
              </div>
              <Button onClick={doInvite} disabled={busy || !invite.email.trim()}><Plus className="h-4 w-4" /> Invite</Button>
            </div>
          )}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-2.5 font-medium">Member</th><th className="px-5 py-2.5 font-medium">Role</th><th className="px-5 py-2.5 font-medium">Joined</th><th className="px-5 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-b border-border last:border-0">
                  <td className="px-5 py-3 text-foreground">{m.email}{!m.userId && <span className="ml-2 rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">invited</span>}</td>
                  <td className="px-5 py-3">
                    {canManage ? (
                      <Select className="w-32" value={m.role} disabled={busy} onChange={(e) => run(() => window.qaflow.workspace.changeRole({ memberId: m.id, role: e.target.value }), 'Role updated.')}>
                        {ROLES.filter((r) => r !== 'owner' || role === 'owner' || m.role === 'owner').map((r) => <option key={r} value={r}>{r}</option>)}
                      </Select>
                    ) : <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-primary">{m.role}</span>}
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{m.joinedAt ? timeAgo(m.joinedAt) : '—'}</td>
                  <td className="px-5 py-3 text-right">
                    {canManage && <button onClick={() => setRemoveTarget(m)} className="rounded-md p-1.5 text-muted-foreground hover:bg-danger-bg hover:text-danger" title="Remove"><Trash2 className="h-4 w-4" /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-6">
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-2 text-base font-semibold text-foreground"><Building2 className="h-4 w-4 text-muted-foreground" /> {workspace.name}</div>
            <div className="mt-1 text-xs text-muted-foreground">Plan: <span className="font-medium capitalize text-foreground">{workspace.plan}</span> · you are <span className="font-medium">{role}</span></div>
            <div className="mt-4 flex flex-col gap-3">
              <UsageBar label="Members" used={usage.members} max={usage.maxMembers} />
              <UsageBar label="Projects" used={usage.projects} max={usage.maxProjects} />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">Need more seats or projects? Contact KriJax Software and Development to upgrade your plan.</p>
          </div>

          {role === 'owner' && (
            <div className="rounded-xl border border-danger/40 bg-card p-5 shadow-sm">
              <div className="flex items-center gap-2 text-base font-semibold text-foreground"><Pencil className="h-4 w-4 text-muted-foreground" /> Workspace settings</div>
              <div className="mt-3 flex gap-2">
                <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!renaming} />
                {renaming
                  ? <Button size="sm" onClick={async () => { await run(() => window.qaflow.workspace.rename({ name }), 'Workspace renamed.'); setRenaming(false); }} disabled={busy}>Save</Button>
                  : <Button size="sm" variant="outline" onClick={() => setRenaming(true)}>Rename</Button>}
              </div>
              <div className="mt-5 flex items-center gap-2 text-sm font-semibold text-danger"><AlertTriangle className="h-4 w-4" /> Danger zone</div>
              <p className="mt-1 text-xs text-muted-foreground">Deleting removes every project, suite, run, ticket and member for everyone. Type the workspace name to confirm.</p>
              <div className="mt-2 flex gap-2">
                <Input placeholder={workspace.name} value={deleteText} onChange={(e) => setDeleteText(e.target.value)} />
                <Button variant="destructive" size="sm" disabled={busy || deleteText !== workspace.name} onClick={() => run(() => window.qaflow.workspace.remove(), 'Workspace deleted.')}><Trash2 className="h-4 w-4" /> Delete</Button>
              </div>
            </div>
          )}
        </div>
      </div>

      <TempPasswordDialog open={Boolean(tempCreds)} email={tempCreds?.email} password={tempCreds?.password} onClose={() => setTempCreds(null)} />
      <ConfirmDialog
        open={Boolean(removeTarget)}
        title={`Remove ${removeTarget?.email}?`}
        description="They lose access to this workspace immediately. Their login account is kept."
        confirmLabel="Remove"
        variant="danger"
        onConfirm={() => run(() => window.qaflow.workspace.removeMember({ memberId: removeTarget.id }), 'Member removed.')}
        onClose={() => setRemoveTarget(null)}
      />
    </div>
  );
};
```

- [ ] **Step 3: Route + nav** — in `App.jsx`: `const Workspace = lazyScreen(() => import('@/screens/Workspace'), 'Workspace');` and in `Screen`: `if (top === 'workspace') return <Workspace />;`. In `Sidebar.jsx` NAV_ITEMS add `{ label: 'Workspace', href: '#/workspace', icon: Building2, match: 'workspace' }` after Credentials (import `Building2`).

- [ ] **Step 4: Verify manually** — build, smoke, launch; as owner: invite a test address `astreus-test-manual@example.invalid` (member) → temp-password dialog appears → role dropdown works → remove it → then delete the auth user from the Supabase dashboard (Authentication → Users) to leave no residue. Confirm a `member`-role account (set your own role to member in the DB temporarily) sees the screen read-only, then restore `owner`.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/screens/Workspace.jsx src/renderer/src/components/TempPasswordDialog.jsx src/renderer/src/App.jsx src/renderer/src/components/Sidebar.jsx
git commit -m "feat: workspace screen - members, invites with one-time passwords, roles, plan usage, owner settings

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Rename the product to KriJaxAutomation

**Files:**
- Modify: `package.json` (`productName`, `description`), `src/main/main.js` (window `title`), `src/renderer/index.html` (`<title>`), `src/renderer/src/components/Sidebar.jsx` (wordmark), `src/renderer/src/screens/Login.jsx` (heading), `src/renderer/src/screens/Settings.jsx` (About row), `src/renderer/src/screens/Guide.jsx` (any product mentions), `README.md`, `docs/USER_GUIDE.md`, `docs/MANUAL.md`, `docs/QA_TRAINING.md`, `docs/ARCHITECTURE.md`, `docs/RELEASING.md`

**Interfaces:** none new; strings only. Historical plan/spec files under `docs/superpowers/` are records and are NOT edited (except this feature's own spec, already correct).

- [ ] **Step 1: Sweep the strings**

```bash
cd /d/personal-project/CritalCaller/qa-flow
grep -rl "Astreus Tech Tester Tool" package.json src README.md docs/*.md | xargs sed -i 's/Astreus Tech Tester Tool/KriJaxAutomation/g'
sed -i 's/"description": ".*"/"description": "KriJaxAutomation — record, run, and report browser QA suites"/' package.json
grep -rn "Astreus" src README.md docs/*.md | grep -v "astreus\b" | grep -vi "astreus-run-media\|schema\|ASTREUS_"
```

Fix whatever the last command still lists by hand (e.g. the Sidebar footer now uses `PRODUCT`; "Astreus cloud workspace" copy → "your KriJaxAutomation workspace"; the README first heading becomes `# KriJaxAutomation` with the subtitle "(formerly Astreus Tech Tester Tool / QA Flow)"). Internal ids (`astreus` schema, bucket, `ASTREUS_PLATFORM_ADMINS`, `qaflow`) must remain untouched — re-run the grep to prove only prose changed.

- [ ] **Step 2: Verify** — `npm run build:renderer`; smoke → `SMOKE OK`; launch and confirm the window title, wordmark, and login heading all read "KriJaxAutomation"; `npm test` green.

- [ ] **Step 3: Commit**

```bash
git add -A package.json src README.md docs/*.md
git commit -m "feat: rename product to KriJaxAutomation

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Docs, Guide, version, installer, E2E

**Files:**
- Modify: `docs/ARCHITECTURE.md` (add a "Workspaces (multi-tenant)" section under the cloud layer), `docs/USER_GUIDE.md` (new §0.5 "Workspaces and roles" after Sign in; note the NoWorkspace/Suspended screens), `src/renderer/src/screens/Guide.jsx` (add a short "Workspace & members" section between §2 and §3 of the in-app guide), `docs/MANUAL.md` (same), `package.json` (`"version": "2.2.0"`)

- [ ] **Step 1: Docs** — write the sections from the spec's §1.3–§1.6 in user language: one workspace per person; roles table (Owner / Admin / Member and what each can do); invite flow with the one-time password; plan limits and the "contact KriJax" message; suspended screen. ARCHITECTURE additionally documents `tenant.js`, `workspaces.js`, `roles.js`, the `getWorkspaceId` scope function, and the compound `Ticket` key.

- [ ] **Step 2: Version + installer** — set `"version": "2.2.0"`; run `npm run dist`; confirm `release/KriJaxAutomation Setup 2.2.0.exe` exists and that `release/win-unpacked/KriJaxAutomation.exe --smoke` prints `SMOKE OK`.

- [ ] **Step 3: E2E (manual, record results in the task report)** — `npm run db:seed-workspaces`; in a Node REPL with `.env` loaded call `createWorkspaceService(...).createWorkspace({ name: 'Golden Paws Co.', slug: 'golden-paws', plan: 'team', maxMembers: 3, maxProjects: 2, ownerEmail: '<a second real mailbox you control>' })`; sign in as that owner in the packaged app → Projects is empty (no KriJax data visible) → create 2 projects → a 3rd is refused with the limit message → Workspace screen → invite a member → sign in as the member on the dev instance → sees the owner's 2 projects, cannot delete one (permission toast), Workspace screen is read-only. Finally delete the test workspace and the two auth users.

- [ ] **Step 4: Commit + merge**

```bash
git add -A docs src/renderer/src/screens/Guide.jsx package.json
git commit -m "docs: workspaces and roles; release v2.2.0

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git checkout main && git merge --no-ff feature/workspaces -m "Merge branch 'feature/workspaces'" && git push origin main
```

---

## Self-review

**Spec coverage:** §1.1 → Task 1; §1.2 → Task 1 (seed) + Task 4 (`ensureVendorWorkspace`) + Task 5 (auto-heal); §1.3 → Tasks 5, 6; §1.4 → Task 3; §1.5 → Tasks 2, 4; §1.6 → Tasks 5, 6, 7, 8; §1.7 → Tasks 1–4 tests + Task 9 E2E; rename → Task 8. Sub-projects 2/3 are separate plans by design.

**Placeholders:** the "unchanged field mapping" comments in Task 3 refer to the existing `data = {…}` objects the implementer keeps verbatim (shown in full in the current file); every new function is written out. No TBDs.

**Type consistency:** `getWorkspaceId: () => string|null` (Task 3) ↔ `tenant.getWorkspaceId()` (Task 5). `inviteMember(workspaceId, { email, role }, actorRole)` (Task 4) ↔ IPC `workspace:members:invite` (Task 5) ↔ `qaflow.workspace.invite({ email, role })` (Task 7). `usage()` shape `{ members, maxMembers, projects, maxProjects }` used identically in Tasks 4, 5, 7. Auth payload fields `workspace`, `role`, `platformAdmin` used identically in Tasks 5, 6. Ticket compound key `workspaceId_id` used only inside Task 3.

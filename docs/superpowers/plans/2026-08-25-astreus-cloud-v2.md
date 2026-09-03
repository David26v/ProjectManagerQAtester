# Astreus Cloud v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn QA Flow v1 into **Astreus Tech Tester Tool**: cloud-primary storage on Supabase (Prisma → Postgres, run media → Storage) with invite-only Supabase Auth and auto-login, so the owner and their client share one live workspace.

**Architecture:** Keep the v1 seam — every consumer talks to the store through the `createStore()` interface. Add `src/engine/cloud-store.js` implementing that same interface over Prisma + Supabase Storage; `src/main/` wires the cloud store, adds an auth module (session persisted via safeStorage), and gates all data IPC behind login. The local JSON store remains for engine tests and per-device secrets (credential storageState blobs, settings.json).

**Tech Stack:** existing v1 stack + `prisma` / `@prisma/client` (Postgres), `@supabase/supabase-js` (Auth + Storage). Plain JavaScript everywhere; engine/main CommonJS; renderer React JSX.

**Spec:** `docs/superpowers/specs/2026-08-25-astreus-cloud-design.md` — read it first; it is the authority this plan argues from.

## Global Constraints

- Repo: `D:\personal-project\CritalCaller\qa-flow`, branch work off `main`. Plain JS. `src/engine/**`/`src/main/**` CommonJS; engine files must not `require('electron')` (cloud-store gets its Supabase/Prisma clients injected or created from plain env/params).
- `.env` (gitignored, NEVER committed) holds `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`. Never print these values in reports or commit messages. A `.env.example` with placeholder values IS committed.
- **SHARED-PROJECT ISOLATION (binding, amended 2026-08-25):** the target Supabase project hosts a LIVE ERP in its `public` schema. Astreus owns exactly one Postgres schema — **`astreus`** — and one storage bucket — **`astreus-run-media`**. Never create/alter/drop anything outside them. `DATABASE_URL` must carry `?schema=astreus` (append mechanically to the value inside `.env`; use `&schema=astreus` if the URL already has a query string; never print the value); `src/engine/cloud/db.js` throws unless the schema param is present. Schema deployment is **`prisma db push`** (NOT `migrate dev` — no shadow DB against the live instance, and it keeps `_prisma_migrations` out of `public`). Integration tests assert afterward that `information_schema.tables` gained NO new tables in `public`.
- Auth is the project's SHARED Supabase Auth — its existing users sign into Astreus (user-intended); no separate user pool, no signup.
- Secrets rule unchanged: captured storageState blobs stay local (safeStorage-encrypted); the cloud `CredentialProfile` table stores metadata only. No secret ever appears in reports, exports, or API/IPC responses.
- `npm test` must stay green offline: cloud integration tests skip when `DATABASE_URL` is unset (`node:test` `t.skip()`), and no default test may hit the network.
- Verification floor per task: `npm test` green AND `npm run smoke` prints `SMOKE OK` exit 0.
- Branding: user-visible name is exactly **"Astreus Tech Tester Tool"**. Internal ids stay `qaflow`/`qa-flow` (`window.qaflow`, `qaflow-media://`, CLI, data dir).
- Commits: conventional messages, NO Claude/Co-Authored-By attribution lines, commit at the end of each task.
- Renderer conventions from v1 hold: shadcn-style primitives in `src/renderer/src/components/ui/`, `useToast()` for feedback, no native alert/confirm, all data via `window.qaflow`.

## Store interface contract (what cloud-store must implement)

`src/engine/store.js`'s `createStore(baseDir)` returns an object whose methods the rest of the app calls. `createCloudStore(...)` (Task 2) must return the same surface, async-compatible (v1 methods are sync; every call site in ipc.js/api.js already `await`s or tolerates promises — verify each while implementing):
`listProjects, getProject, saveProject, deleteProject, listSuites, getSuite, saveSuite, deleteSuite, listRuns(filter), getRun, saveRun, runDir, listCredentials, saveCredential, getCredentialBlob, deleteCredential, listTickets, saveTicket, deleteTicket, getSettings, saveSettings, nextTicketId` — read `src/engine/store.js` for exact signatures/return shapes before writing any cloud method; mirror them exactly.

---

### Task 1: Prisma schema (isolated `astreus`) + db push + clients

**Salvage note:** a prior attempt lives on branch `astreus-cloud-wip-old` (commit "wip: prisma schema and cloud clients"): `prisma/schema.prisma`, `src/engine/cloud/db.js`, `src/engine/cloud/supabase.js`, `test/cloud-db.test.js`, `.env.example` are all reusable as starting points (`git show astreus-cloud-wip-old:<path>`), but package.json/package-lock diverged — re-add dependencies fresh on THIS branch, never merge or cherry-pick the WIP commit. That attempt also pinned `prisma`/`@prisma/client` to `^6` deliberately (Prisma 7 dropped the inline `datasource.url` syntax used here) — keep the `^6` pin.

**Files:**
- Create: `prisma/schema.prisma`
- Create: `src/engine/cloud/db.js` (Prisma client factory), `src/engine/cloud/supabase.js` (supabase-js admin client factory)
- Create: `.env.example`
- Modify: `package.json` (deps + `"db:push": "prisma db push"` script), `.env` (mechanical `schema=astreus` append only — see Global Constraints)
- Test: `test/cloud-db.test.js`

**Interfaces:**
- Produces: `createPrisma()` → `PrismaClient` (reads `process.env.DATABASE_URL`, throws unless it contains `schema=astreus`); `createSupabaseAdmin()` → supabase-js client from `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`; Prisma models `Project`, `Suite`, `Run`, `Ticket`, `CredentialProfile`, `TicketCounter` — all landing in the `astreus` schema via the connection's schema param (single-schema mode; no `@@schema` attributes needed).

- [ ] Step 1: `npm i -D prisma@^6` and `npm i -S @prisma/client@^6 @supabase/supabase-js dotenv`.
- [ ] Step 2: Write `prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Project {
  id                 String   @id
  name               String
  key                String
  baseUrl            String
  type               String   @default("web")
  environments       Json     @default("[]")
  defaultEnvironment String?
  description        String?
  primary            Boolean  @default(false)
  createdAt          DateTime
  updatedAt          DateTime
  suites             Suite[]
}

model Suite {
  id          String   @id
  projectId   String
  name        String
  description String?
  tags        String[] @default([])
  environment String?
  steps       Json     @default("[]")
  archived    Boolean  @default(false)
  createdAt   DateTime
  updatedAt   DateTime
  project     Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
}

model Run {
  runId       String    @id
  suiteId     String
  projectId   String
  suiteName   String
  status      String
  environment String?
  triggeredBy String    @default("manual")
  startedAt   DateTime
  finishedAt  DateTime?
  report      Json
  @@index([projectId, startedAt])
  @@index([suiteId, startedAt])
}

model Ticket {
  id                String   @id
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
}

model CredentialProfile {
  id          String    @id
  name        String
  projectId   String?
  environment String?
  loginUrl    String?
  username    String?
  encrypted   Boolean   @default(true)
  deviceLabel String?
  createdAt   DateTime
  lastUsedAt  DateTime?
}

model TicketCounter {
  id    Int @id @default(1)
  value Int @default(0)
}
```

- [ ] Step 3: `src/engine/cloud/db.js`:

```js
const { PrismaClient } = require('@prisma/client');

function createPrisma() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  return new PrismaClient();
}

module.exports = { createPrisma };
```

- [ ] Step 4: `src/engine/cloud/supabase.js`:

```js
const { createClient } = require('@supabase/supabase-js');

function createSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase URL or service role key not set');
  return createClient(url, key, { auth: { persistSession: false } });
}

module.exports = { createSupabaseAdmin };
```

- [ ] Step 5: `.env.example` with the four variable names and placeholder values (`https://YOUR-PROJECT.supabase.co`, `sb_publishable_...`, `sb_secret_...`, `postgresql://postgres:PASSWORD@db.YOUR-PROJECT.supabase.co:5432/postgres`).
- [ ] Step 6: mechanically append `schema=astreus` to `.env`'s `DATABASE_URL` value if absent (`?` or `&` as appropriate; use sed/node — never echo the value). package.json script `"db:push": "prisma db push"`. Run with the env loaded (`set -a; . ./.env; set +a; npx prisma db push`). BEFORE pushing, run a read-only sanity query counting tables in `public` (save the number). If push fails on pgbouncer/prepared statements, derive a direct URL (port 6543→5432, drop `pgbouncer=true`, KEEP `schema=astreus`) for the push command only. Expected: `astreus` schema created with the 6 tables, `npx prisma generate` run, and the `public` table count UNCHANGED (state both counts in the report).
- [ ] Step 7: `test/cloud-db.test.js` — loads dotenv, and `t.skip()`s everything when `DATABASE_URL` unset; otherwise: creates Prisma, `SELECT 1` via `$queryRaw`, asserts each model table exists by doing `count()` on all six models, disconnects.

```js
const test = require('node:test');
const assert = require('node:assert');
require('dotenv').config();

test('cloud db connectivity and schema', async (t) => {
  if (!process.env.DATABASE_URL) return t.skip('DATABASE_URL not set');
  const { createPrisma } = require('../src/engine/cloud/db.js');
  const prisma = createPrisma();
  try {
    for (const model of ['project', 'suite', 'run', 'ticket', 'credentialProfile', 'ticketCounter']) {
      assert.ok(Number.isInteger(await prisma[model].count()));
    }
  } finally {
    await prisma.$disconnect();
  }
});
```

- [ ] Step 8: Run `npm test` (all green; new test passes with the real .env present) and `npm run smoke`. Commit `feat: prisma schema, supabase clients, initial migration`.

### Task 2: Cloud store (Prisma-backed store interface)

**Files:**
- Create: `src/engine/cloud-store.js`
- Test: `test/cloud-store.test.js`

**Interfaces:**
- Consumes: `createPrisma()`, `createSupabaseAdmin()` (Task 1); the store interface contract (header section — read `src/engine/store.js` first).
- Produces: `createCloudStore({ prisma, supabase, localStore })` returning the full store surface. `localStore` is a v1 `createStore(baseDir)` instance used ONLY for: credential blobs (`saveCredential`'s blob half, `getCredentialBlob`), `getSettings`/`saveSettings`, and `runDir` (local temp dir for in-flight runs).

- [ ] Step 1 (RED): write `test/cloud-store.test.js` — dotenv + skip-without-DATABASE_URL; with it: build `createCloudStore` with real prisma + a v1 local store on a temp dir; round-trip each entity with `astreus-test-` prefixed ids; verify `listRuns({ projectId, suiteId })` filters both keys; verify `nextTicketId()` returns strictly increasing `BUG-<n>` under `Promise.all` of 5 concurrent calls (atomicity via `TicketCounter` upsert/increment in a transaction); `finally` block deletes every `astreus-test-` row. Run: fails (module missing).
- [ ] Step 2 (GREEN): implement `cloud-store.js`. Shape rules: rows store `createdAt`/`updatedAt` as Date, interface returns ISO strings exactly like the JSON store (read v1 store to copy the shapes); `saveRun(report)` upserts the Run row with query columns pulled from the report and `report` as the Json payload; `getRun`/`listRuns` return the report objects (list sorted newest-first like v1); delete methods cascade suites via Prisma relation and delete runs by `deleteMany({ where: { suiteId } })` mirroring v1 behavior; credentials: metadata row in Postgres + blob delegated to `localStore` (blob absent on this device → `getCredentialBlob` returns null and callers already toast); settings delegated to `localStore`.
- [ ] Step 3: run `test/cloud-store.test.js` green, then full `npm test` + `npm run smoke`. Commit `feat: prisma-backed cloud store implementing the v1 store interface`.

### Task 3: Run media → Supabase Storage + signed URLs

**Files:**
- Create: `src/engine/cloud/media.js`
- Modify: `src/engine/cloud-store.js` (saveRun uploads media), `src/main/ipc.js` (`app:mediaUrl` → signed URL), `src/main/main.js` (bucket bootstrap at boot)
- Test: `test/cloud-media.test.js`

**Interfaces:**
- Consumes: `createSupabaseAdmin()`; run reports whose `capturedMedia[].path` are files inside `localStore.runDir(runId)`.
- Produces: `ensureBucket(supabase)` (idempotent, private bucket `astreus-run-media`); `uploadRunMedia(supabase, runId, runDirPath, report)` → mutates report: each uploaded file's `capturedMedia[].path`, `videoPath`, `steps[].screenshot` become `storage:<runId>/<filename>`, adds `mediaUploadError` per failed file without throwing; `signedMediaUrl(supabase, storagePath, ttlSeconds=3600)` → https URL.

- [ ] Step 1 (RED): `test/cloud-media.test.js` — skip without env; with it: ensureBucket twice (idempotent), upload a tiny temp file as `astreus-test-run/<name>`, get a signed URL, `fetch` it and assert the bytes round-trip, then remove the object. Run: fails.
- [ ] Step 2 (GREEN): implement `media.js` with supabase-js `storage.createBucket('astreus-run-media', { public: false })` (swallow "already exists"), `storage.from('astreus-run-media').upload/createSignedUrl/remove`.
- [ ] Step 3: wire `cloud-store.saveRun`: after upserting the row, if the report has local media (paths not starting `storage:`), call `uploadRunMedia`, re-upsert the mutated report, then `fs.rm` the local run dir ONLY when no capturedMedia entry carries `mediaUploadError` — on partial failure keep the dir (local fallback + retry). `app:mediaUrl` in ipc.js: paths starting `storage:` → `signedMediaUrl`; otherwise keep the v1 `qaflow-media://` fallback. main.js boot: `await ensureBucket(...)` next to the API boot (failure = warning, not crash).
- [ ] Step 4: `npm test` + `npm run smoke` green. Commit `feat: run media uploads to supabase storage with signed playback urls`.

### Task 4: Auth module + login gating + cloud wiring in main

**Files:**
- Create: `src/main/auth.js`
- Modify: `src/main/main.js` (wire cloud store + auth), `src/main/ipc.js` (auth surface + logged-in guard), `src/main/preload.js` (`auth.*` + `auth:changed` event)
- Test: manual smoke (auth is Electron-bound; engine untouched)

**Interfaces:**
- Consumes: `@supabase/supabase-js` with `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (NOT the service key) for auth; `safeStorage` for session persistence; Task 2/3 factories.
- Produces: `createAuth({ userDataDir })` → `{ getUser(), status() -> { loggedIn, email, name }, login(email, password), logout(), onChange(cb) }`. Session JSON persisted safeStorage-encrypted at `<userDataDir>/auth-session.bin` via a custom supabase-js `auth.storage` adapter; restored on boot (auto-login). Preload: `qaflow.auth.{status,login,logout}` + `qaflow.on('auth:changed', cb)`. Every data IPC handler except `auth:*` and `app:version` rejects with `Error('Not signed in')` when `!auth.getUser()`.
- The renderer-facing surface Task 5 relies on — exact channel names: `auth:status`, `auth:login` (args `{ email, password }`), `auth:logout`; event payload `{ loggedIn, email, name }`.
- main.js: load dotenv at top (`require('dotenv').config()` pointing at the app root .env); build `localStore = createStore(userData/qaflow-data)`, `prisma`, `supabaseAdmin`, then `store = createCloudStore({ prisma, supabase: supabaseAdmin, localStore })` and pass THAT store to `registerIpc` and the REST API. API boot: only start listening once logged in; while logged out the api responds 503 `{ error: 'Not signed in' }` (simplest: boot it lazily on first `auth:changed` loggedIn=true; acceptable to leave it running once started).
- `--smoke` must still pass with no session and no network: smoke prints SMOKE OK after `did-finish-load` regardless of login state; guard cloud boot steps in try/catch so missing env only warns during smoke.

- [ ] Step 1: implement auth.js (supabase-js client with `auth: { storage: customAdapter, persistSession: true, autoRefreshToken: true }`; adapter's getItem/setItem/removeItem read/write the safeStorage-encrypted file; plaintext+flag fallback when `safeStorage.isEncryptionAvailable()` is false, mirroring the v1 credential pattern in ipc.js).
- [ ] Step 2: wire main.js/ipc.js/preload.js per Interfaces. Ticket identity: `reports:createTicket` and ticket comment saves default `reporter`/`author` to `auth.getUser()?.email` (user_metadata.name preferred when present) instead of `'QA'` — pass the identity into the existing exporter call as its options allow (read `src/engine/exporters/ticket.js` for the parameter; extend its options object if needed — engine change is allowed here because it stays Electron-free).
- [ ] Step 3: `npm test` green; `npm run smoke` SMOKE OK with and without a valid session file. Commit `feat: supabase auth with persisted auto-login session, ipc gating, cloud store wiring`.

### Task 5: Renderer — Login screen, auth state, identity, rename

**Files:**
- Create: `src/renderer/src/screens/Login.jsx`
- Modify: `src/renderer/src/App.jsx` (auth gate), `src/renderer/src/components/Sidebar.jsx` (wordmark + user chip), `src/renderer/src/screens/Settings.jsx` (identity + sign out), `src/renderer/index.html` (title), `src/main/main.js` (window title), `package.json` (`productName`), `README.md` (title line only)
- Test: build/smoke + manual

**Interfaces:**
- Consumes: `qaflow.auth.{status,login,logout}`, `qaflow.on('auth:changed')` (Task 4 — exact names above).

- [ ] Step 1: `Login.jsx` — centered card on the app background: "Astreus Tech Tester Tool" wordmark (reuse the sidebar's blue-square logo styling), email + password `Field`s, Sign in `Button` with loading state, error toast on failure ("Invalid login credentials" surfaces as-is). No signup/forgot links.
- [ ] Step 2: `App.jsx` — on mount call `auth.status()`; while unknown render nothing (or a splash div); `loggedIn === false` → render `<Login onLoggedIn={refresh}/>` INSTEAD of the shell; subscribe `auth:changed` to flip state live (logout returns to Login). All existing screens render only when logged in.
- [ ] Step 3: identity + rename — Sidebar wordmark "Astreus Tech Tester Tool" (keep the Q-square or swap letter to "A" — pick A), user chip shows the logged-in email/name (from `auth.status()`), Settings gets an Account card (email + Sign out button calling `auth.logout()`), window/tab titles and `productName` renamed. README first heading becomes `# Astreus Tech Tester Tool` (subtitle may keep "(formerly QA Flow)").
- [ ] Step 4: `npm test` + `npm run smoke` green. Commit `feat: login screen with auto-login gate, account identity, astreus rename`.

### Task 6: Exports from cloud media + docs + E2E verification

**Files:**
- Modify: `src/main/ipc.js` (exportExcel/bundle download storage media to temp first), `docs/ARCHITECTURE.md`, `docs/USER_GUIDE.md`
- Test: `test/cloud-store.test.js` additions + manual E2E

**Interfaces:**
- Consumes: everything prior.

- [ ] Step 1: excel/zip export handlers: when the run's media paths are `storage:` paths, download each needed file (`storage.from('astreus-run-media').download`) into a fresh temp dir, hand the exporters a `runDirResolver` pointing at it, and clean the temp dir in `finally`. Ticket text/attachments keep storage paths as-is. `runs:openDir`: for cloud runs (no local run dir) return `{ cloud: true }` and have RunDetail's "Open Folder" button become "Copy media link" (signed URL of the video) with a toast — local-dir behavior stays for any legacy run.
- [ ] Step 2: docs — ARCHITECTURE: add the cloud layer diagram + auth/session/media sections and mark the JSON store as "tests + device-local secrets"; USER_GUIDE: add Sign in section, note media lives in the cloud, update the data-location table (cloud vs device). Both keep the Astreus name.
- [ ] Step 3: E2E (manual, from the real app — document results honestly in the task report): sign in → create project → record a short suite on any site → run headless → run appears with playable video (signed URL) → build report → export excel + zip → create ticket (reporter = your email) → sign out → sign back in (auto-login on relaunch). Any step that cannot be performed by the agent is listed for the human to click.
- [ ] Step 4: full `npm test` + `npm run smoke`. Commit `feat: cloud-media exports, astreus docs, e2e pass`.

---

## Out of Scope

RLS/per-user permissions, offline mode, self-signup, magic links, storage pruning UI, v1 local-data migration, installers.

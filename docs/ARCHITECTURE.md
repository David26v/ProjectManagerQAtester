# KriJaxAutomation — Architecture

Plain-JavaScript Electron app with a strict three-layer split, cloud-primary
storage on Supabase since v2. The rule that holds everything together:
**`src/engine/` never imports Electron** — it is pure Node, receives
paths/config/clients as parameters, and is unit-tested with `node --test`
alone.

```
┌────────────────────────────────────────────────────────────┐
│ src/renderer/   React 19 + Tailwind v4 + shadcn/ui (Vite)  │
│                 talks ONLY to window.qaflow                │
│                 Login gate wraps the whole shell           │
├────────────────────────────────────────────────────────────┤
│ src/main/       Electron shell (CommonJS)                  │
│   main.js       window, qaflow-media:// protocol, API boot │
│   auth.js       Supabase Auth + safeStorage session        │
│   preload.js    contextBridge → window.qaflow              │
│   ipc.js        thin adapters: IPC channel ↔ engine call   │
│   scheduler.js  due-schedule polling → executeRun          │
├────────────────────────────────────────────────────────────┤
│ src/engine/     pure Node (CommonJS) — no Electron         │
│   cloud-store.js  Prisma+Storage store (same interface)    │
│   cloud/        db.js · supabase.js · media.js             │
│   store.js      JSON+file store (tests + device-local)     │
│   runner.js     Playwright suite runner + evidence capture │
│   recorder.js   browser recorder → JSON steps              │
│   session.js    headed login capture → storageState        │
│   exporters/    excel.js · ticket.js · bundle.js           │
│   api.js        Express REST API (127.0.0.1 only)          │
└────────────────────────────────────────────────────────────┘
bin/qaflow.js    CLI — a pure HTTP client of the REST API

        Supabase (shared project, isolated `astreus` schema)
        ├─ Postgres via Prisma — projects/suites/runs/tickets/
        │  credential metadata/schedules (shared workspace data)
        ├─ Storage bucket `astreus-run-media` — run videos and
        │  screenshots, served to the app via signed URLs
        └─ Supabase Auth — invite-only sign-in (shared users)
```

## Cloud layer (v2)

- **Source of truth** — the cloud store (`src/engine/cloud-store.js`)
  implements the exact same `createStore()` surface as the v1 JSON store,
  over Prisma → Postgres. Every consumer (ipc.js, api.js, scheduler)
  talks to "the store" and doesn't know which one it got.
- **Schema isolation (binding)** — the Supabase project hosts a live ERP in
  `public`; KriJaxAutomation owns exactly the `astreus` Postgres schema and the
  `astreus-run-media` bucket, nothing else. `DATABASE_URL` must carry
  `schema=astreus` (`cloud/db.js` throws otherwise); deployment is
  `prisma db push` via `npm run db:push` (which rewrites to the direct
  5432 URL — the pooler hangs pushes). Tests permanently assert no
  astreus tables have leaked into `public`.
- **Run media** — the runner still writes video/screenshots to a local
  scratch run dir; `cloud-store.saveRun` then uploads each file to
  `astreus-run-media/<runId>/<file>`, rewrites report paths to
  `storage:<runId>/<file>`, re-persists, and removes the local dir only
  when every file uploaded cleanly (partial failure keeps the dir as a
  local fallback). Playback goes through `app:mediaUrl`, which returns a
  signed URL (1h TTL) for `storage:` paths and the legacy
  `qaflow-media://` protocol for local ones.
- **Exports from cloud media** — Excel/zip exports "materialize" a cloud
  run first: download every referenced object into a temp dir, rewrite a
  copy of the report to bare filenames, run the unchanged exporters
  against it, and clean the temp dir in `finally`. "Open Folder" on a
  cloud run returns `{ cloud: true, mediaLink }` and the renderer copies
  a signed video link instead.
- **What stays device-local** — credential storageState/password blobs
  (safeStorage-encrypted `.bin` files; the cloud `CredentialProfile` table
  holds metadata only), `settings.json`, and the in-flight run scratch
  dir. The v1 JSON store keeps serving engine tests, and is the automatic
  fallback store when cloud construction fails at boot (offline dev,
  missing `.env`) — the app degrades to local data with a console warning
  instead of white-screening.

## Workspaces (multi-tenant)

Every tenant row (`Project`, `Suite`, `Run`, `Ticket`, `CredentialProfile`,
`Schedule`) carries a `workspaceId`; one workspace is a company/team, and a
user belongs to exactly **one** workspace at a time (inviting an email that
already has a membership elsewhere is refused).

- **`src/engine/roles.js`** — the single source of truth for what a role may
  do. `ROLES = ['owner', 'admin', 'member']`; `can(role, action)` checks a
  small `GRANTS` map over management actions only (`invite`,
  `remove_member`, `change_role`, `edit_workspace`, `delete_workspace`,
  `delete_project`) — every QA action (record, run, report, tickets,
  credentials, schedules, repository) is deliberately absent from the map
  and open to all three roles.
- **`src/engine/workspaces.js`** — `createWorkspaceService({ prisma,
  supabase, platformAdminEmails })`. Pure Node: Prisma and the service-role
  supabase-js client are injected, and it never reads tenant data itself —
  that's the cloud store's job. Owns membership resolution
  (`resolveMembership`), invite/provisioning (`inviteMember` creates a
  Supabase Auth login and returns a one-time temp password when the email
  had no account, or silently attaches the membership when it already did),
  role changes and removal (both refuse to touch another owner unless the
  actor is an owner, and refuse to drop the last owner), rename/delete
  (owner-only), and plan-limit enforcement (`usage()` compares live
  member/project counts against the workspace's `maxMembers`/`maxProjects`,
  throwing a "Contact KriJax to upgrade" error when exceeded). Also owns the
  KriJax house workspace (`VENDOR_WORKSPACE`, id `ws-krijax`) via
  `ensureVendorWorkspace`, auto-created/healed the first time a
  platform-admin email signs in with no membership yet.
- **`src/main/tenant.js`** — resolves "which workspace is this session in"
  from the signed-in Supabase user after every auth change. `resolve()`
  looks up the membership (auto-healing the vendor workspace for platform
  admins with none), and `getWorkspaceId()` — the function handed to the
  cloud store as its scope — returns the workspace id only when
  `workspace.status === 'active'`, and `null` while signed out, without a
  membership, or when the workspace is suspended. `status()` exposes
  `{ workspace, role, platformAdmin }` to the renderer for auth state and
  the gate screens.
- **Cloud store scoping** — `cloud-store.js`'s internal `ws()` helper calls
  `getWorkspaceId()` on every single read and write and throws `No active
  workspace` when it returns null; every query filters or scopes by that id
  (`where: { workspaceId: ws() }`, or `id + workspaceId` together on
  lookups by id). This is the last line of defense — the renderer's gate
  screens normally prevent a scoped call from firing in the first place,
  but the store does not trust the UI for isolation.
- **Compound `Ticket` key** — tickets are the one model without a surrogate
  primary key: `@@id([workspaceId, id])` in `prisma/schema.prisma`. Ticket
  numbers (`BUG-1`, `BUG-2`, …) are per-workspace, driven by a
  `TicketCounter` row keyed on `workspaceId` (`@unique`), so two workspaces
  each mint their own `BUG-1` without colliding — the compound id is what
  makes that safe.
- **Gate screens (renderer)** — `WorkspaceGate.jsx` renders instead of the
  app shell in two cases: `kind="none"` ("You're not in a workspace yet",
  signed in but no membership) and `kind="suspended"` ("This workspace is
  suspended"); both offer only **Sign out**. `App.jsx` picks between the
  normal shell, the Login screen, and this gate based on `auth:status`'s
  `workspace`/`role` payload.
- **Seeding** — `npm run db:seed-workspaces` (idempotent) creates the house
  workspace, grants owner membership to every `ASTREUS_PLATFORM_ADMINS`
  email, and syncs each workspace's `TicketCounter` to its current max
  ticket number.

## Auth

- **auth.js (main)** — Supabase Auth with the *publishable* key only (the
  service-role key is confined to the engine's admin client). The session
  JSON (incl. refresh token) is persisted through a custom storage adapter
  as a safeStorage-encrypted `auth-session.bin`, restored on boot
  (auto-login) and refreshed automatically.
- **Gating** — every data IPC channel except `auth:*`, `updates:*`, and
  `app:version` rejects with `Not signed in` when no user is active. The
  REST API only boots after the first confirmed sign-in and 503s every
  route while signed out. `auth:status` awaits session restore before
  answering and reports `configured: false` when no cloud env exists at
  all — in that case the renderer skips the Login gate and the app runs
  ungated on local data.
- **Identity** — tickets and comments default their reporter/author to the
  signed-in user (metadata name preferred, else email).

## Engine (`src/engine/`)

- **store.js** — `createStore(baseDir)`; JSON files under one base dir.
  Still the contract-defining implementation: `cloud-store.js` mirrors its
  method signatures and return shapes exactly (dates as ISO strings, runs
  newest-first, `BUG-<n>` ticket ids via an atomic counter).
- **runner.js** — drives the `playwright` library directly. Executes the
  fixed step vocabulary
  (`goto|click|fill|press|select|waitFor|assertVisible|assertText`), records
  video, screenshots the failing step, and captures **all** of: console
  errors, uncaught in-page exceptions (`pageerror`), tab crashes, failed
  requests, and every HTTP ≥400 response. Supports retries and an optional
  manual-login pre-step (password redacted from any error text).
- **recorder.js** — opens a browser with an injected script
  (`recorder-inject.js`) that emits steps live as the user interacts.
- **session.js** — `start({loginUrl})` opens a headed browser and returns a
  controller; `finish()` captures Playwright `storageState`, `cancel()`
  aborts. Encryption happens in the main process, not here.
- **exporters/** — Excel (exceljs), plain-text ticket generator + kanban
  ticket builder (shared severity heuristic), zip bundle (archiver).
- **git.js** — embedded git client over isomorphic-git (pure JS, no native
  modules): clone/fetch/pull/push over HTTPS (GitHub PAT as
  `x-access-token`), statusMatrix-based staging model, branch
  list/checkout/create (remote-only branches get a local tracking branch),
  commit log with parent oids (drives the renderer's lane graph), per-commit
  changed files via tree walk, and jsdiff line diffs (binary/oversize
  guarded). Working copies live at `<baseDir>/repos/<projectId>` — one per
  project per device; the token is safeStorage-encrypted at
  `<baseDir>/github-token.bin` and never crosses the bridge.
- **api.js** — `createApi({store, runSuiteFn, isSignedIn})`, bound to
  `127.0.0.1`. Routes: `GET /projects`, `GET /projects/:id/suites`,
  `POST /projects/:id/suites/:suiteId/run` (awaits the run, returns 201 with
  the finished report), `GET /runs?projectId=&suiteId=`,
  `GET /runs/:runId/report`, `POST /webhooks/deploy-complete`,
  `GET /projects/:id/auth/status` (credential metadata only). Errors are
  always `{ error: "<message>" }` with a proper status code; 503 when
  signed out.

## Run report shape (fixed contract)

```js
{ runId, suiteId, projectId, suiteName, targetUrl, environment,
  startedAt, finishedAt, status: "passed"|"failed",
  triggeredBy: "manual"|"api"|"cli"|"schedule",
  steps: [{ name, status, error?, screenshot?, durationMs }],
  consoleErrors: [{ text }], networkFailures: [{ url, failure }],
  videoPath,
  capturedMedia: [{ id, type: "video"|"screenshot", path, stepIndex? }],
  reportSelection: { selectedMediaIds: [], notes: {} } | null }
```

The renderer, exporters, API, and CLI all consume exactly this shape. For
cloud runs, `videoPath` / `steps[].screenshot` / `capturedMedia[].path` are
`storage:<runId>/<file>` sentinels instead of bare filenames.

## Electron main (`src/main/`)

- **main.js** — loads `.env`, builds localStore → Prisma → Supabase admin →
  cloud store (each guarded; failures degrade to local), creates the
  1500×980 window (`contextIsolation: true`, `nodeIntegration: false`),
  boots the REST API after first sign-in on `settings.apiPort` (default
  4317), ensures the Storage bucket, starts the scheduler, and registers
  the **`qaflow-media://<runId>/<file>`** protocol (runId validated against
  `/^[A-Za-z0-9_-]+$/`, path-traversal hardened). `--smoke` mode loads the
  window with no env/network at all, prints `SMOKE OK`, exits 0.
- **preload.js** — exposes `window.qaflow` via contextBridge. Dot-path
  groups mirror IPC channel names (`projects:list` ⇔ `qaflow.projects.list`):
  `auth.* projects.* suites.* runs.* recorder.* session.* reports.*
  tickets.* settings.* schedules.* app.* updates.*`, plus allowlisted push
  events via `qaflow.on(...)` (`recorder:step`, `run:progress`,
  `schedules:fired`, `browser:status`, `updates:status`, `auth:changed`).
- **ipc.js** — one thin `ipcMain.handle` per channel: parse args → call
  engine → return JSON, with the signed-in guard applied centrally.
  Credential flow: captured `storageState` is encrypted with `safeStorage`
  (plaintext fallback is flagged `encrypted:false`); when a run/recording
  uses a profile, the blob is decrypted to a temp file passed to
  Playwright and deleted in `finally`. Secrets never cross the bridge.

## Renderer (`src/renderer/`)

Vite app (`vite.config.mjs`, output `src/renderer/dist/`, loaded from disk —
no dev server). React 19, Tailwind v4 (`@theme` tokens in `src/index.css`),
hand-vendored shadcn/ui primitives in `src/components/ui/`, lucide-react
icons.

- **Auth gate** — `App.jsx` renders the Login screen *instead of* the shell
  until a session is active (when cloud auth is configured); no data hook
  mounts while signed out, so gated IPC calls can't fire. `auth:changed`
  flips the gate live in both directions.
- **Routing** — tiny hash router (`src/hooks/useHashRoute.js`) →
  `{ segments, query }`. Routes: `#/dashboard`, `#/projects[/:id]`,
  `#/suites[/:id]` (`?panel=recorder` scrolls to the recorder),
  `#/runs[/:id[/report]]`, `#/kanban[/:ticketId]`, `#/reports`,
  `#/credentials`, `#/settings`.
- **Screens** are lazy-loaded (`React.lazy` + Vite code-splitting) — the
  shell paints immediately and each screen's chunk loads on first visit,
  keeping startup fast and memory proportional to what's actually used.
- **Run lifecycle** — `useRunManager` in `App.jsx` owns starting runs, the
  global progress banner (fed by `run:progress`), and the completion modal
  that lands the verdict with View Details / Build Report actions.
- All data access goes through `window.qaflow`; media only through
  `app.mediaUrl()` (signed URL or `qaflow-media://`), never `file://`.

## CLI (`bin/qaflow.js`)

Zero-dependency `process.argv` parser over `fetch` against
`http://127.0.0.1:<port>`. Commands: `run` (exit 1 on failed suite),
`status`, `report`. It never touches the store or Playwright directly — the
API is the only door. The app must be running and signed in.

## Testing

`npm test` → `node --test test/**/*.test.js` (store, runner, recorder,
exporters, api, schedule, git, cloud-db, cloud-store, cloud-media, roles,
workspaces, security, format — 93 tests).
Local tests use temp dirs and a fixture web server; cloud integration tests
run live against the real `astreus` schema/bucket with `astreus-test-`
prefixed rows (cleaned in `finally`) and skip entirely when `DATABASE_URL`
is unset, so the suite stays green offline. `npm run smoke` (build +
`electron . --smoke`) is the boot-level check and must pass with no env.

## Deliberately out of scope

Postgres RLS (isolation is enforced in application code, at the cloud-store
scope function), offline mode (beyond the local-store fallback),
self-signup, magic links, storage pruning UI, v1 local-data migration, Jira
REST push, repo-connection mode, PIN lock. A vendor-facing web billing
portal for workspace plans is a separate future sub-project.

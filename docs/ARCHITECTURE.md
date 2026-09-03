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
exporters, api, schedule, git, cloud-db, cloud-store, cloud-media — 71
tests).
Local tests use temp dirs and a fixture web server; cloud integration tests
run live against the real `astreus` schema/bucket with `astreus-test-`
prefixed rows (cleaned in `finally`) and skip entirely when `DATABASE_URL`
is unset, so the suite stays green offline. `npm run smoke` (build +
`electron . --smoke`) is the boot-level check and must pass with no env.

## Deliberately out of scope

RLS/per-user permissions, offline mode (beyond the local-store fallback),
self-signup, magic links, storage pruning UI, v1 local-data migration, Jira
REST push, repo-connection mode, PIN lock, role enforcement.

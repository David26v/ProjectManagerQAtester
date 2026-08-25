# QA Flow — Architecture

Plain-JavaScript Electron app with a strict three-layer split. The rule that
holds everything together: **`src/engine/` never imports Electron** — it is
pure Node, receives paths/config as parameters, and is unit-tested with
`node --test` alone.

```
┌────────────────────────────────────────────────────────────┐
│ src/renderer/   React 19 + Tailwind v4 + shadcn/ui (Vite)  │
│                 talks ONLY to window.qaflow                │
├────────────────────────────────────────────────────────────┤
│ src/main/       Electron shell (CommonJS)                  │
│   main.js       window, qaflow-media:// protocol, API boot │
│   preload.js    contextBridge → window.qaflow              │
│   ipc.js        thin adapters: IPC channel ↔ engine call   │
├────────────────────────────────────────────────────────────┤
│ src/engine/     pure Node (CommonJS) — no Electron         │
│   store.js      JSON+file storage (createStore(baseDir))   │
│   runner.js     Playwright suite runner + evidence capture │
│   recorder.js   browser recorder → JSON steps              │
│   session.js    headed login capture → storageState        │
│   exporters/    excel.js · ticket.js · bundle.js           │
│   api.js        Express REST API (127.0.0.1 only)          │
└────────────────────────────────────────────────────────────┘
bin/qaflow.js    CLI — a pure HTTP client of the REST API
```

## Engine (`src/engine/`)

- **store.js** — `createStore(baseDir)`; everything is JSON files under one
  base dir (`userData/qaflow-data` in the app, a temp dir in tests):
  `projects.json`, `suites/<id>.json`, `runs/<runId>/report.json` + media,
  `credentials/index.json` + `credentials/<id>.bin`, `tickets.json`,
  `settings.json`. Credential metadata and encrypted blobs are stored
  separately; the store never returns blobs from listing calls.
- **runner.js** — drives the `playwright` library directly (not
  `@playwright/test`). Executes the fixed step vocabulary
  (`goto|click|fill|press|select|waitFor|assertVisible|assertText`), records
  video, screenshots the failing step, collects console errors and network
  failures, and persists the run report.
- **recorder.js** — opens a browser with an injected script
  (`recorder-inject.js`) that emits steps live as the user interacts.
- **session.js** — `start({loginUrl})` opens a headed browser and returns a
  controller; `finish()` captures Playwright `storageState`, `cancel()`
  aborts. Encryption happens in the main process, not here.
- **exporters/** — Excel (exceljs), Jira-style ticket text + kanban ticket
  builder (shared severity heuristic), zip bundle (archiver).
- **api.js** — `createApi({store, runSuiteFn})`, bound to `127.0.0.1`.
  Routes: `GET /projects`, `GET /projects/:id/suites`,
  `POST /projects/:id/suites/:suiteId/run` (awaits the run, returns 201 with
  the finished report), `GET /runs?projectId=&suiteId=`,
  `GET /runs/:runId/report`, `POST /webhooks/deploy-complete`,
  `GET /projects/:id/auth/status` (credential metadata only). Errors are
  always `{ error: "<message>" }` with a proper status code.

## Run report shape (fixed contract)

```js
{ runId, suiteId, projectId, suiteName, targetUrl, environment,
  startedAt, finishedAt, status: "passed"|"failed",
  triggeredBy: "manual"|"api"|"cli",
  steps: [{ name, status, error?, screenshot?, durationMs }],
  consoleErrors: [{ text }], networkFailures: [{ url, failure }],
  videoPath,
  capturedMedia: [{ id, type: "video"|"screenshot", path, stepIndex? }],
  reportSelection: { selectedMediaIds: [], notes: {} } | null }
```

The renderer, exporters, API, and CLI all consume exactly this shape.

## Electron main (`src/main/`)

- **main.js** — creates the 1500×980 window (`contextIsolation: true`,
  `nodeIntegration: false`), wires the engine with
  `baseDir = userData/qaflow-data`, boots the REST API on
  `settings.apiPort` (default 4317; bind failure warns, never crashes), and
  registers the **`qaflow-media://<runId>/<file>`** protocol so `<img>`/
  `<video>` can play run evidence. The protocol validates `runId` against
  `/^[A-Za-z0-9_-]+$/` and confines resolved paths to the run directory
  (path-traversal hardened). `--smoke` mode loads the window, prints
  `SMOKE OK`, and exits 0 — used as the build's verification floor.
- **preload.js** — exposes `window.qaflow` via contextBridge. Dot-path
  groups mirror IPC channel names (`projects:list` ⇔ `qaflow.projects.list`):
  `projects.* suites.* runs.* recorder.* session.* reports.* tickets.*
  settings.* app.*`, plus push events `qaflow.on('recorder:step'|'run:progress', cb)`
  (returns an unsubscribe function). Only an allowlisted event set can be
  subscribed.
- **ipc.js** — one thin `ipcMain.handle` per channel: parse args → call
  engine → return JSON. Credential flow: captured `storageState` is
  encrypted with `safeStorage` (plaintext fallback is flagged
  `encrypted:false`); when a run/recording uses a profile, the blob is
  decrypted to a temp file passed to Playwright and deleted in `finally`.
  Secrets never cross the bridge — the renderer only ever sees credential
  metadata.

## Renderer (`src/renderer/`)

Vite app (`vite.config.mjs`, output `src/renderer/dist/`, loaded from disk —
no dev server). React 19, Tailwind v4 (`@theme` tokens in `src/index.css`),
hand-vendored shadcn/ui primitives in `src/components/ui/` (new-york style,
JSX, `cn()` from `src/lib/utils.js`), lucide-react icons.

- **Routing** — tiny hash router (`src/hooks/useHashRoute.js`) →
  `{ segments, query }`. Routes: `#/dashboard`, `#/projects[/:id]`,
  `#/suites[/:id]` (`?panel=recorder` scrolls to the recorder), `#/runs[/:id[/report]]`,
  `#/kanban[/:ticketId]`, `#/credentials`, `#/settings`.
- **Screens** in `src/screens/`, one file each; shared pieces in
  `src/components/` (Sidebar, StatusPill, RunProgressBanner, modals) and
  `src/lib/` (format, steps, severity, media, stats, toast).
- **Run lifecycle** — `useRunManager` in `App.jsx` owns starting runs and the
  global progress banner (survives modal unmount), fed by `run:progress`.
- All data access goes through `window.qaflow`; media only through
  `app.mediaUrl()` (`qaflow-media://`), never `file://`.

## CLI (`bin/qaflow.js`)

Zero-dependency `process.argv` parser over `fetch` against
`http://127.0.0.1:<port>`. Commands: `run` (exit 1 on failed suite),
`status`, `report`. It never touches the store or Playwright directly — the
API is the only door, keeping the adapter boundary clean.

## Testing

`npm test` → `node --test test/*.test.js` (store, runner, recorder,
exporters, api — 40 tests). Tests create their own temp base dir and a local
fixture web server; they never touch real app data. The renderer has no unit
tests in v1; `npm run smoke` (build + `electron . --smoke`) is the boot-level
check.

## Deliberately out of scope in v1

Supabase/cloud sync, Jira REST push, repo-connection mode, schedule
*execution* (UI is display-only), PIN lock, role enforcement, installers
(electron-builder), and server-side persistence of report-builder field edits
(title/severity/repro steps — the UI discloses this).

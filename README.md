# QA Flow

QA Flow is a desktop app for recording, running, and reporting on browser QA
suites. It wraps Playwright to record UI flows as JSON steps, replay them on
demand, capture screenshots/video/console/network evidence, and turn failures
into kanban-tracked bug tickets — all backed by a simple local JSON + file
store (no external database).

Built with Electron, Playwright, and a plain JavaScript engine layer that is
independently unit-testable with Node's built-in test runner.

## Getting started

```bash
npm install
npx playwright install chromium
```

## Run the app

```bash
npm start
```

## Run the tests

```bash
npm test
```

Tests run against a temp directory via `node --test` and never touch the
app's real `qaflow-data/` storage.

## Documentation

- [User Guide](docs/USER_GUIDE.md) — the Connect → Record → Save → Run →
  Review → Report loop, screen by screen, plus CLI/API automation.
- [Architecture](docs/ARCHITECTURE.md) — engine / main / renderer layering,
  IPC surface, data layout, and the fixed run-report contract.

## Status

v1 feature-complete, plus a first round of v2 features. All ten v1 build
tasks landed, plus manual-entry credentials, an in-app scheduler, suite
import/export, and a dedicated Reports screen:

- **Storage & engine** — local JSON + file store (projects, suites, runs, credentials, tickets, settings, schedules), Playwright suite runner with screenshot/video/console/network capture and configurable retries, browser recorder, headed login-session capture with encrypted `storageState`.
- **Credentials** — capture a real login session (encrypted `storageState`) or **manually enter** username/password for a profile — the password is encrypted on-device only, never synced or shown again after saving.
- **Scheduler** — queue a suite to run once, daily, or weekly from the Run Suite dialog; fires while the app is open (no OS-level background task) and surfaces on the Dashboard's Scheduled Runs card with pause/delete and lapsed-schedule handling.
- **Suite import/export** — export a suite to JSON and import it back into a project without re-recording.
- **Exporters** — Excel report export, Jira-style ticket text generator, "Send to David" zip bundle.
- **Local REST API + CLI** — `express` server bound to `127.0.0.1`, `bin/qaflow.js` (`run` / `status` / `report` commands).
- **Electron shell** — contextBridge `window.qaflow` bridge, `qaflow-media://` protocol for evidence playback, `--smoke` boot check.
- **Renderer (React + Tailwind v4 + hand-vendored shadcn primitives)**:
  - Dashboard, Projects (+ environment connection), Project Detail, Test Suites & Recorder, Suite Detail, Credentials.
  - Runs, Run Details & Diagnostics, Media Selection & Report Builder (evidence preview, Generate Report).
  - **Reports** — every run with report work started on it, with stat chips (Total reports, This week) and row actions to reopen the builder or export Excel/JSON/zip bundle directly.
  - **Kanban Board** — filterable 5-column bug tracker (Backlog/Ready for QA/In Progress/Blocked/Done) with drag-and-drop status changes, per-column quick-add, Board Insights (aging + weekly throughput), Recent Updates.
  - **Ticket Detail** — description, repro steps, evidence thumbnails, console/network diagnostics pulled from the linked run, comment thread, persisted checklist, status workflow stepper, labels editor, linked run.
  - **Settings** — profile (name/role), local API port + CLI example, data folder info, About, and a Developer-only Diagnostics card.

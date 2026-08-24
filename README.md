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

## Status

Early scaffold — storage layer only. Recorder, runner, Electron shell, and
REST API land in subsequent tasks.

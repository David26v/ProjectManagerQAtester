# Auto-Update & Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package Astreus Tech Tester Tool as a Windows installer published to GitHub Releases, with electron-updater checking for new versions, downloading in the background, and applying on restart — so the client's install updates itself.

**Architecture:** electron-builder (NSIS target) builds and publishes to GitHub Releases on the existing public repo `David26v/ProjectManagerQAtester`; `electron-updater` runs in the main process (packaged builds only), pushes status to the renderer over a new `updates:*` IPC surface; a first-run bootstrap installs the Playwright Chromium browser on the client machine since installers can't assume a dev environment.

**Tech Stack:** existing stack + `electron-builder` (dev), `electron-updater` (runtime). Public repo → updater needs no token; publishing needs `GH_TOKEN` (taken from `gh auth token` at release time, never stored).

**Spec:** design approved in chat 2026-08-25 (GitHub Releases channel, restart-to-apply, unsigned build accepted with SmartScreen first-install caveat). This plan is the design of record.

## Global Constraints

- Branch `feature/auto-update` off `main`. Plain JS. Engine (`src/engine/**`) untouched except where the browser bootstrap needs a pure helper. No TypeScript.
- The updater must be inert in dev (`app.isPackaged === false` → all `updates:*` calls return `{ available: false, dev: true }`, no network checks) so `npm start`/`npm run smoke` behavior is unchanged.
- Never commit tokens; `GH_TOKEN` is read from the environment (or `gh auth token`) only at release time.
- User-visible name everywhere in the installer/updater: **Astreus Tech Tester Tool**. `appId: com.astreus.testertool`. Internal ids stay `qaflow`.
- Verification floor: `npm test` green, `npm run smoke` SMOKE OK, AND `npm run dist` produces an installer under `release/` (build verified locally; publishing is NOT part of task verification).
- Conventional commits, NO attribution trailers.

---

### Task 1: electron-builder packaging + Playwright browser bootstrap

**Files:**
- Modify: `package.json` (version `2.0.0`, `build` config, scripts `dist`/`release`), `.gitignore` (`release/`), `src/main/main.js` (browser bootstrap on boot)
- Create: `src/main/browser-bootstrap.js`, `build/icon.ico` (generate a simple 256px blue rounded-square "A" icon — a small Node script with no new deps writing a valid .ico, or embed a base64 asset; committed as a binary)
- Test: engine suite unchanged; `npm run dist` smoke of the packaged artifact

**Interfaces:**
- Produces: `package.json` `build` block:
  ```json
  {
    "appId": "com.astreus.testertool",
    "productName": "Astreus Tech Tester Tool",
    "directories": { "output": "release" },
    "files": ["src/main/**", "src/engine/**", "src/renderer/dist/**", "bin/**", "package.json", "node_modules/**"],
    "asar": true,
    "asarUnpack": ["node_modules/playwright/**", "node_modules/playwright-core/**"],
    "win": { "target": ["nsis"], "icon": "build/icon.ico" },
    "nsis": { "oneClick": true, "perMachine": false },
    "publish": [{ "provider": "github", "owner": "David26v", "repo": "ProjectManagerQAtester" }]
  }
  ```
  Scripts: `"dist": "npm run build:renderer && electron-builder --win --publish never"`, `"release": "npm run build:renderer && electron-builder --win --publish always"`.
- `createBrowserBootstrap({ onStatus })` in `src/main/browser-bootstrap.js`: `ensureChromium()` → resolves the Playwright chromium executable (`require('playwright').chromium.executablePath()`); if the file exists → `{ ok: true }`; if missing → spawn `process.execPath` with `ELECTRON_RUN_AS_NODE=1` running `node_modules/playwright/cli.js install chromium` (path resolved via `require.resolve('playwright/cli.js')`, works unpacked via asarUnpack), streaming status via `onStatus('installing')`/`onStatus('done')`; errors → `{ ok: false, error }`. main.js: run at boot after window creation (non-blocking), forward status to the renderer as a `browser:status` push event; when `ok: false`, the existing toast path shows "Browser install failed — recording/runs unavailable: <error>". Skip entirely in `--smoke`.

- [ ] Step 1: `npm i -D electron-builder` and `npm i -S electron-updater` (updater dep lands now, wired in Task 2).
- [ ] Step 2: package.json build block + scripts + version 2.0.0; `.gitignore` += `release/`; icon generated and committed.
- [ ] Step 3: implement `browser-bootstrap.js` + main.js wiring + preload allowlist for `browser:status`.
- [ ] Step 4: `npm test` green; `npm run smoke` SMOKE OK; `npm run dist` completes and `release/*.exe` exists (list the artifact name/size in the report — do NOT commit release/). If electron-builder hits a Windows symlink/codesign hiccup, document the exact error and the workaround used (e.g. `CSC_IDENTITY_AUTO_DISCOVERY=false`).
- [ ] Step 5: Commit `feat: electron-builder packaging with playwright browser bootstrap`.

### Task 2: electron-updater wiring + Settings UI + release script docs

**Files:**
- Create: `src/main/updates.js`
- Modify: `src/main/main.js`, `src/main/ipc.js`, `src/main/preload.js`, `src/renderer/src/screens/Settings.jsx`, `src/renderer/src/App.jsx` (update-ready toast), `README.md` + `docs/USER_GUIDE.md` (updates section), `docs/RELEASING.md` (new)
- Test: engine suite unchanged; dev-mode inertness verified via smoke

**Interfaces:**
- Consumes: Task 1's packaging config.
- Produces: `createUpdates({ getMainWindow })` in `src/main/updates.js` wrapping `electron-updater`'s `autoUpdater`: `status()` → `{ state: 'idle'|'checking'|'available'|'downloading'|'ready'|'error'|'dev', version?, error? }`; `check()` (manual trigger); `quitAndInstall()`. In dev (`!app.isPackaged`) every method returns `{ state: 'dev' }` and autoUpdater is never touched. In packaged builds: check on boot (after a 10s delay) and every 4 hours; `autoDownload: true`; on `update-downloaded` push `updates:status {state:'ready', version}` to the renderer. IPC channels `updates:status`, `updates:check`, `updates:install`; preload `qaflow.updates.{status,check,install}` + push event `updates:status`.
- Renderer: App.jsx listens for `updates:status` state `ready` → persistent toast/banner "Update v<version> ready — Restart to apply" with a Restart button (`updates.install()`). Settings → About card gains current version, "Check for updates" button (shows checking/downloading/latest states via `updates:status` responses; in dev shows "Updates run in the installed app only").
- `docs/RELEASING.md`: exact release steps — bump `version` in package.json, commit, `GH_TOKEN=$(gh auth token) npm run release` (bash) / `$env:GH_TOKEN = gh auth token; npm run release` (PowerShell), verify the GitHub Release assets (`.exe`, `latest.yml`), note the SmartScreen first-install caveat and that clients update automatically on next launch.
- Docs: USER_GUIDE + README get a short "Updates" section (installed app updates itself; dev checkout uses git).

- [ ] Step 1: implement updates.js + IPC/preload + renderer surfaces per Interfaces.
- [ ] Step 2: `npm test` green; `npm run smoke` SMOKE OK (proves dev inertness — no updater network calls in the log); `npm run dist` still builds.
- [ ] Step 3: write RELEASING.md + docs sections. Commit `feat: auto-updates via github releases with restart-to-apply and settings controls`.

### Task 3: GitHub Actions release pipeline (QA-friendly deploys)

**Files:**
- Create: `.github/workflows/release.yml`
- Modify: `docs/RELEASING.md` (QA deploy steps become the primary flow)

**Interfaces:**
- Consumes: Task 1's `dist`/`release` scripts and publish config; Task 2's RELEASING.md.
- Produces: workflow `Release` with two triggers: `workflow_dispatch` (input `version`, e.g. `2.1.0`) and `push` tags `v*`. Dispatch flow: checkout with `fetch-depth: 0`; setup-node 22 with npm cache; `npm ci`; `npx playwright install chromium`; `npm test` (gate — publish never runs on red); set the version (`npm version <input> --no-git-tag-version`), commit `chore: release v<version>` and tag `v<version>` as github-actions bot, push both; `npm run build:renderer`; `electron-builder --win --publish always` with `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`. Tag-push flow: same minus the version-bump/commit steps. `runs-on: windows-latest`; top-level `permissions: contents: write`; `CSC_IDENTITY_AUTO_DISCOVERY: "false"` in env so runners never attempt signing.
- RELEASING.md restructured: §1 "Deploy from GitHub (for QA)" — Actions tab → Release → Run workflow → type version → wait green → verify the Release assets (`.exe` + `latest.yml`); §2 "Deploy from a dev machine" keeps the existing `gh auth token` flow as fallback; keep the SmartScreen caveat.

- [ ] Step 1: write the workflow exactly as above.
- [ ] Step 2: validate the YAML (`node -e "require('js-yaml')"` is NOT available — use a careful read + `npx --yes yaml-lint` if quick, else state manual-review); `npm test` + `npm run smoke` still green (untouched app code).
- [ ] Step 3: restructure RELEASING.md. Commit `feat: github actions release pipeline for one-click qa deploys`.

### Task 4: UI + consistency polish sweep (deferred-minor cleanup)

**Files:**
- Create: `src/renderer/src/hooks/useDismissable.js` (outside-click + Escape close for menus)
- Modify: `src/renderer/src/components/Sidebar.jsx`, `src/renderer/src/screens/{Projects,Suites,Dashboard,Runs,RunDetail,Reports,ReportBuilder,Credentials}.jsx`, `src/renderer/src/App.jsx`, `src/renderer/src/lib/format.js`, `src/main/ipc.js`, `src/engine/runner.js`, `bin/qaflow.js`
- Test: `npm test` additions only where engine behavior changes (videoPath gating)

**The sweep — every item below is in scope, nothing else is:**
1. Sidebar footer says "Electron v0.1.0" (app version mislabeled): change label to `Astreus v<app.version>`.
2. `runner.js` sets `videoPath: 'video.webm'` even when no video captured → RunDetail renders a broken `<video>`: only set `videoPath` when the video file exists in capturedMedia (engine test: run with video disabled asserts `videoPath` null/absent) and keep RunDetail's empty-state guard working.
3. RunDetail's local `StepStatusPill` gives `skipped` gray while shared `StatusPill` uses amber: replace the local pill with the shared `StatusPill`.
4. Kebab/dropdown menus don't close on outside click or Escape (Projects cards, Suites cards, Dashboard schedule rows): implement `useDismissable(ref, onClose)` and apply to all three.
5. Credentials "Last used: never" forever: in `ipc.js`, after a successful run/recorder start that used a profile, `store.saveCredential({ ...meta, lastUsedAt: new Date().toISOString() })` (metadata-only update, no blob).
6. Export actions have no in-flight disable (Reports rows + ReportBuilder buttons + Generate modal): disable the clicked control while its promise is pending (per-row/per-button busy state).
7. Reports stat chips share one icon: give "This week" `CalendarClock`.
8. Runs screen offers a dead "Skipped" status filter: remove it.
9. Stale comments claiming the Runs screen is a placeholder (`App.jsx`, `RunProgressBanner.jsx`): delete/correct them.
10. CLI `--format` flag is inert: remove it from `bin/qaflow.js` usage text and arg parsing (JSON is the only output).
11. `timeUntil` month-boundary bug in `format.js` ("Tomorrow" check fails Aug 31→Sep 1): compute via date difference, add a small unit test if a format test file exists — else cover via a trivial new `test/format.test.js` with node:test (pure function, no DOM).
12. `schedules:fired` toast only fires on Dashboard: move the subscription to `App.jsx` so the toast + data refresh happen on any screen (remove the Dashboard-local duplicate).
13. Bundle export ignores the user's chosen filename (`ipc.js` bundle handler writes engine-derived name into the chosen directory): pass the user's chosen full path through to the bundler output.

- [ ] Step 1: engine change (item 2) via TDD; run engine tests.
- [ ] Step 2: main/ipc items (5, 13) + renderer items (1,3,4,6,7,8,9,12) + CLI (10) + format (11).
- [ ] Step 3: `npm test` green (incl. new tests) + `npm run smoke` SMOKE OK. Commit `fix: ui and consistency polish sweep across renderer, ipc, runner, cli`.

---

## Out of Scope

Code signing (documented caveat only), macOS/Linux targets, delta updates, publishing the first release (done by the controller/user with their token after merge), private-repo update feeds.

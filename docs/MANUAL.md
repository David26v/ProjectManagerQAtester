# KriJaxAutomation — Operator's Manual

The complete how-to, screen by screen. Companion to `QA_TRAINING.md`
(mental model / onboarding) and `USER_GUIDE.md` (feature reference).
A designed, shareable version of this manual is published as the
"KriJaxAutomation Operator's Manual" artifact.

## 1. Concepts: what's a test, and why "suites"?

A **test** is a **suite**: a browser flow recorded once — clicks, typing,
navigation — saved as editable steps, ending in an assertion. A **run** is
one execution of a suite in a real automated Chromium.

They're separate on purpose:

- **Suites are reusable** — record "Login" once, run it after every deploy
  forever. Without suites you'd re-record every time.
- **Runs carry evidence** — each run stores its own video, screenshots, and
  error logs, so Tuesday's failure survives Wednesday's pass.
- **Suites group steps into one flow** with one verdict.
- **Suites can be targeted** — tag `smoke` for deploy-gating, point at any
  environment.

Chain: Project → Suites → Runs → Reports → Tickets. All shared live with
the workspace.

## 2. Sign in

Invite-only email + password from the workspace owner. Session persists
between launches (encrypted on-device). Sign out: Settings → Account.

## 3. Set up a project

Projects → **+ New Project** (Name, Key, Base URL). Project Detail has six
tabs:

| Tab | What it does |
|---|---|
| Overview | Environments, 7-day metrics, recent runs, tags |
| Environments | Add/edit/delete environments, set the default |
| Test Suites | This project's tests + run them |
| Credentials | This project's saved logins, create new |
| Activity | Feed of runs / suites / tickets |
| Settings | Rename, base URL, description, default env, delete project |

## 4. Make your first test

1. Sidebar → **Recorder**.
2. Starting URL + project (+ credential profile if login needed).
3. **Start Recording** — a real Chrome opens; use the site like a user.
   Steps appear live; delete stray ones. Passwords are masked.
4. **Stop** → **Save Suite** (name, environment, tags — `smoke` gates
   deploys).
5. Open the suite and **make sure the last step asserts something**
   (`assertVisible` / `assertText`) — the assertion is the bug detector.

Rules of thumb: one flow per suite · start at the flow's real URL · end
with an assertion · tag deploy-gating suites `smoke`.

## 5. Running tests

Run button anywhere → Run Suite dialog: environment, headless/headed,
retries, credential profile → **Run Suite**. Live progress banner; a
completion dialog lands the verdict with View Details / Build Report.

Every run auto-captures: full video, failure screenshot, console errors,
uncaught page exceptions, failed requests, every HTTP 4xx/5xx — even on
passing runs.

## 6. How bugs actually get caught

The tool detects *deviations from what you recorded* plus *every error
signal the browser emits*, in four layers:

1. **Assertions fail** — your recorded expectations are the contract;
   login not reaching the dashboard turns the run red.
2. **Steps fail** — vanished buttons, dead pages, renamed fields break the
   replay itself.
3. **Errors are captured even on green runs** — console errors, uncaught
   exceptions, network failures, 4xx/5xx. This surfaces "silent" bugs
   (page looks fine, API 500s behind it). Check Console/Network tabs even
   on passes.
4. **Evidence for your eyes** — video + screenshots catch visual bugs
   automation can't judge; the verdict there is yours.

Because suites re-run on demand/schedules/deploys, the biggest catch is
**regressions** — things that quietly broke since last week.

## 7. Reading results (triage order)

Run Details → 1) failing step + error (selector timeout = UI changed;
assertion mismatch = app changed) → 2) failure screenshot → 3) video →
4) Console Logs tab (root causes) → 5) Network Failures tab.

Open Folder: local runs open on disk; cloud runs copy a 1-hour signed
video link to the clipboard.

## 8. Reports & bug handoff

Build Report → select evidence (Evidence Preview modal: zoom + notes) →
fill title/severity/repro steps → Generate: **Kanban Ticket** (bug card
linked to the run), **Excel** (screenshots embedded), **JSON**, **Zip
Bundle / Send to David**. The Reports screen reopens/exports any started
report. Fastest handoff: ticket + drag to *Ready for QA* — the developer
watches the video from the ticket. Tracking is the built-in board only (no
Jira).

## 9. Kanban

Backlog / Ready for QA / In Progress / Blocked / Done. Drag to change
status; filters; per-column quick-add; ticket detail has repro steps,
evidence, diagnostics, comments (attributed to your account), checklist.

## 10. Credentials (testing behind a login)

Never type real passwords while recording. **Session Capture**: New
Profile → Capture Session → log in yourself → capture; the session (not
the password) is stored, OS-keychain-encrypted. **Manual Entry** stores
username+password encrypted on-device. Secrets are per-device: re-capture
on other machines.

## 11. Scheduling

Run Suite dialog → Schedule tab → date/time + Once/Daily/Weekly. Manage on
the Dashboard card. **Fires only while the app is open.**

## 12. Repository (built-in git client)

Sidebar → Repository → paste HTTPS URL + GitHub token (encrypted
on-device) → Clone. Working Copy: stage/unstage/discard, line diffs,
commit as your account. History: branch-lane commit graph with branch
labels + uncommitted-changes row. Branch rail: switch/create/checkout
remote branches. Toolbar: Pull/Push/Fetch with ↑/↓ divergence counters.
Merge conflicts need an external git tool.

## 13. Step types

`goto` · `click` · `fill` · `press` · `select` · `waitFor` ·
`assertVisible` · `assertText` — each with a 10s default timeout. Editable
in Suite Detail; suites import/export as JSON.

## 14. CLI & automation

App open + signed in → REST API on `127.0.0.1:4317`.

```bash
qaflow run --project "Golden Paws" --suite "Login works" --env Production
qaflow status --project "Golden Paws"
qaflow report --run-id <id> --format json
```

`qaflow run` exits non-zero on failure (CI-friendly). Deploy webhook:
`POST /webhooks/deploy-complete {"projectId":"…","tag":"smoke"}`.

## 15. Troubleshooting

| Symptom | Fix |
|---|---|
| "Browser is still installing" | First-run download — wait a minute |
| "The app was updated behind this window" | Click Reload app |
| Selector timeout | UI changed — fix/re-record the step |
| Video link dead | Signed links last 1h — copy a fresh one |
| Credential won't run here | Secret is per-device — re-capture (§10) |
| "Not signed in" / API 503 | Session ended — sign in again |
| Scheduled run skipped | App wasn't open at fire time |
| Push/pull fails | Bad/missing GitHub token; conflicts → external git |

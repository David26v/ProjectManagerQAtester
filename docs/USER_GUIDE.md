# QA Flow — User Guide

QA Flow lets a QA tester record a browser flow once, replay it as an automated
test with full evidence capture, and turn failures into shareable bug reports —
without writing any code.

The core loop:

**Connect → Record → Save → Run → Review → Report**

---

## 1. Create a project (Connect)

A *project* is the app or site you test (e.g. "Web Dashboard",
`https://staging.example.com`).

1. Go to **Projects** in the sidebar and click **+ New Project**.
2. Fill in **Name**, **Key** (auto-uppercased short code), and **Base URL**.
3. Optionally add **Environments** (e.g. `Staging`, `Production`) — each with
   its own base URL — and pick a default. You can run any suite against any
   environment later.
4. The **Environment Connection** panel on the Projects screen lets you
   test-connect to an environment URL and save it to the selected project.

## 2. Record a flow (Record)

1. Go to **Test Suites** (or click **Recorder** in the sidebar — it jumps to
   the recorder panel).
2. Enter the **URL** to start at, pick the **project**, and optionally pick a
   **credential profile** (see §6) so the recording starts logged in.
3. Click **Start Recording**. A real Chromium window opens — just use the app
   like a user: click, type, navigate.
4. Every action appears live in the **Steps** list (goto, click, fill, press,
   select…). Delete any noise steps with the step's menu.
5. Click **Stop**, then **Save Suite**: give it a name, project, environment,
   optional tags (e.g. `smoke`) and a description.

Steps are stored as plain JSON — you can rename, reorder, or delete steps
later from the **Suite Detail** page (click a suite card).

## 3. Run a suite (Run)

- From a suite card (or the Run button anywhere), the **Run Suite** dialog
  lets you choose the **environment**, **headless or headed**, and an optional
  **credential profile**.
- Click **Run Suite** — you're taken to **Runs** and a live progress banner
  tracks each step. A toast announces Passed/Failed and opens the run detail.
- Every run captures automatically:
  - a **video** of the whole run,
  - a **screenshot at the failing step**,
  - all **console errors**,
  - all **network failures**.

Runs can also be triggered without the UI — see §7 (CLI & API).

## 4. Review a run (Review)

**Runs** lists every run. Click one to open **Run Details & Diagnostics**:

- **Summary** — step-by-step timeline with per-step status and timing, the
  error details for the failed step (selector/timeout when parseable),
  the failure screenshot, video playback, run metrics, and a suggested bug
  severity.
- **Console Logs** / **Network Failures** — the captured diagnostics.
- **Artifacts** — every captured file.
- **Open Folder** reveals the run's folder on disk; **Re-run** repeats it.

## 5. Build and send a report (Report)

From a run, click **Build Report**:

1. **Select evidence** — the media grid shows all screenshots/videos
   (filter by All / Failed Steps / Videos / Screenshots). Tick what to
   include; add a note per item. Click a thumbnail for a large
   **Evidence Preview** with zoom and notes. Selections save automatically.
2. **Fill the summary** — title, description, severity, environment, and
   editable reproduction steps. The **Live Preview** shows the JSON and the
   Jira-style ticket text as you go.
3. **Generate** — pick any combination of formats:
   - **JSON** — the raw run report.
   - **Excel** — a formatted spreadsheet.
   - **Jira Ticket** — creates a ticket on the Kanban board (copyable
     Jira-style text).
   - **Zip Bundle / "Send to David"** — one zip with the report + all
     selected evidence, ready to send to a developer.

> Note: in v1, title/severity/repro-step **edits** appear in the copied JSON
> preview; file exports and tickets use the run's recorded values. (Planned
> for v2.)

## 6. Credential profiles (logged-in testing)

For apps behind a login, capture a session once instead of recording the login
every time:

1. Go to **Credentials** → **New Profile**.
2. Fill in profile name, project, environment, login URL and username, then
   click **Capture Session** — a real browser opens.
3. Log in manually, then click **I've logged in — capture**. QA Flow stores
   the browser session **encrypted with your OS keychain** (never the
   password itself).
4. Pick that profile in the Run dialog or Recorder to start authenticated.

## 7. Kanban board (bug tracking)

**Kanban Board** tracks tickets created from failed runs (or added by hand):

- Five columns: **Backlog / Ready for QA / In Progress / Blocked / Done** —
  drag cards between columns to change status.
- Filter by project, severity, assignee, or search; summary strips show
  counts; the right rail shows ticket aging and weekly throughput.
- Click a ticket for the full **Ticket Detail**: description, repro steps,
  evidence from the linked run, console/network diagnostics, comments, and a
  QA checklist.

## 8. CLI & local API (automation)

While the app is open, a REST API listens on `127.0.0.1:4317` (port
configurable in **Settings**). The bundled CLI wraps it:

```bash
qaflow run --project "Web Dashboard" --suite "Login smoke" --env Staging
qaflow status --project "Web Dashboard"
qaflow report --run-id <id> --format json
```

`qaflow run` exits non-zero when the suite fails, so it slots into CI or a
post-deploy hook. There is also a deploy webhook:
`POST /webhooks/deploy-complete {"projectId": "...", "tag": "smoke"}` runs
every non-archived suite tagged `smoke` for that project.

## 9. Settings

- **Profile** — your name and role (Developer role reveals an extra
  Diagnostics card with raw report access).
- **API** — the local API port and a copy-ready CLI example.
- **Data** — where everything lives on disk (see below).
- **About** — app/Electron versions.

## Where your data lives

Everything is local files — no external database, nothing leaves your
machine. Under the app's user-data folder, `qaflow-data/` holds:

| Path | Contents |
|---|---|
| `projects.json` | projects + environments |
| `suites/<id>.json` | recorded suites (steps as JSON) |
| `runs/<id>/` | `report.json` + video + screenshots per run |
| `credentials/` | profile index + encrypted session blobs |
| `tickets.json` | kanban tickets |
| `settings.json` | app settings |

Backing up or moving that folder moves your whole workspace.

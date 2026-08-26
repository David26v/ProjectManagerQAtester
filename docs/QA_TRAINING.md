# QA Training — How the Whole System Works

A hands-on orientation for a QA tester joining the Astreus Tech Tester Tool
workspace. Read this top to bottom once, then keep it open as a reference —
it explains the *mental model* first, then walks the daily workflow.

## The mental model (5 things, in order)

Everything in the tool is one of five things, and they chain into each other:

```
PROJECT ──has──▶ SUITE ──produces──▶ RUN ──becomes──▶ REPORT ──becomes──▶ TICKET
(the app         (a recorded         (one replay      (evidence you       (a tracked
 you test)        click-path)         + evidence)      hand-picked)        bug)
```

1. **Project** — the website/app under test, with its environments
   (Staging, Production…). Created once, reused forever.
2. **Suite** — a browser flow you recorded once (login, checkout, search…)
   stored as editable steps. This is your "test case".
3. **Run** — one automated replay of a suite. The tool drives a real
   Chromium browser through your steps and records *everything*: full
   video, a screenshot at the failing step, console errors, uncaught page
   exceptions, failed network requests, and every HTTP 4xx/5xx response.
   Even errors that don't fail a step are kept as evidence.
4. **Report** — you pick which evidence matters, add notes, and export it
   as Excel / JSON / a zip bundle, or as ticket text.
5. **Ticket** — a bug card on the Kanban board, linked back to the run, so
   the developer can watch the video and read the diagnostics themselves.

Because storage is a **shared cloud workspace**, everything you create is
immediately visible to the whole team — and everything they create is
visible to you. You sign in once; the session persists on your machine.

## Your daily loop

1. **Sign in** (automatic after the first time).
2. **Dashboard** — check overnight/scheduled runs: anything red?
3. For a red run: open it → watch the failure video → check Console Logs
   and Network Failures tabs → decide: real bug or flaky selector?
   - **Real bug** → **Build Report** → select evidence → **Create Kanban
     Ticket** (lands on the built-in Kanban board) and/or export the zip
     bundle for the developer.
   - **Flaky/broken step** → open the suite → fix or re-record the step →
     re-run to confirm green.
4. **New feature to cover?** Record a new suite (Recorder), save it with a
   `smoke` tag if it should run after every deploy.
5. **Kanban** — drag your tickets as they progress; add comments (they're
   attributed to your signed-in account).

## Screen-by-screen map

| Screen | What it's for |
|---|---|
| **Dashboard** | Health at a glance: stat cards, recent runs, scheduled runs, activity feed |
| **Projects** | Create/edit projects and environments; test connections |
| **Test Suites** | All recorded suites; the **Recorder** panel lives here too |
| **Suite Detail** | Edit steps (rename/reorder/delete), run history, export suite JSON |
| **Runs** | Every run ever; open one for full diagnostics |
| **Run Details** | Step timeline, error details, failure screenshot, video playback, console/network tabs, artifacts |
| **Report Builder** | Pick evidence, write the summary, generate exports/tickets |
| **Reports** | Shortcut back to any report you started |
| **Kanban Board** | Bug tickets in 5 columns, drag to update status |
| **Credentials** | Saved logins (captured session or manual entry) for authenticated testing |
| **Settings** | Your profile/account, API port, updates |

## Recording good suites — rules of thumb

- **Start clean**: begin at the URL the flow really starts at; the first
  step is always the navigation there.
- **One flow per suite**: "Login", "Create order", "Search returns results"
  — not one giant suite for the whole app. Small suites fail precisely.
- **End with an assertion**: after recording, open Suite Detail and make
  sure the last step *asserts* something ("dashboard heading visible"), so
  a silent failure can't pass.
- **Delete noise steps**: stray clicks recorded by accident — remove them
  in the live step list before saving.
- **Tag `smoke`** on the suites that should gate every deploy — the deploy
  webhook runs everything with that tag automatically.
- **Passwords are never recorded** — use a Credential profile instead
  (capture your real login session once; it's stored encrypted on your
  device only).

## Reading a failed run like a pro

Check in this order:

1. **The failing step + its error** — a timeout on a selector usually means
   the UI changed (test problem); an assertion mismatch usually means the
   app changed (maybe a bug).
2. **The failure screenshot** — what did the page actually look like?
3. **The video** — scrub to just before the failure; watch what happened.
4. **Console Logs tab** — uncaught exceptions and `4xx/5xx` responses here
   often reveal the *root cause* behind a UI-level failure (e.g. the page
   looked empty because an API returned 500).
5. **Network Failures tab** — requests that never completed.

If steps 4–5 show errors even on a *passed* run, that's still worth a
ticket — the tool records them precisely so nothing slips through.

## Getting a bug to the developer

The fastest path: **Run → Build Report → select the failure screenshot +
video → Create Kanban Ticket → drag to "Ready for QA" on Kanban**. When the
developer wants files instead: use **Send to David** (zip bundle) — one zip
with the report and your selected evidence. For a quick share of just the
video, **Open Folder** on a cloud run copies a one-hour signed video link
to your clipboard.

## Things that live only on your machine

- Credential secrets (captured sessions / passwords) — encrypted with your
  OS keychain, never uploaded. A profile made on another machine appears in
  the list but can't run from yours until the session is captured again.
- Your sign-in session and app settings.

## Glossary

- **Environment** — a named base URL of a project (Staging, Production).
- **Headless** — the run's browser is invisible (default); *headed* shows it.
- **Credential profile** — a stored login (session capture or manual entry).
- **Signed link** — a temporary (1-hour) URL to a cloud-stored video/image.
- **Smoke tag** — the label that opts a suite into automated post-deploy runs.
- **storageState** — the browser session Playwright saves so runs start
  logged in.

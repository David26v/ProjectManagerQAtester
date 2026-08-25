# Astreus Tech Tester Tool v2 — Cloud-Primary Design (Supabase + Prisma)

Approved 2026-08-25. Turns QA Flow v1 (local-JSON Electron app) into **Astreus
Tech Tester Tool**: a cloud-primary, multi-user QA tool where the owner and
their client log into the same Supabase-backed workspace and see the same
projects, suites, runs (with media), and tickets.

## Decisions locked with the user

- **Cloud-primary** (option 1): Supabase Postgres via Prisma replaces the
  local JSON store as the source of truth; app requires login + internet.
  No local-first sync, no hybrid.
- **Auth: invite-only.** Whatever users exist in this Supabase project's
  Auth can log in (email + password). No self-signup screen, no magic links.
  Session persists on-device → **auto-login on next launch**.
- **Rename:** user-visible branding becomes "Astreus Tech Tester Tool".
  Internal identifiers stay (`window.qaflow`, `qaflow-media://`, `qaflow`
  CLI, `qaflow-data` dir) — zero-value churn otherwise.
- **Supabase project:** the user created a dedicated project; creds live in
  `qa-flow/.env` (gitignored; never commit): `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
  `DATABASE_URL`.

## Architecture

The v1 seam is the whole trick: every consumer (runner, recorder wiring,
exporters, REST API, IPC) talks to the store through `createStore()`'s
interface. v2 adds `src/engine/cloud-store.js` implementing the **same
interface** backed by Prisma + Supabase Storage; `src/main/` wires the cloud
store instead of the JSON store. The local JSON store stays in the codebase
for engine tests and as the media temp layer.

```
renderer (React) ── window.qaflow ── ipc.js ── cloud-store.js ── Prisma → Supabase Postgres
                                       │             └── @supabase/supabase-js → Storage (run-media)
                                       └── auth.js  ── Supabase Auth (email/password, persisted session)
```

### Database (Prisma, `public` schema, `prisma migrate`)

One model per entity, preserving v1 shapes (docs/ARCHITECTURE.md):

- `Project` — id, name, key, baseUrl, type, environments Json, defaultEnvironment, description, primary, createdAt, updatedAt.
- `Suite` — id, projectId (FK), name, description, tags String[], environment, steps Json, archived, createdAt, updatedAt.
- `Run` — runId (id), suiteId, projectId, suiteName, status, environment, triggeredBy, startedAt, finishedAt as columns; full fixed report as `report Json` (single source; columns are query/filter conveniences kept in sync on write).
- `Ticket` — id ("BUG-n"), title, description, severity, status, projectId, runId?, labels String[], assignee, reporter, reproductionSteps Json, attachments Json, comments Json, checklist Json, createdAt, updatedAt. Ticket id sequence lives in a `TicketCounter` row (atomic increment) — v1's max-scan doesn't survive concurrency.
- `CredentialProfile` — **metadata only**: id, name, projectId, environment, loginUrl, username, encrypted, deviceLabel, createdAt, lastUsedAt. **No storageState/blob column — secrets never leave the device.**

Migrations via `npx prisma migrate dev` against `DATABASE_URL` (direct
connection). Client handoff inherits the migration history.

### Media (Supabase Storage)

- Private bucket **`run-media`** (created idempotently at app boot with the
  service key).
- Runner still writes video/screenshots to the local run dir during the run
  (Playwright needs local paths). On run completion, cloud-store uploads
  each captured file to `run-media/<runId>/<filename>`, rewrites
  `capturedMedia[].path`/`videoPath`/`steps[].screenshot` to storage paths,
  persists the report row, then deletes the local temp dir.
- `app.mediaUrl(runId, relPath)` returns a **signed URL** (~60 min TTL)
  created in the main process. The `qaflow-media://` protocol stays only as
  a fallback for any legacy local files.
- `runs.openDir` is replaced in the UI by a "media is in the cloud" reveal
  of the signed link or removed where meaningless; exports (excel/zip)
  download media to a temp dir first, bundle, then clean up.

### Auth + auto-login

- `src/main/auth.js`: `@supabase/supabase-js` client in the main process
  with a custom storage adapter that persists the session JSON encrypted
  via `safeStorage` in `userData` (plaintext+flag fallback like v1
  credentials). On boot: restore session → if valid, renderer goes straight
  to the app; else a **Login screen** (email + password). IPC surface:
  `auth.{status,login(email,password),logout}` + push event `auth:changed`.
- All data IPC handlers reject when not logged in (single guard in ipc.js).
- Ticket `reporter` and comment `author` default to the logged-in user's
  email (or user_metadata name when present). Settings shows the logged-in
  identity + Sign out.
- Security model (documented honestly): the main process uses the service
  role / `DATABASE_URL`, which bypasses RLS. Login gates the app UI, not
  the database. Acceptable for a trusted two-party tool; anyone holding
  `.env` has full DB access, so `.env` ships out-of-band. `.env.example`
  (placeholders only) is committed.

### What stays local (deliberate)

- Captured login **storageState blobs** (safeStorage-encrypted, per device).
  Only metadata rows sync; a profile whose blob lives on another device
  shows as "captured on another device" and can't be used locally.
- Device `settings.json` (API port etc.).
- The loopback REST API + `qaflow` CLI (unchanged interface; now reading
  cloud data through the same store handle; requires the app to be running
  and logged in — API returns 503 with a clear message when logged out).
- Run media temp files during an active run.

### Rename scope

`package.json` name/productName + BrowserWindow title + sidebar wordmark +
login screen branding + README/docs headline. Everything else keeps its id.

## Error handling

- No network / DB unreachable: IPC rejections surface as toasts (existing
  convention); screens show their existing error/empty states. No offline
  queue in v2.
- Upload failure after a run: report row is still persisted with
  `mediaUploadError` noted per file; UI shows "media unavailable" for those
  entries. The run itself is never lost.
- Auth expiry mid-session: supabase-js auto-refreshes; a hard failure emits
  `auth:changed` → renderer returns to Login.

## Testing

- Existing 42 engine tests keep running against the local JSON store (the
  interface contract) — unchanged, no network in `npm test` by default.
- New `test/cloud-store.test.js` integration suite runs **only when
  `DATABASE_URL` is set** (skips otherwise): CRUD round-trips per model,
  run persistence with report Json, ticket counter atomicity, media path
  rewrite (storage upload mocked or against the real bucket with cleanup).
- Smoke floor unchanged (`npm run smoke` — reaches the Login screen).
- Manual E2E before handoff: log in → record → run → media visible via
  signed URL → ticket created with real reporter → second account sees it.

## Out of scope (v2 of the cloud work)

Row-level security / per-user permissions, offline mode & sync, self-signup,
magic links, storage lifecycle pruning UI, migrating existing v1 local data
(fresh start in the cloud; v1 data stays readable on disk).

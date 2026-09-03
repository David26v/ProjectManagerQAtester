# KriJaxAutomation — Releasing

KriJaxAutomation ships auto-updates through `electron-updater` reading GitHub Releases
on `David26v/ProjectManagerQAtester` (see the `publish` block in
`package.json`). Installed copies check for a new release on boot (after a
short delay) and every 4 hours, download automatically, and prompt the user
to restart once the download finishes.

There are two ways to cut a release:

- **§1 — from GitHub, for QA.** No dev machine, no terminal. This is the
  normal way to ship a release.
- **§2 — from a dev machine.** A local fallback for when Actions is down or
  you need to debug the build itself.

## 1. Deploy from GitHub (for QA)

You need a GitHub account with access to this repo. Nothing else.

1. Go to the repo on GitHub: `github.com/David26v/ProjectManagerQAtester`.
2. Click the **Actions** tab (top of the page, between "Pull requests" and
   "Projects").
3. In the left sidebar, click **Release**.
4. Click the **Run workflow** button (top-right of the list, it opens a small
   dropdown form).
5. In the **version** box, type the new version number — semver, with or
   without the leading `v` — both work. For example: `2.1.0` or `v2.1.0`.
   It must be higher than the version currently
   installed on people's machines (check `package.json`'s `"version"` on
   `main` if you're not sure what the last release was).
6. Click the green **Run workflow** button in that dropdown.
7. A new run appears at the top of the list within a few seconds (you may
   need to refresh). Click into it to watch progress.
8. Wait for it to go green. This takes several minutes — it runs the full
   test suite, bumps the version, builds the Windows installer, and uploads
   it. **If it goes red, the release did not go out** — the test run failed
   and nothing was published. Open the failed step's log to see why, and
   loop in a developer if it's not obvious.
9. Once green, go to the **Releases** page (right sidebar of the repo's main
   page, or `github.com/David26v/ProjectManagerQAtester/releases`) and
   confirm the newest release has:
   - `KriJaxAutomation Setup <version>.exe` — the installer.
   - `latest.yml` — the update manifest `electron-updater` polls for.
   - confirm the release is NOT marked Draft — `electron-updater` cannot see
     draft releases, so a draft release is invisible to installed clients
     even though it looks published to you.

   If either is missing, the release is incomplete — don't tell users to
   expect the update yet; re-run the workflow with the next version number
   once you've worked out what's wrong.
10. **Done.** You don't need to distribute the `.exe` yourself. Everyone with
    QA Flow already installed will pick up the update automatically on their
    next app launch (or within 4 hours if the app is left running) — just
    let them know a new version is out if there's something they should
    watch for.

Notes:

- The workflow refuses to run twice for the same version — if you type a
  version that's already been released, it fails fast with a clear error
  instead of publishing a duplicate. Just bump to the next version.
- The very first install of a new machine still hits the SmartScreen warning
  described below — that isn't something this pipeline can skip.

## 2. Deploy from a dev machine

Fallback path — use this if GitHub Actions is unavailable, or you need to
debug the build locally before trusting CI with it.

1. **Bump the version** in `package.json` (`"version"`), following semver.
   `electron-updater` compares this against the currently installed version,
   so it must increase.
2. **Commit** the version bump:
   ```bash
   git add package.json
   git commit -m "chore: bump version to X.Y.Z"
   ```
3. **Push** the commit:
   ```bash
   git push
   ```
   `npm run release` tags and publishes from your local `HEAD` — if the bump
   commit only exists locally, the remote's tagged commit won't match what's
   on the branch, so push it before publishing.
4. **Build and publish** — this builds the renderer, packages the Windows
   installer, and uploads it (plus the `latest.yml` update manifest) to a new
   GitHub Release tagged from `package.json`'s version. Requires a GitHub
   token with `repo` scope on `GH_TOKEN`; `gh auth token` reuses your local
   `gh` CLI login.

   **bash:**
   ```bash
   GH_TOKEN=$(gh auth token) npm run release
   ```

   **PowerShell:**
   ```powershell
   $env:GH_TOKEN = gh auth token
   npm run release
   ```
5. **Verify the release** on GitHub — the Release should contain:
   - `KriJaxAutomation Setup <version>.exe` — the NSIS installer.
   - `latest.yml` — the update manifest `electron-updater` polls for.
   - the matching `.exe.blockmap` (used for differential downloads).

   If either the `.exe` or `latest.yml` is missing, installed clients won't
   see the update — re-run `npm run release` rather than uploading assets by
   hand.

## Notes

- **SmartScreen on first install.** The installer isn't code-signed
  (`signExecutable: false` in `package.json`'s `build.win` config), so
  Windows SmartScreen shows an "unrecognized publisher" warning on first run
  of a fresh install. This is a one-time prompt per machine per binary — it
  does not appear again on auto-updates once the app is already trusted/run.
- **Clients update automatically.** Nobody needs to re-download or
  re-install by hand — every installed copy checks GitHub on its own boot
  and periodic timer, downloads in the background, and shows a "Restart to
  apply" banner once ready (or the user can trigger a check from Settings →
  About → Check for updates).
- **Dev checkouts never auto-update** — `npm start` / `npm run smoke` always
  report updater state `dev` and never touch the network. Get the latest
  code with `git pull` as usual.

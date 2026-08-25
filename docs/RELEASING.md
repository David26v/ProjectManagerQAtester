# QA Flow — Releasing

QA Flow ships auto-updates through `electron-updater` reading GitHub Releases
on `David26v/ProjectManagerQAtester` (see the `publish` block in
`package.json`). Installed copies check for a new release on boot (after a
short delay) and every 4 hours, download automatically, and prompt the user
to restart once the download finishes.

> **This is the local, by-hand release path.** A later task adds a GitHub
> Actions pipeline as the primary way to cut a QA release — when that lands,
> this doc gets restructured around CI and this section becomes the manual
> fallback.

## Cutting a release

1. **Bump the version** in `package.json` (`"version"`), following semver.
   `electron-updater` compares this against the currently installed version,
   so it must increase.
2. **Commit** the version bump:
   ```bash
   git add package.json
   git commit -m "chore: bump version to X.Y.Z"
   ```
3. **Build and publish** — this builds the renderer, packages the Windows
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
4. **Verify the release** on GitHub — the Release should contain:
   - `Astreus Tech Tester Tool Setup <version>.exe` — the NSIS installer.
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

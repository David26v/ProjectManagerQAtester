'use strict';

// Run media (screenshots + video) → Supabase Storage. The bucket is a single
// private bucket shared by every run; each run's files live under
// `<runId>/<filename>` object keys. Pure Node — no `electron` import, so
// this is testable/usable from both the main process and `node --test`.

const fs = require('node:fs');
const path = require('node:path');

const BUCKET = 'astreus-run-media';

// Idempotent bucket creation — safe to call on every app boot. Swallows the
// "already exists" error from a concurrent/previous creation; any other
// failure is rethrown so the caller (main.js) can log/warn on it.
async function ensureBucket(supabase) {
  const { error } = await supabase.storage.createBucket(BUCKET, { public: false });
  if (error && !/already exists/i.test(error.message)) {
    throw error;
  }
}

async function signedMediaUrl(supabase, storagePath, ttlSeconds = 3600) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, ttlSeconds);
  if (error) throw error;
  return data.signedUrl;
}

// Uploads every local media file referenced by `report` (capturedMedia
// entries, whose `path` is a bare filename inside `runDirPath`) to
// `<runId>/<filename>` in the bucket, then mutates `report` in place so
// `capturedMedia[].path`, `videoPath`, and `steps[].screenshot` become
// `storage:<runId>/<filename>` — the same sentinel prefix the IPC/renderer
// layer checks to decide between a signed URL and the legacy
// `qaflow-media://` local-file fallback.
//
// A single file's upload failure does not abort the run's other files or
// throw: it's recorded as `mediaUploadError` on the matching
// `capturedMedia` entry (and left as a local filename, so it can still be
// resolved via the legacy fallback if the local run dir hasn't been removed
// yet) and the function moves on.
async function uploadRunMedia(supabase, runId, runDirPath, report) {
  const capturedMedia = report.capturedMedia || [];
  const uploadedFilenames = new Set();

  for (const media of capturedMedia) {
    if (typeof media.path !== 'string' || media.path.startsWith('storage:')) continue;

    const filename = media.path;
    const localPath = path.join(runDirPath, filename);
    const storageKey = `${runId}/${filename}`;

    try {
      const bytes = fs.readFileSync(localPath);
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(storageKey, bytes, { contentType: guessContentType(filename), upsert: true });
      if (error) throw error;

      media.path = `storage:${storageKey}`;
      uploadedFilenames.add(filename);
    } catch (e) {
      media.mediaUploadError = e.message;
    }
  }

  if (typeof report.videoPath === 'string' && !report.videoPath.startsWith('storage:') && uploadedFilenames.has(report.videoPath)) {
    report.videoPath = `storage:${runId}/${report.videoPath}`;
  }

  if (Array.isArray(report.steps)) {
    for (const step of report.steps) {
      if (typeof step.screenshot === 'string' && !step.screenshot.startsWith('storage:') && uploadedFilenames.has(step.screenshot)) {
        step.screenshot = `storage:${runId}/${step.screenshot}`;
      }
    }
  }

  return report;
}

function guessContentType(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webm') return 'video/webm';
  return 'application/octet-stream';
}

module.exports = { BUCKET, ensureBucket, signedMediaUrl, uploadRunMedia };

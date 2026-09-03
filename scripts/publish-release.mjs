// Publishes the built installer + update manifest to Supabase Storage so
// electron-updater's `generic` provider can serve auto-updates from there.
// Idempotent: re-running overwrites the same object keys (upsert).
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const BUCKET = 'krijax-releases';
const RELEASE_DIR = 'release';

class NoopRealtimeTransport {}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('[publish] Supabase URL or service role key missing');
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false },
  realtime: { transport: NoopRealtimeTransport },
});

const contentTypeFor = (name) => {
  if (name.endsWith('.exe')) return 'application/vnd.microsoft.portable-executable';
  if (name.endsWith('.yml')) return 'text/yaml';
  if (name.endsWith('.blockmap')) return 'application/octet-stream';
  return 'application/octet-stream';
};

const main = async () => {
  // 1. Ensure the public bucket exists. Public is required: electron-updater
  //    fetches latest.yml and the installer with no auth headers.
  // No per-bucket fileSizeLimit: `null` inherits the project's global limit,
  // and requesting one above that limit makes createBucket fail outright.
  const { error: bucketError } = await supabase.storage.createBucket(BUCKET, {
    public: true,
  });
  if (bucketError && !/already exists/i.test(bucketError.message)) {
    console.error(`[publish] createBucket failed: ${bucketError.message}`);
    process.exit(1);
  }
  console.log(bucketError ? `[publish] bucket ${BUCKET} already exists` : `[publish] bucket ${BUCKET} created (public)`);

  // Make sure an existing bucket is actually public, otherwise updates 404.
  const { error: updateError } = await supabase.storage.updateBucket(BUCKET, {
    public: true,
  });
  if (updateError) console.warn(`[publish] updateBucket warning: ${updateError.message}`);

  // 2. Upload the three artifacts electron-updater needs.
  const files = fs
    .readdirSync(RELEASE_DIR)
    .filter((f) => f === 'latest.yml' || /^KriJaxAutomation Setup .*\.exe(\.blockmap)?$/.test(f));

  if (!files.some((f) => f === 'latest.yml')) {
    console.error('[publish] latest.yml not found in release/ — run `npm run dist` first');
    process.exit(1);
  }

  for (const name of files) {
    const full = path.join(RELEASE_DIR, name);
    const bytes = fs.readFileSync(full);
    const mb = (bytes.length / 1024 / 1024).toFixed(1);
    process.stdout.write(`[publish] uploading ${name} (${mb} MB)… `);
    const { error } = await supabase.storage.from(BUCKET).upload(name, bytes, {
      contentType: contentTypeFor(name),
      upsert: true,
      cacheControl: name === 'latest.yml' ? '60' : '3600',
    });
    if (error) {
      console.log('FAILED');
      console.error(`[publish] ${name}: ${error.message}`);
      process.exit(1);
    }
    console.log('ok');
  }

  const base = `${url}/storage/v1/object/public/${BUCKET}`;
  console.log(`[publish] done. Update feed: ${base}/latest.yml`);
};

main().catch((e) => {
  console.error(`[publish] ${e.message}`);
  process.exit(1);
});

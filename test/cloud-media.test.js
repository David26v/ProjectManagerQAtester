'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
require('dotenv').config();

const PREFIX = 'astreus-test-';

test('run media: ensureBucket is idempotent, upload/sign/fetch/remove round-trips bytes', async (t) => {
  if (!process.env.DATABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return t.skip('Supabase env vars not set');
  }

  const { createSupabaseAdmin } = require('../src/engine/cloud/supabase.js');
  const { ensureBucket, signedMediaUrl } = require('../src/engine/cloud/media.js');

  const supabase = createSupabaseAdmin();
  const bucket = 'astreus-run-media';
  const objectKey = `${PREFIX}run/hello.txt`;
  const contents = `hello astreus ${Date.now()}`;

  try {
    // Idempotent: calling twice must not throw (second call hits the
    // "already exists" branch and swallows it).
    await ensureBucket(supabase);
    await ensureBucket(supabase);

    const tmpFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qaflow-media-test-')), 'hello.txt');
    fs.writeFileSync(tmpFile, contents);

    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(objectKey, fs.readFileSync(tmpFile), { contentType: 'text/plain', upsert: true });
    assert.equal(uploadError, null);

    const url = await signedMediaUrl(supabase, objectKey, 60);
    assert.match(url, /^https:\/\//);

    const res = await fetch(url);
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.equal(body, contents);
  } finally {
    await supabase.storage.from(bucket).remove([objectKey]);
  }
});

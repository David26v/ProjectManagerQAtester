// Wrapper for `npm run db:push`.
//
// Runtime DATABASE_URL points at the Supabase pooler (port 6543,
// pgbouncer=true) so the app's own Prisma queries avoid prepared-statement
// collisions. But `prisma db push` needs a real DDL session — it hangs
// indefinitely against the transaction-mode pooler. This wrapper derives a
// direct (non-pooler, port 5432, no pgbouncer param) URL for the push
// command ONLY, keeping `schema=astreus` so isolation still holds, and never
// touches `.env` or prints the URL.
import { spawnSync } from 'node:child_process';
import 'dotenv/config';

function toDirectUrl(rawUrl) {
  const url = new URL(rawUrl);
  url.port = '5432';
  url.searchParams.delete('pgbouncer');
  return url.toString();
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('[db-push] DATABASE_URL is not set.');
  process.exit(1);
}
if (!/[?&]schema=astreus(&|$)/.test(databaseUrl)) {
  console.error('[db-push] DATABASE_URL must include schema=astreus (shared-project isolation).');
  process.exit(1);
}

console.warn(
  '[db-push] Runtime DATABASE_URL uses the pooled 6543 connection (pgbouncer=true), which does not ' +
    'support the DDL session `prisma db push` needs. Using the direct port-5432 URL for this push only ' +
    '(schema=astreus preserved, pgbouncer param dropped). No connection string is printed.'
);

const env = { ...process.env, DATABASE_URL: toDirectUrl(databaseUrl) };
const result = spawnSync('npx', ['prisma', 'db', 'push', '--skip-generate'], {
  env,
  stdio: 'inherit',
  shell: true,
});

process.exit(result.status ?? 1);

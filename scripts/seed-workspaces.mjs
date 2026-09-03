// Idempotent: creates the KriJax house workspace and an owner membership
// for every platform admin. Safe to re-run; never touches tenant rows.
//
// The vendor-workspace upsert lives once in `src/engine/workspaces.js`
// (`VENDOR_WORKSPACE` / `ensureVendorWorkspace`) — this script is ESM but
// that module is CommonJS, so it's pulled in via `createRequire` rather than
// re-declaring the same workspace shape here, which would only drift.
import 'dotenv/config';
import { createRequire } from 'node:module';
import { PrismaClient } from '@prisma/client';

const require = createRequire(import.meta.url);
const { createWorkspaceService, VENDOR_WORKSPACE } = require('../src/engine/workspaces.js');

const admins = (process.env.ASTREUS_PLATFORM_ADMINS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

const prisma = new PrismaClient();
try {
  const workspaces = createWorkspaceService({ prisma, supabase: null, platformAdminEmails: admins });

  // `ensureVendorWorkspace(email)` upserts the house workspace AND grants
  // `email` an owner membership in it, so it's called once per admin rather
  // than once overall — but with zero admins configured the house workspace
  // must still exist (matching the old script's unconditional upsert), so
  // fall back to a plain upsert with no membership in that case.
  if (admins.length) {
    for (const email of admins) await workspaces.ensureVendorWorkspace(email);
  } else {
    const now = new Date();
    await prisma.workspace.upsert({
      where: { id: VENDOR_WORKSPACE.id },
      create: { ...VENDOR_WORKSPACE, maxMembers: null, maxProjects: null, status: 'active', createdAt: now, updatedAt: now },
      update: {},
    });
  }
  console.log(`[seed-workspaces] ${VENDOR_WORKSPACE.id} ready; ${admins.length} owner(s) ensured.`);

  // `TicketCounter.id` is an autoincrement PK, but its rows are written via
  // `upsert({ where: { workspaceId } })`, never by letting Postgres assign
  // the id — so the sequence can drift behind existing rows (e.g. a row
  // hand-inserted with an explicit id). Resyncing it here on every seed run
  // keeps every environment self-healing instead of relying on a one-off
  // manual fix. Schema-qualified (`astreus."TicketCounter"`) rather than
  // relying on the ambient `search_path`, since this runs against a shared
  // project.
  await prisma.$executeRawUnsafe(
    'SELECT setval(pg_get_serial_sequence(\'astreus."TicketCounter"\', \'id\'), GREATEST(COALESCE((SELECT MAX(id) FROM astreus."TicketCounter"), 0), 1))'
  );
  console.log('[seed-workspaces] TicketCounter sequence synced.');
} finally {
  await prisma.$disconnect();
}

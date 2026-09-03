// Idempotent: creates the KriJax house workspace and an owner membership
// for every platform admin. Safe to re-run; never touches tenant rows.
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const VENDOR = { id: 'ws-krijax', name: 'KriJax', slug: 'krijax', plan: 'vendor' };

const admins = (process.env.ASTREUS_PLATFORM_ADMINS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

const prisma = new PrismaClient();
try {
  const now = new Date();
  await prisma.workspace.upsert({
    where: { id: VENDOR.id },
    create: { ...VENDOR, maxMembers: null, maxProjects: null, status: 'active', createdAt: now, updatedAt: now },
    update: { name: VENDOR.name, plan: VENDOR.plan },
  });
  for (const email of admins) {
    await prisma.workspaceMember.upsert({
      where: { workspaceId_email: { workspaceId: VENDOR.id, email } },
      create: { id: randomUUID(), workspaceId: VENDOR.id, email, role: 'owner', createdAt: now },
      update: { role: 'owner' },
    });
  }
  console.log(`[seed-workspaces] ${VENDOR.id} ready; ${admins.length} owner(s) ensured.`);

  // `TicketCounter.id` is an autoincrement PK, but its rows are written via
  // `upsert({ where: { workspaceId } })`, never by letting Postgres assign
  // the id — so the sequence can drift behind existing rows (e.g. a row
  // hand-inserted with an explicit id). Resyncing it here on every seed run
  // keeps every environment self-healing instead of relying on a one-off
  // manual fix.
  await prisma.$executeRawUnsafe(
    'SELECT setval(pg_get_serial_sequence(\'"TicketCounter"\', \'id\'), GREATEST(COALESCE((SELECT MAX(id) FROM "TicketCounter"), 0), 1))'
  );
  console.log('[seed-workspaces] TicketCounter sequence synced.');
} finally {
  await prisma.$disconnect();
}

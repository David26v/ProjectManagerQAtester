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
} finally {
  await prisma.$disconnect();
}

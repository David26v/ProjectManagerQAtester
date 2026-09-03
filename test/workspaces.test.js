'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('dotenv').config();

const PREFIX = 'astreus-test-';

test('workspaces: provisioning, membership claim, invites, limits, role guards', async (t) => {
  if (!process.env.DATABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return t.skip('cloud env not set');

  const { createPrisma } = require('../src/engine/cloud/db.js');
  const { createSupabaseAdmin } = require('../src/engine/cloud/supabase.js');
  const { createWorkspaceService } = require('../src/engine/workspaces.js');

  const prisma = createPrisma();
  const supabase = createSupabaseAdmin();
  const rand = Math.random().toString(36).slice(2, 8);
  const ownerEmail = `${PREFIX}${rand}-owner@example.invalid`;
  const memberEmail = `${PREFIX}${rand}-member@example.invalid`;
  const slug = `${PREFIX}${rand}`;
  const createdUserIds = [];
  const svc = createWorkspaceService({ prisma, supabase, platformAdminEmails: ['Admin@KriJax.com'] });

  try {
    assert.equal(svc.isPlatformAdmin('admin@krijax.com'), true);
    assert.equal(svc.isPlatformAdmin('nobody@x.com'), false);

    // provision a company with a brand-new owner login
    const created = await svc.createWorkspace({ name: 'Acme QA', slug, plan: 'team', maxMembers: 2, maxProjects: 3, ownerEmail: ownerEmail.toUpperCase() });
    assert.equal(created.workspace.id, `ws-${slug}`);
    assert.equal(created.owner.role, 'owner');
    assert.equal(created.owner.email, ownerEmail);
    assert.match(created.tempPassword, /^[A-Za-z0-9_-]{16}$/);
    createdUserIds.push(created.owner.userId);
    assert.ok(created.owner.userId, 'owner login created up front');

    // stranger resolves to nothing; owner resolves by userId
    assert.equal(await svc.resolveMembership({ userId: 'nope', email: 'nobody@x.com' }), null);
    const resolved = await svc.resolveMembership({ userId: created.owner.userId, email: ownerEmail });
    assert.equal(resolved.workspace.id, created.workspace.id);
    assert.equal(resolved.member.role, 'owner');

    // invite: creates login, returns temp password; admin cannot grant owner
    const invited = await svc.inviteMember(created.workspace.id, { email: memberEmail, role: 'member' }, 'owner');
    assert.equal(invited.member.role, 'member');
    assert.match(invited.tempPassword, /^[A-Za-z0-9_-]{16}$/);
    createdUserIds.push(invited.member.userId);
    await assert.rejects(() => svc.inviteMember(created.workspace.id, { email: `${PREFIX}x@example.invalid`, role: 'owner' }, 'admin'), /owner/i);
    // member role may not invite at all
    await assert.rejects(() => svc.inviteMember(created.workspace.id, { email: `${PREFIX}y@example.invalid`, role: 'member' }, 'member'), /permission/i);
    // seat limit (maxMembers = 2, already 2)
    await assert.rejects(() => svc.inviteMember(created.workspace.id, { email: `${PREFIX}z@example.invalid`, role: 'member' }, 'owner'), /Member limit reached/);

    // claim by email: a membership created without userId is claimed at first login
    await prisma.workspaceMember.update({ where: { id: invited.member.id }, data: { userId: null, joinedAt: null } });
    const claimed = await svc.resolveMembership({ userId: invited.member.userId, email: memberEmail });
    assert.equal(claimed.member.userId, invited.member.userId);
    assert.ok(claimed.member.joinedAt);

    // usage
    const usage = await svc.usage(created.workspace.id);
    assert.deepEqual(usage, { members: 2, maxMembers: 2, projects: 0, maxProjects: 3 });

    // role changes + last-owner protection
    const promoted = await svc.changeRole(created.workspace.id, invited.member.id, 'admin', 'owner');
    assert.equal(promoted.role, 'admin');
    await assert.rejects(() => svc.changeRole(created.workspace.id, created.owner.id, 'member', 'owner'), /at least one owner/);
    await assert.rejects(() => svc.removeMember(created.workspace.id, created.owner.id, 'owner'), /at least one owner/);
    await svc.removeMember(created.workspace.id, invited.member.id, 'owner');
    assert.equal((await svc.listMembers(created.workspace.id)).length, 1);

    // vendor safety net
    const vendor = await svc.ensureVendorWorkspace(`${PREFIX}${rand}-vendor@example.invalid`);
    assert.equal(vendor.workspace.id, 'ws-krijax');
    assert.equal(vendor.member.role, 'owner');

    // one-workspace-per-user: inviting an email already tied to another workspace is refused
    const otherOwnerEmail = `${PREFIX}${rand}-other-owner@example.invalid`;
    const otherSlug = `${PREFIX}${rand}-other`;
    const other = await svc.createWorkspace({ name: 'Other Co', slug: otherSlug, plan: 'free', ownerEmail: otherOwnerEmail });
    createdUserIds.push(other.owner.userId);
    await assert.rejects(
      () => svc.inviteMember(created.workspace.id, { email: otherOwnerEmail, role: 'member' }, 'owner'),
      /already belongs to another workspace/
    );

    // invite into a non-existent workspace: rejects and provisions no login
    const orphanEmail = `${PREFIX}${rand}-orphan@example.invalid`;
    await assert.rejects(() => svc.inviteMember('ws-does-not-exist', { email: orphanEmail, role: 'member' }, 'owner'), /Workspace not found/);
    const laterInvite = await svc.inviteMember(other.workspace.id, { email: orphanEmail, role: 'member' }, 'owner');
    assert.ok(laterInvite.tempPassword, 'no account was provisioned by the failed invite into the bad workspace id');
    createdUserIds.push(laterInvite.member.userId);

    // unknown role rejects
    await assert.rejects(
      () => svc.inviteMember(other.workspace.id, { email: `${PREFIX}${rand}-badrole@example.invalid`, role: 'superadmin' }, 'owner'),
      /Unknown role/
    );
    await assert.rejects(() => svc.changeRole(other.workspace.id, other.owner.id, 'superadmin', 'owner'), /Unknown role/);

    await svc.deleteWorkspace(other.workspace.id, 'owner');

    // rename + delete guards
    assert.equal((await svc.renameWorkspace(created.workspace.id, 'Acme Renamed', 'owner')).name, 'Acme Renamed');
    await assert.rejects(() => svc.deleteWorkspace(created.workspace.id, 'admin'), /permission/i);
    await svc.deleteWorkspace(created.workspace.id, 'owner');
    assert.equal(await svc.getWorkspace(created.workspace.id), null);
  } finally {
    await prisma.workspaceMember.deleteMany({ where: { email: { startsWith: PREFIX } } });
    await prisma.workspace.deleteMany({ where: { id: { startsWith: 'ws-' + PREFIX } } });
    for (const id of createdUserIds) if (id) await supabase.auth.admin.deleteUser(id);
    await prisma.$disconnect();
  }
});

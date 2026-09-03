'use strict';

// Workspace (tenant) service — membership resolution, invites/provisioning
// with Supabase Auth logins, roles and plan limits. Pure Node: Prisma and
// the service-role supabase-js client are injected. Nothing here reads
// tenant data; that is the cloud store's job.

const crypto = require('node:crypto');
const { can } = require('./roles.js');

const VENDOR_WORKSPACE = { id: 'ws-krijax', name: 'KriJax', slug: 'krijax', plan: 'vendor' };

const toIso = (d) => (d instanceof Date ? d.toISOString() : d);
const normalizeEmail = (e) => String(e || '').trim().toLowerCase();
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '');

const serializeWorkspace = (row) =>
  row && {
    id: row.id,
    name: row.name,
    slug: row.slug,
    plan: row.plan,
    maxMembers: row.maxMembers,
    maxProjects: row.maxProjects,
    status: row.status,
    pricePerMonth: row.pricePerMonth == null ? null : Number(row.pricePerMonth),
    currency: row.currency,
    billingEmail: row.billingEmail,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };

const serializeMember = (row) =>
  row && {
    id: row.id,
    workspaceId: row.workspaceId,
    email: row.email,
    userId: row.userId,
    role: row.role,
    createdAt: toIso(row.createdAt),
    joinedAt: toIso(row.joinedAt),
  };

const createWorkspaceService = ({ prisma, supabase, platformAdminEmails = [] }) => {
  const admins = new Set(platformAdminEmails.map(normalizeEmail).filter(Boolean));

  const isPlatformAdmin = (email) => admins.has(normalizeEmail(email));

  const requireCan = (role, action) => {
    if (!can(role, action)) throw new Error(`Your role (${role || 'none'}) does not have permission to ${action.replace('_', ' ')}.`);
  };

  // Creates a Supabase Auth login for an invited email. Returns the one-time
  // temp password (never stored). An already-registered email gets no
  // password — the existing account claims the membership at first login.
  const ensureLogin = async (email) => {
    const password = crypto.randomBytes(12).toString('base64url').slice(0, 16);
    const { data, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) {
      if (/already|exists|registered/i.test(error.message)) return { userId: null, tempPassword: null };
      throw new Error(`Could not create login for ${email}: ${error.message}`);
    }
    return { userId: data.user.id, tempPassword: password };
  };

  const getWorkspace = async (id) => serializeWorkspace(await prisma.workspace.findUnique({ where: { id } }));

  const listWorkspaces = async () => {
    const rows = await prisma.workspace.findMany({ orderBy: { createdAt: 'asc' } });
    return rows.map(serializeWorkspace);
  };

  const usage = async (workspaceId) => {
    const [workspace, members, projects] = await Promise.all([
      prisma.workspace.findUnique({ where: { id: workspaceId } }),
      prisma.workspaceMember.count({ where: { workspaceId } }),
      prisma.project.count({ where: { workspaceId } }),
    ]);
    return { members, maxMembers: workspace ? workspace.maxMembers : null, projects, maxProjects: workspace ? workspace.maxProjects : null };
  };

  const listMembers = async (workspaceId) => {
    const rows = await prisma.workspaceMember.findMany({ where: { workspaceId }, orderBy: { createdAt: 'asc' } });
    return rows.map(serializeMember);
  };

  const addMembership = async (workspaceId, email, role, userId) => {
    const now = new Date();
    const row = await prisma.workspaceMember.upsert({
      where: { workspaceId_email: { workspaceId, email } },
      create: { id: crypto.randomUUID(), workspaceId, email, role, userId, createdAt: now, joinedAt: userId ? now : null },
      update: { role, userId: userId ?? undefined },
    });
    return serializeMember(row);
  };

  const resolveMembership = async ({ userId, email }) => {
    const normalized = normalizeEmail(email);
    let member = userId ? await prisma.workspaceMember.findFirst({ where: { userId } }) : null;
    if (!member && normalized) {
      const pending = await prisma.workspaceMember.findFirst({ where: { email: normalized } });
      if (pending) {
        member = await prisma.workspaceMember.update({
          where: { id: pending.id },
          data: { userId: userId || pending.userId, joinedAt: pending.joinedAt || new Date() },
        });
      }
    }
    if (!member) return null;
    const workspace = await prisma.workspace.findUnique({ where: { id: member.workspaceId } });
    if (!workspace) return null;
    return { workspace: serializeWorkspace(workspace), member: serializeMember(member) };
  };

  const ensureVendorWorkspace = async (email) => {
    const now = new Date();
    const workspace = await prisma.workspace.upsert({
      where: { id: VENDOR_WORKSPACE.id },
      create: { ...VENDOR_WORKSPACE, maxMembers: null, maxProjects: null, status: 'active', createdAt: now, updatedAt: now },
      update: {},
    });
    const member = await addMembership(VENDOR_WORKSPACE.id, normalizeEmail(email), 'owner', null);
    return { workspace: serializeWorkspace(workspace), member };
  };

  const createWorkspace = async ({ name, slug, plan = 'free', maxMembers = null, maxProjects = null, ownerEmail }) => {
    const email = normalizeEmail(ownerEmail);
    if (!name || !email) throw new Error('Workspace name and owner email are required');
    const cleanSlug = slugify(slug || name);
    const id = `ws-${cleanSlug}`;
    if (await prisma.workspace.findUnique({ where: { id } })) throw new Error(`A workspace with slug "${cleanSlug}" already exists`);
    const login = await ensureLogin(email);
    const now = new Date();
    const workspace = await prisma.workspace.create({
      data: { id, name, slug: cleanSlug, plan, maxMembers, maxProjects, status: 'active', createdAt: now, updatedAt: now },
    });
    const owner = await addMembership(id, email, 'owner', login.userId);
    return { workspace: serializeWorkspace(workspace), owner, tempPassword: login.tempPassword };
  };

  const updateWorkspace = async (id, patch) => {
    const allowed = ['name', 'plan', 'maxMembers', 'maxProjects', 'status', 'pricePerMonth', 'currency', 'billingEmail'];
    const data = { updatedAt: new Date() };
    for (const key of allowed) if (patch[key] !== undefined) data[key] = patch[key];
    return serializeWorkspace(await prisma.workspace.update({ where: { id }, data }));
  };

  const inviteMember = async (workspaceId, { email, role = 'member' }, actorRole) => {
    requireCan(actorRole, 'invite');
    if (role === 'owner' && actorRole !== 'owner') throw new Error('Only an owner can grant the owner role.');
    const normalized = normalizeEmail(email);
    if (!normalized) throw new Error('Email is required');
    const current = await usage(workspaceId);
    if (current.maxMembers != null && current.members >= current.maxMembers) {
      throw new Error(`Member limit reached for your plan (${current.maxMembers}). Contact KriJax to upgrade.`);
    }
    const login = await ensureLogin(normalized);
    const member = await addMembership(workspaceId, normalized, role, login.userId);
    return { member, tempPassword: login.tempPassword };
  };

  const ownerCount = (workspaceId) => prisma.workspaceMember.count({ where: { workspaceId, role: 'owner' } });

  const changeRole = async (workspaceId, memberId, role, actorRole) => {
    requireCan(actorRole, 'change_role');
    if (role === 'owner' && actorRole !== 'owner') throw new Error('Only an owner can grant the owner role.');
    const target = await prisma.workspaceMember.findFirst({ where: { id: memberId, workspaceId } });
    if (!target) throw new Error('Member not found');
    if (target.role === 'owner' && role !== 'owner' && (await ownerCount(workspaceId)) <= 1) {
      throw new Error('A workspace must keep at least one owner.');
    }
    return serializeMember(await prisma.workspaceMember.update({ where: { id: memberId }, data: { role } }));
  };

  const removeMember = async (workspaceId, memberId, actorRole) => {
    requireCan(actorRole, 'remove_member');
    const target = await prisma.workspaceMember.findFirst({ where: { id: memberId, workspaceId } });
    if (!target) throw new Error('Member not found');
    if (target.role === 'owner' && (await ownerCount(workspaceId)) <= 1) throw new Error('A workspace must keep at least one owner.');
    await prisma.workspaceMember.delete({ where: { id: memberId } });
    return true;
  };

  const renameWorkspace = async (id, name, actorRole) => {
    requireCan(actorRole, 'edit_workspace');
    if (!name || !name.trim()) throw new Error('Workspace name is required');
    return updateWorkspace(id, { name: name.trim() });
  };

  const deleteWorkspace = async (id, actorRole) => {
    requireCan(actorRole, 'delete_workspace');
    if (id === VENDOR_WORKSPACE.id) throw new Error('The KriJax workspace cannot be deleted.');
    await prisma.$transaction([
      prisma.run.deleteMany({ where: { workspaceId: id } }),
      prisma.schedule.deleteMany({ where: { workspaceId: id } }),
      prisma.suite.deleteMany({ where: { workspaceId: id } }),
      prisma.project.deleteMany({ where: { workspaceId: id } }),
      prisma.ticket.deleteMany({ where: { workspaceId: id } }),
      prisma.ticketCounter.deleteMany({ where: { workspaceId: id } }),
      prisma.credentialProfile.deleteMany({ where: { workspaceId: id } }),
      prisma.workspace.deleteMany({ where: { id } }), // members + invoices cascade
    ]);
    return true;
  };

  return {
    VENDOR_WORKSPACE,
    isPlatformAdmin,
    resolveMembership,
    ensureVendorWorkspace,
    getWorkspace,
    listWorkspaces,
    usage,
    listMembers,
    inviteMember,
    changeRole,
    removeMember,
    renameWorkspace,
    deleteWorkspace,
    createWorkspace,
    updateWorkspace,
  };
};

module.exports = { createWorkspaceService, VENDOR_WORKSPACE };

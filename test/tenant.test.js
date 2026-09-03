'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTenant } = require('../src/main/tenant.js');

const activeWorkspace = { id: 'ws-acme', name: 'Acme', plan: 'team', status: 'active' };
const suspendedWorkspace = { id: 'ws-acme', name: 'Acme', plan: 'team', status: 'suspended' };

const stubAuth = (user) => ({ getUser: () => user });

test('tenant: signed out resolves to no workspace', async () => {
  const auth = stubAuth(null);
  const workspaces = { isPlatformAdmin: () => false, resolveMembership: async () => null };
  const tenant = createTenant({ auth, workspaces });

  const resolved = await tenant.resolve();
  assert.equal(resolved.workspaceId, null);
  assert.equal(tenant.getWorkspaceId(), null);
  assert.deepEqual(tenant.status().workspace, null);
});

test('tenant: member of an active workspace resolves normally', async () => {
  const auth = stubAuth({ id: 'u1', email: 'owner@acme.test' });
  const workspaces = {
    isPlatformAdmin: () => false,
    resolveMembership: async ({ userId, email }) => {
      assert.equal(userId, 'u1');
      assert.equal(email, 'owner@acme.test');
      return { workspace: activeWorkspace, member: { role: 'owner' } };
    },
  };
  const tenant = createTenant({ auth, workspaces });

  await tenant.resolve();
  assert.equal(tenant.getWorkspaceId(), 'ws-acme');
  const status = tenant.status();
  assert.deepEqual(status.workspace, { id: 'ws-acme', name: 'Acme', plan: 'team', status: 'active' });
  assert.equal(status.role, 'owner');
});

test('tenant: member of a suspended workspace is unscopable — getWorkspaceId is null', async () => {
  const auth = stubAuth({ id: 'u1', email: 'owner@acme.test' });
  const workspaces = {
    isPlatformAdmin: () => false,
    resolveMembership: async () => ({ workspace: suspendedWorkspace, member: { role: 'owner' } }),
  };
  const tenant = createTenant({ auth, workspaces });

  await tenant.resolve();
  // The invariant this whole test exists to pin down: `get()` still knows
  // which workspace the membership points at, but `getWorkspaceId()` — the
  // one thing the cloud store actually scopes queries by — refuses it.
  assert.equal(tenant.get().workspaceId, 'ws-acme');
  assert.equal(tenant.getWorkspaceId(), null);
  assert.equal(tenant.status().workspace.status, 'suspended');
});

test('tenant: a platform admin with no membership gets the vendor workspace provisioned', async () => {
  const auth = stubAuth({ id: 'u2', email: 'admin@krijax.com' });
  let ensureCalls = 0;
  let resolveCalls = 0;
  const workspaces = {
    isPlatformAdmin: (email) => email === 'admin@krijax.com',
    resolveMembership: async () => {
      resolveCalls += 1;
      // First call: not a member yet. Second call (after provisioning):
      // adopt the newly created membership.
      return resolveCalls === 1 ? null : { workspace: activeWorkspace, member: { role: 'owner' } };
    },
    ensureVendorWorkspace: async (email) => {
      ensureCalls += 1;
      assert.equal(email, 'admin@krijax.com');
    },
  };
  const tenant = createTenant({ auth, workspaces });

  const resolved = await tenant.resolve();
  assert.equal(ensureCalls, 1);
  assert.equal(resolveCalls, 2);
  assert.equal(resolved.workspaceId, 'ws-acme');
  assert.equal(resolved.platformAdmin, true);
  assert.equal(tenant.getWorkspaceId(), 'ws-acme');
});

test('tenant: a non-admin with no membership stays out of any workspace', async () => {
  const auth = stubAuth({ id: 'u3', email: 'nobody@example.test' });
  const workspaces = {
    isPlatformAdmin: () => false,
    resolveMembership: async () => null,
  };
  const tenant = createTenant({ auth, workspaces });

  const resolved = await tenant.resolve();
  assert.equal(resolved.workspaceId, null);
  assert.equal(resolved.platformAdmin, false);
  assert.equal(tenant.getWorkspaceId(), null);
});

test('tenant: resolveMembership throwing does not reject — falls back to no workspace', async () => {
  const auth = stubAuth({ id: 'u4', email: 'owner@acme.test' });
  const workspaces = {
    isPlatformAdmin: () => false,
    resolveMembership: async () => {
      throw new Error('database is unreachable');
    },
  };
  const tenant = createTenant({ auth, workspaces });

  await assert.doesNotReject(() => tenant.resolve());
  assert.equal(tenant.get().workspaceId, null);
  assert.equal(tenant.getWorkspaceId(), null);
  assert.equal(tenant.status().workspace, null);
});

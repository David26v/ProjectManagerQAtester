'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { can, ROLES, ACTIONS } = require('../src/engine/roles.js');

test('roles: owner can do everything', () => {
  for (const action of ACTIONS) assert.equal(can('owner', action), true, action);
});

test('roles: admin can do everything except delete_workspace', () => {
  for (const action of ACTIONS) {
    assert.equal(can('admin', action), action !== 'delete_workspace', action);
  }
});

test('roles: member has no management powers', () => {
  for (const action of ACTIONS) assert.equal(can('member', action), false, action);
});

test('roles: unknown role or action is always false', () => {
  assert.equal(can('god', 'invite'), false);
  assert.equal(can('owner', 'launch_missiles'), false);
  assert.equal(can(null, 'invite'), false);
});

test('roles: exports the canonical lists', () => {
  assert.deepEqual(ROLES, ['owner', 'admin', 'member']);
  assert.deepEqual(ACTIONS, ['invite', 'remove_member', 'change_role', 'edit_workspace', 'delete_workspace', 'delete_project']);
});

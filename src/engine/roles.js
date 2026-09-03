'use strict';

// Single source of truth for what each workspace role may do. Every QA
// action (projects, suites, runs, reports, tickets, credentials, schedules,
// repository) is open to all roles and deliberately NOT listed here — only
// management powers are gated.

const ROLES = ['owner', 'admin', 'member'];
const ACTIONS = ['invite', 'remove_member', 'change_role', 'edit_workspace', 'delete_workspace', 'delete_project'];

const GRANTS = {
  owner: new Set(ACTIONS),
  admin: new Set(ACTIONS.filter((a) => a !== 'delete_workspace')),
  member: new Set(),
};

const can = (role, action) => Boolean(GRANTS[role] && GRANTS[role].has(action));

module.exports = { ROLES, ACTIONS, can };

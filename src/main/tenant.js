'use strict';

// Holds "which workspace is this session in" — resolved from the signed-in
// Supabase user after every auth change, handed to the cloud store as the
// scope function and to the renderer as part of auth status. `getWorkspaceId`
// returns null while signed out, without a membership, or when the
// workspace is suspended — the store refuses every call in those states.

const createTenant = ({ auth, workspaces }) => {
  let state = { workspaceId: null, role: null, platformAdmin: false, workspace: null };

  const resolve = async () => {
    const user = auth && auth.getUser();
    if (!user || !workspaces) {
      state = { workspaceId: null, role: null, platformAdmin: false, workspace: null };
      return state;
    }
    const email = (user.email || '').toLowerCase();
    const platformAdmin = workspaces.isPlatformAdmin(email);
    let membership = null;
    try {
      membership = await workspaces.resolveMembership({ userId: user.id, email });
      if (!membership && platformAdmin) {
        await workspaces.ensureVendorWorkspace(email);
        membership = await workspaces.resolveMembership({ userId: user.id, email });
      }
    } catch (e) {
      console.warn(`[qaflow] workspace resolution failed: ${e.message}`);
    }
    state = membership
      ? { workspaceId: membership.workspace.id, role: membership.member.role, platformAdmin, workspace: membership.workspace }
      : { workspaceId: null, role: null, platformAdmin, workspace: null };
    return state;
  };

  const get = () => state;
  const getWorkspaceId = () => (state.workspace && state.workspace.status === 'active' ? state.workspaceId : null);
  const status = () => ({
    workspace: state.workspace
      ? { id: state.workspace.id, name: state.workspace.name, plan: state.workspace.plan, status: state.workspace.status }
      : null,
    role: state.role,
    platformAdmin: state.platformAdmin,
  });

  return { resolve, get, getWorkspaceId, status };
};

module.exports = { createTenant };

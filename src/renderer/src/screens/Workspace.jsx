import { useEffect, useState } from 'react';
import { Building2, Users, Plus, Trash2, Pencil, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { TempPasswordDialog } from '@/components/TempPasswordDialog';
import { timeAgo } from '@/lib/format';
import { useToast } from '@/lib/toast';

const ROLES = ['member', 'admin', 'owner'];
const manages = (role) => role === 'owner' || role === 'admin';

const UsageBar = ({ label, used, max }) => {
  const pct = max ? Math.min(100, Math.round((used / max) * 100)) : 0;
  return (
    <div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span className="tabular-nums">{used} / {max ?? '∞'}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary">
        <div className={`h-full rounded-full ${pct >= 100 ? 'bg-danger' : 'bg-primary'}`} style={{ width: `${max ? pct : 15}%` }} />
      </div>
    </div>
  );
};

export const Workspace = () => {
  const toast = useToast();
  const [info, setInfo] = useState(null);
  const [members, setMembers] = useState([]);
  const [invite, setInvite] = useState({ email: '', role: 'member' });
  const [busy, setBusy] = useState(false);
  const [tempCreds, setTempCreds] = useState(null);
  const [removeTarget, setRemoveTarget] = useState(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [deleteText, setDeleteText] = useState('');

  const load = async () => {
    try {
      const [current, list] = await Promise.all([window.qaflow.workspace.current(), window.qaflow.workspace.listMembers()]);
      setInfo(current);
      setMembers(list);
      setName(current.workspace.name);
    } catch (e) {
      toast(`Failed to load workspace: ${e.message}`, 'error');
    }
  };
  useEffect(() => { load(); }, []);

  const run = async (fn, successMsg) => {
    setBusy(true);
    try {
      const result = await fn();
      if (successMsg) toast(successMsg, 'success');
      await load();
      return result;
    } catch (e) {
      toast(e.message, 'error');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const doInvite = async () => {
    const result = await run(() => window.qaflow.workspace.invite(invite), `Invited ${invite.email.trim().toLowerCase()}.`);
    if (result) {
      if (result.tempPassword) setTempCreds({ email: result.member.email, password: result.tempPassword });
      setInvite({ email: '', role: 'member' });
    }
  };

  if (!info) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  const { workspace, role, usage } = info;
  const canManage = manages(role);

  return (
    <div className="flex flex-col gap-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Workspace</h1>
        <p className="mt-1 text-sm text-muted-foreground">Your company's members, plan, and settings.</p>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_340px]">
        <div className="rounded-xl border border-border bg-card shadow-sm">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div className="flex items-center gap-2 text-base font-semibold text-foreground"><Users className="h-4 w-4 text-muted-foreground" /> Members ({members.length})</div>
          </div>
          {canManage && (
            <div className="flex flex-wrap items-end gap-2 border-b border-border px-5 py-4">
              <div className="flex min-w-64 flex-1 flex-col gap-1.5">
                <Label htmlFor="inv-email">Invite by email</Label>
                <Input id="inv-email" type="email" placeholder="teammate@company.com" value={invite.email} onChange={(e) => setInvite((f) => ({ ...f, email: e.target.value }))} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="inv-role">Role</Label>
                <Select id="inv-role" className="w-36" value={invite.role} onChange={(e) => setInvite((f) => ({ ...f, role: e.target.value }))}>
                  {ROLES.filter((r) => r !== 'owner' || role === 'owner').map((r) => <option key={r} value={r}>{r}</option>)}
                </Select>
              </div>
              <Button onClick={doInvite} disabled={busy || !invite.email.trim()}><Plus className="h-4 w-4" /> Invite</Button>
            </div>
          )}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-2.5 font-medium">Member</th><th className="px-5 py-2.5 font-medium">Role</th><th className="px-5 py-2.5 font-medium">Joined</th><th className="px-5 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-b border-border last:border-0">
                  <td className="px-5 py-3 text-foreground">{m.email}{!m.userId && <span className="ml-2 rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">invited</span>}</td>
                  <td className="px-5 py-3">
                    {canManage && !(role !== 'owner' && m.role === 'owner') ? (
                      <Select className="w-32" value={m.role} disabled={busy} onChange={(e) => run(() => window.qaflow.workspace.changeRole({ memberId: m.id, role: e.target.value }), 'Role updated.')}>
                        {ROLES.filter((r) => r !== 'owner' || role === 'owner' || m.role === 'owner').map((r) => <option key={r} value={r}>{r}</option>)}
                      </Select>
                    ) : <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-primary">{m.role}</span>}
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{m.joinedAt ? timeAgo(m.joinedAt) : '—'}</td>
                  <td className="px-5 py-3 text-right">
                    {canManage && !(role !== 'owner' && m.role === 'owner') && <button onClick={() => setRemoveTarget(m)} className="rounded-md p-1.5 text-muted-foreground hover:bg-danger-bg hover:text-danger" title="Remove"><Trash2 className="h-4 w-4" /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-6">
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-2 text-base font-semibold text-foreground"><Building2 className="h-4 w-4 text-muted-foreground" /> {workspace.name}</div>
            <div className="mt-1 text-xs text-muted-foreground">Plan: <span className="font-medium capitalize text-foreground">{workspace.plan}</span> · you are <span className="font-medium">{role}</span></div>
            <div className="mt-4 flex flex-col gap-3">
              <UsageBar label="Members" used={usage.members} max={usage.maxMembers} />
              <UsageBar label="Projects" used={usage.projects} max={usage.maxProjects} />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">Need more seats or projects? Contact KriJax Software and Development to upgrade your plan.</p>
          </div>

          {role === 'owner' && (
            <div className="rounded-xl border border-danger/40 bg-card p-5 shadow-sm">
              <div className="flex items-center gap-2 text-base font-semibold text-foreground"><Pencil className="h-4 w-4 text-muted-foreground" /> Workspace settings</div>
              <div className="mt-3 flex gap-2">
                <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!renaming} />
                {renaming
                  ? <Button size="sm" onClick={async () => { await run(() => window.qaflow.workspace.rename({ name }), 'Workspace renamed.'); setRenaming(false); }} disabled={busy}>Save</Button>
                  : <Button size="sm" variant="outline" onClick={() => setRenaming(true)}>Rename</Button>}
              </div>
              <div className="mt-5 flex items-center gap-2 text-sm font-semibold text-danger"><AlertTriangle className="h-4 w-4" /> Danger zone</div>
              <p className="mt-1 text-xs text-muted-foreground">Deleting removes every project, suite, run, ticket and member for everyone. Type the workspace name to confirm.</p>
              <div className="mt-2 flex gap-2">
                <Input placeholder={workspace.name} value={deleteText} onChange={(e) => setDeleteText(e.target.value)} />
                <Button variant="destructive" size="sm" disabled={busy || deleteText !== workspace.name} onClick={() => run(() => window.qaflow.workspace.remove(), 'Workspace deleted.')}><Trash2 className="h-4 w-4" /> Delete</Button>
              </div>
            </div>
          )}
        </div>
      </div>

      <TempPasswordDialog open={Boolean(tempCreds)} email={tempCreds?.email} password={tempCreds?.password} onClose={() => setTempCreds(null)} />
      <ConfirmDialog
        open={Boolean(removeTarget)}
        title={`Remove ${removeTarget?.email}?`}
        description="They lose access to this workspace immediately. Their login account is kept."
        confirmLabel="Remove"
        variant="danger"
        onConfirm={() => run(() => window.qaflow.workspace.removeMember({ memberId: removeTarget.id }), 'Member removed.')}
        onClose={() => setRemoveTarget(null)}
      />
    </div>
  );
};

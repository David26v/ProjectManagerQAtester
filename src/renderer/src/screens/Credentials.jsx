import { useEffect, useState } from 'react';
import { KeyRound, Plus, Trash2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { CredentialModal } from '@/components/CredentialModal';
import { timeAgo } from '@/lib/format';
import { useToast } from '@/lib/toast';

export function Credentials({ data }) {
  const { projects } = data;
  const toast = useToast();

  const [credentials, setCredentials] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  async function reload() {
    const list = await window.qaflow.session.list();
    setCredentials(list || []);
    setLoaded(true);
  }

  useEffect(() => {
    reload();
  }, []);

  const projectsById = Object.fromEntries(projects.map((p) => [p.id, p]));

  async function handleDelete(cred) {
    try {
      await window.qaflow.session.remove(cred.id);
      toast(`Credential profile "${cred.name}" deleted.`, 'success');
      reload();
    } catch (e) {
      toast(`Failed to delete credential: ${e.message}`, 'error');
    }
  }

  return (
    <div className="flex flex-col gap-6 p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Credentials</h1>
          <p className="mt-1 text-sm text-muted-foreground">Saved login sessions used for automated test runs.</p>
        </div>
        <Button onClick={() => setModalOpen(true)}>
          <Plus className="h-4 w-4" /> New Profile
        </Button>
      </div>

      <div className="rounded-xl border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2 text-base font-semibold text-foreground">
            <KeyRound className="h-4 w-4 text-muted-foreground" /> Credential Profiles
            <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">{credentials.length}</span>
          </div>
        </div>
        <div className="divide-y divide-border">
          {loaded && credentials.length === 0 && (
            <div className="px-5 py-10 text-center text-sm text-muted-foreground">No credential profiles yet — capture a login session to get started.</div>
          )}
          {credentials.map((c) => (
            <div key={c.id} className="flex items-center gap-4 px-5 py-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
                <ShieldCheck className="h-4.5 w-4.5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-semibold text-foreground">{c.name}</span>
                  <span className="rounded-full bg-success-bg px-2 py-0.5 text-xs font-medium text-success">Active</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>{projectsById[c.projectId]?.name || 'Unknown project'}</span>
                  <span>{c.environment || '—'}</span>
                  {c.username && <span>{c.username}</span>}
                  <span>Last used {c.lastUsedAt ? timeAgo(c.lastUsedAt) : 'never'}</span>
                </div>
              </div>
              <button
                onClick={() => setDeleteTarget(c)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-danger-bg hover:text-danger"
                title="Delete"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <CredentialModal open={modalOpen} onClose={() => setModalOpen(false)} projects={projects} onSaved={reload} />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={`Delete "${deleteTarget?.name}"?`}
        description="This removes the stored session. Any suite runs that rely on it will need a new credential profile."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => deleteTarget && handleDelete(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}

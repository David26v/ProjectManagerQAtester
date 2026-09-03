import { useEffect, useState } from 'react';
import { User, Server, FolderOpen, Info, Copy, Bug, FileJson, LogOut, Cloud } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { StatusPill } from '@/components/StatusPill';
import { fmtDate } from '@/lib/format';
import { openRunFolder } from '@/lib/media';
import { useToast } from '@/lib/toast';
import { PRODUCT } from '@/lib/brand';

const ROLES = ['QA', 'Developer'];
const DEFAULT_PORT = 4317;

// `#/settings` — profile, local REST API info, data folder, and About. No
// mockup exists for this screen (see task-10 brief); it follows the visual
// language of the rest of the app (card grid, Field-style labeled inputs,
// explicit Save buttons like NewProjectModal) rather than inventing a new
// layout convention.
export function Settings({ data }) {
  const { settings, runs, projects, suites, version, reload } = data;
  const toast = useToast();

  const [profile, setProfile] = useState({ userName: '', role: 'QA' });
  const [apiPort, setApiPort] = useState(String(DEFAULT_PORT));
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingApi, setSavingApi] = useState(false);
  const [updateStatus, setUpdateStatus] = useState(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [account, setAccount] = useState(null);
  const [signingOut, setSigningOut] = useState(false);

  // Account card state — self-contained rather than threaded through `data`,
  // since auth status lives outside the store. Sign-out flips the whole app
  // back to the Login screen via App.jsx's `auth:changed` subscription.
  useEffect(() => {
    window.qaflow.auth.status().then(setAccount);
  }, []);

  async function signOut() {
    setSigningOut(true);
    try {
      await window.qaflow.auth.logout();
    } catch (e) {
      toast(`Sign out failed: ${e.message}`, 'error');
      setSigningOut(false);
    }
  }

  useEffect(() => {
    setProfile({ userName: settings?.userName || '', role: settings?.role || 'QA' });
    setApiPort(String(settings?.apiPort || DEFAULT_PORT));
  }, [settings]);

  // Initial read (also tells us `dev` vs packaged) plus live updates while
  // this screen is mounted — a check kicked off elsewhere (boot, periodic
  // timer) should still move the button's label along.
  useEffect(() => {
    window.qaflow.updates.status().then(setUpdateStatus);
    const unsubscribe = window.qaflow.on('updates:status', setUpdateStatus);
    return unsubscribe;
  }, []);

  async function checkForUpdates() {
    setCheckingUpdate(true);
    try {
      const result = await window.qaflow.updates.check();
      setUpdateStatus(result);
      if (result.state === 'idle') toast('You are on the latest version.', 'info');
      else if (result.state === 'error') toast(`Update check failed: ${result.error}`, 'error');
    } catch (e) {
      toast(`Update check failed: ${e.message}`, 'error');
    } finally {
      setCheckingUpdate(false);
    }
  }

  function updateStatusLabel() {
    if (!updateStatus || updateStatus.state === 'dev') return 'Updates run in the installed app only';
    if (checkingUpdate || updateStatus.state === 'checking') return 'Checking…';
    if (updateStatus.state === 'downloading') return 'Downloading update…';
    if (updateStatus.state === 'ready') return `Update v${updateStatus.version} ready — restart to apply`;
    if (updateStatus.state === 'error') return `Update check failed: ${updateStatus.error}`;
    return 'Up to date';
  }

  async function saveProfile() {
    setSavingProfile(true);
    try {
      await window.qaflow.settings.save({ userName: profile.userName.trim(), role: profile.role });
      toast('Profile saved.', 'success');
      reload();
    } catch (e) {
      toast(`Failed to save profile: ${e.message}`, 'error');
    } finally {
      setSavingProfile(false);
    }
  }

  async function saveApiPort() {
    const port = Number(apiPort);
    if (!Number.isInteger(port) || port <= 0) {
      toast('Enter a valid port number.', 'warning');
      return;
    }
    setSavingApi(true);
    try {
      await window.qaflow.settings.save({ apiPort: port });
      toast('API port saved — restart the app for it to take effect.', 'success');
      reload();
    } catch (e) {
      toast(`Failed to save API port: ${e.message}`, 'error');
    } finally {
      setSavingApi(false);
    }
  }

  function copyCliExample() {
    const project = projects?.[0];
    const suite = project ? suites?.find((s) => s.projectId === project.id) : null;
    const example = `qaflow run --project ${project ? JSON.stringify(project.name) : '"My Project"'} --suite ${
      suite ? JSON.stringify(suite.name) : '"My Suite"'
    } --port ${apiPort}`;
    navigator.clipboard?.writeText(example);
    toast('CLI example copied to clipboard.', 'success');
  }

  const cliExample = `qaflow run --project <project> --suite <suite>${apiPort !== String(DEFAULT_PORT) ? ` --port ${apiPort}` : ''}`;
  const sortedRuns = [...(runs || [])].sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));

  return (
    <div className="flex flex-col gap-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage your profile, local API, and app preferences.</p>
      </div>

      {account?.configured && (
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center gap-2 text-base font-semibold text-foreground">
            <Cloud className="h-4 w-4 text-muted-foreground" /> Account
          </div>
          <div className="mt-4 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-foreground">{account.name || account.email}</div>
              <div className="truncate text-xs text-muted-foreground">{account.email}</div>
              <p className="mt-1 text-xs text-muted-foreground">
                Workspace: <span className="font-medium text-foreground">{account.workspace?.name || '—'}</span>
                {account.role && <> · {account.role}</>}
                {account.platformAdmin && <> · KriJax staff</>}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={signOut} disabled={signingOut}>
              <LogOut className="h-4 w-4" /> {signingOut ? 'Signing out…' : 'Sign out'}
            </Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center gap-2 text-base font-semibold text-foreground">
            <User className="h-4 w-4 text-muted-foreground" /> Profile
          </div>
          <div className="mt-4 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="settings-name">Name</Label>
              <Input id="settings-name" placeholder="e.g., Jordan Smith" value={profile.userName} onChange={(e) => setProfile((p) => ({ ...p, userName: e.target.value }))} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="settings-role">Role</Label>
              <Select id="settings-role" value={profile.role} onChange={(e) => setProfile((p) => ({ ...p, role: e.target.value }))}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">Developer role reveals a Diagnostics card below — it only changes what's visible, not real access control (v2).</p>
            </div>
            <Button className="self-start" onClick={saveProfile} disabled={savingProfile}>
              {savingProfile ? 'Saving…' : 'Save Profile'}
            </Button>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center gap-2 text-base font-semibold text-foreground">
            <Server className="h-4 w-4 text-muted-foreground" /> Local API
          </div>
          <div className="mt-4 flex flex-col gap-4">
            <div className="flex items-center justify-between rounded-md bg-secondary/60 px-3 py-2 text-sm">
              <span className="text-muted-foreground">Status</span>
              <StatusPill status="connected" />
            </div>
            <p className="-mt-2 text-xs text-muted-foreground">
              The local REST API starts automatically once you're signed in — there's no separate start/stop control, so this reflects the port configuration rather
              than a live health check.
            </p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="settings-port">Port</Label>
              <Input id="settings-port" type="number" value={apiPort} onChange={(e) => setApiPort(e.target.value)} />
              <p className="text-xs text-muted-foreground">Changes apply the next time {PRODUCT} starts.</p>
            </div>
            <Button variant="outline" className="self-start" onClick={saveApiPort} disabled={savingApi}>
              {savingApi ? 'Saving…' : 'Save Port'}
            </Button>
            <div className="rounded-md border border-border bg-secondary/40 p-3">
              <div className="text-xs font-medium text-muted-foreground">CLI Example</div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <code className="truncate font-mono text-xs text-foreground">{cliExample}</code>
                <button onClick={copyCliExample} className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-primary" title="Copy CLI example">
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center gap-2 text-base font-semibold text-foreground">
            <FolderOpen className="h-4 w-4 text-muted-foreground" /> Data Folder
          </div>
          <div className="mt-4 flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              All projects, suites, runs, credentials, and tickets are stored locally under Electron's <code className="font-mono text-xs">userData</code>/
              <code className="font-mono text-xs">qaflow-data</code> folder.
            </p>
            <Button variant="outline" className="self-start" disabled title="Open a specific run's folder from the Runs screen instead — the root data folder path isn't exposed to the renderer yet">
              <FolderOpen className="h-4 w-4" /> Open Data Folder
            </Button>
            <p className="text-xs text-muted-foreground">
              The root path isn't available over IPC in this build — open an individual run's folder from Runs → Open Folder instead.
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center gap-2 text-base font-semibold text-foreground">
            <Info className="h-4 w-4 text-muted-foreground" /> About
          </div>
          <div className="mt-4 flex flex-col gap-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{PRODUCT}</span>
              <span className="font-medium text-foreground">v{version || '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Vendor</span>
              <span className="font-medium text-foreground">KriJax Software and Development</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Projects</span>
              <span className="font-medium text-foreground">{projects?.length || 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total Runs</span>
              <span className="font-medium text-foreground">{runs?.length || 0}</span>
            </div>
            <div className="mt-2 flex flex-col gap-2 border-t border-border pt-3">
              <Button
                variant="outline"
                size="sm"
                className="self-start"
                onClick={checkForUpdates}
                disabled={!updateStatus || updateStatus.state === 'dev' || checkingUpdate || updateStatus.state === 'checking' || updateStatus.state === 'downloading'}
              >
                {checkingUpdate || updateStatus?.state === 'checking' ? 'Checking…' : 'Check for updates'}
              </Button>
              <p className="text-xs text-muted-foreground">{updateStatusLabel()}</p>
            </div>
          </div>
        </div>
      </div>

      {profile.role === 'Developer' && (
        <div className="rounded-xl border border-border bg-card shadow-sm">
          <div className="flex items-center gap-2 border-b border-border px-5 py-4 text-base font-semibold text-foreground">
            <Bug className="h-4 w-4 text-muted-foreground" /> Diagnostics
          </div>
          <div className="p-5">
            <Alert variant="info" className="mb-4">
              Every run's raw <code className="font-mono text-xs">report.json</code> lives inside its run folder. There's no direct file-open IPC yet, so
              "Open" reveals the run's folder in your file manager.
            </Alert>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Run</th>
                    <th className="px-3 py-2 font-medium">Suite</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Started</th>
                    <th className="px-3 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRuns.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-8 text-center text-sm text-muted-foreground">
                        No runs yet.
                      </td>
                    </tr>
                  )}
                  {sortedRuns.map((r) => (
                    <tr key={r.runId} className="border-b border-border last:border-0">
                      <td className="px-3 py-2.5 font-medium text-foreground">{r.runId}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">{r.suiteName}</td>
                      <td className="px-3 py-2.5">
                        <StatusPill status={r.status} />
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">{fmtDate(r.startedAt)}</td>
                      <td className="px-3 py-2.5 text-right">
                        <button
                          onClick={() => openRunFolder(r.runId, toast)}
                          className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                        >
                          <FileJson className="h-3.5 w-3.5" /> Open
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

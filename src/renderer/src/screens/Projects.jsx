import { useMemo, useState } from 'react';
import {
  Search,
  ArrowUpDown,
  Plus,
  Upload,
  MoreVertical,
  Play,
  Globe,
  GitBranch,
  Link2,
  CheckCircle2,
  XCircle,
  PlusCircle,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { StatusPill } from '@/components/StatusPill';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { RunSuiteModal } from '@/components/RunSuiteModal';
import { projectVisual, envColorClass, envDotClass } from '@/lib/projectVisuals';
import { timeAgo, fmtDate } from '@/lib/format';
import { navigate } from '@/hooks/useHashRoute';
import { useToast } from '@/lib/toast';

const COMPARISON_ROWS = [
  { label: 'Setup Time', browser: 'Seconds', repo: 'Minutes' },
  { label: 'Best For', browser: 'Quick ad-hoc testing', repo: 'Automated CI runs' },
  { label: 'Data Freshness', browser: 'Live environment', repo: 'Reproducible' },
  { label: 'Network Access', browser: 'Same as your browser', repo: 'Server/CI access' },
  { label: 'Secrets Handling', browser: 'Local only', repo: 'Managed (.env/secrets)' },
  { label: 'Parallel Environments', browser: false, repo: true },
  { label: 'Version Controlled', browser: false, repo: true },
];

function EnvChips({ environments = [] }) {
  const shown = environments.slice(0, 2);
  const extra = environments.length - shown.length;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {shown.map((env) => (
        <span key={env.name} className={`rounded-full px-2 py-0.5 text-xs font-medium ${envColorClass(env.name)}`}>
          {env.name}
        </span>
      ))}
      {extra > 0 && <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">+{extra}</span>}
    </div>
  );
}

function ComparisonCell({ value }) {
  if (typeof value === 'boolean') {
    return value ? <CheckCircle2 className="h-4 w-4 text-success" /> : <XCircle className="h-4 w-4 text-danger" />;
  }
  return <span className="text-foreground">{value}</span>;
}

export function Projects({ data, onNewProject, startRun }) {
  const { projects, suites, runs, reload } = data;
  const toast = useToast();

  const [search, setSearch] = useState('');
  const [menuOpenId, setMenuOpenId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [runTarget, setRunTarget] = useState(null);
  const [selectedProjectId, setSelectedProjectId] = useState(projects[0]?.id || '');
  const [activeTab, setActiveTab] = useState('browser');
  const [envForm, setEnvForm] = useState({ name: '', baseUrl: '', browserProfile: '' });
  const [testState, setTestState] = useState('idle'); // idle | testing | connected | failed
  const [connectionStatus, setConnectionStatus] = useState({}); // `${projectId}:${envName}` -> 'connected'|'failed'

  const projectsWithMeta = useMemo(() => {
    return projects
      .filter((p) => p.name?.toLowerCase().includes(search.toLowerCase()))
      .map((p) => {
        const projectSuites = suites.filter((s) => s.projectId === p.id);
        const projectRuns = runs.filter((r) => r.projectId === p.id);
        const lastRun = [...projectRuns].sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))[0];
        return { project: p, suiteCount: projectSuites.length, lastRun };
      });
  }, [projects, suites, runs, search]);

  const selectedProject = projects.find((p) => p.id === selectedProjectId) || null;

  const recentActivity = useMemo(() => {
    const runEvents = runs.map((r) => ({
      key: `run-${r.runId}`,
      icon: r.status === 'failed' ? XCircle : CheckCircle2,
      tone: r.status === 'failed' ? 'text-danger bg-danger-bg' : 'text-success bg-success-bg',
      title: `Run ${r.runId.split('-').pop().slice(0, 4).toUpperCase()} ${r.status === 'failed' ? 'failed' : 'completed'}`,
      subtitle: `${projects.find((p) => p.id === r.projectId)?.name || 'Unknown'} • ${r.suiteName} • ${r.environment || '—'}`,
      at: r.startedAt,
    }));
    return runEvents.sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 5);
  }, [runs, projects]);

  function handleRunProject(project) {
    const projectSuites = suites.filter((s) => s.projectId === project.id);
    if (projectSuites.length === 0) {
      toast(`${project.name} has no test suites yet — add one in Test Suites.`, 'info');
      return;
    }
    setRunTarget(projectSuites[0]);
  }

  async function handleDelete(project) {
    try {
      await window.qaflow.projects.remove(project.id);
      toast(`Project "${project.name}" deleted`, 'success');
      reload();
    } catch (e) {
      toast(`Failed to delete project: ${e.message}`, 'error');
    }
  }

  async function testConnection() {
    if (!envForm.baseUrl.trim()) {
      toast('Enter a base URL first.', 'warning');
      return;
    }
    setTestState('testing');
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      // `no-cors` gives an opaque response — we only care whether the
      // network request completed at all, not its status/body.
      await fetch(envForm.baseUrl.trim(), { mode: 'no-cors', signal: controller.signal });
      clearTimeout(timeout);
      setTestState('connected');
    } catch (e) {
      setTestState('failed');
    }
  }

  async function saveEnvironment() {
    if (!selectedProject) {
      toast('Select a project first.', 'warning');
      return;
    }
    const name = envForm.name.trim();
    const baseUrl = envForm.baseUrl.trim();
    if (!name || !baseUrl) {
      toast('Environment name and base URL are required.', 'warning');
      return;
    }
    const existing = selectedProject.environments || [];
    const next = existing.some((e) => e.name === name)
      ? existing.map((e) => (e.name === name ? { ...e, baseUrl, browserProfile: envForm.browserProfile } : e))
      : [...existing, { name, baseUrl, browserProfile: envForm.browserProfile }];

    try {
      await window.qaflow.projects.save({ ...selectedProject, environments: next });
      setConnectionStatus((s) => ({ ...s, [`${selectedProject.id}:${name}`]: testState === 'connected' ? 'connected' : s[`${selectedProject.id}:${name}`] }));
      toast(`Environment "${name}" saved to ${selectedProject.name}.`, 'success');
      setEnvForm({ name: '', baseUrl: '', browserProfile: '' });
      setTestState('idle');
      reload();
    } catch (e) {
      toast(`Failed to save environment: ${e.message}`, 'error');
    }
  }

  return (
    <div className="flex flex-col gap-6 p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Projects</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage your QA targets, environments, and configurations in one place.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => toast('Config import arrives in v2.', 'info')}>
            <Upload className="h-4 w-4" /> Import Config
          </Button>
          <Button onClick={onNewProject}>
            <Plus className="h-4 w-4" /> New Project
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_420px]">
        <div className="flex flex-col gap-6">
          <div className="rounded-xl border border-border bg-card shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
              <div className="flex items-center gap-2 text-base font-semibold text-foreground">
                All Projects
                <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">{projects.length}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="w-52 pl-8"
                    placeholder="Search projects..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <button
                  onClick={() => toast('Sorting arrives in v2.', 'info')}
                  className="flex h-9 w-9 items-center justify-center rounded-md border border-input text-muted-foreground hover:bg-accent"
                >
                  <ArrowUpDown className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="divide-y divide-border">
              {projectsWithMeta.length === 0 && (
                <div className="px-5 py-10 text-center text-sm text-muted-foreground">
                  {projects.length === 0 ? 'No projects yet — create your first project to get started.' : 'No projects match your search.'}
                </div>
              )}
              {projectsWithMeta.map(({ project, suiteCount, lastRun }, idx) => {
                const { Icon, colorClass } = projectVisual(project);
                return (
                  <div key={project.id} className="flex items-center gap-4 px-5 py-4">
                    <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-white ${colorClass}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1 cursor-pointer" onClick={() => navigate(`/projects/${project.id}`)}>
                      <div className="flex items-center gap-2">
                        <span className="truncate font-semibold text-foreground">{project.name}</span>
                        {idx === 0 && (
                          <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-primary">Primary</span>
                        )}
                      </div>
                      <div className="truncate text-sm text-muted-foreground">{project.baseUrl}</div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <EnvChips environments={project.environments} />
                        <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">
                          {suiteCount} Suites
                        </span>
                        {lastRun && (
                          <>
                            <span className="text-xs text-muted-foreground">Last run: {timeAgo(lastRun.startedAt)}</span>
                            <StatusPill status={lastRun.status} />
                          </>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => handleRunProject(project)}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-primary hover:bg-accent"
                      title="Run"
                    >
                      <Play className="h-4 w-4" />
                    </button>
                    <div className="relative shrink-0">
                      <button
                        onClick={() => setMenuOpenId(menuOpenId === project.id ? null : project.id)}
                        className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>
                      {menuOpenId === project.id && (
                        <div className="absolute right-0 top-10 z-20 w-36 rounded-md border border-border bg-card py-1 shadow-lg">
                          <button
                            className="block w-full px-3 py-1.5 text-left text-sm text-foreground hover:bg-secondary"
                            onClick={() => {
                              setMenuOpenId(null);
                              navigate(`/projects/${project.id}`);
                            }}
                          >
                            Edit
                          </button>
                          <button
                            className="block w-full px-3 py-1.5 text-left text-sm text-danger hover:bg-danger-bg"
                            onClick={() => {
                              setMenuOpenId(null);
                              setDeleteTarget(project);
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {projectsWithMeta.length > 0 && (
              <div className="border-t border-border px-5 py-3 text-sm text-muted-foreground">
                Showing 1 to {projectsWithMeta.length} of {projects.length} projects
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <div className="text-base font-semibold text-foreground">Project Switcher</div>
              <div className="mt-3">
                <Select value={selectedProjectId} onChange={(e) => setSelectedProjectId(e.target.value)}>
                  <option value="">Select a project</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </div>
              {selectedProject && (
                <div className="mt-4">
                  <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Environments</div>
                  <div className="flex flex-col gap-2">
                    {(selectedProject.environments || []).length === 0 && (
                      <p className="text-sm text-muted-foreground">No environments configured yet.</p>
                    )}
                    {(selectedProject.environments || []).map((env) => {
                      const status = connectionStatus[`${selectedProject.id}:${env.name}`];
                      return (
                        <div key={env.name} className="flex items-center justify-between text-sm">
                          <span className="flex items-center gap-2 text-foreground">
                            <span className={`h-2 w-2 rounded-full ${envDotClass(env.name)}`} />
                            {env.name}
                          </span>
                          <StatusPill status={status === 'connected' ? 'connected' : 'not connected'} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              <Button
                variant="outline"
                className="mt-4 w-full"
                onClick={() => toast('Environment management lives in the project detail page.', 'info')}
              >
                Manage Environments
              </Button>
            </div>

            <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="text-base font-semibold text-foreground">Recent Activity</div>
                <a href="#/reports" className="text-sm font-medium text-primary hover:underline">
                  View all activity
                </a>
              </div>
              <div className="mt-4 flex flex-col gap-4">
                {recentActivity.length === 0 && <p className="text-sm text-muted-foreground">No activity yet.</p>}
                {recentActivity.map((a) => {
                  const Icon = a.icon;
                  return (
                    <div key={a.key} className="flex items-start gap-3">
                      <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${a.tone}`}>
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-foreground">{a.title}</div>
                        <div className="truncate text-xs text-muted-foreground">{a.subtitle}</div>
                      </div>
                      <div className="shrink-0 text-xs text-muted-foreground">{fmtDate(a.at)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="text-lg font-semibold text-foreground">Environment Connection</div>
            <p className="mt-1 text-sm text-muted-foreground">Connect to your application environment to enable testing.</p>

            <div className="mt-4 flex border-b border-border">
              <button
                onClick={() => setActiveTab('browser')}
                className={`border-b-2 px-1 pb-2 text-sm font-medium ${
                  activeTab === 'browser' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'
                } mr-6`}
              >
                Browser Connection
              </button>
              <button
                disabled
                title="Repo Connection — coming in v2"
                className="flex cursor-not-allowed items-center gap-1.5 border-b-2 border-transparent pb-2 text-sm font-medium text-muted-foreground/50"
              >
                <GitBranch className="h-3.5 w-3.5" /> Repo Connection
                <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-semibold">v2</span>
              </button>
            </div>

            {activeTab === 'browser' && (
              <div className="mt-4 flex flex-col gap-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Globe className="h-4 w-4 text-primary" /> Browser Connection
                </div>
                <p className="-mt-2 text-xs text-muted-foreground">Connect to a running instance in your browser.</p>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="env-name">Environment Name</Label>
                  <Input
                    id="env-name"
                    placeholder="Staging"
                    value={envForm.name}
                    onChange={(e) => setEnvForm((f) => ({ ...f, name: e.target.value }))}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="env-url">Base URL</Label>
                  <Input
                    id="env-url"
                    placeholder="https://staging.example.com"
                    value={envForm.baseUrl}
                    onChange={(e) => {
                      setEnvForm((f) => ({ ...f, baseUrl: e.target.value }));
                      setTestState('idle');
                    }}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="env-profile">Browser Profile (Optional)</Label>
                  <Select
                    id="env-profile"
                    value={envForm.browserProfile}
                    onChange={(e) => setEnvForm((f) => ({ ...f, browserProfile: e.target.value }))}
                  >
                    <option value="">Default Profile</option>
                    <option value="incognito">Incognito</option>
                  </Select>
                </div>

                <div className="flex items-center gap-2">
                  <Button variant="outline" onClick={testConnection} disabled={testState === 'testing'}>
                    {testState === 'testing' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                    Test Connection
                  </Button>
                  <Button className="flex-1" onClick={saveEnvironment}>
                    <PlusCircle className="h-4 w-4" /> Save Environment
                  </Button>
                </div>
                {testState === 'connected' && <StatusPill status="connected" />}
                {testState === 'failed' && <StatusPill status="failed" />}
              </div>
            )}

            <div className="mt-6">
              <div className="mb-2 text-sm font-semibold text-foreground">Connection Comparison</div>
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-secondary/50 text-left text-muted-foreground">
                      <th className="px-3 py-2 font-medium"> </th>
                      <th className="px-3 py-2 font-medium">Browser Connection</th>
                      <th className="px-3 py-2 font-medium">Repo Connection</th>
                    </tr>
                  </thead>
                  <tbody>
                    {COMPARISON_ROWS.map((row) => (
                      <tr key={row.label} className="border-t border-border">
                        <td className="px-3 py-2 font-medium text-muted-foreground">{row.label}</td>
                        <td className="px-3 py-2">
                          <ComparisonCell value={row.browser} />
                        </td>
                        <td className="px-3 py-2">
                          <ComparisonCell value={row.repo} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">You can add both connection types to the same project.</p>
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={`Delete "${deleteTarget?.name}"?`}
        description="This removes the project. Its suites and run history stay on disk but will no longer be reachable from here."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => deleteTarget && handleDelete(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
      />

      <RunSuiteModal
        open={Boolean(runTarget)}
        onClose={() => setRunTarget(null)}
        suite={runTarget}
        project={runTarget ? projects.find((p) => p.id === runTarget.projectId) : null}
        runs={runs}
        onRun={(suite, opts) => startRun(suite, opts)}
      />
    </div>
  );
}

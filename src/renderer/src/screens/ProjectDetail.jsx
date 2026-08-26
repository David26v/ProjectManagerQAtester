import { useEffect, useMemo, useState } from 'react';
import {
  ChevronRight,
  Link2,
  Play,
  Pencil,
  Plus,
  X,
  Globe,
  Layers,
  BarChart3,
  Copy,
  KeyRound,
  Trash2,
  ListChecks,
  Activity as ActivityIcon,
  CheckCircle2,
  XCircle,
  Star,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { StatusPill } from '@/components/StatusPill';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { CredentialModal } from '@/components/CredentialModal';
import { projectVisual, envDotClass } from '@/lib/projectVisuals';
import { fmtDate, fmtDuration, timeAgo } from '@/lib/format';
import { withinLastDays, successRate } from '@/lib/stats';
import { navigate } from '@/hooks/useHashRoute';
import { useToast } from '@/lib/toast';

const TABS = ['Overview', 'Environments', 'Test Suites', 'Credentials', 'Activity', 'Settings'];

const KV = ({ label, value, mono }) => {
  return (
    <div className="flex items-center justify-between gap-3 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`truncate text-right font-medium text-foreground ${mono ? 'font-mono text-xs' : ''}`}>{value}</span>
    </div>
  );
}

const Card = ({ title, icon: Icon, action, children }) => {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-base font-semibold text-foreground">
          {Icon && <Icon className="h-4 w-4 text-muted-foreground" />} {title}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

// ---- Environments tab ----
const EnvironmentsTab = ({ project, reload }) => {
  const toast = useToast();
  const [form, setForm] = useState({ name: '', baseUrl: '' });
  const [editing, setEditing] = useState(null); // env name being edited
  const [editForm, setEditForm] = useState({ name: '', baseUrl: '' });
  const [deleteTarget, setDeleteTarget] = useState(null);
  const environments = project.environments || [];

  const save = async (nextEnvs, nextDefault = project.defaultEnvironment, msg) => {
    try {
      await window.qaflow.projects.save({ ...project, environments: nextEnvs, defaultEnvironment: nextDefault });
      if (msg) toast(msg, 'success');
      reload();
    } catch (e) {
      toast(`Failed to save environments: ${e.message}`, 'error');
    }
  }

  const addEnvironment = async () => {
    const name = form.name.trim();
    const baseUrl = form.baseUrl.trim();
    if (!name || !baseUrl) {
      toast('Environment name and base URL are required.', 'warning');
      return;
    }
    if (environments.some((e) => e.name === name)) {
      toast(`Environment "${name}" already exists.`, 'warning');
      return;
    }
    await save([...environments, { name, baseUrl }], project.defaultEnvironment || name, `Environment "${name}" added.`);
    setForm({ name: '', baseUrl: '' });
  }

  const saveEdit = async (oldName) => {
    const name = editForm.name.trim();
    const baseUrl = editForm.baseUrl.trim();
    if (!name || !baseUrl) {
      toast('Environment name and base URL are required.', 'warning');
      return;
    }
    const next = environments.map((e) => (e.name === oldName ? { ...e, name, baseUrl } : e));
    const nextDefault = project.defaultEnvironment === oldName ? name : project.defaultEnvironment;
    await save(next, nextDefault, `Environment "${name}" saved.`);
    setEditing(null);
  }

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_320px]">
      <Card title="Environments" icon={Globe}>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          {environments.length === 0 && (
            <p className="text-sm text-muted-foreground md:col-span-2">No environments yet — add the first one on the right.</p>
          )}
          {environments.map((env) => (
            <div key={env.name} className="rounded-lg border border-border p-4">
              {editing === env.name ? (
                <div className="flex flex-col gap-2">
                  <Input value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} placeholder="Name" />
                  <Input value={editForm.baseUrl} onChange={(e) => setEditForm((f) => ({ ...f, baseUrl: e.target.value }))} placeholder="https://…" />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => saveEdit(env.name)}>
                      Save
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 font-medium text-foreground">
                      <span className={`h-2 w-2 rounded-full ${envDotClass(env.name)}`} />
                      {env.name}
                    </span>
                    {project.defaultEnvironment === env.name && (
                      <span className="flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-primary">
                        <Star className="h-3 w-3" /> Default
                      </span>
                    )}
                  </div>
                  <div className="mt-3 text-xs text-muted-foreground">Base URL</div>
                  <div className="truncate text-sm text-foreground" title={env.baseUrl}>
                    {env.baseUrl}
                  </div>
                  <div className="mt-3 flex items-center gap-2 border-t border-border pt-2.5">
                    {project.defaultEnvironment !== env.name && (
                      <button
                        onClick={() => save(environments, env.name, `"${env.name}" is now the default environment.`)}
                        className="text-xs font-medium text-primary hover:underline"
                      >
                        Set default
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setEditing(env.name);
                        setEditForm({ name: env.name, baseUrl: env.baseUrl });
                      }}
                      className="text-xs font-medium text-muted-foreground hover:text-foreground"
                    >
                      Edit
                    </button>
                    <button onClick={() => setDeleteTarget(env)} className="ml-auto text-xs font-medium text-danger hover:underline">
                      Delete
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </Card>

      <Card title="Add Environment" icon={Plus}>
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="env-name">Name</Label>
            <Input id="env-name" placeholder="Staging" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="env-url">Base URL</Label>
            <Input id="env-url" placeholder="https://staging.example.com" value={form.baseUrl} onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))} />
          </div>
          <Button className="self-start" size="sm" onClick={addEnvironment}>
            <Plus className="h-4 w-4" /> Add Environment
          </Button>
        </div>
      </Card>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={`Delete environment "${deleteTarget?.name}"?`}
        description="Suites configured to run against it will fall back to the project's base URL."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() =>
          save(
            environments.filter((e) => e.name !== deleteTarget.name),
            project.defaultEnvironment === deleteTarget.name ? null : project.defaultEnvironment,
            `Environment "${deleteTarget.name}" deleted.`
          )
        }
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}

// ---- Test Suites tab ----
const SuitesTab = ({ project, projectSuites, projectRuns, startRun }) => {
  const toast = useToast();

  const lastRunFor = (suiteId) => {
    return projectRuns.find((r) => r.suiteId === suiteId) || null;
  }

  const runSuite = (suite) => {
    if (startRun) {
      startRun(suite, { environment: suite.environment || project.defaultEnvironment, headless: true });
    } else {
      toast('Open the suite to run it.', 'info');
    }
  }

  return (
    <Card
      title={`Test Suites (${projectSuites.length})`}
      icon={ListChecks}
      action={
        <Button size="sm" onClick={() => navigate('/suites?panel=recorder')}>
          <Plus className="h-4 w-4" /> New Suite
        </Button>
      }
    >
      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-y border-border text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">Suite</th>
              <th className="px-4 py-2.5 font-medium">Tags</th>
              <th className="px-4 py-2.5 font-medium">Steps</th>
              <th className="px-4 py-2.5 font-medium">Last Run</th>
              <th className="px-4 py-2.5 font-medium">Updated</th>
              <th className="px-4 py-2.5 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {projectSuites.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  No suites yet — record the first one with the Recorder.
                </td>
              </tr>
            )}
            {projectSuites.map((s) => {
              const last = lastRunFor(s.id);
              return (
                <tr
                  key={s.id}
                  onClick={() => navigate(`/suites/${s.id}`)}
                  className="cursor-pointer border-b border-border last:border-0 hover:bg-secondary/40"
                >
                  <td className="px-4 py-3 font-medium text-foreground">{s.name}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(s.tags || []).map((t) => (
                        <span key={t} className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
                          {t}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{(s.steps || []).length}</td>
                  <td className="px-4 py-3">{last ? <StatusPill status={last.status} /> : <span className="text-xs text-muted-foreground">never</span>}</td>
                  <td className="px-4 py-3 text-muted-foreground">{timeAgo(s.updatedAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        runSuite(s);
                      }}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-primary"
                      title="Run headless"
                    >
                      <Play className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ---- Credentials tab ----
const CredentialsTab = ({ project, projects }) => {
  const toast = useToast();
  const [profiles, setProfiles] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const load = async () => {
    try {
      setProfiles(await window.qaflow.session.list(project.id));
    } catch (e) {
      toast(`Failed to load credentials: ${e.message}`, 'error');
      setProfiles([]);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  const remove = async (profile) => {
    try {
      await window.qaflow.session.remove(profile.id);
      toast(`Profile "${profile.name}" deleted.`, 'success');
      load();
    } catch (e) {
      toast(`Failed to delete profile: ${e.message}`, 'error');
    }
  }

  return (
    <>
      <Card
        title={`Credential Profiles (${profiles?.length ?? '…'})`}
        icon={KeyRound}
        action={
          <Button size="sm" onClick={() => setModalOpen(true)}>
            <Plus className="h-4 w-4" /> New Profile
          </Button>
        }
      >
        <p className="mt-1 text-xs text-muted-foreground">
          <ShieldCheck className="mr-1 inline h-3.5 w-3.5" />
          Secrets are encrypted on the device that captured them — profiles are listed workspace-wide, but each machine can only run with sessions it captured itself.
        </p>
        <div className="mt-3 flex flex-col divide-y divide-border">
          {profiles && profiles.length === 0 && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No credential profiles for this project yet — create one to run tests behind a login.
            </div>
          )}
          {(profiles || []).map((p) => (
            <div key={p.id} className="flex items-center gap-3 py-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
                <KeyRound className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-foreground">{p.name}</span>
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {p.mode === 'manual' ? 'Manual' : 'Session'}
                  </span>
                  {p.environment && <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">{p.environment}</span>}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {p.username || 'no username'} · last used {p.lastUsedAt ? timeAgo(p.lastUsedAt) : 'never'}
                </div>
              </div>
              <button
                onClick={() => setDeleteTarget(p)}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-danger-bg hover:text-danger"
                title="Delete profile"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </Card>

      <CredentialModal open={modalOpen} onClose={() => setModalOpen(false)} projects={projects} defaultProjectId={project.id} onSaved={load} />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={`Delete "${deleteTarget?.name}"?`}
        description="This removes the stored session. Any suite runs that rely on it will need a new credential profile."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => remove(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
      />
    </>
  );
}

// ---- Activity tab ----
const ActivityTab = ({ project, projectSuites, projectRuns, tickets }) => {
  const events = useMemo(() => {
    const runEvents = projectRuns.map((r) => ({
      key: `run-${r.runId}`,
      icon: r.status === 'failed' ? XCircle : CheckCircle2,
      tone: r.status === 'failed' ? 'text-danger bg-danger-bg' : 'text-success bg-success-bg',
      title: `Run ${r.status === 'failed' ? 'failed' : 'passed'} — ${r.suiteName}`,
      subtitle: `${r.environment || '—'} · triggered by ${r.triggeredBy || 'manual'}`,
      at: r.startedAt,
      href: `#/runs/${r.runId}`,
    }));
    const suiteEvents = projectSuites.map((s) => ({
      key: `suite-${s.id}`,
      icon: ListChecks,
      tone: 'text-primary bg-accent',
      title: `Suite added — ${s.name}`,
      subtitle: `${(s.steps || []).length} steps`,
      at: s.createdAt,
      href: `#/suites/${s.id}`,
    }));
    const ticketEvents = (tickets || [])
      .filter((t) => t.projectId === project.id)
      .map((t) => ({
        key: `ticket-${t.id}`,
        icon: AlertTriangle,
        tone: 'text-warning bg-warning-bg',
        title: `Ticket ${t.id} — ${t.title}`,
        subtitle: `${t.severity} · ${t.status.replace('_', ' ')}`,
        at: t.createdAt,
        href: `#/kanban/${t.id}`,
      }));
    return [...runEvents, ...suiteEvents, ...ticketEvents]
      .filter((e) => e.at)
      .sort((a, b) => new Date(b.at) - new Date(a.at))
      .slice(0, 30);
  }, [project.id, projectSuites, projectRuns, tickets]);

  return (
    <Card title="Activity" icon={ActivityIcon}>
      <div className="mt-3 flex flex-col">
        {events.length === 0 && <div className="py-8 text-center text-sm text-muted-foreground">Nothing has happened in this project yet.</div>}
        {events.map((e) => {
          const Icon = e.icon;
          return (
            <a key={e.key} href={e.href} className="flex items-start gap-3 rounded-md px-2 py-2.5 hover:bg-secondary/50">
              <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${e.tone}`}>
                <Icon className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">{e.title}</span>
                <span className="block truncate text-xs text-muted-foreground">{e.subtitle}</span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(e.at)}</span>
            </a>
          );
        })}
      </div>
    </Card>
  );
}

// ---- Settings tab ----
const SettingsTab = ({ project, reload }) => {
  const toast = useToast();
  const [form, setForm] = useState({
    name: project.name || '',
    key: project.key || '',
    baseUrl: project.baseUrl || '',
    description: project.description || '',
    defaultEnvironment: project.defaultEnvironment || '',
  });
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    setForm({
      name: project.name || '',
      key: project.key || '',
      baseUrl: project.baseUrl || '',
      description: project.description || '',
      defaultEnvironment: project.defaultEnvironment || '',
    });
  }, [project]);

  const save = async () => {
    if (!form.name.trim() || !form.baseUrl.trim()) {
      toast('Name and base URL are required.', 'warning');
      return;
    }
    setSaving(true);
    try {
      await window.qaflow.projects.save({
        ...project,
        name: form.name.trim(),
        key: form.key.trim().toUpperCase(),
        baseUrl: form.baseUrl.trim(),
        description: form.description,
        defaultEnvironment: form.defaultEnvironment || null,
      });
      toast('Project saved.', 'success');
      reload();
    } catch (e) {
      toast(`Failed to save project: ${e.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  const deleteProject = async () => {
    try {
      await window.qaflow.projects.remove(project.id);
      toast(`Project "${project.name}" deleted.`, 'success');
      navigate('/projects');
      reload();
    } catch (e) {
      toast(`Failed to delete project: ${e.message}`, 'error');
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_320px]">
      <Card title="Project Settings" icon={Pencil}>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ps-name">Name *</Label>
            <Input id="ps-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ps-key">Key</Label>
            <Input id="ps-key" value={form.key} onChange={(e) => setForm((f) => ({ ...f, key: e.target.value.toUpperCase() }))} />
          </div>
          <div className="flex flex-col gap-1.5 md:col-span-2">
            <Label htmlFor="ps-url">Base URL *</Label>
            <Input id="ps-url" value={form.baseUrl} onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ps-env">Default Environment</Label>
            <Select id="ps-env" value={form.defaultEnvironment} onChange={(e) => setForm((f) => ({ ...f, defaultEnvironment: e.target.value }))}>
              <option value="">None</option>
              {(project.environments || []).map((env) => (
                <option key={env.name} value={env.name}>
                  {env.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5 md:col-span-2">
            <Label htmlFor="ps-desc">Description</Label>
            <textarea
              id="ps-desc"
              rows={3}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              placeholder="What this project covers…"
            />
          </div>
        </div>
        <Button className="mt-4" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save Changes'}
        </Button>
      </Card>

      <div className="rounded-xl border border-danger/40 bg-card p-5 shadow-sm">
        <div className="flex items-center gap-2 text-base font-semibold text-danger">
          <AlertTriangle className="h-4 w-4" /> Danger Zone
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Deleting this project removes its suites and runs for everyone in the workspace. This cannot be undone.
        </p>
        <Button variant="destructive" size="sm" className="mt-4" onClick={() => setDeleteOpen(true)}>
          <Trash2 className="h-4 w-4" /> Delete Project
        </Button>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        title={`Delete "${project.name}"?`}
        description="All of this project's suites and runs will be removed for the whole workspace. This cannot be undone."
        confirmLabel="Delete project"
        variant="danger"
        onConfirm={deleteProject}
        onClose={() => setDeleteOpen(false)}
      />
    </div>
  );
}

export const ProjectDetail = ({ id, data, startRun }) => {
  const { projects, suites, runs, tickets, reload } = data;
  const toast = useToast();
  const [tab, setTab] = useState('Overview');
  const [tagDraft, setTagDraft] = useState('');

  const project = projects.find((p) => p.id === id);
  const projectSuites = useMemo(() => suites.filter((s) => s.projectId === id), [suites, id]);
  const projectRuns = useMemo(
    () => runs.filter((r) => r.projectId === id).sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt)),
    [runs, id]
  );
  const runsLast7 = useMemo(() => projectRuns.filter((r) => withinLastDays(r.startedAt, 7)), [projectRuns]);
  const lastRun = projectRuns[0];

  const metrics = useMemo(() => {
    const passed = runsLast7.filter((r) => r.status === 'passed').length;
    const failed = runsLast7.filter((r) => r.status === 'failed').length;
    const skipped = runsLast7.filter((r) => r.status === 'skipped').length;
    const durations = runsLast7
      .filter((r) => r.startedAt && r.finishedAt)
      .map((r) => new Date(r.finishedAt) - new Date(r.startedAt));
    const avgDuration = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : NaN;
    return {
      totalRuns: runsLast7.length,
      passed,
      failed,
      skipped,
      totalSuites: projectSuites.length,
      successRate: successRate(runsLast7),
      avgDuration,
    };
  }, [runsLast7, projectSuites]);

  if (!project) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
        <h2 className="text-lg font-semibold text-foreground">Project not found</h2>
        <p className="text-sm text-muted-foreground">It may have been deleted.</p>
        <Button variant="outline" onClick={() => navigate('/projects')}>
          Back to Projects
        </Button>
      </div>
    );
  }

  const { Icon, colorClass } = projectVisual(project);

  const runFirstSuite = () => {
    if (projectSuites.length === 0) {
      toast('Add a test suite before running tests.', 'info');
      return;
    }
    const suite = projectSuites[0];
    if (startRun) {
      startRun(suite, { environment: project.defaultEnvironment, headless: true });
    }
  }

  const rerun = (run) => {
    const suite = suites.find((s) => s.id === run.suiteId);
    if (!suite) {
      toast('The suite for this run no longer exists.', 'warning');
      return;
    }
    if (startRun) {
      startRun(suite, { environment: run.environment, headless: true });
    }
  }

  const addTag = async () => {
    const tag = tagDraft.trim();
    if (!tag) return;
    const tags = project.tags || [];
    if (tags.includes(tag)) {
      setTagDraft('');
      return;
    }
    await window.qaflow.projects.save({ ...project, tags: [...tags, tag] });
    setTagDraft('');
    reload();
  }

  const removeTag = async (tag) => {
    await window.qaflow.projects.save({ ...project, tags: (project.tags || []).filter((t) => t !== tag) });
    reload();
  }

  return (
    <div className="flex flex-col gap-6 p-8">
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <a href="#/projects" className="hover:text-foreground hover:underline">
          Projects
        </a>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-foreground">{project.name}</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="flex items-start gap-4">
          <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-xl text-white ${colorClass}`}>
            <Icon className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold text-foreground">{project.name}</h1>
              {lastRun && <StatusPill status={lastRun.status} />}
            </div>
            <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
              <span>{project.type || 'Web Application'}</span>
            </div>
            <a
              href={project.baseUrl}
              onClick={(e) => e.preventDefault()}
              className="mt-1 flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              <Link2 className="h-3.5 w-3.5" /> {project.baseUrl}
            </a>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-secondary px-2.5 py-1 font-medium text-muted-foreground">
                {projectSuites.length} Suites
              </span>
              <span className="rounded-full bg-secondary px-2.5 py-1 font-medium text-muted-foreground">
                Last run: {lastRun ? fmtDate(lastRun.startedAt) : 'never'}
              </span>
              <span className="rounded-full bg-secondary px-2.5 py-1 font-medium text-muted-foreground">
                Owner: {data.settings?.userName || 'QA Engineer'}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setTab('Settings')}>
            <Pencil className="h-4 w-4" /> Edit Project
          </Button>
          <Button onClick={runFirstSuite}>
            <Play className="h-4 w-4" /> Run Tests
          </Button>
        </div>
      </div>

      <div className="flex gap-6 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-1 pb-3 text-sm font-medium transition-colors ${
              tab === t ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Environments' && <EnvironmentsTab project={project} reload={reload} />}
      {tab === 'Test Suites' && <SuitesTab project={project} projectSuites={projectSuites} projectRuns={projectRuns} startRun={startRun} />}
      {tab === 'Credentials' && <CredentialsTab project={project} projects={projects} />}
      {tab === 'Activity' && <ActivityTab project={project} projectSuites={projectSuites} projectRuns={projectRuns} tickets={tickets} />}
      {tab === 'Settings' && <SettingsTab project={project} reload={reload} />}

      {tab === 'Overview' && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_320px]">
          <div className="flex flex-col gap-6">
            <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-base font-semibold text-foreground">
                  <Globe className="h-4 w-4 text-muted-foreground" /> Environments
                </div>
                <button onClick={() => setTab('Environments')} className="text-sm font-medium text-primary hover:underline">
                  Manage
                </button>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
                {(project.environments || []).length === 0 && (
                  <p className="text-sm text-muted-foreground md:col-span-3">No environments configured yet — add one in the Environments tab.</p>
                )}
                {(project.environments || []).map((env) => (
                  <div key={env.name} className="rounded-lg border border-border p-4">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 font-medium text-foreground">
                        <span className={`h-2 w-2 rounded-full ${envDotClass(env.name)}`} />
                        {env.name}
                      </span>
                      {project.defaultEnvironment === env.name && (
                        <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-primary">Default</span>
                      )}
                    </div>
                    <div className="mt-3 text-xs text-muted-foreground">Base URL</div>
                    <div className="truncate text-sm text-foreground">{env.baseUrl}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-[260px_1fr]">
              <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
                <div className="flex items-center gap-2 text-base font-semibold text-foreground">
                  <BarChart3 className="h-4 w-4 text-muted-foreground" /> Project Metrics
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">Last 7 days</p>
                <div className="mt-3 divide-y divide-border">
                  <KV label="Total Runs" value={metrics.totalRuns} />
                  <KV label="Passed" value={metrics.passed} />
                  <KV label="Failed" value={metrics.failed} />
                  <KV label="Skipped" value={metrics.skipped} />
                  <KV label="Total Suites" value={metrics.totalSuites} />
                  <KV label="Success Rate" value={`${Math.round(metrics.successRate)}%`} />
                  <KV label="Avg Run Duration" value={Number.isFinite(metrics.avgDuration) ? fmtDuration(metrics.avgDuration) : '—'} />
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card shadow-sm">
                <div className="flex items-center justify-between px-5 py-4">
                  <div className="flex items-center gap-2 text-base font-semibold text-foreground">
                    <Layers className="h-4 w-4 text-muted-foreground" /> Recent Runs
                  </div>
                  <a href="#/runs" className="text-sm font-medium text-primary hover:underline">
                    View all runs
                  </a>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-y border-border text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        <th className="px-5 py-2.5 font-medium">Environment</th>
                        <th className="px-5 py-2.5 font-medium">Status</th>
                        <th className="px-5 py-2.5 font-medium">Started At</th>
                        <th className="px-5 py-2.5 font-medium"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {projectRuns.length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-5 py-8 text-center text-sm text-muted-foreground">
                            No runs yet.
                          </td>
                        </tr>
                      )}
                      {projectRuns.slice(0, 6).map((r) => (
                        <tr
                          key={r.runId}
                          onClick={() => navigate(`/runs/${r.runId}`)}
                          className="cursor-pointer border-b border-border last:border-0 hover:bg-secondary/40"
                        >
                          <td className="px-5 py-3 text-foreground">{r.environment || '—'}</td>
                          <td className="px-5 py-3">
                            <StatusPill status={r.status} />
                          </td>
                          <td className="px-5 py-3 text-muted-foreground">{fmtDate(r.startedAt)}</td>
                          <td className="px-5 py-3 text-right">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                rerun(r);
                              }}
                              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-primary"
                              title="Re-run"
                            >
                              <Play className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-6">
            <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-foreground">Tags</div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {(project.tags || []).map((tag) => (
                  <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground">
                    {tag}
                    <button onClick={() => removeTag(tag)} className="opacity-60 hover:opacity-100">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                <div className="flex items-center gap-1">
                  <Input
                    className="h-7 w-24 text-xs"
                    placeholder="Add tag"
                    value={tagDraft}
                    onChange={(e) => setTagDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addTag();
                      }
                    }}
                  />
                  <button onClick={addTag} className="rounded-full border border-dashed border-primary/40 p-1 text-primary hover:bg-accent">
                    <Plus className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <div className="text-sm font-semibold text-foreground">Project Details</div>
              <div className="mt-1 divide-y divide-border">
                <KV label="Project Type" value={project.type || 'Web Application'} />
                <KV label="Project Key" value={project.key || '—'} />
                <KV label="Created At" value={project.createdAt ? fmtDate(project.createdAt) : '—'} />
                <KV label="Owner" value={data.settings?.userName || 'QA Engineer'} />
                <KV label="ID" value={project.id} mono />
              </div>
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(project.id);
                  toast('Project ID copied.', 'success');
                }}
                className="mt-2 flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
              >
                <Copy className="h-3 w-3" /> Copy ID
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

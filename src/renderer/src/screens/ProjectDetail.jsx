import { useMemo, useState } from 'react';
import { ChevronRight, Link2, Play, Pencil, Plus, X, Globe, Layers, BarChart3, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusPill } from '@/components/StatusPill';
import { projectVisual, envDotClass } from '@/lib/projectVisuals';
import { fmtDate, fmtDuration } from '@/lib/format';
import { withinLastDays, successRate } from '@/lib/stats';
import { navigate } from '@/hooks/useHashRoute';
import { useToast } from '@/lib/toast';

const TABS = ['Overview', 'Environments', 'Test Suites', 'Credentials', 'Activity', 'Settings'];

function KV({ label, value, mono }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`truncate text-right font-medium text-foreground ${mono ? 'font-mono text-xs' : ''}`}>{value}</span>
    </div>
  );
}

export function ProjectDetail({ id, data }) {
  const { projects, suites, runs, reload } = data;
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

  async function runFirstSuite() {
    if (projectSuites.length === 0) {
      toast('Add a test suite before running tests.', 'info');
      return;
    }
    const suite = projectSuites[0];
    toast(`Running "${suite.name}" headless…`, 'info');
    try {
      await window.qaflow.runs.run(suite.id, { environment: project.defaultEnvironment, headless: true });
      toast('Run finished.', 'success');
      reload();
    } catch (e) {
      toast(`Run failed: ${e.message}`, 'error');
    }
  }

  async function rerun(run) {
    toast(`Re-running "${run.suiteName}"…`, 'info');
    try {
      await window.qaflow.runs.run(run.suiteId, { environment: run.environment, headless: true });
      toast('Run finished.', 'success');
      reload();
    } catch (e) {
      toast(`Run failed: ${e.message}`, 'error');
    }
  }

  async function addTag() {
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

  async function removeTag(tag) {
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
          <Button variant="outline" onClick={() => toast('Project detail editing arrives in v2.', 'info')}>
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

      {tab !== 'Overview' ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border p-14 text-center">
          <p className="text-sm text-muted-foreground">The {tab} tab arrives in v2.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_320px]">
          <div className="flex flex-col gap-6">
            <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-base font-semibold text-foreground">
                  <Globe className="h-4 w-4 text-muted-foreground" /> Environments
                </div>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
                {(project.environments || []).length === 0 && (
                  <p className="text-sm text-muted-foreground md:col-span-3">No environments configured yet — add one from the Projects screen.</p>
                )}
                {(project.environments || []).map((env) => (
                  <div key={env.name} className="rounded-lg border border-border p-4">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 font-medium text-foreground">
                        <span className={`h-2 w-2 rounded-full ${envDotClass(env.name)}`} />
                        {env.name}
                      </span>
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

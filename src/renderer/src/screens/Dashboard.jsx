import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Folder,
  Play,
  CheckCircle2,
  XCircle,
  Briefcase,
  Plus,
  Layers,
  Calendar,
  Activity as ActivityIcon,
  Link2,
  Circle,
  Save,
  FileText,
  ArrowRight,
  MoreVertical,
  Trash2,
} from 'lucide-react';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { StatCard } from '@/components/StatCard';
import { StatusPill } from '@/components/StatusPill';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { fmtDate, timeAgo, timeUntil } from '@/lib/format';
import { withinLastDays, withinPriorWindow, successRate } from '@/lib/stats';
import { navigate } from '@/hooks/useHashRoute';
import { useToast } from '@/lib/toast';
import { cn } from '@/lib/utils';

const RECURRENCE_LABEL = { once: 'Once', daily: 'Daily', weekly: 'Weekly' };

function ScheduleRow({ schedule, suiteName, onToggle, onDelete, menuOpen, onToggleMenu }) {
  // A lapsed 'once' schedule (fired, nextRunAt cleared to null by the
  // scheduler) can't be meaningfully re-enabled — there's no future
  // occurrence to compute. Recurring schedules with a null/past nextRunAt
  // still toggle on fine; `schedules:save` recomputes nextRunAt on enable.
  const lapsedOnce = !schedule.nextRunAt && schedule.recurrence === 'once';
  const statusLabel = lapsedOnce ? 'Completed' : schedule.enabled ? timeUntil(schedule.nextRunAt) : 'Paused';

  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">{suiteName}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>{statusLabel}</span>
          <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {RECURRENCE_LABEL[schedule.recurrence] || schedule.recurrence}
          </span>
        </div>
      </div>
      <button
        role="switch"
        aria-checked={schedule.enabled}
        disabled={lapsedOnce}
        onClick={() => onToggle(schedule)}
        title={lapsedOnce ? 'This one-time run already fired — schedule a new run to run it again.' : schedule.enabled ? 'Disable' : 'Enable'}
        className={cn(
          'relative h-5 w-9 shrink-0 rounded-full transition-colors',
          schedule.enabled ? 'bg-primary' : 'bg-secondary',
          lapsedOnce && 'cursor-not-allowed opacity-40'
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
            schedule.enabled ? 'translate-x-4' : 'translate-x-0.5'
          )}
        />
      </button>
      <div className="relative shrink-0">
        <button
          onClick={() => onToggleMenu(schedule.id)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
        >
          <MoreVertical className="h-3.5 w-3.5" />
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-8 z-20 w-32 rounded-md border border-border bg-card py-1 shadow-lg">
            <button
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-danger hover:bg-danger-bg"
              onClick={() => onDelete(schedule)}
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const QUICK_STEPS = [
  { n: 1, title: 'Connect', body: 'Connect to your application or API', icon: Link2, color: 'bg-blue-50 text-blue-600' },
  { n: 2, title: 'Record', body: 'Capture user flows and interactions', icon: Circle, color: 'bg-red-50 text-red-600' },
  { n: 3, title: 'Save', body: 'Save your test suite and test data', icon: Save, color: 'bg-emerald-50 text-emerald-600' },
  { n: 4, title: 'Run', body: 'Run tests on your environment', icon: Play, color: 'bg-violet-50 text-violet-600' },
  { n: 5, title: 'Review', body: 'Review results and evidence', icon: FileText, color: 'bg-cyan-50 text-cyan-600' },
  { n: 6, title: 'Report', body: 'Generate reports and share insights', icon: FileText, color: 'bg-amber-50 text-amber-600' },
];

function runShortId(run) {
  // runIds are `run-<timestamp>-<hex>` — show a short numeric-looking tail
  // that reads like the mockup's "#128" without inventing a fake counter.
  const tail = run.runId.split('-').pop();
  return `#${tail.slice(0, 4).toUpperCase()}`;
}

export function Dashboard({ data, onNewProject }) {
  const { projects, suites, runs, reload } = data;
  const toast = useToast();
  const [projectFilter, setProjectFilter] = useState('all');
  const [schedules, setSchedules] = useState([]);
  const [scheduleMenuId, setScheduleMenuId] = useState(null);
  const [scheduleDeleteTarget, setScheduleDeleteTarget] = useState(null);

  const loadSchedules = useCallback(async () => {
    const list = await window.qaflow.schedules.list();
    setSchedules(list || []);
  }, []);

  useEffect(() => {
    loadSchedules();
  }, [loadSchedules]);

  useEffect(() => {
    const unsubscribe = window.qaflow.on('schedules:fired', ({ schedule, status }) => {
      toast(`Scheduled run ${schedule.name}: ${status === 'passed' ? 'passed' : 'failed'}`, status === 'passed' ? 'success' : 'error');
      loadSchedules();
      reload();
    });
    return unsubscribe;
  }, [toast, loadSchedules, reload]);

  // `store.listSchedules()` already sorts ascending by nextRunAt with nulls
  // last, so lapsed/completed schedules (nextRunAt: null) sink to the
  // bottom instead of disappearing — they still need to show up here so
  // they can be deleted (or, for daily/weekly, re-enabled).
  const upcomingSchedules = useMemo(() => schedules.slice(0, 5), [schedules]);

  const suiteNamesById = useMemo(() => Object.fromEntries(suites.map((s) => [s.id, s.name])), [suites]);

  async function toggleSchedule(schedule) {
    try {
      await window.qaflow.schedules.save({ ...schedule, enabled: !schedule.enabled });
      loadSchedules();
    } catch (e) {
      toast(`Failed to update schedule: ${e.message}`, 'error');
    }
  }

  async function deleteSchedule(schedule) {
    try {
      await window.qaflow.schedules.remove(schedule.id);
      toast(`Schedule for "${schedule.name}" deleted.`, 'success');
      loadSchedules();
    } catch (e) {
      toast(`Failed to delete schedule: ${e.message}`, 'error');
    }
  }

  const filteredRuns = useMemo(
    () => (projectFilter === 'all' ? runs : runs.filter((r) => r.projectId === projectFilter)),
    [runs, projectFilter]
  );

  const stats = useMemo(() => {
    const suitesThisWeek = suites.filter((s) => withinLastDays(s.createdAt, 7)).length;
    const runsThisWeek = filteredRuns.filter((r) => withinLastDays(r.startedAt, 7)).length;

    const runsLast7 = filteredRuns.filter((r) => withinLastDays(r.startedAt, 7));
    const runsPrior7 = filteredRuns.filter((r) => withinPriorWindow(r.startedAt, 7));
    const rateNow = successRate(runsLast7.length ? runsLast7 : filteredRuns);
    const ratePrior = successRate(runsPrior7);
    const rateDelta = runsPrior7.length ? rateNow - ratePrior : 0;

    const failedTotal = filteredRuns.filter((r) => r.status === 'failed').length;
    const failedLast7 = runsLast7.filter((r) => r.status === 'failed').length;
    const failedPrior7 = runsPrior7.filter((r) => r.status === 'failed').length;
    const failedDelta = failedLast7 - failedPrior7;

    const projectsThisWeek = projects.filter((p) => withinLastDays(p.createdAt, 7)).length;

    return {
      totalSuites: suites.length,
      suitesThisWeek,
      totalRuns: filteredRuns.length,
      runsThisWeek,
      successRate: successRate(filteredRuns),
      rateDelta,
      failedTotal,
      failedDelta,
      activeProjects: projects.length,
      projectsThisWeek,
    };
  }, [suites, filteredRuns, projects]);

  const recentRuns = useMemo(
    () => [...filteredRuns].sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt)).slice(0, 5),
    [filteredRuns]
  );

  const projectsById = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p])), [projects]);

  const projectsOverview = useMemo(() => {
    return projects.map((p) => {
      const projectRuns = runs.filter((r) => r.projectId === p.id);
      const last7 = projectRuns.filter((r) => withinLastDays(r.startedAt, 7));
      const lastRun = [...projectRuns].sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))[0];
      return {
        project: p,
        suiteCount: suites.filter((s) => s.projectId === p.id).length,
        runsLast7: last7.length,
        successRate: successRate(projectRuns),
        lastRun,
      };
    });
  }, [projects, runs, suites]);

  const activity = useMemo(() => {
    const runEvents = filteredRuns.map((r) => ({
      key: `run-${r.runId}`,
      icon: r.status === 'failed' ? XCircle : CheckCircle2,
      tone: r.status === 'failed' ? 'text-danger bg-danger-bg' : 'text-success bg-success-bg',
      title: `${runShortId(r)} ${r.status === 'failed' ? 'failed' : 'completed'}`,
      subtitle: `${r.suiteName} on ${projectsById[r.projectId]?.name || 'Unknown project'}`,
      at: r.startedAt,
    }));
    const suiteEvents = suites.map((s) => ({
      key: `suite-${s.id}`,
      icon: Plus,
      tone: 'text-primary bg-accent',
      title: 'New suite added',
      subtitle: `${s.name} in ${projectsById[s.projectId]?.name || 'Unknown project'}`,
      at: s.createdAt,
    }));
    return [...runEvents, ...suiteEvents]
      .filter((e) => e.at)
      .sort((a, b) => new Date(b.at) - new Date(a.at))
      .slice(0, 6);
  }, [filteredRuns, suites, projectsById]);

  function handleNewRun() {
    navigate('/suites');
  }

  return (
    <div className="flex flex-col gap-6 p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">Welcome back! Here's what's happening with your test automation.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-52">
            <Select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
              <option value="all">All Projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
          <Button variant="outline" onClick={onNewProject}>
            <Plus className="h-4 w-4" /> New Project
          </Button>
          <Button onClick={handleNewRun}>
            <Play className="h-4 w-4" /> New Run
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        <StatCard
          label="Total Suites"
          value={stats.totalSuites}
          icon={Layers}
          iconClass="bg-blue-50 text-blue-600"
          delta={`${stats.suitesThisWeek} this week`}
        />
        <StatCard
          label="Total Runs"
          value={stats.totalRuns}
          icon={Play}
          iconClass="bg-emerald-50 text-emerald-600"
          delta={`${stats.runsThisWeek} this week`}
        />
        <StatCard
          label="Success Rate"
          value={`${Math.round(stats.successRate)}%`}
          progress={stats.successRate}
          delta={`${Math.abs(Math.round(stats.rateDelta))}% vs last 7 days`}
          deltaArrow={stats.rateDelta < 0 ? 'down' : 'up'}
          deltaTone={stats.rateDelta < 0 ? 'bad' : 'good'}
        />
        <StatCard
          label="Failed Runs"
          value={stats.failedTotal}
          icon={XCircle}
          iconClass="bg-red-50 text-red-600"
          delta={`${Math.abs(stats.failedDelta)} vs last 7 days`}
          deltaArrow={stats.failedDelta > 0 ? 'up' : 'down'}
          deltaTone={stats.failedDelta > 0 ? 'bad' : 'good'}
        />
        <StatCard
          label="Active Projects"
          value={stats.activeProjects}
          icon={Briefcase}
          iconClass="bg-violet-50 text-violet-600"
          delta={`${stats.projectsThisWeek} this week`}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_380px]">
        <div className="flex flex-col gap-6">
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
                    <th className="px-5 py-2.5 font-medium">Run</th>
                    <th className="px-5 py-2.5 font-medium">Project</th>
                    <th className="px-5 py-2.5 font-medium">Suite</th>
                    <th className="px-5 py-2.5 font-medium">Environment</th>
                    <th className="px-5 py-2.5 font-medium">Status</th>
                    <th className="px-5 py-2.5 font-medium">Started At</th>
                  </tr>
                </thead>
                <tbody>
                  {recentRuns.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-5 py-8 text-center text-sm text-muted-foreground">
                        No runs yet — run a suite to see it here.
                      </td>
                    </tr>
                  )}
                  {recentRuns.map((r) => (
                    <tr
                      key={r.runId}
                      onClick={() => navigate(`/runs/${r.runId}`)}
                      className="cursor-pointer border-b border-border last:border-0 hover:bg-secondary/40"
                    >
                      <td className="flex items-center gap-2 px-5 py-3 font-medium text-foreground">
                        <Play className="h-3.5 w-3.5 text-primary" /> {runShortId(r)}
                      </td>
                      <td className="px-5 py-3 text-foreground">{projectsById[r.projectId]?.name || '—'}</td>
                      <td className="px-5 py-3 text-muted-foreground">{r.suiteName}</td>
                      <td className="px-5 py-3 text-muted-foreground">{r.environment || '—'}</td>
                      <td className="px-5 py-3">
                        <StatusPill status={r.status} />
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">{fmtDate(r.startedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-border px-5 py-3 text-center">
              <a href="#/runs" className="text-sm font-medium text-primary hover:underline">
                View all runs
              </a>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card shadow-sm">
            <div className="flex items-center justify-between px-5 py-4">
              <div className="flex items-center gap-2 text-base font-semibold text-foreground">
                <Layers className="h-4 w-4 text-muted-foreground" /> Projects Overview
              </div>
              <a href="#/projects" className="text-sm font-medium text-primary hover:underline">
                View all projects
              </a>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-y border-border text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <th className="px-5 py-2.5 font-medium">Project</th>
                    <th className="px-5 py-2.5 font-medium">Suites</th>
                    <th className="px-5 py-2.5 font-medium">Runs (7d)</th>
                    <th className="px-5 py-2.5 font-medium">Success Rate</th>
                    <th className="px-5 py-2.5 font-medium">Last Run</th>
                  </tr>
                </thead>
                <tbody>
                  {projectsOverview.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-5 py-8 text-center text-sm text-muted-foreground">
                        No projects yet — create one to get started.
                      </td>
                    </tr>
                  )}
                  {projectsOverview.map(({ project, suiteCount, runsLast7, successRate: rate, lastRun }) => (
                    <tr
                      key={project.id}
                      onClick={() => navigate(`/projects/${project.id}`)}
                      className="cursor-pointer border-b border-border last:border-0 hover:bg-secondary/40"
                    >
                      <td className="flex items-center gap-2 px-5 py-3 font-medium text-foreground">
                        <Folder className="h-3.5 w-3.5 text-primary" /> {project.name}
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">{suiteCount}</td>
                      <td className="px-5 py-3 text-muted-foreground">{runsLast7}</td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <span className="w-9 text-xs font-medium text-foreground">{Math.round(rate)}%</span>
                          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-secondary">
                            <div className="h-full rounded-full bg-success" style={{ width: `${Math.max(0, Math.min(100, rate))}%` }} />
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">{lastRun ? fmtDate(lastRun.startedAt) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-base font-semibold text-foreground">
                <Calendar className="h-4 w-4 text-muted-foreground" /> Scheduled Runs
              </div>
              <a href="#/runs" className="text-sm font-medium text-primary hover:underline">
                View calendar
              </a>
            </div>
            {upcomingSchedules.length === 0 ? (
              <div className="mt-6 flex flex-col items-center gap-2 py-6 text-center">
                <Calendar className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">No scheduled runs yet</p>
              </div>
            ) : (
              <div className="mt-2 flex flex-col divide-y divide-border">
                {upcomingSchedules.map((s) => (
                  <ScheduleRow
                    key={s.id}
                    schedule={s}
                    suiteName={s.name || suiteNamesById[s.suiteId] || 'Unknown suite'}
                    onToggle={toggleSchedule}
                    onDelete={(sched) => {
                      setScheduleMenuId(null);
                      setScheduleDeleteTarget(sched);
                    }}
                    menuOpen={scheduleMenuId === s.id}
                    onToggleMenu={(id) => setScheduleMenuId(scheduleMenuId === id ? null : id)}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-2 text-base font-semibold text-foreground">
              <ActivityIcon className="h-4 w-4 text-muted-foreground" /> Activity Feed
            </div>
            <div className="mt-4 flex flex-col gap-4">
              {activity.length === 0 && <p className="text-sm text-muted-foreground">No activity yet.</p>}
              {activity.map((a) => {
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
                    <div className="shrink-0 text-xs text-muted-foreground">{timeAgo(a.at)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <h2 className="text-base font-semibold text-foreground">Quick Workflow</h2>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
          {QUICK_STEPS.map((step, i) => {
            const Icon = step.icon;
            return (
              <div key={step.n} className="relative flex flex-col gap-2 rounded-lg border border-border p-4">
                <div className="flex items-center gap-2">
                  <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${step.color}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <span className="text-sm font-semibold text-foreground">
                    {step.n} {step.title}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{step.body}</p>
                {i < QUICK_STEPS.length - 1 && (
                  <ArrowRight className="absolute -right-2.5 top-1/2 hidden h-4 w-4 -translate-y-1/2 text-muted-foreground/40 lg:block" />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(scheduleDeleteTarget)}
        title={`Delete schedule for "${scheduleDeleteTarget?.name}"?`}
        description="This removes the scheduled run. It won't affect any runs that already happened."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => scheduleDeleteTarget && deleteSchedule(scheduleDeleteTarget)}
        onClose={() => setScheduleDeleteTarget(null)}
      />
    </div>
  );
}

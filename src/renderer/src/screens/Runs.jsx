import { useMemo, useState } from 'react';
import { Search, Play, FolderOpen, FileText, ListChecks } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { StatusPill } from '@/components/StatusPill';
import { fmtDate, fmtDuration } from '@/lib/format';
import { shortRunId } from '@/lib/media';
import { navigate } from '@/hooks/useHashRoute';
import { useToast } from '@/lib/toast';

// `#/runs` — table of every run across all projects/suites. Live progress
// for the in-flight run is handled by App.jsx's fixed RunProgressBanner, not
// here — this screen only ever shows runs that have already produced a
// report.json.
const STATUS_FILTERS = [
  { key: 'all', label: 'All Status' },
  { key: 'passed', label: 'Passed' },
  { key: 'failed', label: 'Failed' },
];

function runDuration(run) {
  if (!run.finishedAt || !run.startedAt) return null;
  return new Date(run.finishedAt) - new Date(run.startedAt);
}

export function Runs({ data, startRun }) {
  const { projects, suites, runs } = data;
  const toast = useToast();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [projectFilter, setProjectFilter] = useState('all');

  const projectsById = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p])), [projects]);
  const suitesById = useMemo(() => Object.fromEntries(suites.map((s) => [s.id, s])), [suites]);

  const filteredRuns = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...runs]
      .filter((r) => statusFilter === 'all' || r.status === statusFilter)
      .filter((r) => projectFilter === 'all' || r.projectId === projectFilter)
      .filter((r) => !q || r.suiteName?.toLowerCase().includes(q) || r.runId.toLowerCase().includes(q))
      .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
  }, [runs, search, statusFilter, projectFilter]);

  function rerun(run) {
    const suite = suitesById[run.suiteId];
    if (!suite) {
      toast('The suite for this run no longer exists.', 'error');
      return;
    }
    startRun(suite, { environment: run.environment, headless: true });
  }

  async function openDir(run) {
    try {
      await window.qaflow.runs.openDir(run.runId);
    } catch (e) {
      toast(`Failed to open run folder: ${e.message}`, 'error');
    }
  }

  return (
    <div className="flex flex-col gap-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Runs</h1>
        <p className="mt-1 text-sm text-muted-foreground">Run history across every project and suite.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search by suite or run id..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select className="w-48" value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
          <option value="all">All Projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Select className="w-40" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          {STATUS_FILTERS.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </Select>
      </div>

      <div className="rounded-xl border border-border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-2.5 font-medium">Run</th>
                <th className="px-5 py-2.5 font-medium">Project</th>
                <th className="px-5 py-2.5 font-medium">Suite</th>
                <th className="px-5 py-2.5 font-medium">Environment</th>
                <th className="px-5 py-2.5 font-medium">Status</th>
                <th className="px-5 py-2.5 font-medium">Started</th>
                <th className="px-5 py-2.5 font-medium">Duration</th>
                <th className="px-5 py-2.5 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {filteredRuns.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-10 text-center text-sm text-muted-foreground">
                    {runs.length === 0 ? 'No runs yet — run a suite from Test Suites to see it here.' : 'No runs match this filter.'}
                  </td>
                </tr>
              )}
              {filteredRuns.map((r) => (
                <tr key={r.runId} onClick={() => navigate(`/runs/${r.runId}`)} className="cursor-pointer border-b border-border last:border-0 hover:bg-secondary/40">
                  <td className="px-5 py-3 font-medium text-foreground">{shortRunId(r.runId)}</td>
                  <td className="px-5 py-3 text-foreground">{projectsById[r.projectId]?.name || 'Unknown'}</td>
                  <td className="px-5 py-3 text-muted-foreground">{r.suiteName}</td>
                  <td className="px-5 py-3 text-muted-foreground">{r.environment || '—'}</td>
                  <td className="px-5 py-3">
                    <StatusPill status={r.status} />
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{fmtDate(r.startedAt)}</td>
                  <td className="px-5 py-3 text-muted-foreground">{fmtDuration(runDuration(r))}</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => navigate(`/runs/${r.runId}`)} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-primary" title="View">
                        <ListChecks className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => rerun(r)} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-primary" title="Re-run">
                        <Play className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => navigate(`/runs/${r.runId}/report`)} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-primary" title="Build Report">
                        <FileText className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => openDir(r)} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-primary" title="Open Folder">
                        <FolderOpen className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

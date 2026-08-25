import { useMemo } from 'react';
import { FileBarChart2, FileText, Braces, FileSpreadsheet, Archive } from 'lucide-react';
import { StatusPill } from '@/components/StatusPill';
import { fmtDate } from '@/lib/format';
import { shortRunId } from '@/lib/media';
import { withinLastDays } from '@/lib/stats';
import { navigate } from '@/hooks/useHashRoute';
import { useToast } from '@/lib/toast';

// `#/reports` — every run that has report work started on it (a non-null
// `reportSelection`, written the moment a tester opens Build Report and
// touches the media grid or notes). Rows are actionable exports so a tester
// can go straight from here to a finished file without reopening the run.
// A run with no `reportSelection` never appears — that's what the empty
// state below points at.

// `run.reportSelection` doesn't carry its own timestamp (only the run
// itself does) — `finishedAt` falling back to `startedAt` is the closest
// proxy for "when this run's report was last touched".
function lastUpdated(run) {
  return run.finishedAt || run.startedAt;
}

export function Reports({ data }) {
  const { projects, runs } = data;
  const toast = useToast();

  const projectsById = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p])), [projects]);

  const reportRuns = useMemo(
    () => runs.filter((r) => r.reportSelection).sort((a, b) => new Date(lastUpdated(b)) - new Date(lastUpdated(a))),
    [runs]
  );

  const stats = useMemo(() => {
    const thisWeek = reportRuns.filter((r) => withinLastDays(lastUpdated(r), 7)).length;
    return { total: reportRuns.length, thisWeek };
  }, [reportRuns]);

  async function exportJson(run) {
    try {
      const filePath = await window.qaflow.reports.exportJson(run.runId);
      if (filePath) toast(`JSON report saved to ${filePath}`, 'success');
    } catch (e) {
      toast(`Failed to export JSON: ${e.message}`, 'error');
    }
  }

  async function exportExcel(run) {
    try {
      const filePath = await window.qaflow.reports.exportExcel(run.runId);
      if (filePath) toast(`Excel report saved to ${filePath}`, 'success');
    } catch (e) {
      toast(`Failed to export Excel: ${e.message}`, 'error');
    }
  }

  async function zipBundle(run) {
    try {
      const zipPath = await window.qaflow.reports.bundle(run.runId);
      if (!zipPath) return;
      await window.qaflow.app.revealPath(zipPath);
      toast('Bundle ready to send.', 'success');
    } catch (e) {
      toast(`Failed to build bundle: ${e.message}`, 'error');
    }
  }

  return (
    <div className="flex flex-col gap-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Reports</h1>
        <p className="mt-1 text-sm text-muted-foreground">Every run with a report in progress or ready to export.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 shadow-sm">
          <FileBarChart2 className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Total reports</span>
          <span className="text-sm font-semibold text-foreground">{stats.total}</span>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 shadow-sm">
          <FileBarChart2 className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">This week</span>
          <span className="text-sm font-semibold text-foreground">{stats.thisWeek}</span>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-2.5 font-medium">Run</th>
                <th className="px-5 py-2.5 font-medium">Suite</th>
                <th className="px-5 py-2.5 font-medium">Project</th>
                <th className="px-5 py-2.5 font-medium">Status</th>
                <th className="px-5 py-2.5 font-medium">Selected Media</th>
                <th className="px-5 py-2.5 font-medium">Notes</th>
                <th className="px-5 py-2.5 font-medium">Last Updated</th>
                <th className="px-5 py-2.5 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {reportRuns.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-10 text-center text-sm text-muted-foreground">
                    No reports yet — open a run from Runs and click Build Report to start one.
                  </td>
                </tr>
              )}
              {reportRuns.map((r) => {
                const notesCount = Object.values(r.reportSelection?.notes || {}).filter((n) => n && n.trim()).length;
                const selectedCount = r.reportSelection?.selectedMediaIds?.length || 0;
                return (
                  <tr
                    key={r.runId}
                    onClick={() => navigate(`/runs/${r.runId}/report`)}
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-secondary/40"
                  >
                    <td className="px-5 py-3 font-medium text-foreground">{shortRunId(r.runId)}</td>
                    <td className="px-5 py-3 text-muted-foreground">{r.suiteName}</td>
                    <td className="px-5 py-3 text-foreground">{projectsById[r.projectId]?.name || 'Unknown'}</td>
                    <td className="px-5 py-3">
                      <StatusPill status={r.status} />
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">
                      {selectedCount} / {r.capturedMedia?.length || 0}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{notesCount}</td>
                    <td className="px-5 py-3 text-muted-foreground">{fmtDate(lastUpdated(r))}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => navigate(`/runs/${r.runId}/report`)}
                          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-primary"
                          title="Open builder"
                        >
                          <FileText className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => exportExcel(r)}
                          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-primary"
                          title="Export Excel"
                        >
                          <FileSpreadsheet className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => exportJson(r)}
                          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-primary"
                          title="Export JSON"
                        >
                          <Braces className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => zipBundle(r)}
                          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-primary"
                          title="Zip Bundle"
                        >
                          <Archive className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

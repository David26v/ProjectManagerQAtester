import { CheckCircle2, XCircle, FileText, Eye } from 'lucide-react';
import { Dialog, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { navigate } from '@/hooks/useHashRoute';

const durationSeconds = (report) => {
  const start = new Date(report.startedAt).getTime();
  const end = new Date(report.finishedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.round((end - start) / 1000);
}

// Shown by App.jsx's run manager the moment a manual run finishes — a
// richer landing than the old toast-plus-auto-navigate: the tester sees the
// verdict and step tally at a glance and chooses where to go next (details
// vs. straight into the report builder for a failure) instead of being
// teleported.
export const RunCompletionModal = ({ report, onClose }) => {
  if (!report) return null;

  const failed = report.status === 'failed';
  const steps = report.steps || [];
  const passedCount = steps.filter((s) => s.status === 'passed').length;
  const failedSteps = steps.filter((s) => s.status === 'failed');
  const skippedCount = steps.filter((s) => s.status === 'skipped').length;
  const seconds = durationSeconds(report);
  const consoleCount = (report.consoleErrors || []).length;
  const networkCount = (report.networkFailures || []).length;

  const go = (path) => {
    onClose();
    navigate(path);
  }

  return (
    <Dialog open onClose={onClose} className="max-w-md">
      <div className="flex items-start justify-between p-5 pb-0">
        <div className="flex items-start gap-3">
          <div
            className={
              failed
                ? 'flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-danger-bg text-danger'
                : 'flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-success-bg text-success'
            }
          >
            {failed ? <XCircle className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}
          </div>
          <div>
            <h3 className="text-base font-semibold text-foreground">
              {failed ? 'Run failed' : 'Run passed'}
            </h3>
            <p className="mt-0.5 text-sm text-muted-foreground">{report.suiteName}</p>
          </div>
        </div>
        <DialogClose onClick={onClose} />
      </div>

      <div className="grid grid-cols-3 gap-2 p-5">
        <div className="rounded-lg bg-secondary/60 px-3 py-2 text-center">
          <div className="text-lg font-semibold text-success">{passedCount}</div>
          <div className="text-xs text-muted-foreground">Passed</div>
        </div>
        <div className="rounded-lg bg-secondary/60 px-3 py-2 text-center">
          <div className={failedSteps.length ? 'text-lg font-semibold text-danger' : 'text-lg font-semibold text-foreground'}>
            {failedSteps.length}
          </div>
          <div className="text-xs text-muted-foreground">Failed</div>
        </div>
        <div className="rounded-lg bg-secondary/60 px-3 py-2 text-center">
          <div className="text-lg font-semibold text-foreground">{skippedCount}</div>
          <div className="text-xs text-muted-foreground">Skipped</div>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 px-5 pb-4 text-sm">
        {failedSteps[0] && (
          <div className="rounded-md border border-danger/30 bg-danger-bg/60 px-3 py-2">
            <div className="text-xs font-medium text-danger">Failed at: {failedSteps[0].name}</div>
            {failedSteps[0].error && (
              <div className="mt-0.5 line-clamp-2 font-mono text-xs text-muted-foreground">{failedSteps[0].error}</div>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {seconds != null && <span>Duration: {seconds}s</span>}
          <span>Console errors: {consoleCount}</span>
          <span>Network failures: {networkCount}</span>
          {report.attempts > 1 && <span>Attempts: {report.attempts}</span>}
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t border-border bg-secondary/40 px-5 py-3">
        <Button variant="outline" size="sm" onClick={onClose}>
          Close
        </Button>
        <Button variant="outline" size="sm" onClick={() => go(`/runs/${report.runId}`)}>
          <Eye className="h-4 w-4" /> View Details
        </Button>
        {failed && (
          <Button size="sm" onClick={() => go(`/runs/${report.runId}/report`)}>
            <FileText className="h-4 w-4" /> Build Report
          </Button>
        )}
      </div>
    </Dialog>
  );
}

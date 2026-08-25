import { Loader2, X } from 'lucide-react';

// Fixed live-progress banner for the run kicked off from Run Suite modal.
// Lives at the App shell level (not the Runs screen, which is still a
// placeholder) so it survives the modal closing and the navigate("#/runs")
// that follows it — App.jsx's run manager owns the `run:progress` stream.
export function RunProgressBanner({ run, onDismiss }) {
  if (!run) return null;

  const total = run.totalSteps || 0;
  const done = run.completedSteps || 0;
  const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;

  return (
    <div className="fixed left-1/2 top-4 z-[150] w-[420px] -translate-x-1/2 rounded-lg border border-border bg-card px-4 py-3 shadow-lg">
      <div className="flex items-center gap-3">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-foreground">Running "{run.suiteName}"…</div>
          <div className="truncate text-xs text-muted-foreground">{run.currentStepName || 'Starting…'}</div>
        </div>
        <button onClick={onDismiss} className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent" title="Hide">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

import { useState } from 'react';
import { Loader2, X, ChevronDown, ChevronUp, MonitorPlay } from 'lucide-react';
import { cn } from '@/lib/utils';

// Floating live-run panel (bottom-right) for the run kicked off from the
// Run Suite modal. Lives at the App shell level so it survives the modal
// closing and any navigation — App.jsx's run manager owns the
// `run:progress` stream and feeds it the latest preview frame the runner
// captures after every step, so the tester literally watches the test
// executing without needing headed mode. Collapsible to a slim bar.
export const RunProgressBanner = ({ run, onDismiss }) => {
  const [expanded, setExpanded] = useState(true);

  if (!run) return null;

  const total = run.totalSteps || 0;
  const done = run.completedSteps || 0;
  const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;

  return (
    <div
      className={cn(
        'fixed bottom-4 right-4 z-[150] overflow-hidden rounded-xl border border-border bg-card shadow-2xl transition-all',
        expanded ? 'w-[420px]' : 'w-[340px]'
      )}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-foreground">Running "{run.suiteName}"…</div>
          <div className="truncate text-xs text-muted-foreground">
            {run.currentStepName || 'Starting…'}
            {total > 0 && ` · ${Math.min(done, total)}/${total}`}
          </div>
        </div>
        <button
          onClick={() => setExpanded((e) => !e)}
          className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent"
          title={expanded ? 'Collapse live view' : 'Expand live view'}
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
        </button>
        <button onClick={onDismiss} className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent" title="Hide">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="h-1.5 w-full overflow-hidden bg-secondary">
        <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>

      {expanded && (
        <div className="relative aspect-[16/10] w-full bg-secondary/60">
          {run.previewFrame ? (
            <img src={run.previewFrame} alt="Live view of the running test" className="h-full w-full object-contain" />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
              <MonitorPlay className="h-6 w-6" />
              <span className="text-xs">Live view appears after the first step…</span>
            </div>
          )}
          <span className="absolute bottom-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white">
            LIVE
          </span>
        </div>
      )}
    </div>
  );
};

import { cn } from '@/lib/utils';

// Status vocabulary spans runs (passed/failed/skipped/running), environment
// connections (connected/not connected) and tickets (open/etc.) — one pill
// covers all of it since they share the same pass/fail/neutral palette.
const STYLES = {
  passed: 'bg-success-bg text-success',
  connected: 'bg-success-bg text-success',
  scheduled: 'bg-success-bg text-success',
  done: 'bg-success-bg text-success',
  failed: 'bg-danger-bg text-danger',
  blocked: 'bg-danger-bg text-danger',
  skipped: 'bg-warning-bg text-amber-800',
  running: 'bg-accent text-accent-foreground',
  in_progress: 'bg-accent text-accent-foreground',
  ready: 'bg-accent text-accent-foreground',
  backlog: 'bg-secondary text-muted-foreground',
  'not connected': 'bg-secondary text-muted-foreground',
};

// `label` overrides the auto-capitalized text shown for `status` — needed
// for keys like `in_progress`/`ready` (kanban ticket statuses) whose display
// text ("In Progress", "Ready for QA") doesn't just capitalize the key.
export function StatusPill({ status, label, className }) {
  const key = String(status || '').toLowerCase();
  const style = STYLES[key] || 'bg-secondary text-muted-foreground';
  const text = label || (status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unknown');
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', style, className)}>
      {text}
    </span>
  );
}

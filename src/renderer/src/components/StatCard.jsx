import { ArrowUp, ArrowDown } from 'lucide-react';
import { cn } from '@/lib/utils';

// Dashboard stat card — icon chip, big number, optional progress bar
// (Success Rate), optional delta line ("↑ 4 this week").
export function StatCard({ label, value, icon: Icon, iconClass, delta, deltaArrow = 'up', deltaTone = 'good', progress }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <div className="text-sm font-medium text-muted-foreground">{label}</div>
        {Icon && (
          <div className={cn('flex h-9 w-9 items-center justify-center rounded-lg', iconClass)}>
            <Icon className="h-4.5 w-4.5" />
          </div>
        )}
      </div>
      <div className="mt-2 text-3xl font-semibold tracking-tight text-foreground">{value}</div>
      {typeof progress === 'number' && (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
          <div className="h-full rounded-full bg-success" style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
        </div>
      )}
      {delta && (
        <div className={cn('mt-2 flex items-center gap-1 text-xs font-medium', deltaTone === 'bad' ? 'text-danger' : 'text-success')}>
          {deltaArrow === 'down' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />}
          <span className="text-muted-foreground">{delta}</span>
        </div>
      )}
    </div>
  );
}

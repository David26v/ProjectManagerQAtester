import { RefreshCw, X } from 'lucide-react';

// Persistent banner shown once the main process reports `updates:status`
// state `ready` (a downloaded update is staged). Deliberately not a toast —
// toast.jsx auto-dismisses after 4s and this needs to stay put with an
// action button until the user restarts or dismisses it. Bottom-left so it
// never overlaps the toast stack (bottom-right) or the run progress banner
// (top-center).
export function UpdateReadyBanner({ version, onInstall, onDismiss }) {
  if (!version) return null;

  return (
    <div className="fixed bottom-5 left-5 z-[150] w-[360px] rounded-lg border border-primary/30 bg-card px-4 py-3 shadow-lg">
      <div className="flex items-start gap-3">
        <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground">Update v{version} ready</div>
          <div className="text-xs text-muted-foreground">Restart to apply</div>
          <button
            onClick={onInstall}
            className="mt-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
          >
            Restart
          </button>
        </div>
        <button onClick={onDismiss} className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent" title="Dismiss">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

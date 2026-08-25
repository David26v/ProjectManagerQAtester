import { AlertTriangle } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

// Controlled confirm dialog — replaces window.confirm(). Parent owns the
// open/target state; this just renders the prompt and fires onConfirm.
export function ConfirmDialog({ open, title, description, confirmLabel = 'Confirm', variant = 'default', onConfirm, onClose }) {
  return (
    <Dialog open={open} onClose={onClose} className="max-w-sm">
      <div className="flex items-start gap-3 p-5">
        <div
          className={
            variant === 'danger'
              ? 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-danger-bg text-danger'
              : 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground'
          }
        >
          <AlertTriangle className="h-4.5 w-4.5" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-border bg-secondary/40 px-5 py-3">
        <Button variant="outline" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant={variant === 'danger' ? 'destructive' : 'default'}
          size="sm"
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}

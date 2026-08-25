import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

// Hand-vendored modal — no Radix Dialog in this project's dependency set.
// Plain fixed-overlay + portal; covers everything the New Project modal and
// future confirm dialogs need (backdrop click / Escape / focus trap is
// intentionally out of scope for v1 — YAGNI until a screen needs it).
export function Dialog({ open, onClose, children, className }) {
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        className={cn(
          'relative z-10 flex max-h-[90vh] w-full flex-col overflow-hidden rounded-xl bg-card shadow-2xl',
          className
        )}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}

export function DialogClose({ onClick, className }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Close"
      className={cn(
        'shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
        className
      )}
    >
      <X className="h-4.5 w-4.5" />
    </button>
  );
}

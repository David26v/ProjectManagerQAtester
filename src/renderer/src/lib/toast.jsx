import { createContext, useCallback, useContext, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, XCircle, Info, AlertTriangle, X } from 'lucide-react';

// Lightweight shadcn-style toast — a context + fixed portal stack. Avoids
// pulling in `sonner` for four call sites; swap in `sonner` later if the
// toast surface grows real complexity (positioning, promises, undo, ...).

const ToastContext = createContext(null);

const ICONS = { success: CheckCircle2, error: XCircle, info: Info, warning: AlertTriangle };

const STYLES = {
  success: 'border-success/30 bg-success-bg text-success',
  error: 'border-danger/30 bg-danger-bg text-danger',
  info: 'border-primary/30 bg-accent text-accent-foreground',
  warning: 'border-warning/40 bg-warning-bg text-amber-800',
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message, type = 'info') => {
      const id = crypto.randomUUID();
      setToasts((list) => [...list, { id, message, type }]);
      setTimeout(() => dismiss(id), 4000);
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={toast}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed bottom-5 right-5 z-[200] flex w-80 flex-col gap-2">
          {toasts.map((t) => {
            const Icon = ICONS[t.type] || Info;
            return (
              <div
                key={t.id}
                className={`pointer-events-auto flex items-start gap-2.5 rounded-lg border px-4 py-3 text-sm shadow-lg ${STYLES[t.type] || STYLES.info}`}
              >
                <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="flex-1">{t.message}</span>
                <button
                  onClick={() => dismiss(t.id)}
                  className="shrink-0 rounded p-0.5 opacity-60 hover:opacity-100"
                  aria-label="Dismiss"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast() must be called within <ToastProvider>');
  return ctx;
}

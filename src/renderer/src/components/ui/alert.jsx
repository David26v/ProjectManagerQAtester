import * as React from 'react';
import { Info, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

// Vendored by hand, matching button.jsx's pattern — inline banner for
// non-blocking info/success/warning/error messaging (e.g. "Scheduling
// arrives in v2"). Not the toast — this stays visible in the layout. Always
// renders its own leading icon for the variant; pass only the message text
// as children.
const VARIANT_STYLES = {
  info: 'border-primary/30 bg-accent text-accent-foreground [&_svg]:text-primary',
  success: 'border-success/30 bg-success-bg text-success [&_svg]:text-success',
  warning: 'border-warning/40 bg-warning-bg text-amber-800 [&_svg]:text-amber-600',
  error: 'border-danger/30 bg-danger-bg text-danger [&_svg]:text-danger',
};

const VARIANT_ICONS = { info: Info, success: CheckCircle2, warning: AlertTriangle, error: XCircle };

const Alert = React.forwardRef(({ className, variant = 'info', children, ...props }, ref) => {
  const Icon = VARIANT_ICONS[variant] || Info;
  return (
    <div
      ref={ref}
      role="alert"
      className={cn('flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-sm', VARIANT_STYLES[variant] || VARIANT_STYLES.info, className)}
      {...props}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex-1">{children}</div>
    </div>
  );
});
Alert.displayName = 'Alert';

export { Alert };

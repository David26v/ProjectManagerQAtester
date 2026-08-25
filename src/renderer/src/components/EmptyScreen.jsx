import { Sparkles } from 'lucide-react';

// Placeholder for routes not yet implemented (Suites/Runs/Kanban/Reports/
// Credentials/Settings land in later tasks) — keeps nav from 404ing.
export function EmptyScreen({ title, subtitle }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-primary">
        <Sparkles className="h-5 w-5" />
      </div>
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <p className="max-w-sm text-sm text-muted-foreground">{subtitle || 'This screen is coming in a later task.'}</p>
    </div>
  );
}

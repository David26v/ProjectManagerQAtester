import { Building2, ShieldOff, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { VENDOR } from '@/lib/brand';

// Shown INSTEAD of the app shell when the signed-in user has no workspace
// membership ("none") or their workspace is suspended ("suspended").
export const WorkspaceGate = ({ status, kind }) => {
  const suspended = kind === 'suspended';
  const Icon = suspended ? ShieldOff : Building2;
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent text-primary">
          <Icon className="h-6 w-6" />
        </div>
        <h1 className="mt-4 text-lg font-semibold text-foreground">
          {suspended ? 'This workspace is suspended' : "You're not in a workspace yet"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {suspended
            ? `"${status.workspace?.name}" has been suspended. Contact KriJax Software and Development to restore access.`
            : `You're signed in as ${status.email}, but this account isn't a member of any workspace. Ask your administrator to invite you.`}
        </p>
        <Button variant="outline" className="mt-6" onClick={() => window.qaflow.auth.logout()}>
          <LogOut className="h-4 w-4" /> Sign out
        </Button>
        <p className="mt-6 text-xs text-muted-foreground">{VENDOR}</p>
      </div>
    </div>
  );
};

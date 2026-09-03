import { useState } from 'react';
import { LogIn } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useToast } from '@/lib/toast';
import { PRODUCT, VENDOR } from '@/lib/brand';

// Sign-in gate for the shared cloud workspace. Invite-only — Supabase Auth
// errors ("Invalid login credentials") surface as-is; there is deliberately
// no signup or forgot-password link. Rendered by App.jsx INSTEAD of the app
// shell whenever cloud auth is configured and no session is active.
export const Login = ({ onLoggedIn }) => {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      toast('Enter your email and password.', 'warning');
      return;
    }
    setBusy(true);
    try {
      const status = await window.qaflow.auth.login({ email: email.trim(), password });
      onLoggedIn?.(status);
    } catch (err) {
      toast(err.message || 'Sign in failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background">
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl border border-border bg-card p-8 shadow-sm">
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-xl font-bold text-primary-foreground">
            A
          </div>
          <div className="text-center">
            <h1 className="text-lg font-semibold text-foreground">{PRODUCT}</h1>
            <p className="mt-1 text-sm text-muted-foreground">Sign in to your team workspace</p>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="login-email">Email</Label>
            <Input
              id="login-email"
              type="email"
              autoComplete="email"
              autoFocus
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="login-password">Password</Label>
            <Input
              id="login-password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={busy} className="mt-1 w-full">
            <LogIn className="h-4 w-4" /> {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </div>

        <p className="mt-5 text-center text-xs text-muted-foreground">
          Access is invite-only. Ask your workspace owner for an account.
        </p>
        <p className="mt-2 text-center text-[11px] text-muted-foreground/80">{VENDOR}</p>
      </form>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { ShieldCheck, Lock, MonitorSmartphone, FileJson, ShieldAlert, Video, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { Dialog, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { useToast } from '@/lib/toast';
import { cn } from '@/lib/utils';

const TABS = [
  { key: 'capture', label: 'Session Capture' },
  { key: 'manual', label: 'Manual Entry', disabled: true },
  { key: 'security', label: 'Security' },
];

const SECURITY_POINTS = [
  { icon: Lock, title: 'Local-Only Storage', body: 'Credentials are stored only on this device and never synced to the cloud.' },
  { icon: MonitorSmartphone, title: 'OS Credential Store', body: 'Sensitive data is encrypted and stored in your OS credential store.' },
  { icon: FileJson, title: 'No Secrets in Reports', body: 'Credentials, passwords, and tokens are never included in test reports or logs.' },
  { icon: ShieldAlert, title: 'Optional PIN Protection', body: 'Protect this profile with a PIN for an extra layer of security (coming in v2).' },
];

const EMPTY_FORM = { name: '', projectId: '', environment: '', loginUrl: '', username: '' };

// Credential Profile modal (modal-4 mockup). Session capture is not a
// single request/response — `session.capture()` doesn't resolve until the
// user finishes logging in (via `session.finish()`) or cancels (via
// `session.cancel()` / closing the login window), so this component tracks
// an explicit `sessionStatus` state machine: idle -> waiting -> captured|cancelled.
export function CredentialModal({ open, onClose, projects = [], defaultProjectId, onSaved }) {
  const toast = useToast();
  const [tab, setTab] = useState('capture');
  const [form, setForm] = useState(EMPTY_FORM);
  const [sessionStatus, setSessionStatus] = useState('idle'); // idle | waiting | captured | cancelled
  const [capturedMeta, setCapturedMeta] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTab('capture');
    setForm({ ...EMPTY_FORM, projectId: defaultProjectId || '' });
    setSessionStatus('idle');
    setCapturedMeta(null);
  }, [open, defaultProjectId]);

  const project = projects.find((p) => p.id === form.projectId) || null;
  const environments = project?.environments || [];

  function setField(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function closeAndReset() {
    if (sessionStatus === 'waiting') {
      window.qaflow.session.cancel().catch(() => {});
    }
    onClose();
  }

  const canCapture = Boolean(form.name.trim() && form.projectId && form.environment && form.loginUrl.trim());

  async function captureSession() {
    if (!canCapture) {
      toast('Fill in Profile Name, Linked Project, Environment, and Login URL before capturing.', 'warning');
      return;
    }
    setSessionStatus('waiting');
    try {
      const meta = await window.qaflow.session.capture({
        loginUrl: form.loginUrl.trim(),
        projectId: form.projectId || undefined,
        environment: form.environment || undefined,
        name: form.name.trim() || undefined,
        meta: { username: form.username.trim() || undefined },
      });
      if (meta) {
        setSessionStatus('captured');
        setCapturedMeta(meta);
      } else {
        setSessionStatus('cancelled');
      }
    } catch (e) {
      setSessionStatus('idle');
      toast(`Session capture failed: ${e.message}`, 'error');
    }
  }

  async function finishCapture() {
    try {
      await window.qaflow.session.finish();
    } catch (e) {
      toast(`Failed to finish capture: ${e.message}`, 'error');
    }
  }

  async function cancelCapture() {
    try {
      await window.qaflow.session.cancel();
    } catch (e) {
      toast(`Failed to cancel capture: ${e.message}`, 'error');
    }
  }

  const canSave = form.name.trim() && form.projectId && form.environment && form.loginUrl.trim() && sessionStatus === 'captured';

  async function handleSave() {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      toast(`Credential profile "${capturedMeta?.name || form.name}" saved.`, 'success');
      onClose();
      onSaved?.(capturedMeta);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={closeAndReset} className="max-w-4xl">
      <div className="flex items-start justify-between gap-4 border-b border-border p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Credential Profile</h2>
            <p className="text-sm text-muted-foreground">Securely store login sessions and credentials for use in automated tests.</p>
          </div>
        </div>
        <DialogClose onClick={closeAndReset} />
      </div>

      <div className="flex border-b border-border px-5">
        {TABS.map((t) => (
          <button
            key={t.key}
            disabled={t.disabled}
            title={t.disabled ? 'Manual entry arrives in v2' : undefined}
            onClick={() => setTab(t.key)}
            className={cn(
              'mr-6 border-b-2 py-3 text-sm font-medium transition-colors',
              tab === t.key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground',
              t.disabled && 'cursor-not-allowed text-muted-foreground/50'
            )}
          >
            {t.label}
            {t.disabled && <span className="ml-1.5 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-semibold">v2</span>}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 overflow-y-auto p-5 lg:grid-cols-[1fr_320px]">
        {tab !== 'security' ? (
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cp-name">
                  Profile Name <span className="text-danger">*</span>
                </Label>
                <Input
                  id="cp-name"
                  placeholder="e.g., E-Commerce Admin"
                  value={form.name}
                  onChange={(e) => setField('name', e.target.value)}
                  disabled={sessionStatus === 'waiting'}
                />
                <p className="text-xs text-muted-foreground">A friendly name to identify this credential profile.</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cp-project">
                  Linked Project <span className="text-danger">*</span>
                </Label>
                <Select
                  id="cp-project"
                  value={form.projectId}
                  onChange={(e) => setField('projectId', e.target.value)}
                  disabled={sessionStatus === 'waiting'}
                >
                  <option value="">Select a project</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
                <p className="text-xs text-muted-foreground">Project this credential profile is associated with.</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cp-env">
                  Environment <span className="text-danger">*</span>
                </Label>
                <Select
                  id="cp-env"
                  value={form.environment}
                  onChange={(e) => setField('environment', e.target.value)}
                  disabled={environments.length === 0 || sessionStatus === 'waiting'}
                >
                  <option value="">Select environment</option>
                  {environments.map((env) => (
                    <option key={env.name} value={env.name}>
                      {env.name}
                    </option>
                  ))}
                </Select>
                <p className="text-xs text-muted-foreground">Environment where this credential will be used.</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cp-url">
                  Login URL <span className="text-danger">*</span>
                </Label>
                <Input
                  id="cp-url"
                  placeholder="https://app.example.com/login"
                  value={form.loginUrl}
                  onChange={(e) => setField('loginUrl', e.target.value)}
                  disabled={sessionStatus === 'waiting'}
                />
                <p className="text-xs text-muted-foreground">Full URL of the login page.</p>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cp-username">Username</Label>
              <Input
                id="cp-username"
                placeholder="qa.admin@company.com"
                value={form.username}
                onChange={(e) => setField('username', e.target.value)}
                disabled={sessionStatus === 'waiting'}
              />
              <p className="text-xs text-muted-foreground">Username or email for login (for reference only — the session itself is captured below).</p>
            </div>

            {tab === 'capture' && (
              <>
                <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
                      <Video className="h-4.5 w-4.5" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-foreground">Capture Login Session</div>
                      <p className="text-sm text-muted-foreground">Launch a browser to sign in and capture your authenticated session.</p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    onClick={captureSession}
                    disabled={sessionStatus === 'waiting' || !canCapture}
                    title={!canCapture ? 'Fill in Profile Name, Linked Project, Environment, and Login URL first.' : undefined}
                    className="shrink-0"
                  >
                    {sessionStatus === 'waiting' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />}
                    Capture Session
                  </Button>
                </div>
                {!canCapture && sessionStatus === 'idle' && (
                  <p className="-mt-2 text-xs text-muted-foreground">
                    Fill in Profile Name, Linked Project, Environment, and Login URL to enable capture.
                  </p>
                )}

                <div className="rounded-lg border border-border p-4">
                  {sessionStatus === 'waiting' && (
                    <div className="flex items-start gap-3">
                      <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-foreground">Waiting — log in in the opened browser</div>
                        <p className="text-sm text-muted-foreground">Sign in, then come back and click "I've logged in" to capture the session.</p>
                        <div className="mt-3 flex gap-2">
                          <Button size="sm" onClick={finishCapture}>
                            I've logged in — capture
                          </Button>
                          <Button size="sm" variant="outline" onClick={cancelCapture}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                  {sessionStatus === 'captured' && (
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                      <div>
                        <div className="text-sm font-semibold text-foreground">Session captured ✓</div>
                        <p className="text-sm text-muted-foreground">Ready to save — this session will be reused on future runs.</p>
                      </div>
                    </div>
                  )}
                  {sessionStatus === 'cancelled' && (
                    <div className="flex items-start gap-3">
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
                      <div>
                        <div className="text-sm font-semibold text-foreground">Capture cancelled</div>
                        <p className="text-sm text-muted-foreground">No active session available. Capture a new session to continue.</p>
                      </div>
                    </div>
                  )}
                  {sessionStatus === 'idle' && (
                    <div className="flex items-start gap-3">
                      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <div>
                        <div className="text-sm font-semibold text-foreground">Session not captured</div>
                        <p className="text-sm text-muted-foreground">No active session available. Capture a session to continue.</p>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {SECURITY_POINTS.map((p) => {
              const Icon = p.icon;
              return (
                <div key={p.title} className="flex items-start gap-3 rounded-lg border border-border p-4">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
                    <Icon className="h-4.5 w-4.5" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-foreground">{p.title}</div>
                    <p className="text-sm text-muted-foreground">{p.body}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-border p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
              <ShieldCheck className="h-4 w-4 text-primary" /> Security & Privacy
            </div>
            <div className="flex flex-col gap-3">
              {SECURITY_POINTS.map((p) => {
                const Icon = p.icon;
                return (
                  <div key={p.title} className="flex items-start gap-2.5">
                    <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <div>
                      <div className="text-xs font-semibold text-foreground">{p.title}</div>
                      <p className="text-xs text-muted-foreground">{p.body}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="rounded-lg border border-border p-4">
            <div className="text-sm font-semibold text-foreground">Good to know</div>
            <p className="mt-1 text-xs text-muted-foreground">
              You can manage and review all saved credential profiles from the Credentials section.
            </p>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t border-border bg-secondary/30 px-5 py-3.5">
        <Button variant="outline" onClick={closeAndReset}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={!canSave || saving}>
          {saving ? 'Saving…' : 'Save Profile'}
        </Button>
      </div>
    </Dialog>
  );
}

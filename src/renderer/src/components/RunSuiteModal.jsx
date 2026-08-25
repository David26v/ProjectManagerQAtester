import { useEffect, useMemo, useState } from 'react';
import { Play, Monitor, MonitorX, KeyRound, Clock, ListChecks } from 'lucide-react';
import { Dialog, DialogClose } from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusPill } from '@/components/StatusPill';
import { Alert } from '@/components/ui/alert';
import { projectVisual } from '@/lib/projectVisuals';
import { fmtDate, fmtDuration } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useToast } from '@/lib/toast';

const MAX_RETRIES = 3;

const RECURRENCE_LABELS = { once: 'once', daily: 'every day', weekly: 'every week' };

// Run Suite modal (modal-3 mockup). Kicking off the run and tracking its
// progress is owned by the parent (`onRun`) — App.jsx's run manager keeps
// that state alive after this modal closes/unmounts on navigation.
export function RunSuiteModal({ open, onClose, suite, project, runs = [], onRun }) {
  const toast = useToast();
  const [tab, setTab] = useState('now');
  const [environment, setEnvironment] = useState('');
  const [headless, setHeadless] = useState(true);
  const [retryCount, setRetryCount] = useState(0);
  const [credentialProfileId, setCredentialProfileId] = useState('');
  const [credentials, setCredentials] = useState([]);
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');
  const [recurrence, setRecurrence] = useState('once');
  const [scheduling, setScheduling] = useState(false);

  useEffect(() => {
    if (!open || !suite) return;
    setTab('now');
    setEnvironment(suite.environment || project?.defaultEnvironment || project?.environments?.[0]?.name || '');
    setHeadless(true);
    setRetryCount(0);
    setCredentialProfileId('');
    setScheduleDate('');
    setScheduleTime('');
    setRecurrence('once');
  }, [open, suite, project]);

  useEffect(() => {
    if (!open || !project) {
      setCredentials([]);
      return;
    }
    let cancelled = false;
    window.qaflow.session.list(project.id).then((list) => {
      if (!cancelled) setCredentials(list || []);
    });
    return () => {
      cancelled = true;
    };
  }, [open, project]);

  const suiteRuns = useMemo(
    () => runs.filter((r) => r.suiteId === suite?.id).sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt)),
    [runs, suite]
  );
  const lastRun = suiteRuns[0];

  if (!suite) return null;

  const { Icon, colorClass } = projectVisual(project || { id: suite.projectId });

  function handleRun() {
    onRun(suite, {
      environment,
      headless,
      credentialProfileId: credentialProfileId || undefined,
      retries: retryCount,
    });
    onClose();
  }

  const scheduleAtIso = useMemo(() => {
    if (!scheduleDate || !scheduleTime) return null;
    const [year, month, day] = scheduleDate.split('-').map(Number);
    const [hh, mm] = scheduleTime.split(':').map(Number);
    if ([year, month, day, hh, mm].some((n) => Number.isNaN(n))) return null;
    return new Date(year, month - 1, day, hh, mm).toISOString();
  }, [scheduleDate, scheduleTime]);

  const scheduleInPast = Boolean(scheduleAtIso && new Date(scheduleAtIso).getTime() <= Date.now());
  const canSchedule = Boolean(environment && scheduleAtIso && !scheduleInPast);

  async function handleSchedule() {
    if (!canSchedule || scheduling) return;
    setScheduling(true);
    try {
      const now = new Date().toISOString();
      await window.qaflow.schedules.save({
        id: `sched-${crypto.randomUUID()}`,
        suiteId: suite.id,
        projectId: suite.projectId,
        name: suite.name,
        environment,
        headless: true,
        credentialProfileId: credentialProfileId || undefined,
        at: scheduleAtIso,
        recurrence,
        enabled: true,
        nextRunAt: scheduleAtIso,
        createdAt: now,
        updatedAt: now,
      });
      toast('Scheduled', 'success');
      onClose();
    } catch (e) {
      toast(`Failed to schedule run: ${e.message}`, 'error');
    } finally {
      setScheduling(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} className="max-w-4xl">
      <div className="flex items-start justify-between gap-4 border-b border-border p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
            <Play className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Run Suite</h2>
            <p className="text-sm text-muted-foreground">Execute the selected test suite with your preferred configuration.</p>
          </div>
        </div>
        <DialogClose onClick={onClose} />
      </div>

      <div className="grid grid-cols-1 gap-6 overflow-y-auto p-5 lg:grid-cols-[1fr_300px]">
        <div className="flex flex-col gap-5">
          <div className="flex items-start gap-3 rounded-lg border border-border p-4">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white ${colorClass}`}>
              <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-foreground">{project?.name || 'Unknown project'}</span>
                {!suite.archived && <span className="rounded-full bg-success-bg px-2 py-0.5 text-xs font-medium text-success">Active</span>}
                {(suite.tags || []).map((t) => (
                  <span key={t} className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    {t}
                  </span>
                ))}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{suite.description || 'No description.'}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {suite.steps?.length || 0} steps · Updated {fmtDate(suite.updatedAt)}
              </p>
            </div>
          </div>

          <div className="text-sm font-semibold text-foreground">Run Configuration</div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">Environment</label>
              <Select value={environment} onChange={(e) => setEnvironment(e.target.value)}>
                <option value="">Select environment</option>
                {(project?.environments || []).map((env) => (
                  <option key={env.name} value={env.name}>
                    {env.name}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">Environment variables and base URLs.</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">Browser</label>
              <Select value="chromium" disabled>
                <option value="chromium">Chromium</option>
              </Select>
              <p className="text-xs text-muted-foreground">Chromium only in v1 — more browsers arrive in v2.</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">Execution Mode</label>
              <div className="flex overflow-hidden rounded-md border border-input">
                <button
                  type="button"
                  onClick={() => setHeadless(true)}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-1.5 py-1.5 text-sm font-medium transition-colors',
                    headless ? 'bg-accent text-primary' : 'bg-background text-muted-foreground hover:bg-secondary'
                  )}
                >
                  <MonitorX className="h-3.5 w-3.5" /> Headless
                </button>
                <button
                  type="button"
                  onClick={() => setHeadless(false)}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-1.5 border-l border-input py-1.5 text-sm font-medium transition-colors',
                    !headless ? 'bg-accent text-primary' : 'bg-background text-muted-foreground hover:bg-secondary'
                  )}
                >
                  <Monitor className="h-3.5 w-3.5" /> Headed
                </button>
              </div>
              <p className="text-xs text-muted-foreground">Run tests with or without a visible browser window.</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">Retry Count</label>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="icon" onClick={() => setRetryCount((c) => Math.max(0, c - 1))}>
                  −
                </Button>
                <Input className="w-16 text-center" value={retryCount} readOnly />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setRetryCount((c) => Math.min(MAX_RETRIES, c + 1))}
                  disabled={retryCount >= MAX_RETRIES}
                >
                  +
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Retry failed tests up to {MAX_RETRIES} times.</p>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <KeyRound className="h-3.5 w-3.5 text-muted-foreground" /> Credentials Profile
            </label>
            <Select value={credentialProfileId} onChange={(e) => setCredentialProfileId(e.target.value)}>
              <option value="">No credentials (public flow)</option>
              {credentials.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">Credentials and secrets for this run.</p>
          </div>

          <div className="flex border-b border-border">
            <button
              onClick={() => setTab('now')}
              className={cn('border-b-2 px-1 pb-2 text-sm font-medium mr-6', tab === 'now' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground')}
            >
              Run Now
            </button>
            <button
              onClick={() => setTab('schedule')}
              className={cn('border-b-2 px-1 pb-2 text-sm font-medium', tab === 'schedule' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground')}
            >
              Schedule
            </button>
          </div>

          {tab === 'schedule' && (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-foreground">Date</label>
                  <Input type="date" value={scheduleDate} onChange={(e) => setScheduleDate(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-foreground">Time</label>
                  <Input type="time" value={scheduleTime} onChange={(e) => setScheduleTime(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-foreground">Recurrence</label>
                  <Select value={recurrence} onChange={(e) => setRecurrence(e.target.value)}>
                    <option value="once">Once</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-foreground">Timezone</label>
                  <Select disabled>
                    <option>Local</option>
                  </Select>
                </div>
              </div>
              <Alert variant={scheduleInPast ? 'warning' : 'info'}>
                {scheduleInPast
                  ? 'That date and time is in the past — pick a future time to schedule this run.'
                  : scheduleAtIso
                    ? `Runs ${RECURRENCE_LABELS[recurrence]} starting ${fmtDate(scheduleAtIso)}.`
                    : 'Pick a date and time to schedule this run.'}
              </Alert>
              <div className="flex justify-end">
                <Button type="button" onClick={handleSchedule} disabled={!canSchedule || scheduling}>
                  {scheduling ? 'Scheduling…' : 'Schedule Run'}
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-border p-4">
            <div className="mb-3 text-sm font-semibold text-foreground">Run Summary</div>
            <div className="flex flex-col gap-3 text-sm">
              <div className="flex items-center gap-2.5">
                <ListChecks className="h-4 w-4 text-muted-foreground" />
                <div className="flex-1">
                  <div className="font-medium text-foreground">Included Steps</div>
                  <div className="text-xs text-muted-foreground">{suite.steps?.length || 0} steps in this suite.</div>
                </div>
              </div>
              <div className="flex items-center gap-2.5">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <div className="flex-1">
                  <div className="font-medium text-foreground">Est. Runtime</div>
                  <div className="text-xs text-muted-foreground">~{Math.max(1, Math.round((suite.steps?.length || 0) * 2 / 60))} min based on step count.</div>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-border p-4">
            <div className="mb-3 text-sm font-semibold text-foreground">Last Run</div>
            {lastRun ? (
              <div className="flex flex-col gap-1.5 text-sm">
                <StatusPill status={lastRun.status} />
                <div className="text-xs text-muted-foreground">{fmtDate(lastRun.startedAt)}</div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Duration</span>
                  <span className="font-medium text-foreground">
                    {lastRun.finishedAt ? fmtDuration(new Date(lastRun.finishedAt) - new Date(lastRun.startedAt)) : '—'}
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Environment</span>
                  <span className="font-medium text-foreground">{lastRun.environment || '—'}</span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No runs yet.</p>
            )}
          </div>

          <Alert variant="info">Good to go! All required settings are configured.</Alert>
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t border-border bg-secondary/30 px-5 py-3.5">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        {tab === 'now' && (
          <Button onClick={handleRun} disabled={!environment}>
            <Play className="h-4 w-4" /> Run Suite
          </Button>
        )}
      </div>
    </Dialog>
  );
}

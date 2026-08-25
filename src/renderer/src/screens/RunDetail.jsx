import { useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  Copy,
  FolderOpen,
  Play,
  FileText,
  CheckCircle2,
  XCircle,
  MinusCircle,
  Gauge,
  ShieldAlert,
  Tag,
  Image as ImageIcon,
  Film,
  ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/StatusPill';
import { fmtDate, fmtDuration } from '@/lib/format';
import { shortRunId, resolveMediaUrls } from '@/lib/media';
import { deriveSeverity, findFailingStep, parseErrorDetails, SEVERITY_REASONS } from '@/lib/severity';
import { navigate } from '@/hooks/useHashRoute';
import { useToast } from '@/lib/toast';

const TABS = [
  { key: 'summary', label: 'Summary' },
  { key: 'console', label: 'Console Logs' },
  { key: 'network', label: 'Network Failures' },
  { key: 'artifacts', label: 'Artifacts' },
];

function stepTimeOffsets(steps) {
  let cumulative = 0;
  return steps.map((s) => {
    const at = cumulative;
    cumulative += s.durationMs || 0;
    return at;
  });
}

function fmtOffset(ms) {
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function StepStatusPill({ status }) {
  const styles = {
    passed: 'bg-success-bg text-success',
    failed: 'bg-danger-bg text-danger',
    skipped: 'bg-secondary text-muted-foreground',
  };
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[status] || styles.skipped}`}>{status}</span>;
}

export function RunDetail({ id, data, startRun }) {
  const { projects, suites, runs, reload } = data;
  const toast = useToast();
  const [tab, setTab] = useState('summary');
  const [mediaUrls, setMediaUrls] = useState({});
  const [creatingTicket, setCreatingTicket] = useState(false);

  const run = runs.find((r) => r.runId === id);
  const project = run ? projects.find((p) => p.id === run.projectId) : null;
  const suite = run ? suites.find((s) => s.id === run.suiteId) : null;

  useEffect(() => {
    if (!run) return undefined;
    let cancelled = false;
    resolveMediaUrls(run.runId, run.capturedMedia, { video: run.videoPath }).then((map) => {
      if (!cancelled) setMediaUrls(map);
    });
    return () => {
      cancelled = true;
    };
  }, [run]);

  const steps = run?.steps || [];
  const offsets = useMemo(() => stepTimeOffsets(steps), [steps]);
  const failingStep = run ? findFailingStep(run) : null;
  const mediaByPath = useMemo(() => Object.fromEntries((run?.capturedMedia || []).map((m) => [m.path, m])), [run]);

  if (!run) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
        <h2 className="text-lg font-semibold text-foreground">Run not found</h2>
        <p className="text-sm text-muted-foreground">It may have been deleted, or the run id in the URL is wrong.</p>
        <Button variant="outline" onClick={() => navigate('/runs')}>
          Back to Runs
        </Button>
      </div>
    );
  }

  const durationMs = run.finishedAt && run.startedAt ? new Date(run.finishedAt) - new Date(run.startedAt) : null;
  const passedCount = steps.filter((s) => s.status === 'passed').length;
  const failedCount = steps.filter((s) => s.status === 'failed').length;
  const skippedCount = steps.filter((s) => s.status === 'skipped').length;
  const total = steps.length || 1;
  const successRate = Math.round((passedCount / total) * 100);
  const durations = steps.filter((s) => Number.isFinite(s.durationMs)).map((s) => s.durationMs);
  const avgStepDuration = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

  const severity = deriveSeverity(run);
  const errorDetails = failingStep ? parseErrorDetails(failingStep.error) : { selector: null, timeout: null };
  const screenshotMedia = failingStep?.screenshot ? mediaByPath[failingStep.screenshot] : null;
  const screenshotUrl = screenshotMedia ? mediaUrls[screenshotMedia.id] : null;
  const videoUrl = mediaUrls.video;

  function rerun() {
    if (!suite) {
      toast('The suite for this run no longer exists.', 'error');
      return;
    }
    startRun(suite, { environment: run.environment, headless: true });
  }

  async function openDir() {
    try {
      await window.qaflow.runs.openDir(run.runId);
    } catch (e) {
      toast(`Failed to open run folder: ${e.message}`, 'error');
    }
  }

  function copyRunId() {
    navigator.clipboard?.writeText(run.runId);
    toast('Run ID copied.', 'success');
  }

  async function createTicket() {
    setCreatingTicket(true);
    try {
      const ticket = await window.qaflow.reports.createTicket(run.runId);
      toast(`Bug ticket "${ticket.title}" created on the Kanban board.`, 'success');
      reload();
    } catch (e) {
      toast(`Failed to create ticket: ${e.message}`, 'error');
    } finally {
      setCreatingTicket(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <button onClick={() => navigate('/runs')} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-3.5 w-3.5" /> Back to Runs
          </button>
          <h1 className="mt-2 text-2xl font-semibold text-foreground">Run Details &amp; Diagnostics</h1>
          <p className="mt-1 text-sm text-muted-foreground">Deep dive into your test run execution, logs, and failures.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={openDir}>
            <FolderOpen className="h-4 w-4" /> Open Folder
          </Button>
          <Button variant="outline" onClick={rerun}>
            <Play className="h-4 w-4" /> Re-run
          </Button>
          <Button onClick={() => navigate(`/runs/${run.runId}/report`)}>
            <FileText className="h-4 w-4" /> Build Report
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="flex items-start gap-4">
          <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${run.status === 'failed' ? 'bg-danger-bg text-danger' : 'bg-success-bg text-success'}`}>
            {run.status === 'failed' ? <XCircle className="h-6 w-6" /> : <CheckCircle2 className="h-6 w-6" />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-foreground">{run.suiteName}</h2>
              <StatusPill status={run.status} />
            </div>
            <button onClick={copyRunId} className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
              {shortRunId(run.runId)} <Copy className="h-3 w-3" />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-5">
          <div>
            <div className="text-xs text-muted-foreground">Environment</div>
            <div className="font-medium text-foreground">{run.environment || '—'}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Started At</div>
            <div className="font-medium text-foreground">{fmtDate(run.startedAt)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Duration</div>
            <div className="font-medium text-foreground">{fmtDuration(durationMs)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Triggered By</div>
            <div className="font-medium text-foreground">{run.triggeredBy === 'manual' ? 'QA Engineer' : run.triggeredBy || '—'}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Source</div>
            <div className="font-medium capitalize text-foreground">{run.triggeredBy || 'Manual'}</div>
          </div>
        </div>
      </div>

      <div className="flex gap-6 border-b border-border">
        {TABS.map((t) => {
          const count = t.key === 'console' ? run.consoleErrors?.length : t.key === 'network' ? run.networkFailures?.length : t.key === 'artifacts' ? run.capturedMedia?.length : null;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`-mb-px flex items-center gap-1.5 border-b-2 px-1 pb-3 text-sm font-medium transition-colors ${
                tab === t.key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
              {Boolean(count) && <span className="rounded-full bg-secondary px-1.5 py-0.5 text-xs text-muted-foreground">{count}</span>}
            </button>
          );
        })}
      </div>

      {tab === 'summary' && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[300px_1fr_300px]">
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="text-base font-semibold text-foreground">Run Timeline</div>
              <span className="text-xs text-muted-foreground">{steps.length} steps</span>
            </div>
            <div className="mt-4 flex flex-col gap-4">
              {steps.length === 0 && <p className="text-sm text-muted-foreground">No steps recorded for this run.</p>}
              {steps.map((step, idx) => (
                <div key={idx} className="flex items-start gap-3">
                  <div className="mt-0.5 shrink-0">
                    {step.status === 'passed' && <CheckCircle2 className="h-4 w-4 text-success" />}
                    {step.status === 'failed' && <XCircle className="h-4 w-4 text-danger" />}
                    {step.status === 'skipped' && <MinusCircle className="h-4 w-4 text-muted-foreground" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-muted-foreground">{fmtOffset(offsets[idx])}</span>
                      <StepStatusPill status={step.status} />
                    </div>
                    <div className="truncate text-sm font-medium text-foreground">{step.name}</div>
                    {step.status === 'failed' && step.error && (
                      <div className="mt-1 rounded-md bg-danger-bg px-2.5 py-1.5 text-xs text-danger">{step.error}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-4">
            {failingStep ? (
              <>
                <div className="flex items-center justify-between rounded-xl border border-danger/30 bg-danger-bg px-4 py-3 text-sm font-medium text-danger">
                  <span>Step Failed: {failingStep.name}</span>
                  {Number.isFinite(failingStep.durationMs) && <span className="text-xs">{fmtDuration(failingStep.durationMs)}</span>}
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="rounded-xl border border-success/30 bg-success-bg/40 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-success">Expected</div>
                    <p className="mt-1 text-sm text-foreground">"{failingStep.name}" to succeed</p>
                  </div>
                  <div className="rounded-xl border border-danger/30 bg-danger-bg/60 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-danger">Actual</div>
                    <p className="mt-1 text-sm text-foreground">{failingStep.error || 'Unknown error'}</p>
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
                  <div className="text-sm font-semibold text-foreground">Error Details</div>
                  <div className="mt-2 whitespace-pre-wrap rounded-md bg-secondary/60 p-3 font-mono text-xs text-foreground">{failingStep.error || 'No error message captured.'}</div>
                  {(errorDetails.selector || errorDetails.timeout) && (
                    <div className="mt-3 grid grid-cols-2 gap-4">
                      {errorDetails.selector && (
                        <div>
                          <div className="text-xs text-muted-foreground">Selector</div>
                          <div className="mt-0.5 truncate font-mono text-sm text-foreground">{errorDetails.selector}</div>
                        </div>
                      )}
                      {errorDetails.timeout && (
                        <div>
                          <div className="text-xs text-muted-foreground">Timeout</div>
                          <div className="mt-0.5 text-sm text-foreground">{errorDetails.timeout}</div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
                    <div className="text-sm font-semibold text-foreground">Screenshot at Failure</div>
                    <div className="mt-2 overflow-hidden rounded-lg border border-border bg-secondary/40">
                      {screenshotUrl ? (
                        <img src={screenshotUrl} alt="Failure screenshot" className="w-full object-cover" />
                      ) : (
                        <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">No screenshot captured.</div>
                      )}
                    </div>
                  </div>
                  <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
                    <div className="text-sm font-semibold text-foreground">Video Playback</div>
                    <div className="mt-2 overflow-hidden rounded-lg border border-border bg-secondary/40">
                      {videoUrl ? (
                        <video controls src={videoUrl} className="w-full" />
                      ) : (
                        <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">No video captured.</div>
                      )}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border p-10 text-center">
                <CheckCircle2 className="h-8 w-8 text-success" />
                <p className="text-sm font-medium text-foreground">All steps passed</p>
                <p className="text-sm text-muted-foreground">Nothing failed in this run — no diagnostics to show.</p>
                {videoUrl && (
                  <div className="mt-3 w-full max-w-md overflow-hidden rounded-lg border border-border">
                    <video controls src={videoUrl} className="w-full" />
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-4">
            <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Gauge className="h-4 w-4 text-muted-foreground" /> Run Metrics
              </div>
              <div className="mt-3 flex flex-col gap-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Steps</span>
                  <span className="font-medium text-foreground">{steps.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Passed</span>
                  <span className="font-medium text-success">
                    {passedCount} ({Math.round((passedCount / total) * 100)}%)
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Failed</span>
                  <span className="font-medium text-danger">
                    {failedCount} ({Math.round((failedCount / total) * 100)}%)
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Skipped</span>
                  <span className="font-medium text-foreground">
                    {skippedCount} ({Math.round((skippedCount / total) * 100)}%)
                  </span>
                </div>
                <div className="flex justify-between border-t border-border pt-2">
                  <span className="text-muted-foreground">Success Rate</span>
                  <span className="font-medium text-foreground">{successRate}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Avg Step Duration</span>
                  <span className="font-medium text-foreground">{fmtDuration(avgStepDuration)}</span>
                </div>
              </div>
            </div>

            {failingStep && (
              <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <ShieldAlert className="h-4 w-4 text-muted-foreground" /> Bug Severity Suggestion
                </div>
                <span className={`mt-2 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${severity === 'high' ? 'bg-danger-bg text-danger' : 'bg-warning-bg text-amber-800'}`}>
                  {severity === 'high' ? 'High' : 'Medium'}
                </span>
                <ul className="mt-3 flex flex-col gap-1.5">
                  {(SEVERITY_REASONS[severity] || []).map((reason) => (
                    <li key={reason} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                      <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-success" /> {reason}
                    </li>
                  ))}
                </ul>
                <Button variant="outline" size="sm" className="mt-3 w-full" onClick={createTicket} disabled={creatingTicket}>
                  {creatingTicket ? 'Creating…' : 'Create Bug Ticket'}
                </Button>
              </div>
            )}

            <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Tag className="h-4 w-4 text-muted-foreground" /> Tags &amp; Metadata
              </div>
              <div className="mt-3 flex flex-col gap-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Suite</span>
                  <span className="font-medium text-foreground">{run.suiteName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Project</span>
                  <span className="font-medium text-foreground">{project?.name || 'Unknown'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Browser</span>
                  <span className="font-medium text-foreground">Chromium</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">OS</span>
                  <span className="font-medium text-foreground">{navigator.platform || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Viewport</span>
                  <span className="font-medium text-foreground">1280 × 800</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'console' && (
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="text-base font-semibold text-foreground">Console Errors</div>
          <div className="mt-4 flex flex-col gap-2">
            {(!run.consoleErrors || run.consoleErrors.length === 0) && (
              <p className="py-8 text-center text-sm text-muted-foreground">No console errors captured during this run.</p>
            )}
            {(run.consoleErrors || []).map((err, idx) => (
              <div key={idx} className="rounded-md border border-danger/20 bg-danger-bg px-3 py-2 font-mono text-xs text-danger">
                {err.text}
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'network' && (
        <div className="rounded-xl border border-border bg-card shadow-sm">
          <div className="border-b border-border px-5 py-4 text-base font-semibold text-foreground">Network Failures</div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-2.5 font-medium">URL</th>
                  <th className="px-5 py-2.5 font-medium">Failure</th>
                </tr>
              </thead>
              <tbody>
                {(!run.networkFailures || run.networkFailures.length === 0) && (
                  <tr>
                    <td colSpan={2} className="px-5 py-8 text-center text-sm text-muted-foreground">
                      No failed network requests during this run.
                    </td>
                  </tr>
                )}
                {(run.networkFailures || []).map((nf, idx) => (
                  <tr key={idx} className="border-b border-border last:border-0">
                    <td className="max-w-md truncate px-5 py-3 font-mono text-xs text-foreground">{nf.url}</td>
                    <td className="px-5 py-3 text-danger">{nf.failure || 'Unknown failure'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'artifacts' && (
        <div className="rounded-xl border border-border bg-card shadow-sm">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div className="text-base font-semibold text-foreground">Artifacts</div>
            <button onClick={() => navigate(`/runs/${run.runId}/report`)} className="flex items-center gap-1 text-sm font-medium text-primary hover:underline">
              Review in Report Builder <ExternalLink className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex flex-col divide-y divide-border">
            {(!run.capturedMedia || run.capturedMedia.length === 0) && (
              <p className="px-5 py-8 text-center text-sm text-muted-foreground">No media captured during this run.</p>
            )}
            {(run.capturedMedia || []).map((m) => (
              <div key={m.id} className="flex items-center gap-3 px-5 py-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent text-primary">
                  {m.type === 'video' ? <Film className="h-4 w-4" /> : <ImageIcon className="h-4 w-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground">{m.path}</div>
                  <div className="text-xs text-muted-foreground">
                    {m.type === 'video' ? 'Video' : 'Screenshot'}
                    {Number.isInteger(m.stepIndex) && steps[m.stepIndex] ? ` · Step ${m.stepIndex + 1}: ${steps[m.stepIndex].name}` : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  MessageSquare,
  FileText,
  Image as ImageIcon,
  Film,
  Plus,
  X,
  User,
  Tag,
  Calendar,
  Gauge,
  Link2,
  CheckCircle2,
  Circle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { StatusPill } from '@/components/StatusPill';
import { fmtDate, timeAgo } from '@/lib/format';
import { resolveMediaUrls } from '@/lib/media';
import { STATUSES, statusLabel, severityMeta, ensureChecklist } from '@/lib/tickets';
import { navigate } from '@/hooks/useHashRoute';
import { useToast } from '@/lib/toast';
import { cn } from '@/lib/utils';

// The tab strip in kanban-4 (Details/Activity/Attachments/Linked Runs/
// Checklist/History) is visual only per the task brief — every section it
// names is already rendered below as one scrolling page, so these render as
// plain non-interactive labels with "Details" highlighted rather than a
// real tab switcher.
const VISUAL_TABS = ['Details', 'Activity', 'Attachments', 'Linked Runs', 'Checklist', 'History'];

export function TicketDetail({ id, data, startRun }) {
  const { projects, suites, runs, tickets, settings, reload } = data;
  const toast = useToast();

  const ticket = tickets.find((t) => t.id === id);
  const project = ticket ? projects.find((p) => p.id === ticket.projectId) : null;
  const run = ticket?.runId ? runs.find((r) => r.runId === ticket.runId) : null;
  const suite = run ? suites.find((s) => s.id === run.suiteId) : null;

  const [mediaUrls, setMediaUrls] = useState({});
  const [commentDraft, setCommentDraft] = useState('');
  const [labelDraft, setLabelDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const commentRef = useRef(null);

  useEffect(() => {
    if (!run) {
      setMediaUrls({});
      return undefined;
    }
    let cancelled = false;
    resolveMediaUrls(run.runId, run.capturedMedia).then((map) => {
      if (!cancelled) setMediaUrls(map);
    });
    return () => {
      cancelled = true;
    };
  }, [run]);

  const checklist = useMemo(() => ensureChecklist(ticket), [ticket]);
  const checklistDone = checklist.filter((c) => c.done).length;

  const evidenceMedia = useMemo(() => {
    if (!run) return [];
    const media = run.capturedMedia || [];
    if (run.reportSelection?.selectedMediaIds?.length) {
      return media.filter((m) => run.reportSelection.selectedMediaIds.includes(m.id));
    }
    if (ticket?.attachments?.length) {
      const attachedIds = new Set(ticket.attachments.map((a) => a.mediaId));
      return media.filter((m) => attachedIds.has(m.id));
    }
    return media;
  }, [run, ticket]);

  if (!ticket) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
        <h2 className="text-lg font-semibold text-foreground">Ticket not found</h2>
        <p className="text-sm text-muted-foreground">It may have been deleted, or the ticket id in the URL is wrong.</p>
        <Button variant="outline" onClick={() => navigate('/kanban')}>
          Back to Kanban
        </Button>
      </div>
    );
  }

  async function persist(patch, successMessage) {
    setBusy(true);
    try {
      await window.qaflow.tickets.save({ ...ticket, ...patch });
      if (successMessage) toast(successMessage, 'success');
      reload();
    } catch (e) {
      toast(`Failed to update ticket: ${e.message}`, 'error');
    } finally {
      setBusy(false);
    }
  }

  function changeStatus(status) {
    if (status === ticket.status) return;
    persist({ status }, `Status changed to "${statusLabel(status)}".`);
  }

  function focusComment() {
    commentRef.current?.focus();
    commentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function submitComment() {
    const text = commentDraft.trim();
    if (!text) return;
    const comment = { author: settings?.userName || 'QA Engineer', text, at: new Date().toISOString() };
    persist({ comments: [...(ticket.comments || []), comment] });
    setCommentDraft('');
  }

  function toggleChecklistItem(idx) {
    const next = checklist.map((c, i) => (i === idx ? { ...c, done: !c.done } : c));
    persist({ checklist: next });
  }

  function addLabel() {
    const label = labelDraft.trim();
    if (!label) return;
    if ((ticket.labels || []).some((l) => l.toLowerCase() === label.toLowerCase())) {
      setLabelDraft('');
      return;
    }
    persist({ labels: [...(ticket.labels || []), label] });
    setLabelDraft('');
  }

  function removeLabel(label) {
    persist({ labels: (ticket.labels || []).filter((l) => l !== label) });
  }

  function generateReport() {
    if (!run) {
      toast('This ticket has no linked run to generate a report for.', 'warning');
      return;
    }
    navigate(`/runs/${run.runId}/report`);
  }

  const severity = severityMeta(ticket.severity);
  const statusIndex = STATUSES.findIndex((s) => s.key === ticket.status);

  return (
    <div className="flex flex-col gap-6 p-8">
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <button onClick={() => navigate('/kanban')} className="flex items-center gap-1 hover:text-foreground">
          <ChevronLeft className="h-3.5 w-3.5" /> Kanban
        </button>
        <span>/</span>
        <span className="font-medium text-foreground">{ticket.id}</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-foreground">{ticket.title}</h1>
            <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', severity.chip)}>{severity.label}</span>
            <StatusPill status={ticket.status} label={statusLabel(ticket.status)} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span>{ticket.id}</span>
            <span>Project: {project?.name || 'Unknown'}</span>
            {run && <span>Run: {run.suiteName}</span>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="w-44">
            <Select value={ticket.status} onChange={(e) => changeStatus(e.target.value)} disabled={busy}>
              {STATUSES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </Select>
          </div>
          <Button variant="outline" onClick={focusComment}>
            <MessageSquare className="h-4 w-4" /> Add Comment
          </Button>
          <Button onClick={generateReport} disabled={!run} title={run ? undefined : 'No linked run'}>
            <FileText className="h-4 w-4" /> Generate Report
          </Button>
        </div>
      </div>

      <div className="flex gap-6 border-b border-border">
        {VISUAL_TABS.map((t) => (
          <span
            key={t}
            className={cn(
              '-mb-px select-none border-b-2 px-1 pb-3 text-sm font-medium',
              t === 'Details' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground/60'
            )}
          >
            {t}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="text-sm font-semibold text-foreground">Description</div>
            <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{ticket.description || 'No description provided.'}</p>
          </div>

          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="text-sm font-semibold text-foreground">Reproduction Steps</div>
            {ticket.reproductionSteps?.length ? (
              <ol className="mt-2 flex flex-col gap-1.5">
                {ticket.reproductionSteps.map((step, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm text-foreground">
                    <span className="mt-0.5 w-4 shrink-0 text-xs font-medium text-muted-foreground">{idx + 1}.</span>
                    {step}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">No reproduction steps recorded.</p>
            )}
          </div>

          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="text-sm font-semibold text-foreground">Evidence Attachments ({evidenceMedia.length})</div>
            {!run && <p className="mt-2 text-sm text-muted-foreground">No linked run — evidence can't be resolved for this ticket.</p>}
            {run && evidenceMedia.length === 0 && <p className="mt-2 text-sm text-muted-foreground">No evidence attached.</p>}
            {run && evidenceMedia.length > 0 && (
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {evidenceMedia.map((m) => (
                  <div key={m.id} className="relative overflow-hidden rounded-lg border border-border bg-secondary/50">
                    <div className="flex h-24 items-center justify-center">
                      {mediaUrls[m.id] ? (
                        m.type === 'video' ? (
                          <video src={mediaUrls[m.id]} className="h-24 w-full object-cover" />
                        ) : (
                          <img src={mediaUrls[m.id]} alt={m.path} className="h-24 w-full object-cover" />
                        )
                      ) : (
                        <span className="text-xs text-muted-foreground">Loading…</span>
                      )}
                    </div>
                    <div className="absolute right-1.5 top-1.5 rounded-full bg-black/60 p-1 text-white">
                      {m.type === 'video' ? <Film className="h-3 w-3" /> : <ImageIcon className="h-3 w-3" />}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <div className="text-sm font-semibold text-foreground">Console Errors {run ? `(${run.consoleErrors?.length || 0})` : ''}</div>
              <div className="mt-2 flex flex-col gap-2">
                {!run && <p className="text-sm text-muted-foreground">No linked run.</p>}
                {run && (!run.consoleErrors || run.consoleErrors.length === 0) && <p className="text-sm text-muted-foreground">No console errors captured.</p>}
                {(run?.consoleErrors || []).map((err, idx) => (
                  <div key={idx} className="rounded-md border border-danger/20 bg-danger-bg px-3 py-2 font-mono text-xs text-danger">
                    {err.text}
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <div className="text-sm font-semibold text-foreground">Network Failures {run ? `(${run.networkFailures?.length || 0})` : ''}</div>
              <div className="mt-2 flex flex-col gap-2">
                {!run && <p className="text-sm text-muted-foreground">No linked run.</p>}
                {run && (!run.networkFailures || run.networkFailures.length === 0) && <p className="text-sm text-muted-foreground">No failed requests captured.</p>}
                {(run?.networkFailures || []).map((nf, idx) => (
                  <div key={idx} className="rounded-md border border-danger/20 bg-danger-bg px-3 py-2 text-xs">
                    <div className="truncate font-mono text-danger">{nf.url}</div>
                    <div className="text-muted-foreground">{nf.failure || 'Unknown failure'}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="text-sm font-semibold text-foreground">Comments ({ticket.comments?.length || 0})</div>
            <div className="mt-3 flex flex-col gap-3">
              {(!ticket.comments || ticket.comments.length === 0) && <p className="text-sm text-muted-foreground">No comments yet — be the first to add one.</p>}
              {(ticket.comments || []).map((c, idx) => (
                <div key={idx} className="flex items-start gap-2.5">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-primary">
                    {(c.author || '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-medium text-foreground">{c.author}</span>
                      <span className="text-muted-foreground">{fmtDate(c.at)}</span>
                    </div>
                    <p className="mt-0.5 text-sm text-foreground">{c.text}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-center gap-2">
              <Input
                ref={commentRef}
                placeholder="Add a comment..."
                value={commentDraft}
                onChange={(e) => setCommentDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitComment()}
              />
              <Button onClick={submitComment} disabled={!commentDraft.trim()}>
                Comment
              </Button>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-foreground">Checklist ({checklistDone}/{checklist.length})</div>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
              <div className="h-full rounded-full bg-primary" style={{ width: `${(checklistDone / checklist.length) * 100}%` }} />
            </div>
            <ul className="mt-3 flex flex-col gap-2">
              {checklist.map((item, idx) => (
                <li key={item.label}>
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <input type="checkbox" className="h-4 w-4 rounded border-input" checked={item.done} onChange={() => toggleChecklistItem(idx)} />
                    <span className={item.done ? 'text-muted-foreground line-through' : 'text-foreground'}>{item.label}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="text-sm font-semibold text-foreground">Status Workflow</div>
            <div className="mt-4 flex items-center">
              {STATUSES.map((s, idx) => (
                <div key={s.key} className="flex flex-1 items-center last:flex-none">
                  <div className="flex flex-col items-center gap-1">
                    <div
                      className={cn(
                        'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2',
                        idx < statusIndex
                          ? 'border-primary bg-primary text-primary-foreground'
                          : idx === statusIndex
                            ? 'border-primary bg-card text-primary'
                            : 'border-border bg-card text-muted-foreground'
                      )}
                    >
                      {idx < statusIndex ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-2.5 w-2.5 fill-current" />}
                    </div>
                    <span className={cn('w-16 text-center text-[10px] leading-tight', idx === statusIndex ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
                      {s.label}
                    </span>
                  </div>
                  {idx < STATUSES.length - 1 && <div className={cn('mx-1 h-0.5 flex-1', idx < statusIndex ? 'bg-primary' : 'bg-border')} />}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <User className="h-4 w-4 text-muted-foreground" /> Assignments
            </div>
            <div className="mt-3 flex flex-col gap-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Assignee</span>
                <span className="font-medium text-foreground">{ticket.assignee || 'Unassigned'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Reporter</span>
                <span className="font-medium text-foreground">{ticket.reporter || 'QA'}</span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Tag className="h-4 w-4 text-muted-foreground" /> Details
            </div>
            <div className="mt-3 flex flex-col gap-3 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">Labels</div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {(ticket.labels || []).map((label) => (
                    <span key={label} className="inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium text-accent-foreground">
                      {label}
                      <button onClick={() => removeLabel(label)} className="opacity-60 hover:opacity-100" aria-label={`Remove ${label}`}>
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                  <div className="flex items-center gap-1">
                    <Input
                      className="h-7 w-24 text-xs"
                      placeholder="Add label"
                      value={labelDraft}
                      onChange={(e) => setLabelDraft(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && addLabel()}
                    />
                    <button onClick={addLabel} className="rounded-full border border-dashed border-primary/40 p-1 text-primary hover:bg-accent" aria-label="Add label">
                      <Plus className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Environment</span>
                <span className="font-medium text-foreground">{run?.environment || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Created</span>
                <span className="font-medium text-foreground">{fmtDate(ticket.createdAt)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Updated</span>
                <span className="font-medium text-foreground">{timeAgo(ticket.updatedAt)}</span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Gauge className="h-4 w-4 text-muted-foreground" /> Quick Metrics
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg border border-border p-3">
                <div className="text-xs text-muted-foreground">Run Status</div>
                <div className="mt-1 font-semibold text-foreground">{run ? run.status : '—'}</div>
              </div>
              <div className="rounded-lg border border-border p-3">
                <div className="text-xs text-muted-foreground">Comments</div>
                <div className="mt-1 font-semibold text-foreground">{ticket.comments?.length || 0}</div>
              </div>
              <div className="rounded-lg border border-border p-3">
                <div className="text-xs text-muted-foreground">Checklist</div>
                <div className="mt-1 font-semibold text-foreground">
                  {checklistDone}/{checklist.length}
                </div>
              </div>
              <div className="rounded-lg border border-border p-3">
                <div className="text-xs text-muted-foreground">Attachments</div>
                <div className="mt-1 font-semibold text-foreground">{evidenceMedia.length}</div>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Link2 className="h-4 w-4 text-muted-foreground" /> Linked Runs
            </div>
            <div className="mt-3 flex flex-col gap-2">
              {!run && <p className="text-sm text-muted-foreground">No linked run.</p>}
              {run && (
                <button
                  onClick={() => navigate(`/runs/${run.runId}`)}
                  className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-left text-sm hover:bg-secondary/40"
                >
                  <div>
                    <div className="font-medium text-foreground">{run.suiteName}</div>
                    <div className="text-xs text-muted-foreground">{fmtDate(run.startedAt)}</div>
                  </div>
                  <StatusPill status={run.status} />
                </button>
              )}
              {run && startRun && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (!suite) {
                      toast('The suite for this run no longer exists.', 'error');
                      return;
                    }
                    startRun(suite, { environment: run.environment, headless: true });
                  }}
                >
                  Re-run Suite
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

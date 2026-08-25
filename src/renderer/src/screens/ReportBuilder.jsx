import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, Plus, X, FileText, Braces, FileSpreadsheet, Send, ChevronDown, Image as ImageIcon, Film, Copy, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { StatusPill } from '@/components/StatusPill';
import { EvidenceModal } from '@/components/EvidenceModal';
import { GenerateReportModal } from '@/components/GenerateReportModal';
import { fmtDate } from '@/lib/format';
import { shortRunId, resolveMediaUrls } from '@/lib/media';
import { deriveSeverity, stepsUpToFailure } from '@/lib/severity';
import { navigate } from '@/hooks/useHashRoute';
import { useToast } from '@/lib/toast';
import { cn } from '@/lib/utils';

const MEDIA_TABS = [
  { key: 'all', label: 'All Media' },
  { key: 'failed', label: 'Failed Steps' },
  { key: 'videos', label: 'Videos' },
  { key: 'screenshots', label: 'Screenshots' },
];

const SAVE_DEBOUNCE_MS = 600;

function defaultSelection(run) {
  if (run.reportSelection) return run.reportSelection;
  return { selectedMediaIds: (run.capturedMedia || []).map((m) => m.id), notes: {} };
}

export function ReportBuilder({ id, data }) {
  const { projects, runs: cachedRuns } = data;
  const toast = useToast();

  // The app-wide `data.runs` cache can be stale — a previous visit to this
  // screen may have written a newer `reportSelection` to disk than what's
  // cached. Seed the initial paint from the cache (fast, no flash of empty
  // state) but re-fetch the run fresh on mount and treat that as the
  // authoritative source — otherwise re-entering this screen can seed
  // selection state from a stale cache and the next edit flushes that
  // stale state back to disk, silently reverting a saved selection.
  const [freshRun, setFreshRun] = useState(null);
  const cachedRun = cachedRuns.find((r) => r.runId === id);
  const run = freshRun && freshRun.runId === id ? freshRun : cachedRun;
  const project = run ? projects.find((p) => p.id === run.projectId) : null;

  useEffect(() => {
    let cancelled = false;
    setFreshRun(null);
    window.qaflow.runs.get(id).then((r) => {
      if (!cancelled) setFreshRun(r);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const [selection, setSelection] = useState(() => (run ? defaultSelection(run) : { selectedMediaIds: [], notes: {} }));
  const [mediaTab, setMediaTab] = useState('all');
  const [sortOrder, setSortOrder] = useState('oldest');
  const [mediaUrls, setMediaUrls] = useState({});
  const [evidenceId, setEvidenceId] = useState(null);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [busyAction, setBusyAction] = useState(null);

  const [title, setTitle] = useState(() => (run ? `${run.suiteName} Failure - Run ${shortRunId(run.runId)}` : ''));
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState(() => (run ? deriveSeverity(run) : 'medium'));
  const [environment, setEnvironment] = useState(() => run?.environment || '');
  const [reproSteps, setReproSteps] = useState(() => (run ? stepsUpToFailure(run).map((s) => s.name) : []));
  const [newStepDraft, setNewStepDraft] = useState('');
  const [previewTab, setPreviewTab] = useState('json');
  const [ticketText, setTicketText] = useState('');

  const saveTimer = useRef(null);
  const initialLoad = useRef(true);

  // Reseed on every `run` object change, not just `run.runId` — the fresh
  // fetch above resolves to a new object with the same runId, and it must
  // re-seed selection/title/etc from that authoritative copy rather than
  // leaving the (possibly stale) cache-seeded state in place.
  useEffect(() => {
    if (!run) return;
    setSelection(defaultSelection(run));
    setTitle(`${run.suiteName} Failure - Run ${shortRunId(run.runId)}`);
    setSeverity(deriveSeverity(run));
    setEnvironment(run.environment || '');
    setReproSteps(stepsUpToFailure(run).map((s) => s.name));
    initialLoad.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  useEffect(() => {
    if (!run) return undefined;
    let cancelled = false;
    resolveMediaUrls(run.runId, run.capturedMedia).then((map) => {
      if (!cancelled) setMediaUrls(map);
    });
    return () => {
      cancelled = true;
    };
  }, [run]);

  // Persist `reportSelection` on every selection/note change, debounced —
  // skip the very first run right after loading a run (that write would be
  // a no-op echo of what's already on disk).
  useEffect(() => {
    if (!run) return undefined;
    if (initialLoad.current) {
      initialLoad.current = false;
      return undefined;
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      window.qaflow.reports.saveSelection(run.runId, selection).catch((e) => {
        toast(`Failed to save selection: ${e.message}`, 'error');
      });
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(saveTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, run?.runId]);

  useEffect(() => {
    if (!run || previewTab !== 'ticket') return undefined;
    let cancelled = false;
    window.qaflow.reports
      .ticketText(run.runId)
      .then((text) => {
        if (!cancelled) setTicketText(text);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [run, previewTab, selection]);

  const stepsById = useMemo(() => {
    if (!run) return {};
    return Object.fromEntries((run.steps || []).map((s, idx) => [idx, s]));
  }, [run]);

  const mediaWithStep = useMemo(() => {
    if (!run) return [];
    return (run.capturedMedia || []).map((m) => ({ ...m, step: Number.isInteger(m.stepIndex) ? stepsById[m.stepIndex] : null }));
  }, [run, stepsById]);

  const filteredMedia = useMemo(() => {
    let list = mediaWithStep;
    if (mediaTab === 'failed') list = list.filter((m) => m.step?.status === 'failed');
    if (mediaTab === 'videos') list = list.filter((m) => m.type === 'video');
    if (mediaTab === 'screenshots') list = list.filter((m) => m.type === 'screenshot');
    if (sortOrder === 'newest') list = [...list].reverse();
    return list;
  }, [mediaWithStep, mediaTab, sortOrder]);

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

  const allIds = (run.capturedMedia || []).map((m) => m.id);
  const allSelected = allIds.length > 0 && allIds.every((mid) => selection.selectedMediaIds.includes(mid));
  const selectedCount = selection.selectedMediaIds.length;

  function toggleSelectAll() {
    setSelection((s) => ({ ...s, selectedMediaIds: allSelected ? [] : allIds }));
  }

  function clearSelection() {
    setSelection((s) => ({ ...s, selectedMediaIds: [] }));
  }

  function toggleMedia(mediaId) {
    setSelection((s) => ({
      ...s,
      selectedMediaIds: s.selectedMediaIds.includes(mediaId) ? s.selectedMediaIds.filter((x) => x !== mediaId) : [...s.selectedMediaIds, mediaId],
    }));
  }

  function setNote(mediaId, text) {
    setSelection((s) => ({ ...s, notes: { ...s.notes, [mediaId]: text } }));
  }

  // Every export action reads `reportSelection` server-side, but the
  // autosave above is debounced 600ms — a click right after a checkbox/note
  // change would otherwise export the previous selection. Cancel the
  // pending debounce and write the live selection synchronously first.
  async function flushSelection() {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    try {
      await window.qaflow.reports.saveSelection(run.runId, selection);
    } catch (e) {
      toast(`Failed to save selection: ${e.message}`, 'error');
    }
  }

  function addStep() {
    if (!newStepDraft.trim()) return;
    setReproSteps((steps) => [...steps, newStepDraft.trim()]);
    setNewStepDraft('');
  }

  function updateStep(idx, value) {
    setReproSteps((steps) => steps.map((s, i) => (i === idx ? value : s)));
  }

  function removeStep(idx) {
    setReproSteps((steps) => steps.filter((_, i) => i !== idx));
  }

  async function exportJson() {
    setBusyAction('json');
    await flushSelection();
    try {
      const filePath = await window.qaflow.reports.exportJson(run.runId);
      if (filePath) toast(`JSON report saved to ${filePath}`, 'success');
    } catch (e) {
      toast(`Failed to export JSON: ${e.message}`, 'error');
    } finally {
      setBusyAction(null);
    }
  }

  async function exportExcel() {
    setBusyAction('excel');
    await flushSelection();
    try {
      const filePath = await window.qaflow.reports.exportExcel(run.runId);
      if (filePath) toast(`Excel report saved to ${filePath}`, 'success');
    } catch (e) {
      toast(`Failed to export Excel: ${e.message}`, 'error');
    } finally {
      setBusyAction(null);
    }
  }

  async function createTicket() {
    setBusyAction('ticket');
    await flushSelection();
    try {
      const ticket = await window.qaflow.reports.createTicket(run.runId);
      toast(`Bug ticket "${ticket.title}" created on the Kanban board.`, 'success');
    } catch (e) {
      toast(`Failed to create ticket: ${e.message}`, 'error');
    } finally {
      setBusyAction(null);
    }
  }

  async function sendToDavid() {
    setBusyAction('david');
    await flushSelection();
    try {
      const zipPath = await window.qaflow.reports.bundle(run.runId);
      if (!zipPath) return;
      await window.qaflow.app.revealPath(zipPath);
      toast('Bundle ready to send.', 'success');
    } catch (e) {
      toast(`Failed to build bundle: ${e.message}`, 'error');
    } finally {
      setBusyAction(null);
    }
  }

  // Mirrors what GenerateReportModal's "Copy JSON" destination copies — the
  // one export path that can actually honor the title/severity/environment/
  // repro-step edits, since exportJson/exportExcel/createTicket all read the
  // persisted run+reportSelection server-side (see the hint text below).
  const previewJson = JSON.stringify(
    { ...run, reportSelection: selection, reportTitle: title, severity, environment, reproductionSteps: reproSteps },
    null,
    2
  );
  const environments = (project?.environments || []).map((e) => e.name);

  return (
    <div className="flex flex-col gap-6 p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <button onClick={() => navigate(`/runs/${run.runId}`)} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-3.5 w-3.5" /> Back to Run
          </button>
          <h1 className="mt-2 text-2xl font-semibold text-foreground">Media Selection &amp; Report Builder</h1>
          <p className="mt-1 text-sm text-muted-foreground">Review and select evidence from your test run to build a comprehensive report.</p>
        </div>
        <div className="text-right">
          <div className="flex items-center justify-end gap-2">
            <span className="text-sm font-semibold text-foreground">{shortRunId(run.runId)}</span>
            <StatusPill status={run.status} />
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{fmtDate(run.startedAt)}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_380px]">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-6 border-b border-border">
              {MEDIA_TABS.map((t) => {
                const count =
                  t.key === 'all'
                    ? mediaWithStep.length
                    : t.key === 'failed'
                      ? mediaWithStep.filter((m) => m.step?.status === 'failed').length
                      : t.key === 'videos'
                        ? mediaWithStep.filter((m) => m.type === 'video').length
                        : mediaWithStep.filter((m) => m.type === 'screenshot').length;
                return (
                  <button
                    key={t.key}
                    onClick={() => setMediaTab(t.key)}
                    className={cn(
                      '-mb-px flex items-center gap-1.5 border-b-2 px-1 pb-3 text-sm font-medium transition-colors',
                      mediaTab === t.key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {t.label} <span className="rounded-full bg-secondary px-1.5 py-0.5 text-xs text-muted-foreground">{count}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 text-sm">
              <label className="flex items-center gap-2 font-medium text-foreground">
                <input type="checkbox" className="h-4 w-4 rounded border-input" checked={allSelected} onChange={toggleSelectAll} /> Select all
              </label>
              <span className="text-muted-foreground">{selectedCount} selected</span>
              {selectedCount > 0 && (
                <button onClick={clearSelection} className="text-primary hover:underline">
                  Clear selection
                </button>
              )}
            </div>
            <Select className="w-40" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)}>
              <option value="oldest">Sort: Oldest first</option>
              <option value="newest">Sort: Newest first</option>
            </Select>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredMedia.length === 0 && (
              <div className="col-span-full rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
                No media in this view.
              </div>
            )}
            {filteredMedia.map((m) => {
              const checked = selection.selectedMediaIds.includes(m.id);
              return (
                <div key={m.id} className={cn('flex flex-col gap-2 rounded-xl border bg-card p-3 shadow-sm', checked ? 'border-primary' : 'border-border')}>
                  <div className="relative cursor-pointer overflow-hidden rounded-lg border border-border bg-secondary/50" onClick={() => setEvidenceId(m.id)}>
                    <label className="absolute left-2 top-2 z-10" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" className="h-4 w-4 rounded border-input bg-background" checked={checked} onChange={() => toggleMedia(m.id)} />
                    </label>
                    <div className="flex h-32 items-center justify-center">
                      {mediaUrls[m.id] ? (
                        m.type === 'video' ? (
                          <video src={mediaUrls[m.id]} className="h-32 w-full object-cover" />
                        ) : (
                          <img src={mediaUrls[m.id]} alt={m.path} className="h-32 w-full object-cover" />
                        )
                      ) : (
                        <span className="text-xs text-muted-foreground">Loading…</span>
                      )}
                    </div>
                    <div className="absolute right-2 top-2 rounded-full bg-black/60 p-1 text-white">
                      {m.type === 'video' ? <Film className="h-3 w-3" /> : <ImageIcon className="h-3 w-3" />}
                    </div>
                    {m.step?.status === 'failed' && <div className="absolute bottom-0 left-0 right-0 bg-danger/85 px-2 py-1 text-center text-xs font-medium text-white">Failed step</div>}
                  </div>
                  <div>
                    <div className="truncate text-sm font-medium text-foreground">{m.step?.name || m.path}</div>
                    <div className="text-xs text-muted-foreground">
                      {m.type === 'video' ? 'Video' : 'Screenshot'}
                      {Number.isInteger(m.stepIndex) ? ` · Step ${m.stepIndex + 1}` : ''}
                    </div>
                  </div>
                  <Input
                    className="h-8 text-xs"
                    placeholder="Add note (optional)"
                    value={selection.notes[m.id] || ''}
                    onChange={(e) => setNote(m.id, e.target.value)}
                  />
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="text-sm font-semibold text-foreground">Report Summary</div>
            <div className="mt-2 flex items-start gap-1.5 rounded-md bg-accent px-2.5 py-2 text-xs text-accent-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>Title, severity and repro-step edits appear in the copied JSON only — file exports and tickets use the run's recorded values (v2 will persist edits).</span>
            </div>
            <div className="mt-3 flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Title</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Description</Label>
                <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe the failure..." />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label>Severity</Label>
                  <Select value={severity} onChange={(e) => setSeverity(e.target.value)}>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Environment</Label>
                  <Select value={environment} onChange={(e) => setEnvironment(e.target.value)}>
                    {!environments.includes(environment) && <option value={environment}>{environment || 'Unknown'}</option>}
                    {environments.map((env) => (
                      <option key={env} value={env}>
                        {env}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
              <div className="flex items-center justify-between rounded-md bg-secondary/60 px-3 py-2 text-sm">
                <span className="text-muted-foreground">Selected Media</span>
                <span className="font-semibold text-foreground">
                  {selectedCount} / {allIds.length}
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-foreground">Reproduction Steps</div>
              <Button variant="outline" size="sm" onClick={addStep}>
                <Plus className="h-3.5 w-3.5" /> Add Step
              </Button>
            </div>
            <ol className="mt-3 flex flex-col gap-2">
              {reproSteps.map((step, idx) => (
                <li key={idx} className="flex items-center gap-2">
                  <span className="w-4 shrink-0 text-xs font-medium text-muted-foreground">{idx + 1}.</span>
                  <Input className="h-8 flex-1 text-sm" value={step} onChange={(e) => updateStep(idx, e.target.value)} />
                  <button onClick={() => removeStep(idx)} className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-danger-bg hover:text-danger">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
              {reproSteps.length === 0 && <p className="text-sm text-muted-foreground">No steps yet — add one below.</p>}
            </ol>
            <div className="mt-2 flex items-center gap-2">
              <Input
                className="h-8 flex-1 text-sm"
                placeholder="New step..."
                value={newStepDraft}
                onChange={(e) => setNewStepDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addStep()}
              />
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="text-sm font-semibold text-foreground">Actions</div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button className="col-span-2" onClick={() => setGenerateOpen(true)} disabled={Boolean(busyAction)}>
                <FileText className="h-4 w-4" /> Generate Report
              </Button>
              <Button variant="outline" onClick={exportJson} disabled={busyAction === 'json'}>
                <Braces className="h-4 w-4" /> {busyAction === 'json' ? 'Exporting…' : 'Export JSON'}
              </Button>
              <Button variant="outline" onClick={exportExcel} disabled={busyAction === 'excel'}>
                <FileSpreadsheet className="h-4 w-4" /> {busyAction === 'excel' ? 'Exporting…' : 'Export Excel'}
              </Button>
              <Button variant="outline" className="col-span-2" onClick={createTicket} disabled={busyAction === 'ticket'}>
                <Send className="h-4 w-4" /> {busyAction === 'ticket' ? 'Creating…' : 'Create Jira Ticket'}
              </Button>
              <div className="col-span-2 flex">
                <Button variant="outline" className="flex-1 rounded-r-none" onClick={sendToDavid} disabled={busyAction === 'david'}>
                  <Send className="h-4 w-4" /> {busyAction === 'david' ? 'Sending…' : 'Send to David'}
                </Button>
                <Button
                  variant="outline"
                  className="rounded-l-none border-l-0 px-2"
                  onClick={sendToDavid}
                  disabled={busyAction === 'david'}
                  title="Send to David"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card shadow-sm">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <div className="text-sm font-semibold text-foreground">Live Preview</div>
              <div className="flex gap-1 rounded-md bg-secondary p-0.5">
                <button
                  onClick={() => setPreviewTab('json')}
                  className={cn('rounded px-2.5 py-1 text-xs font-medium', previewTab === 'json' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground')}
                >
                  JSON
                </button>
                <button
                  onClick={() => setPreviewTab('ticket')}
                  className={cn('rounded px-2.5 py-1 text-xs font-medium', previewTab === 'ticket' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground')}
                >
                  Jira Ticket
                </button>
              </div>
            </div>
            <div className="max-h-72 overflow-auto p-4">
              {previewTab === 'json' ? (
                <pre className="whitespace-pre-wrap break-all font-mono text-xs text-foreground">{previewJson}</pre>
              ) : (
                <pre className="whitespace-pre-wrap font-mono text-xs text-foreground">{ticketText || 'Loading ticket preview…'}</pre>
              )}
            </div>
            <div className="border-t border-border px-4 py-2 text-right">
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(previewTab === 'json' ? previewJson : ticketText);
                  toast('Copied to clipboard.', 'success');
                }}
                className="flex items-center gap-1 text-xs font-medium text-primary hover:underline ml-auto"
              >
                <Copy className="h-3 w-3" /> Copy
              </button>
            </div>
          </div>
        </div>
      </div>

      <EvidenceModal
        open={Boolean(evidenceId)}
        onClose={() => setEvidenceId(null)}
        run={run}
        media={run.capturedMedia || []}
        mediaUrls={mediaUrls}
        activeId={evidenceId}
        onActiveChange={setEvidenceId}
        selectedIds={new Set(selection.selectedMediaIds)}
        onToggleSelect={toggleMedia}
        notes={selection.notes}
        onNoteChange={setNote}
      />

      <GenerateReportModal
        open={generateOpen}
        onClose={() => setGenerateOpen(false)}
        run={run}
        project={project}
        environments={environments}
        selection={selection}
        title={title}
        severity={severity}
        environment={environment}
        reproSteps={reproSteps}
        onTitleChange={setTitle}
        onSeverityChange={setSeverity}
        onEnvironmentChange={setEnvironment}
        onFlushSelection={flushSelection}
      />
    </div>
  );
}

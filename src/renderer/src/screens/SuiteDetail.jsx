import { useMemo, useState } from 'react';
import { ChevronRight, Play, Archive, Download, ArrowUp, ArrowDown, Trash2, Pencil, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { StatusPill } from '@/components/StatusPill';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { RunSuiteModal } from '@/components/RunSuiteModal';
import { projectVisual } from '@/lib/projectVisuals';
import { fmtDate, fmtDuration } from '@/lib/format';
import { withinLastDays, successRate } from '@/lib/stats';
import { stepIcon, stepDetail, estimateDurationMs } from '@/lib/steps';
import { navigate } from '@/hooks/useHashRoute';
import { useToast } from '@/lib/toast';

const FILTERS = [
  { key: 'all', label: 'All Runs' },
  { key: 'passed', label: 'Passed' },
  { key: 'failed', label: 'Failed' },
  { key: 'skipped', label: 'Skipped' },
];

function move(list, from, to) {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function SuiteDetail({ id, data, startRun }) {
  const { projects, suites, runs, reload } = data;
  const toast = useToast();

  const suite = suites.find((s) => s.id === id);
  const project = suite ? projects.find((p) => p.id === suite.projectId) : null;

  const [runModalOpen, setRunModalOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [notesDraft, setNotesDraft] = useState(suite?.description || '');
  const [notesTouched, setNotesTouched] = useState(false);
  const [editingIndex, setEditingIndex] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [runFilter, setRunFilter] = useState('all');

  const suiteRuns = useMemo(
    () => runs.filter((r) => r.suiteId === id).sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt)),
    [runs, id]
  );
  const last30 = useMemo(() => suiteRuns.filter((r) => withinLastDays(r.startedAt, 30)), [suiteRuns]);
  const lastRun = suiteRuns[0];

  const filteredRuns = useMemo(() => (runFilter === 'all' ? suiteRuns : suiteRuns.filter((r) => r.status === runFilter)), [suiteRuns, runFilter]);

  if (!suite) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
        <h2 className="text-lg font-semibold text-foreground">Suite not found</h2>
        <p className="text-sm text-muted-foreground">It may have been deleted or archived.</p>
        <Button variant="outline" onClick={() => navigate('/suites')}>
          Back to Test Suites
        </Button>
      </div>
    );
  }

  const { Icon, colorClass } = projectVisual(project || { id: suite.projectId });
  const steps = suite.steps || [];
  const estDuration = estimateDurationMs(steps);

  async function persistSteps(nextSteps) {
    try {
      await window.qaflow.suites.save({ ...suite, steps: nextSteps });
      reload();
    } catch (e) {
      toast(`Failed to update steps: ${e.message}`, 'error');
    }
  }

  function startRename(idx) {
    setEditingIndex(idx);
    setEditingName(steps[idx].name);
  }

  async function commitRename() {
    if (editingIndex === null) return;
    const next = steps.map((s, i) => (i === editingIndex ? { ...s, name: editingName.trim() || s.name } : s));
    setEditingIndex(null);
    await persistSteps(next);
  }

  async function deleteStep(idx) {
    await persistSteps(steps.filter((_, i) => i !== idx));
  }

  async function reorderStep(idx, dir) {
    await persistSteps(move(steps, idx, idx + dir));
  }

  async function saveNotes() {
    if (!notesTouched) return;
    try {
      await window.qaflow.suites.save({ ...suite, description: notesDraft });
      setNotesTouched(false);
      toast('Notes saved.', 'success');
      reload();
    } catch (e) {
      toast(`Failed to save notes: ${e.message}`, 'error');
    }
  }

  async function archiveSuite() {
    try {
      await window.qaflow.suites.save({ ...suite, archived: true });
      toast(`"${suite.name}" archived.`, 'success');
      navigate('/suites');
      reload();
    } catch (e) {
      toast(`Failed to archive suite: ${e.message}`, 'error');
    }
  }

  function exportSuiteJson() {
    const blob = new Blob([JSON.stringify(suite, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${suite.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function rerun(run) {
    startRun(suite, { environment: run.environment, headless: true });
  }

  return (
    <div className="flex flex-col gap-6 p-8">
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <a href="#/suites" className="hover:text-foreground hover:underline">
          Test Suites
        </a>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-foreground">{suite.name}</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="flex items-start gap-4">
          <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-xl text-white ${colorClass}`}>
            <Icon className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold text-foreground">{suite.name}</h1>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${suite.archived ? 'bg-secondary text-muted-foreground' : 'bg-success-bg text-success'}`}>
                {suite.archived ? 'Archived' : 'Active'}
              </span>
            </div>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">{suite.description || 'No description yet.'}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-secondary px-2.5 py-1 font-medium text-muted-foreground">Project: {project?.name || 'Unknown'}</span>
              <span className="rounded-full bg-secondary px-2.5 py-1 font-medium text-muted-foreground">Environment: {suite.environment || '—'}</span>
              <span className="rounded-full bg-secondary px-2.5 py-1 font-medium text-muted-foreground">Browser: Chrome</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => toast('Editing suite metadata — use the kebab menu on Test Suites for now.', 'info')}>
            <Pencil className="h-4 w-4" /> Edit
          </Button>
          <Button onClick={() => setRunModalOpen(true)}>
            <Play className="h-4 w-4" /> Run Suite
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="text-xs font-medium text-muted-foreground">Total Steps</div>
          <div className="mt-1 text-2xl font-semibold text-foreground">{steps.length}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="text-xs font-medium text-muted-foreground">Est. Duration</div>
          <div className="mt-1 text-2xl font-semibold text-foreground">{fmtDuration(estDuration)}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="text-xs font-medium text-muted-foreground">Success Rate (30d)</div>
          <div className="mt-1 text-2xl font-semibold text-foreground">{Math.round(successRate(last30))}%</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="text-xs font-medium text-muted-foreground">Last Run</div>
          <div className="mt-1 text-sm font-semibold text-foreground">{lastRun ? fmtDate(lastRun.startedAt) : 'Never'}</div>
          {lastRun && <StatusPill status={lastRun.status} className="mt-1" />}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-6">
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="text-base font-semibold text-foreground">Step Timeline Preview</div>
            <div className="mt-4 flex items-start gap-1 overflow-x-auto pb-2">
              {steps.length === 0 && <p className="text-sm text-muted-foreground">No steps recorded.</p>}
              {steps.map((step, idx) => (
                <div key={idx} className="flex shrink-0 items-start">
                  <div className="flex w-24 flex-col items-center gap-1 text-center">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-primary text-xs font-semibold text-primary">{idx + 1}</div>
                    <span className="line-clamp-2 text-xs text-foreground">{step.name}</span>
                  </div>
                  {idx < steps.length - 1 && <div className="mt-4 h-px w-8 bg-border" />}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card shadow-sm">
            <div className="border-b border-border px-5 py-4 text-base font-semibold text-foreground">Steps ({steps.length})</div>
            <div className="flex flex-col divide-y divide-border">
              {steps.length === 0 && <p className="px-5 py-8 text-center text-sm text-muted-foreground">This suite has no steps.</p>}
              {steps.map((step, idx) => {
                const StepIcon = stepIcon(step.type);
                return (
                  <div key={idx} className="flex items-center gap-3 px-5 py-3">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent text-primary">
                      <StepIcon className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      {editingIndex === idx ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            autoFocus
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitRename();
                              if (e.key === 'Escape') setEditingIndex(null);
                            }}
                            className="h-7 flex-1 rounded-md border border-input bg-background px-2 text-sm"
                          />
                          <button onClick={commitRename} className="rounded-md p-1 text-success hover:bg-success-bg">
                            <Check className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => setEditingIndex(null)} className="rounded-md p-1 text-muted-foreground hover:bg-secondary">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => startRename(idx)} className="truncate text-left text-sm font-medium text-foreground hover:underline">
                          {step.name}
                        </button>
                      )}
                      <div className="truncate text-xs text-muted-foreground">{stepDetail(step)}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button onClick={() => reorderStep(idx, -1)} disabled={idx === 0} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent disabled:opacity-30">
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => reorderStep(idx, 1)} disabled={idx === steps.length - 1} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent disabled:opacity-30">
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => deleteStep(idx)} className="rounded-md p-1.5 text-muted-foreground hover:bg-danger-bg hover:text-danger">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card shadow-sm">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div className="text-base font-semibold text-foreground">Recent Run History</div>
              <div className="flex gap-1">
                {FILTERS.map((f) => (
                  <button
                    key={f.key}
                    onClick={() => setRunFilter(f.key)}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${runFilter === f.key ? 'bg-accent text-primary' : 'text-muted-foreground hover:bg-secondary'}`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <th className="px-5 py-2.5 font-medium">Status</th>
                    <th className="px-5 py-2.5 font-medium">Started At</th>
                    <th className="px-5 py-2.5 font-medium">Duration</th>
                    <th className="px-5 py-2.5 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRuns.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-5 py-8 text-center text-sm text-muted-foreground">
                        No runs yet.
                      </td>
                    </tr>
                  )}
                  {filteredRuns.slice(0, 8).map((r) => (
                    <tr key={r.runId} onClick={() => navigate(`/runs/${r.runId}`)} className="cursor-pointer border-b border-border last:border-0 hover:bg-secondary/40">
                      <td className="px-5 py-3">
                        <StatusPill status={r.status} />
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">{fmtDate(r.startedAt)}</td>
                      <td className="px-5 py-3 text-muted-foreground">{r.finishedAt ? fmtDuration(new Date(r.finishedAt) - new Date(r.startedAt)) : '—'}</td>
                      <td className="px-5 py-3 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            rerun(r);
                          }}
                          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-primary"
                          title="Re-run"
                        >
                          <Play className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="text-base font-semibold text-foreground">Suite Notes</div>
            <Textarea
              className="mt-3"
              rows={4}
              value={notesDraft}
              onChange={(e) => {
                setNotesDraft(e.target.value);
                setNotesTouched(true);
              }}
              onBlur={saveNotes}
              placeholder="Add notes about this suite's coverage, edge cases, or gotchas..."
            />
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="text-sm font-semibold text-foreground">Suite Summary</div>
            <p className="text-xs text-muted-foreground">Last 30 days</p>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">Total Runs</div>
                <div className="text-lg font-semibold text-foreground">{last30.length}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Passed</div>
                <div className="text-lg font-semibold text-success">{last30.filter((r) => r.status === 'passed').length}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Failed</div>
                <div className="text-lg font-semibold text-danger">{last30.filter((r) => r.status === 'failed').length}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Success Rate</div>
                <div className="text-lg font-semibold text-foreground">{Math.round(successRate(last30))}%</div>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="text-sm font-semibold text-foreground">Quick Filters</div>
            <div className="mt-3 flex flex-col gap-1">
              {FILTERS.map((f) => {
                const count = f.key === 'all' ? suiteRuns.length : suiteRuns.filter((r) => r.status === f.key).length;
                return (
                  <button
                    key={f.key}
                    onClick={() => setRunFilter(f.key)}
                    className={`flex items-center justify-between rounded-md px-2.5 py-1.5 text-sm ${
                      runFilter === f.key ? 'bg-accent text-primary' : 'text-foreground hover:bg-secondary'
                    }`}
                  >
                    {f.label}
                    <span className="text-xs text-muted-foreground">{count}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="text-sm font-semibold text-foreground">Actions</div>
            <div className="mt-3 flex flex-col gap-2">
              <Button variant="outline" onClick={exportSuiteJson}>
                <Download className="h-4 w-4" /> Export Suite JSON
              </Button>
              {!suite.archived && (
                <Button variant="outline" className="text-danger hover:bg-danger-bg hover:text-danger" onClick={() => setArchiveOpen(true)}>
                  <Archive className="h-4 w-4" /> Archive Suite
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      <RunSuiteModal
        open={runModalOpen}
        onClose={() => setRunModalOpen(false)}
        suite={suite}
        project={project}
        runs={runs}
        onRun={(s, opts) => startRun(s, opts)}
      />

      <ConfirmDialog
        open={archiveOpen}
        title={`Archive "${suite.name}"?`}
        description="Archived suites stay on disk and can be restored anytime, but are hidden from the default view."
        confirmLabel="Archive"
        variant="danger"
        onConfirm={archiveSuite}
        onClose={() => setArchiveOpen(false)}
      />
    </div>
  );
}

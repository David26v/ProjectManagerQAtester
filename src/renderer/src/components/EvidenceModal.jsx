import { useEffect, useRef, useState } from 'react';
import { ZoomOut, ZoomIn, Maximize2, ChevronLeft, ChevronRight, Image as ImageIcon, Film } from 'lucide-react';
import { Dialog, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { fmtDate } from '@/lib/format';

// Evidence Preview modal (modal-5 mockup) — opens on a media thumbnail click
// from the Report Builder's media grid. Generic over `media`/`mediaUrls` so
// it doesn't know anything about how selection is persisted; the parent
// (ReportBuilder) owns `reportSelection` and passes callbacks down.
function stepOffsetMs(steps, index) {
  let cumulative = 0;
  for (let i = 0; i < index; i += 1) cumulative += steps[i]?.durationMs || 0;
  return cumulative;
}

export function EvidenceModal({ open, onClose, run, media = [], mediaUrls = {}, activeId, onActiveChange, selectedIds, onToggleSelect, notes = {}, onNoteChange }) {
  const [zoom, setZoom] = useState(100);
  const noteRef = useRef(null);

  const activeIndex = media.findIndex((m) => m.id === activeId);
  const active = activeIndex >= 0 ? media[activeIndex] : null;

  useEffect(() => {
    setZoom(100);
  }, [activeId]);

  if (!open || !active) return null;

  const steps = run?.steps || [];
  const step = Number.isInteger(active.stepIndex) ? steps[active.stepIndex] : null;
  const isSelected = selectedIds?.has(active.id);
  const relatedList = media.filter((m) => m.id !== active.id);
  const gotoStep = [...steps].slice(0, (active.stepIndex ?? steps.length) + 1).reverse().find((s) => s?.name?.toLowerCase().includes('navigate') || s?.name?.toLowerCase().includes('goto'));

  function stepFor(m) {
    return Number.isInteger(m.stepIndex) ? steps[m.stepIndex] : null;
  }

  return (
    <Dialog open={open} onClose={onClose} className="max-w-6xl">
      <div className="flex items-start justify-between gap-4 border-b border-border p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
            {active.type === 'video' ? <Film className="h-5 w-5" /> : <ImageIcon className="h-5 w-5" />}
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Evidence Preview</h2>
            <p className="text-sm text-muted-foreground">Review captured media and diagnostic data from this run.</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {onToggleSelect && (
            <label className="flex items-center gap-2 text-sm font-medium text-foreground">
              <input type="checkbox" checked={Boolean(isSelected)} onChange={() => onToggleSelect(active.id)} className="h-4 w-4 rounded border-input" />
              Include in report
            </label>
          )}
          <DialogClose onClick={onClose} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-0 overflow-y-auto lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-4 border-b border-border p-5 lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {activeIndex + 1} of {media.length}
            </span>
            <div className="flex items-center gap-1">
              <button
                disabled={activeIndex <= 0}
                onClick={() => onActiveChange(media[activeIndex - 1].id)}
                className="rounded-md p-1 hover:bg-accent disabled:opacity-30"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                disabled={activeIndex >= media.length - 1}
                onClick={() => onActiveChange(media[activeIndex + 1].id)}
                className="rounded-md p-1 hover:bg-accent disabled:opacity-30"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="flex min-h-[320px] flex-1 items-center justify-center overflow-auto rounded-lg border border-border bg-secondary/40 p-4">
            {mediaUrls[active.id] ? (
              active.type === 'video' ? (
                <video controls src={mediaUrls[active.id]} className="max-h-[420px] max-w-full" />
              ) : (
                <img src={mediaUrls[active.id]} alt={active.path} style={{ width: `${zoom}%` }} className="max-w-none" />
              )
            ) : (
              <span className="text-sm text-muted-foreground">Loading preview…</span>
            )}
          </div>

          {active.type !== 'video' && (
            <div className="flex items-center justify-center gap-2">
              <Button variant="outline" size="icon" onClick={() => setZoom((z) => Math.max(25, z - 25))}>
                <ZoomOut className="h-4 w-4" />
              </Button>
              <span className="w-12 text-center text-sm text-foreground">{zoom}%</span>
              <Button variant="outline" size="icon" onClick={() => setZoom((z) => Math.min(200, z + 25))}>
                <ZoomIn className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => setZoom(100)}>
                <Maximize2 className="h-3.5 w-3.5" /> Fit
              </Button>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-6 p-5">
          <div>
            <div className="text-sm font-semibold text-foreground">Details</div>
            <div className="mt-2 flex flex-col gap-2 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Step Name</span>
                <span className="text-right font-medium text-foreground">{step?.name || '—'}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Step #</span>
                <span className="font-medium text-foreground">{Number.isInteger(active.stepIndex) ? `${active.stepIndex + 1} of ${steps.length}` : '—'}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Status</span>
                <span className={`font-medium ${step?.status === 'failed' ? 'text-danger' : step?.status === 'skipped' ? 'text-muted-foreground' : 'text-success'}`}>
                  {step?.status || '—'}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Timestamp</span>
                <span className="font-medium text-foreground">
                  {run?.startedAt ? fmtDate(new Date(new Date(run.startedAt).getTime() + stepOffsetMs(steps, active.stepIndex ?? 0)).toISOString()) : '—'}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Environment</span>
                <span className="font-medium text-foreground">{run?.environment || '—'}</span>
              </div>
              {gotoStep?.value && (
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">URL</span>
                  <span className="truncate font-medium text-foreground">{gotoStep.value}</span>
                </div>
              )}
            </div>
          </div>

          <div>
            <div className="text-sm font-semibold text-foreground">Note</div>
            <Textarea
              ref={noteRef}
              className="mt-2"
              rows={3}
              placeholder="Add a note about this evidence..."
              value={notes[active.id] || ''}
              onChange={(e) => onNoteChange && onNoteChange(active.id, e.target.value)}
            />
          </div>

          <div>
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-foreground">Related Evidence ({relatedList.length})</div>
            </div>
            <div className="mt-2 flex max-h-64 flex-col gap-2 overflow-y-auto">
              {relatedList.length === 0 && <p className="text-xs text-muted-foreground">No other media in this run.</p>}
              {relatedList.map((m) => {
                const mStep = stepFor(m);
                return (
                  <button
                    key={m.id}
                    onClick={() => onActiveChange(m.id)}
                    className="flex items-center gap-2.5 rounded-md border border-border p-2 text-left hover:bg-secondary/40"
                  >
                    <div className="h-10 w-14 shrink-0 overflow-hidden rounded bg-secondary">
                      {mediaUrls[m.id] && m.type !== 'video' && <img src={mediaUrls[m.id]} alt={m.path} className="h-full w-full object-cover" />}
                      {m.type === 'video' && (
                        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                          <Film className="h-4 w-4" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium text-foreground">{mStep?.name || m.path}</div>
                      <div className="text-xs text-muted-foreground capitalize">{m.type}</div>
                    </div>
                    {mStep?.status && (
                      <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${mStep.status === 'failed' ? 'bg-danger-bg text-danger' : 'bg-secondary text-muted-foreground'}`}>
                        {mStep.status}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t border-border bg-secondary/30 px-5 py-3.5">
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
        <Button variant="outline" onClick={() => noteRef.current?.focus()}>
          Add Note
        </Button>
        {onToggleSelect && (
          <Button onClick={() => onToggleSelect(active.id)}>{isSelected ? 'Included in Report' : 'Include in Report'}</Button>
        )}
      </div>
    </Dialog>
  );
}

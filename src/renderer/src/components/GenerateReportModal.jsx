import { useEffect, useState } from 'react';
import { FileText, Download, Braces, Send, Zap, Image as ImageIcon, Film, ScrollText, Paperclip, CheckCircle2, Info } from 'lucide-react';
import { Dialog, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { useToast } from '@/lib/toast';
import { cn } from '@/lib/utils';

const FORMATS = [
  { key: 'json', label: 'JSON', icon: Braces },
  { key: 'excel', label: 'Excel', icon: FileText },
  { key: 'ticket', label: 'Kanban Ticket', icon: Send },
  { key: 'zip', label: 'Zip Bundle', icon: Zap },
];

// Jira push deliberately absent — bug tracking lives on the built-in Kanban
// board (user decision 2026-08-26); an external tracker integration would be
// a new feature, not a destination toggle.
const DESTINATIONS = [
  { key: 'download', label: 'Download', icon: Download },
  { key: 'copy-json', label: 'Copy JSON', icon: Braces },
  { key: 'send-to-david', label: 'Send to David', icon: Send },
];

// Generate Report modal (modal-6 mockup). Self-contained — performs the
// actual export IPC calls itself rather than delegating back up to
// ReportBuilder, since every format/destination combination here maps
// directly onto one `reports.*` (or `app.revealPath`) call.
export function GenerateReportModal({
  open,
  onClose,
  run,
  project,
  environments = [],
  selection,
  title,
  severity,
  environment,
  reproSteps = [],
  onSeverityChange,
  onEnvironmentChange,
  onTitleChange,
  onFlushSelection,
}) {
  const toast = useToast();
  const [formats, setFormats] = useState({ json: true, excel: true, ticket: true, zip: true });
  const [destination, setDestination] = useState('download');
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (open) {
      setFormats({ json: true, excel: true, ticket: true, zip: true });
      setDestination('download');
    }
  }, [open]);

  if (!open || !run) return null;

  const selectedMedia = (run.capturedMedia || []).filter((m) => selection.selectedMediaIds.includes(m.id));
  const screenshotCount = selectedMedia.filter((m) => m.type === 'screenshot').length;
  const videoCount = selectedMedia.filter((m) => m.type === 'video').length;
  const attachmentCount = selectedMedia.length;
  const logCount = (run.consoleErrors?.length || 0) + (run.networkFailures?.length || 0);

  function toggleFormat(key) {
    setFormats((f) => ({ ...f, [key]: !f[key] }));
  }

  async function handleGenerate() {
    if (!title.trim()) {
      toast('Report title is required.', 'warning');
      return;
    }
    setGenerating(true);
    const produced = [];
    const errors = [];

    try {
      // Cancel ReportBuilder's pending debounced save and write the live
      // selection synchronously first — exportJson/exportExcel/createTicket/
      // bundle all read `reportSelection` server-side, so a Generate click
      // right after a checkbox/note change would otherwise ship the
      // previous selection.
      if (onFlushSelection) await onFlushSelection();

      const forceZip = destination === 'send-to-david';

      if (formats.json && destination !== 'copy-json') {
        try {
          const filePath = await window.qaflow.reports.exportJson(run.runId);
          if (filePath) produced.push(`JSON (${filePath})`);
        } catch (e) {
          errors.push(`JSON: ${e.message}`);
        }
      }

      if (destination === 'copy-json') {
        try {
          const payload = { ...run, reportTitle: title, severity, environment, reproductionSteps: reproSteps, reportSelection: selection };
          await navigator.clipboard?.writeText(JSON.stringify(payload, null, 2));
          produced.push('JSON copied to clipboard');
        } catch (e) {
          errors.push(`Copy JSON: ${e.message}`);
        }
      }

      if (formats.excel) {
        try {
          const filePath = await window.qaflow.reports.exportExcel(run.runId);
          if (filePath) produced.push(`Excel (${filePath})`);
        } catch (e) {
          errors.push(`Excel: ${e.message}`);
        }
      }

      if (formats.ticket) {
        try {
          const ticket = await window.qaflow.reports.createTicket(run.runId);
          produced.push(`Kanban ticket "${ticket.title}"`);
        } catch (e) {
          errors.push(`Kanban ticket: ${e.message}`);
        }
      }

      if (formats.zip || forceZip) {
        try {
          const zipPath = await window.qaflow.reports.bundle(run.runId);
          if (zipPath) {
            produced.push(`Zip Bundle (${zipPath})`);
            if (forceZip) {
              await window.qaflow.app.revealPath(zipPath);
              toast('Bundle ready to send.', 'success');
            }
          }
        } catch (e) {
          errors.push(`Zip Bundle: ${e.message}`);
        }
      }

      if (produced.length > 0) {
        toast(`Report generated: ${produced.join(', ')}.`, 'success');
      }
      if (errors.length > 0) {
        toast(`Some formats failed: ${errors.join('; ')}`, 'error');
      }
      if (produced.length === 0 && errors.length === 0) {
        toast('No formats selected — nothing was generated.', 'info');
      }
      if (produced.length > 0) onClose();
    } finally {
      setGenerating(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} className="max-w-4xl">
      <div className="flex items-start justify-between gap-4 border-b border-border p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
            <FileText className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Generate Report</h2>
            <p className="text-sm text-muted-foreground">Prepare the final bug report package with selected evidence and details.</p>
          </div>
        </div>
        <DialogClose onClick={onClose} />
      </div>

      <div className="grid grid-cols-1 gap-6 overflow-y-auto p-5 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-5">
          <div className="flex items-start gap-1.5 rounded-md bg-accent px-2.5 py-2 text-xs text-accent-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>Title, severity and repro-step edits appear in the copied JSON only — file exports and tickets use the run's recorded values (v2 will persist edits).</span>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>
              Report Title <span className="text-danger">*</span>
            </Label>
            <Input value={title} onChange={(e) => onTitleChange(e.target.value)} placeholder="e.g. Checkout Flow Failure - Run #127" />
            <p className="text-xs text-muted-foreground">A clear title helps track and identify this report.</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>
                Severity <span className="text-danger">*</span>
              </Label>
              <Select value={severity} onChange={(e) => onSeverityChange(e.target.value)}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>
                Environment <span className="text-danger">*</span>
              </Label>
              <Select value={environment} onChange={(e) => onEnvironmentChange(e.target.value)}>
                {!environments.includes(environment) && <option value={environment}>{environment || 'Unknown'}</option>}
                {environments.map((env) => (
                  <option key={env} value={env}>
                    {env}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div>
            <div className="text-sm font-medium text-foreground">Report Format</div>
            <p className="text-xs text-muted-foreground">Choose the formats to include in your report.</p>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {FORMATS.map((f) => {
                const Icon = f.icon;
                const checked = formats[f.key];
                return (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => toggleFormat(f.key)}
                    className={cn(
                      'flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors',
                      checked ? 'border-primary bg-accent text-primary' : 'border-border text-muted-foreground hover:bg-secondary'
                    )}
                  >
                    <span className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded border', checked ? 'border-primary bg-primary text-primary-foreground' : 'border-input')}>
                      {checked && <CheckCircle2 className="h-3 w-3" />}
                    </span>
                    <Icon className="h-3.5 w-3.5" /> {f.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="text-sm font-medium text-foreground">Included Media</div>
            <p className="text-xs text-muted-foreground">Review the selected evidence that will be packaged.</p>
            <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="flex items-center gap-2 rounded-lg border border-border p-3">
                <ImageIcon className="h-4 w-4 text-primary" />
                <div>
                  <div className="text-sm font-semibold text-foreground">{screenshotCount}</div>
                  <div className="text-xs text-muted-foreground">Screenshots</div>
                </div>
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-border p-3">
                <Film className="h-4 w-4 text-primary" />
                <div>
                  <div className="text-sm font-semibold text-foreground">{videoCount}</div>
                  <div className="text-xs text-muted-foreground">Videos</div>
                </div>
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-border p-3">
                <ScrollText className="h-4 w-4 text-primary" />
                <div>
                  <div className="text-sm font-semibold text-foreground">{logCount}</div>
                  <div className="text-xs text-muted-foreground">Logs</div>
                </div>
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-border p-3">
                <Paperclip className="h-4 w-4 text-primary" />
                <div>
                  <div className="text-sm font-semibold text-foreground">{attachmentCount}</div>
                  <div className="text-xs text-muted-foreground">Attachments</div>
                </div>
              </div>
            </div>
          </div>

          <div>
            <div className="text-sm font-medium text-foreground">Send Destination</div>
            <p className="text-xs text-muted-foreground">Choose where to send or export the generated report.</p>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {DESTINATIONS.map((d) => {
                const Icon = d.icon;
                return (
                  <button
                    key={d.key}
                    type="button"
                    disabled={d.disabled}
                    title={d.note}
                    onClick={() => setDestination(d.key)}
                    className={cn(
                      'flex flex-col items-center gap-1.5 rounded-lg border px-3 py-3 text-center text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                      destination === d.key ? 'border-primary bg-accent text-primary' : 'border-border text-muted-foreground hover:bg-secondary'
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {d.label}
                    {d.note && <span className="text-[10px] text-muted-foreground">{d.note}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-border p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
              <Zap className="h-4 w-4 text-muted-foreground" /> Live Summary
            </div>
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Test Suite</span>
                <span className="font-medium text-foreground">{run.suiteName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Run</span>
                <span className="font-medium text-foreground">{run.runId.split('-').pop()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Run Status</span>
                <span className={run.status === 'failed' ? 'font-medium text-danger' : 'font-medium text-success'}>{run.status}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Selected Evidence</span>
                <span className="font-medium text-foreground">{attachmentCount} items</span>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-border p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
              <CheckCircle2 className="h-4 w-4 text-success" /> Report Checklist
            </div>
            <ul className="flex flex-col gap-2.5 text-sm">
              <li className="flex items-start gap-2">
                <CheckCircle2 className={cn('mt-0.5 h-4 w-4 shrink-0', title.trim() ? 'text-success' : 'text-muted-foreground')} />
                <div>
                  <div className="font-medium text-foreground">Report content ready</div>
                  <div className="text-xs text-muted-foreground">{title.trim() ? 'All required details are complete' : 'Title is required'}</div>
                </div>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className={cn('mt-0.5 h-4 w-4 shrink-0', screenshotCount > 0 ? 'text-success' : 'text-muted-foreground')} />
                <div>
                  <div className="font-medium text-foreground">Screenshots selected</div>
                  <div className="text-xs text-muted-foreground">{screenshotCount} screenshots included</div>
                </div>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className={cn('mt-0.5 h-4 w-4 shrink-0', videoCount > 0 ? 'text-success' : 'text-muted-foreground')} />
                <div>
                  <div className="font-medium text-foreground">Video selected</div>
                  <div className="text-xs text-muted-foreground">{videoCount} videos included</div>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t border-border bg-secondary/30 px-5 py-3.5">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleGenerate} disabled={generating}>
          <FileText className="h-4 w-4" /> {generating ? 'Generating…' : 'Generate Report'}
        </Button>
      </div>
    </Dialog>
  );
}

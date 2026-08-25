import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { Dialog, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { SEVERITIES, CHECKLIST_TEMPLATE } from '@/lib/tickets';
import { useToast } from '@/lib/toast';

const EMPTY_FORM = { title: '', severity: 'medium', projectId: '' };

// Per-column "+ Add Ticket" quick modal (kanban-3 mockup) — three fields
// only (title, severity, project). `status` is fixed to whichever column
// the user clicked, everything else (labels, comments, checklist...) starts
// empty/default just like `ticketFromRun` seeds a run-derived ticket.
export function QuickAddTicketModal({ open, status, projects, defaultProjectId, onClose, onCreated }) {
  const toast = useToast();
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setForm({ ...EMPTY_FORM, projectId: defaultProjectId || projects[0]?.id || '' });
  }, [open, defaultProjectId, projects]);

  function setField(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  const canSubmit = form.title.trim() && form.projectId;

  async function handleCreate() {
    if (!canSubmit || saving) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const ticket = await window.qaflow.tickets.save({
        title: form.title.trim(),
        severity: form.severity,
        projectId: form.projectId,
        status,
        description: '',
        labels: [],
        assignee: null,
        reporter: 'QA',
        reproductionSteps: [],
        attachments: [],
        comments: [],
        checklist: CHECKLIST_TEMPLATE.map((label) => ({ label, done: false })),
        createdAt: now,
      });
      toast(`Ticket "${ticket.id}" created.`, 'success');
      onClose();
      onCreated?.(ticket);
    } catch (e) {
      toast(`Failed to create ticket: ${e.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} className="max-w-md">
      <div className="flex items-start justify-between gap-4 border-b border-border p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
            <Plus className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Add Ticket</h2>
            <p className="text-sm text-muted-foreground">Creates a bug ticket directly in this column.</p>
          </div>
        </div>
        <DialogClose onClick={onClose} />
      </div>

      <div className="flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="qt-title">
            Title <span className="text-danger">*</span>
          </Label>
          <Input
            id="qt-title"
            placeholder="e.g., Checkout button not responsive on iOS Safari"
            value={form.title}
            onChange={(e) => setField('title', e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="qt-severity">Severity</Label>
            <Select id="qt-severity" value={form.severity} onChange={(e) => setField('severity', e.target.value)}>
              {SEVERITIES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="qt-project">
              Project <span className="text-danger">*</span>
            </Label>
            <Select id="qt-project" value={form.projectId} onChange={(e) => setField('projectId', e.target.value)} disabled={projects.length === 0}>
              {projects.length === 0 && <option value="">No projects yet</option>}
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t border-border bg-secondary/30 px-5 py-3.5">
        <Button variant="outline" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={handleCreate} disabled={!canSubmit || saving}>
          {saving ? 'Creating…' : 'Create Ticket'}
        </Button>
      </div>
    </Dialog>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { Save, X, ListChecks, Clock, Globe } from 'lucide-react';
import { Dialog, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useToast } from '@/lib/toast';
import { stepIcon, stepDetail, estimateDurationMs, fmtEstimate } from '@/lib/steps';

const DESCRIPTION_MAX = 500;

const EMPTY_FORM = { name: '', projectId: '', environment: '', tags: [], description: '' };

// Save Suite modal (modal-2 mockup) — turns a batch of recorded steps into a
// persisted suite. `suite` is passed when editing an existing suite's
// metadata (Suites grid "Edit" action) rather than saving a fresh recording.
export function SaveSuiteModal({ open, onClose, steps = [], projects = [], defaultProjectId, suite = null, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(EMPTY_FORM);
  const [tagDraft, setTagDraft] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (suite) {
      setForm({
        name: suite.name || '',
        projectId: suite.projectId || defaultProjectId || '',
        environment: suite.environment || '',
        tags: suite.tags || [],
        description: suite.description || '',
      });
    } else {
      setForm({ ...EMPTY_FORM, projectId: defaultProjectId || '' });
    }
    setTagDraft('');
  }, [open, suite, defaultProjectId]);

  const project = projects.find((p) => p.id === form.projectId) || null;
  const environments = project?.environments || [];

  useEffect(() => {
    // Reset environment choice when it no longer belongs to the selected project.
    if (form.environment && !environments.some((e) => e.name === form.environment)) {
      setForm((f) => ({ ...f, environment: project?.defaultEnvironment || environments[0]?.name || '' }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.projectId]);

  const estimateMs = useMemo(() => estimateDurationMs(steps), [steps]);

  function setField(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function addTag() {
    const tag = tagDraft.trim();
    if (!tag) return;
    if (form.tags.includes(tag)) {
      setTagDraft('');
      return;
    }
    setForm((f) => ({ ...f, tags: [...f.tags, tag] }));
    setTagDraft('');
  }

  function removeTag(tag) {
    setForm((f) => ({ ...f, tags: f.tags.filter((t) => t !== tag) }));
  }

  const canSubmit = form.name.trim() && form.projectId && form.environment;

  async function handleSave() {
    if (!canSubmit || saving) return;
    setSaving(true);
    try {
      const saved = await window.qaflow.suites.save({
        ...(suite || {}),
        name: form.name.trim(),
        projectId: form.projectId,
        environment: form.environment,
        tags: form.tags,
        description: form.description.trim(),
        steps: suite ? suite.steps : steps,
        source: suite ? suite.source : 'recorder',
        archived: suite ? suite.archived : false,
      });
      toast(`Suite "${saved.name}" saved.`, 'success');
      onClose();
      onSaved?.(saved);
    } catch (e) {
      toast(`Failed to save suite: ${e.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  const previewSteps = suite ? suite.steps || [] : steps;

  return (
    <Dialog open={open} onClose={onClose} className="max-w-4xl">
      <div className="flex items-start justify-between gap-4 border-b border-border p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
            <Save className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">{suite ? 'Edit Test Suite' : 'Save Test Suite'}</h2>
            <p className="text-sm text-muted-foreground">Save your recorded flow as a new test suite for future runs and reusability.</p>
          </div>
        </div>
        <DialogClose onClick={onClose} />
      </div>

      <div className="grid grid-cols-1 gap-6 overflow-y-auto p-5 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ss-name">
              Suite Name <span className="text-danger">*</span>
            </Label>
            <Input id="ss-name" placeholder="e.g., E-Commerce Checkout Flow" value={form.name} onChange={(e) => setField('name', e.target.value)} />
            <p className="text-xs text-muted-foreground">A clear, descriptive name for your test suite.</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ss-project">
                Project <span className="text-danger">*</span>
              </Label>
              <Select id="ss-project" value={form.projectId} onChange={(e) => setField('projectId', e.target.value)}>
                <option value="">Select a project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">Select the project to save this suite under.</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ss-env">
                Environment <span className="text-danger">*</span>
              </Label>
              <Select id="ss-env" value={form.environment} onChange={(e) => setField('environment', e.target.value)} disabled={environments.length === 0}>
                <option value="">Select environment</option>
                {environments.map((env) => (
                  <option key={env.name} value={env.name}>
                    {env.name}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">Choose the default environment for this suite.</p>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Tags</Label>
            <div className="flex flex-wrap items-center gap-2">
              {form.tags.map((tag) => (
                <span key={tag} className="inline-flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground">
                  {tag}
                  <button onClick={() => removeTag(tag)} className="opacity-60 hover:opacity-100" aria-label={`Remove ${tag}`}>
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              <div className="flex items-center gap-1">
                <Input
                  className="h-7 w-28 text-xs"
                  placeholder="Add a tag..."
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addTag();
                    }
                  }}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Use tags to categorize and filter your suites.</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ss-desc">Description</Label>
            <Textarea
              id="ss-desc"
              maxLength={DESCRIPTION_MAX}
              placeholder="Describe what this suite covers..."
              value={form.description}
              onChange={(e) => setField('description', e.target.value)}
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Provide additional context and objectives for this suite.</span>
              <span>
                {form.description.length} / {DESCRIPTION_MAX}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-border p-4">
            <div className="mb-3 text-sm font-semibold text-foreground">Suite Summary</div>
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent text-primary">
                  <ListChecks className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground">Recorded Actions</div>
                  <div className="text-xs text-muted-foreground">Total actions captured in this recording.</div>
                </div>
                <div className="shrink-0 text-sm font-semibold text-foreground">{previewSteps.length} steps</div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent text-primary">
                  <Clock className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground">Estimated Duration</div>
                  <div className="text-xs text-muted-foreground">Estimated time to complete the suite.</div>
                </div>
                <div className="shrink-0 text-sm font-semibold text-foreground">{fmtEstimate(estimateMs)}</div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent text-primary">
                  <Globe className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground">Browser</div>
                  <div className="text-xs text-muted-foreground">Browser used during recording.</div>
                </div>
                <div className="shrink-0 text-sm font-semibold text-foreground">Chrome</div>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-border">
            <div className="border-b border-border px-4 py-3 text-sm font-semibold text-foreground">Step Preview ({previewSteps.length} steps)</div>
            <div className="flex max-h-72 flex-col gap-3 overflow-y-auto p-4">
              {previewSteps.length === 0 && <p className="text-sm text-muted-foreground">No steps recorded yet.</p>}
              {previewSteps.map((step, idx) => {
                const Icon = stepIcon(step.type);
                return (
                  <div key={idx} className="flex items-start gap-2.5 text-sm">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-muted-foreground">
                      {idx + 1}
                    </div>
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center text-primary">
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-foreground">{step.name}</div>
                      <div className="truncate text-xs text-muted-foreground">{stepDetail(step)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t border-border bg-secondary/30 px-5 py-3.5">
        <Button variant="outline" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={!canSubmit || saving}>
          {saving ? 'Saving…' : 'Save Suite'}
        </Button>
      </div>
    </Dialog>
  );
}

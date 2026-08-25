import { useMemo, useState } from 'react';
import { FolderPlus, Lightbulb, Plus, X } from 'lucide-react';
import { Dialog, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useToast } from '@/lib/toast';

const DESCRIPTION_MAX = 500;

const TIPS = [
  { title: 'Use a clear name', body: 'Pick a name that reflects the application or domain under test.' },
  { title: 'Choose a stable base URL', body: 'Use the root URL for the environment (e.g. https://staging.example.com).' },
  { title: 'Select the right type', body: 'Web for browsers, API for services, Mobile for mobile applications.' },
  { title: 'Add environments early', body: 'You can add more environments anytime from project settings.' },
];

function slugKey(name) {
  return name
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 6);
}

const EMPTY_FORM = {
  name: '',
  key: '',
  keyTouched: false,
  baseUrl: '',
  type: 'Web Application',
  defaultEnvironment: '',
  environments: [],
  description: '',
};

export function NewProjectModal({ open, onClose, onCreated }) {
  const toast = useToast();
  const [form, setForm] = useState(EMPTY_FORM);
  const [envDraft, setEnvDraft] = useState('');
  const [saving, setSaving] = useState(false);

  function resetAndClose() {
    setForm(EMPTY_FORM);
    setEnvDraft('');
    onClose();
  }

  function setField(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function onNameChange(value) {
    setForm((f) => ({
      ...f,
      name: value,
      key: f.keyTouched ? f.key : slugKey(value),
    }));
  }

  function onKeyChange(value) {
    setForm((f) => ({ ...f, key: value.toUpperCase(), keyTouched: true }));
  }

  function addEnvironment() {
    const name = envDraft.trim();
    if (!name) return;
    if (form.environments.some((e) => e.toLowerCase() === name.toLowerCase())) {
      setEnvDraft('');
      return;
    }
    setForm((f) => ({
      ...f,
      environments: [...f.environments, name],
      defaultEnvironment: f.defaultEnvironment || name,
    }));
    setEnvDraft('');
  }

  function removeEnvironment(name) {
    setForm((f) => ({
      ...f,
      environments: f.environments.filter((e) => e !== name),
      defaultEnvironment: f.defaultEnvironment === name ? '' : f.defaultEnvironment,
    }));
  }

  const canSubmit = useMemo(
    () => form.name.trim() && form.key.trim() && form.baseUrl.trim() && form.type,
    [form]
  );

  async function handleCreate() {
    if (!canSubmit || saving) return;
    setSaving(true);
    try {
      const project = await window.qaflow.projects.save({
        name: form.name.trim(),
        key: form.key.trim(),
        baseUrl: form.baseUrl.trim(),
        type: form.type,
        defaultEnvironment: form.defaultEnvironment || undefined,
        environments: form.environments.map((name) => ({ name, baseUrl: form.baseUrl.trim() })),
        description: form.description.trim(),
        tags: [],
      });
      toast(`Project "${project.name}" created`, 'success');
      resetAndClose();
      onCreated?.(project);
    } catch (e) {
      toast(`Failed to create project: ${e.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={resetAndClose} className="max-w-3xl">
      <div className="flex items-start justify-between gap-4 border-b border-border p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
            <FolderPlus className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">New Project</h2>
            <p className="text-sm text-muted-foreground">Create a new project to organize tests, suites, and environments.</p>
          </div>
        </div>
        <DialogClose onClick={resetAndClose} />
      </div>

      <div className="grid grid-cols-1 gap-6 overflow-y-auto p-5 lg:grid-cols-[1fr_280px]">
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="np-name">
                Project Name <span className="text-danger">*</span>
              </Label>
              <Input
                id="np-name"
                placeholder="e.g., E-Commerce App"
                value={form.name}
                onChange={(e) => onNameChange(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">A human-readable name for your project.</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="np-key">
                Project Key <span className="text-danger">*</span>
              </Label>
              <Input id="np-key" placeholder="e.g., ECOM" value={form.key} onChange={(e) => onKeyChange(e.target.value)} />
              <p className="text-xs text-muted-foreground">Unique key used in URLs and identifiers.</p>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="np-url">
              Base URL <span className="text-danger">*</span>
            </Label>
            <Input
              id="np-url"
              placeholder="https://app.example.com"
              value={form.baseUrl}
              onChange={(e) => setField('baseUrl', e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Base URL of the application under test.</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="np-type">
                Project Type <span className="text-danger">*</span>
              </Label>
              <Select id="np-type" value={form.type} onChange={(e) => setField('type', e.target.value)}>
                <option value="Web Application">Web Application</option>
              </Select>
              <p className="text-xs text-muted-foreground">Choose how this project will be used.</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="np-env">Default Environment</Label>
              <Select
                id="np-env"
                value={form.defaultEnvironment}
                onChange={(e) => setField('defaultEnvironment', e.target.value)}
                disabled={form.environments.length === 0}
              >
                <option value="">Select environment</option>
                {form.environments.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">Environment used by default for new runs.</p>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Environments (optional)</Label>
            <p className="text-xs text-muted-foreground">Add environments you plan to use for this project.</p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {form.environments.map((name) => (
                <span
                  key={name}
                  className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-foreground"
                >
                  {name}
                  <button onClick={() => removeEnvironment(name)} className="opacity-60 hover:opacity-100" aria-label={`Remove ${name}`}>
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              <div className="flex items-center gap-1">
                <Input
                  className="h-7 w-32 text-xs"
                  placeholder="Environment name"
                  value={envDraft}
                  onChange={(e) => setEnvDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addEnvironment();
                    }
                  }}
                />
                <button
                  onClick={addEnvironment}
                  className="inline-flex items-center gap-1 rounded-full border border-dashed border-primary/40 px-2.5 py-1 text-xs font-medium text-primary hover:bg-accent"
                >
                  <Plus className="h-3 w-3" /> Add Environment
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="np-desc">Description (optional)</Label>
            <Textarea
              id="np-desc"
              maxLength={DESCRIPTION_MAX}
              placeholder="Describe the purpose of this project, its scope, or any important notes..."
              value={form.description}
              onChange={(e) => setField('description', e.target.value)}
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>This will help your team understand the project.</span>
              <span>
                {form.description.length} / {DESCRIPTION_MAX}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-border bg-secondary/40 p-4">
            <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-foreground">
              <Lightbulb className="h-4 w-4 text-amber-500" /> Setup Tips
            </div>
            <p className="mb-3 text-xs text-muted-foreground">Follow these best practices to get started.</p>
            <ul className="flex flex-col gap-3">
              {TIPS.map((tip) => (
                <li key={tip.title} className="text-xs">
                  <div className="font-medium text-foreground">{tip.title}</div>
                  <div className="text-muted-foreground">{tip.body}</div>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-lg border border-border p-4">
            <div className="mb-2 text-sm font-semibold text-foreground">Summary</div>
            <dl className="flex flex-col gap-1.5 text-xs">
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Type</dt>
                <dd className="font-medium text-foreground">{form.type || 'Not selected'}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Default Environment</dt>
                <dd className="font-medium text-foreground">{form.defaultEnvironment || 'Not selected'}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Environments</dt>
                <dd className="font-medium text-foreground">{form.environments.length} added</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t border-border bg-secondary/30 px-5 py-3.5">
        <Button variant="outline" onClick={resetAndClose} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={handleCreate} disabled={!canSubmit || saving}>
          {saving ? 'Creating…' : 'Create Project'}
        </Button>
      </div>
    </Dialog>
  );
}

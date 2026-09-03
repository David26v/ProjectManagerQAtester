import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  Plus,
  Upload,
  MoreVertical,
  Play,
  Pencil,
  Copy,
  Archive,
  ArchiveRestore,
  Circle,
  Square,
  Trash2,
  Radio,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { RunSuiteModal } from '@/components/RunSuiteModal';
import { SaveSuiteModal } from '@/components/SaveSuiteModal';
import { projectVisual } from '@/lib/projectVisuals';
import { timeAgo } from '@/lib/format';
import { stepIcon, stepDetail } from '@/lib/steps';
import { navigate } from '@/hooks/useHashRoute';
import { useDismissable } from '@/hooks/useDismissable';
import { useToast } from '@/lib/toast';

const TABS = [
  { key: 'all', label: 'All Suites' },
  { key: 'recorded', label: 'Recorded' },
  { key: 'archived', label: 'Archived' },
];

function elapsedLabel(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function SuiteCard({ suite, project, onRun, onEdit, onDuplicate, onArchive, menuOpen, onToggleMenu }) {
  const { Icon, colorClass } = projectVisual(project || { id: suite.projectId });
  const menuRef = useRef(null);
  useDismissable(menuRef, () => onToggleMenu(null), menuOpen);
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white ${colorClass}`}>
            <Icon className="h-4.5 w-4.5" />
          </div>
          <div className="min-w-0">
            <button onClick={() => navigate(`/suites/${suite.id}`)} className="truncate text-left text-sm font-semibold text-foreground hover:underline">
              {suite.name}
            </button>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {(suite.tags || []).map((t) => (
                <span key={t} className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {t}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div ref={menuRef} className="relative shrink-0">
          <button onClick={() => onToggleMenu(suite.id)} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent">
            <MoreVertical className="h-4 w-4" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-9 z-20 w-36 rounded-md border border-border bg-card py-1 shadow-lg">
              <button className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-foreground hover:bg-secondary" onClick={() => onEdit(suite)}>
                <Pencil className="h-3.5 w-3.5" /> Edit
              </button>
              <button className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-foreground hover:bg-secondary" onClick={() => onDuplicate(suite)}>
                <Copy className="h-3.5 w-3.5" /> Duplicate
              </button>
              <button className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-danger hover:bg-danger-bg" onClick={() => onArchive(suite)}>
                {suite.archived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
                {suite.archived ? 'Unarchive' : 'Archive'}
              </button>
            </div>
          )}
        </div>
      </div>

      <p className="line-clamp-2 text-sm text-muted-foreground">{suite.description || 'No description yet.'}</p>

      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${suite.archived ? 'bg-secondary text-muted-foreground' : 'bg-success-bg text-success'}`}>
          {suite.archived ? 'Archived' : 'Active'}
        </span>
        <span className="text-xs text-muted-foreground">
          {suite.steps?.length || 0} steps · Updated {timeAgo(suite.updatedAt)}
        </span>
      </div>

      <div className="mt-1 flex items-center gap-2">
        <Button size="sm" className="flex-1" onClick={() => onRun(suite)}>
          <Play className="h-3.5 w-3.5" /> Run
        </Button>
        <Button size="sm" variant="outline" onClick={() => onEdit(suite)} title="Edit">
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button size="sm" variant="outline" onClick={() => onDuplicate(suite)} title="Duplicate">
          <Copy className="h-3.5 w-3.5" />
        </Button>
        <Button size="sm" variant="outline" onClick={() => onArchive(suite)} title={suite.archived ? 'Unarchive' : 'Archive'}>
          {suite.archived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  );
}

export function Suites({ data, route, startRun }) {
  const { projects, suites, runs, reload } = data;
  const toast = useToast();
  const recorderRef = useRef(null);
  const recUrlRef = useRef(null);
  const [recorderHighlight, setRecorderHighlight] = useState(false);

  // "New Suite" (and the sidebar's Recorder deep-link) both mean "I want to
  // record a new test" — scroll to the recorder, pulse a highlight ring so
  // it's obvious where to look, and focus the URL field so the user can type
  // straight away.
  const focusRecorder = () => {
    recorderRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    recUrlRef.current?.focus();
    setRecorderHighlight(true);
    setTimeout(() => setRecorderHighlight(false), 1600);
  };

  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [menuOpenId, setMenuOpenId] = useState(null);
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [runTarget, setRunTarget] = useState(null);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [editingSuite, setEditingSuite] = useState(null);

  // Recorder panel state
  const [recording, setRecording] = useState(false);
  const [recordedSteps, setRecordedSteps] = useState([]);
  const [recUrl, setRecUrl] = useState('');
  const [recProjectId, setRecProjectId] = useState(projects[0]?.id || '');
  const [recCredentialId, setRecCredentialId] = useState('');
  const [recCredentials, setRecCredentials] = useState([]);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    if (!recProjectId && projects[0]) setRecProjectId(projects[0].id);
  }, [projects, recProjectId]);

  useEffect(() => {
    let cancelled = false;
    if (!recProjectId) {
      setRecCredentials([]);
      return;
    }
    window.qaflow.session.list(recProjectId).then((list) => {
      // Manual-entry profiles can't seed the recorder (main rejects them —
      // see recorder:start in ipc.js) — filter them out of the dropdown so
      // picking one doesn't throw.
      if (!cancelled) setRecCredentials((list || []).filter((c) => c.mode !== 'manual'));
    });
    return () => {
      cancelled = true;
    };
  }, [recProjectId]);

  // Scroll to the recorder panel when arriving via a "?panel=recorder" deep
  // link (New Suite from a project card, etc.).
  useEffect(() => {
    if (route?.query?.panel === 'recorder') {
      focusRecorder();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.query?.panel]);

  // Live steps stream from the recorder while it's running.
  useEffect(() => {
    const unsubscribe = window.qaflow.on('recorder:step', (step) => {
      setRecordedSteps((list) => [...list, step]);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!recording) return undefined;
    const timer = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [recording]);

  const filteredSuites = useMemo(() => {
    const q = search.trim().toLowerCase();
    return suites
      .filter((s) => {
        if (tab === 'recorded' && s.source !== 'recorder') return false;
        if (tab === 'archived') return Boolean(s.archived);
        if (tab !== 'archived' && s.archived) return false;
        return true;
      })
      .filter((s) => !q || s.name.toLowerCase().includes(q) || (s.tags || []).some((t) => t.toLowerCase().includes(q)))
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }, [suites, tab, search]);

  const projectsById = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p])), [projects]);

  async function handleStartRecording() {
    if (!recUrl.trim()) {
      toast('Enter a URL to start recording.', 'warning');
      return;
    }
    if (!recProjectId) {
      toast('Select a project first.', 'warning');
      return;
    }
    setStarting(true);
    try {
      await window.qaflow.recorder.start({
        url: recUrl.trim(),
        projectId: recProjectId,
        credentialProfileId: recCredentialId || undefined,
      });
      setRecordedSteps([]);
      setElapsedSec(0);
      setRecording(true);
    } catch (e) {
      toast(`Failed to start recording: ${e.message}`, 'error');
    } finally {
      setStarting(false);
    }
  }

  async function handleStopRecording() {
    setStopping(true);
    try {
      const { steps } = await window.qaflow.recorder.stop();
      setRecordedSteps(steps);
      setRecording(false);
      return steps;
    } catch (e) {
      toast(`Failed to stop recording: ${e.message}`, 'error');
      return recordedSteps;
    } finally {
      setStopping(false);
    }
  }

  async function handleSaveSuiteFromRecorder() {
    const steps = recording ? await handleStopRecording() : recordedSteps;
    if (!steps.length) {
      toast('Record at least one step before saving.', 'info');
      return;
    }
    setEditingSuite(null);
    setSaveModalOpen(true);
  }

  function removeRecordedStep(index) {
    setRecordedSteps((list) => list.filter((_, i) => i !== index));
  }

  function openEdit(suite) {
    setMenuOpenId(null);
    setEditingSuite(suite);
    setSaveModalOpen(true);
  }

  async function duplicateSuite(suite) {
    setMenuOpenId(null);
    try {
      const { id, createdAt, updatedAt, ...rest } = suite;
      const saved = await window.qaflow.suites.save({ ...rest, name: `${suite.name} (Copy)` });
      toast(`Duplicated as "${saved.name}".`, 'success');
      reload();
    } catch (e) {
      toast(`Failed to duplicate suite: ${e.message}`, 'error');
    }
  }

  async function handleImportSuite() {
    try {
      const imported = await window.qaflow.suites.importFromFile();
      if (!imported) return; // user cancelled the file picker
      toast(`Imported suite "${imported.name}".`, 'success');
      reload();
    } catch (e) {
      toast(`Failed to import suite: ${e.message}`, 'error');
    }
  }

  async function toggleArchive(suite) {
    try {
      await window.qaflow.suites.save({ ...suite, archived: !suite.archived });
      toast(suite.archived ? `"${suite.name}" restored.` : `"${suite.name}" archived.`, 'success');
      reload();
    } catch (e) {
      toast(`Failed to update suite: ${e.message}`, 'error');
    }
  }

  return (
    <div className="flex flex-col gap-6 p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Test Suites & Recorder</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage your test suites, and record new tests.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleImportSuite}>
            <Upload className="h-4 w-4" /> Import Suite
          </Button>
          <Button onClick={focusRecorder}>
            <Plus className="h-4 w-4" /> New Suite
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-6 border-b border-border">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`-mb-px border-b-2 px-1 pb-3 text-sm font-medium transition-colors ${
                tab === t.key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input className="w-64 pl-8" placeholder="Search suites..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filteredSuites.length === 0 && (
          <div className="col-span-full rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            {suites.length === 0 ? 'No test suites yet — record one below to get started.' : 'No suites match this view.'}
          </div>
        )}
        {filteredSuites.map((suite) => (
          <SuiteCard
            key={suite.id}
            suite={suite}
            project={projectsById[suite.projectId]}
            onRun={setRunTarget}
            onEdit={openEdit}
            onDuplicate={duplicateSuite}
            onArchive={(s) => setArchiveTarget(s)}
            menuOpen={menuOpenId === suite.id}
            onToggleMenu={(id) => setMenuOpenId(menuOpenId === id ? null : id)}
          />
        ))}
      </div>

      <div
        ref={recorderRef}
        className={`rounded-xl border bg-card p-5 shadow-sm transition-all ${
          recorderHighlight ? 'border-primary ring-2 ring-primary/40' : 'border-border'
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Radio className="h-4 w-4 text-primary" />
            <div>
              <div className="text-base font-semibold text-foreground">Recorder</div>
              <p className="text-sm text-muted-foreground">Record user interactions and convert them into automated tests.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Select className="w-48" value={recProjectId} onChange={(e) => setRecProjectId(e.target.value)} disabled={recording}>
              <option value="">Select project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
            <Select className="w-48" value={recCredentialId} onChange={(e) => setRecCredentialId(e.target.value)} disabled={recording}>
              <option value="">No credentials</option>
              {recCredentials.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2">
          {recording ? (
            <div className="flex items-center gap-2 rounded-md bg-danger-bg px-3 py-1.5 text-sm font-medium text-danger">
              <span className="h-2 w-2 animate-pulse rounded-full bg-danger" />
              Recording… {elapsedLabel(elapsedSec)}
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">Not recording.</span>
          )}
          <Input ref={recUrlRef} className="flex-1" placeholder="https://app.example.com  ·  or  http://localhost:3000" value={recUrl} onChange={(e) => setRecUrl(e.target.value)} disabled={recording} />
          {!recording && (
            <Button onClick={handleStartRecording} disabled={starting}>
              <Circle className="h-4 w-4 fill-current" /> {starting ? 'Starting…' : 'Start Recording'}
            </Button>
          )}
        </div>

        <div className="mt-4 rounded-lg border border-border">
          <div className="border-b border-border px-4 py-2.5 text-sm font-semibold text-foreground">Steps ({recordedSteps.length})</div>
          <div className="flex max-h-80 flex-col divide-y divide-border overflow-y-auto">
            {recordedSteps.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted-foreground">No steps recorded yet — start recording to see actions appear here.</p>}
            {recordedSteps.map((step, idx) => {
              const Icon = stepIcon(step.type);
              return (
                <div key={idx} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent text-primary">
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">{step.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{stepDetail(step)}</div>
                  </div>
                  <button
                    onClick={() => removeRecordedStep(idx)}
                    className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-danger-bg hover:text-danger"
                    title="Delete step"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <Button variant="destructive" onClick={handleStopRecording} disabled={!recording || stopping}>
            <Square className="h-4 w-4" /> {stopping ? 'Stopping…' : 'Stop'}
          </Button>
          <Button variant="outline" onClick={handleSaveSuiteFromRecorder} disabled={recordedSteps.length === 0 && !recording}>
            Save Suite
          </Button>
        </div>
      </div>

      <RunSuiteModal
        open={Boolean(runTarget)}
        onClose={() => setRunTarget(null)}
        suite={runTarget}
        project={runTarget ? projectsById[runTarget.projectId] : null}
        runs={runs}
        onRun={(suite, opts) => startRun(suite, opts)}
      />

      <SaveSuiteModal
        open={saveModalOpen}
        onClose={() => setSaveModalOpen(false)}
        steps={recordedSteps}
        projects={projects}
        defaultProjectId={editingSuite ? editingSuite.projectId : recProjectId}
        suite={editingSuite}
        onSaved={() => {
          setRecordedSteps([]);
          setEditingSuite(null);
          reload();
        }}
      />

      <ConfirmDialog
        open={Boolean(archiveTarget)}
        title={archiveTarget?.archived ? `Restore "${archiveTarget?.name}"?` : `Archive "${archiveTarget?.name}"?`}
        description={
          archiveTarget?.archived
            ? 'This suite will move back into your active suites.'
            : 'Archived suites stay on disk and can be restored anytime, but are hidden from the default view.'
        }
        confirmLabel={archiveTarget?.archived ? 'Restore' : 'Archive'}
        variant={archiveTarget?.archived ? 'default' : 'danger'}
        onConfirm={() => archiveTarget && toggleArchive(archiveTarget)}
        onClose={() => setArchiveTarget(null)}
      />
    </div>
  );
}

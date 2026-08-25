import { useCallback, useEffect, useState } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { EmptyScreen } from '@/components/EmptyScreen';
import { NewProjectModal } from '@/components/NewProjectModal';
import { RunProgressBanner } from '@/components/RunProgressBanner';
import { UpdateReadyBanner } from '@/components/UpdateReadyBanner';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Dashboard } from '@/screens/Dashboard';
import { Projects } from '@/screens/Projects';
import { ProjectDetail } from '@/screens/ProjectDetail';
import { Suites } from '@/screens/Suites';
import { SuiteDetail } from '@/screens/SuiteDetail';
import { Runs } from '@/screens/Runs';
import { RunDetail } from '@/screens/RunDetail';
import { ReportBuilder } from '@/screens/ReportBuilder';
import { Reports } from '@/screens/Reports';
import { Credentials } from '@/screens/Credentials';
import { Kanban } from '@/screens/Kanban';
import { TicketDetail } from '@/screens/TicketDetail';
import { Settings } from '@/screens/Settings';
import { ToastProvider, useToast } from '@/lib/toast';
import { useHashRoute, navigate } from '@/hooks/useHashRoute';

function useAppData() {
  const [state, setState] = useState({
    projects: [],
    suites: [],
    runs: [],
    tickets: [],
    settings: {},
    version: '',
    loaded: false,
  });

  const reload = useCallback(async () => {
    const [projects, suites, runs, tickets, settings, version] = await Promise.all([
      window.qaflow.projects.list(),
      window.qaflow.suites.list(),
      window.qaflow.runs.list(),
      window.qaflow.tickets.list(),
      window.qaflow.settings.get(),
      window.qaflow.app.version(),
    ]);
    setState({ projects, suites, runs, tickets, settings, version, loaded: true });
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { ...state, reload };
}

// Owns the single in-flight run kicked off from a Run Suite modal. Lives
// above the modal (which closes/unmounts immediately on "Run Suite") so the
// `qaflow.runs.run()` promise and the `run:progress` stream both survive the
// navigate("#/runs") that follows — a fixed banner (rather than in-screen
// state) is what carries the live progress and the pass/fail toast, since
// it needs to survive navigating away from the Runs screen entirely.
function useRunManager(reload) {
  const toast = useToast();
  const [activeRun, setActiveRun] = useState(null);

  useEffect(() => {
    const unsubscribe = window.qaflow.on('run:progress', (event) => {
      setActiveRun((run) => {
        if (!run || run.suiteId !== event.suiteId) return run;
        // index -1 marks the manual-login phase (runner.js) — it isn't one
        // of the suite's own steps, so it gets a friendly label but doesn't
        // count toward the step progress bar.
        if (event.index === -1) return { ...run, currentStepName: 'Logging in…' };
        // A step-start for index 0 marks the beginning of a fresh attempt —
        // either a retry of *this* run, or (same suiteId, different run
        // entirely — e.g. a scheduled run of the suite the user is also
        // running manually) another run's events bleeding in. Either way
        // the progress bar should restart from 0, and we adopt whichever
        // attempt just started as the one we're now tracking so its own
        // step-end events count correctly.
        if (event.type === 'step-start' && event.index === 0) {
          return { ...run, completedSteps: 0, currentStepName: event.name, attempt: event.attempt };
        }
        // Once we've locked onto an attempt, ignore step events tagged with
        // a different attempt — they belong to a retry we've moved past, or
        // to an unrelated overlapping run of the same suite.
        if (event.attempt !== undefined && run.attempt !== undefined && event.attempt !== run.attempt) return run;
        if (event.type === 'step-start') return { ...run, currentStepName: event.name };
        if (event.type === 'step-end') return { ...run, completedSteps: run.completedSteps + 1, currentStepName: event.name };
        return run;
      });
    });
    return unsubscribe;
  }, []);

  const startRun = useCallback(
    (suite, opts) => {
      setActiveRun({
        suiteId: suite.id,
        suiteName: suite.name,
        totalSteps: suite.steps?.length || 0,
        completedSteps: 0,
        currentStepName: null,
        attempt: undefined,
      });
      toast(`Running "${suite.name}"…`, 'info');
      navigate('/runs');

      window.qaflow.runs
        .run(suite.id, opts)
        .then((report) => {
          const failed = report.status === 'failed';
          toast(`"${suite.name}" ${failed ? 'failed' : 'passed'}.`, failed ? 'error' : 'success');
          navigate(`/runs/${report.runId}`);
          reload();
        })
        .catch((e) => {
          toast(`Run failed: ${e.message}`, 'error');
        })
        .finally(() => {
          setActiveRun((run) => (run && run.suiteId === suite.id ? null : run));
        });
    },
    [toast, reload]
  );

  return { activeRun, startRun, dismissActiveRun: () => setActiveRun(null) };
}

// Surfaces the scheduler's fire events at the app level — not just the
// Dashboard — so the pass/fail toast and the app-wide data refresh happen
// no matter which screen the user is on when a scheduled run completes.
// Dashboard keeps a lighter local subscription (no toast) just to refresh
// its own schedules list/statuses.
function useScheduleFiredListener(reload) {
  const toast = useToast();

  useEffect(() => {
    const unsubscribe = window.qaflow.on('schedules:fired', ({ schedule, status }) => {
      toast(`Scheduled run ${schedule.name}: ${status === 'passed' ? 'passed' : 'failed'}`, status === 'passed' ? 'success' : 'error');
      reload();
    });
    return unsubscribe;
  }, [toast, reload]);
}

// Surfaces the main process's Playwright Chromium bootstrap. `installing`/
// `done` are expected first-run noise (a background download), so only the
// `error` status — main.js already prefixes it with the user-facing message
// — reaches a toast; the happy path stays silent.
function useBrowserBootstrapListener() {
  const toast = useToast();

  useEffect(() => {
    const unsubscribe = window.qaflow.on('browser:status', ({ status, error }) => {
      if (status === 'error') toast(error, 'error');
    });
    return unsubscribe;
  }, [toast]);
}

// Surfaces the main process's electron-updater state. Only `ready` renders
// anything (the persistent restart banner) — `checking`/`downloading`/`idle`
// are silent here and instead read live from Settings' About card, which
// polls `updates.status()` on demand. `dev` (unpackaged checkout) never
// fires this listener at all since main.js's dev stub never pushes.
function useUpdateReadyListener() {
  const [readyVersion, setReadyVersion] = useState(null);

  useEffect(() => {
    const unsubscribe = window.qaflow.on('updates:status', (payload) => {
      if (payload?.state === 'ready') setReadyVersion(payload.version);
    });
    return unsubscribe;
  }, []);

  return { readyVersion, dismiss: () => setReadyVersion(null) };
}

function Screen({ route, data, onNewProject, startRun }) {
  const [top, second] = route.segments;

  if (!top || top === 'dashboard') return <Dashboard data={data} onNewProject={onNewProject} />;

  if (top === 'projects') {
    if (second) return <ProjectDetail id={second} data={data} />;
    return <Projects data={data} onNewProject={onNewProject} startRun={startRun} />;
  }

  if (top === 'suites') {
    if (second) return <SuiteDetail id={second} data={data} startRun={startRun} />;
    return <Suites data={data} route={route} startRun={startRun} />;
  }

  if (top === 'credentials') return <Credentials data={data} />;

  if (top === 'runs') {
    if (second && route.segments[2] === 'report') return <ReportBuilder id={second} data={data} />;
    if (second) return <RunDetail id={second} data={data} startRun={startRun} />;
    return <Runs data={data} startRun={startRun} />;
  }

  if (top === 'kanban') {
    if (second) return <TicketDetail id={second} data={data} startRun={startRun} />;
    return <Kanban data={data} />;
  }

  if (top === 'settings') return <Settings data={data} />;

  if (top === 'reports') return <Reports data={data} />;

  return <EmptyScreen title="Not found" subtitle={`No screen registered for "#/${route.path}".`} />;
}

// `#/suites` is shared by the Test Suites and Recorder nav items — Recorder
// highlights only when `?panel=recorder` is present, Test Suites otherwise.
function activeNavKey(route) {
  const top = route.segments[0] || 'dashboard';
  if (top === 'suites' && route.query.panel === 'recorder') return 'recorder';
  return top;
}

function AppShell() {
  const route = useHashRoute();
  const data = useAppData();
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const { activeRun, startRun, dismissActiveRun } = useRunManager(data.reload);
  useScheduleFiredListener(data.reload);
  useBrowserBootstrapListener();
  const { readyVersion, dismiss: dismissUpdateReady } = useUpdateReadyListener();
  const [confirmRestartOpen, setConfirmRestartOpen] = useState(false);

  // A run in flight is driving a real Playwright process mid-write (video,
  // screenshots, report.json) — quitAndInstall() force-kills the whole app,
  // so restarting while `activeRun` is set needs an explicit "abort it?"
  // confirmation instead of installing straight away. The button itself
  // stays enabled either way — the user should still be able to choose.
  function handleRestartClick() {
    if (activeRun) {
      setConfirmRestartOpen(true);
      return;
    }
    window.qaflow.updates.install();
  }

  return (
    <>
      <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
        <Sidebar
          activeSegment={activeNavKey(route)}
          userName={data.settings?.userName}
          userEmail={data.settings?.userEmail}
          version={data.version}
        />
        <main className="flex-1 overflow-y-auto">
          {data.loaded ? (
            <Screen route={route} data={data} onNewProject={() => setNewProjectOpen(true)} startRun={startRun} />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading…</div>
          )}
        </main>
      </div>

      <NewProjectModal
        open={newProjectOpen}
        onClose={() => setNewProjectOpen(false)}
        onCreated={() => data.reload()}
      />

      <RunProgressBanner run={activeRun} onDismiss={dismissActiveRun} />
      <UpdateReadyBanner
        version={readyVersion}
        onInstall={handleRestartClick}
        onDismiss={dismissUpdateReady}
      />

      <ConfirmDialog
        open={confirmRestartOpen}
        title="A test run is in progress"
        description="Restarting now will abort it. Restart anyway?"
        confirmLabel="Restart anyway"
        variant="danger"
        onConfirm={() => window.qaflow.updates.install()}
        onClose={() => setConfirmRestartOpen(false)}
      />
    </>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AppShell />
    </ToastProvider>
  );
}

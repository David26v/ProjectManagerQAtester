import { Component, lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { EmptyScreen } from '@/components/EmptyScreen';
import { NewProjectModal } from '@/components/NewProjectModal';
import { RunProgressBanner } from '@/components/RunProgressBanner';
import { RunCompletionModal } from '@/components/RunCompletionModal';
import { UpdateReadyBanner } from '@/components/UpdateReadyBanner';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Login } from '@/screens/Login';
import { WorkspaceGate } from '@/screens/WorkspaceGate';
import { ToastProvider, useToast } from '@/lib/toast';
import { useHashRoute, navigate } from '@/hooks/useHashRoute';

// Screens are lazy-loaded (code-split by Vite) rather than bundled into the
// first paint: the shell + sidebar render immediately and each screen's
// chunk loads on first visit. That keeps startup fast and memory lower —
// screens the user never opens are never parsed or mounted.
const lazyScreen = (loader, name) => lazy(() => loader().then((m) => ({ default: m[name] })));
const Dashboard = lazyScreen(() => import('@/screens/Dashboard'), 'Dashboard');
const Projects = lazyScreen(() => import('@/screens/Projects'), 'Projects');
const ProjectDetail = lazyScreen(() => import('@/screens/ProjectDetail'), 'ProjectDetail');
const Suites = lazyScreen(() => import('@/screens/Suites'), 'Suites');
const SuiteDetail = lazyScreen(() => import('@/screens/SuiteDetail'), 'SuiteDetail');
const Runs = lazyScreen(() => import('@/screens/Runs'), 'Runs');
const RunDetail = lazyScreen(() => import('@/screens/RunDetail'), 'RunDetail');
const ReportBuilder = lazyScreen(() => import('@/screens/ReportBuilder'), 'ReportBuilder');
const Reports = lazyScreen(() => import('@/screens/Reports'), 'Reports');
const Credentials = lazyScreen(() => import('@/screens/Credentials'), 'Credentials');
const Kanban = lazyScreen(() => import('@/screens/Kanban'), 'Kanban');
const TicketDetail = lazyScreen(() => import('@/screens/TicketDetail'), 'TicketDetail');
const Settings = lazyScreen(() => import('@/screens/Settings'), 'Settings');
const Repo = lazyScreen(() => import('@/screens/Repo'), 'Repo');
const Guide = lazyScreen(() => import('@/screens/Guide'), 'Guide');
const Workspace = lazyScreen(() => import('@/screens/Workspace'), 'Workspace');

const useAppData = () => {
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

// Cloud auth state. `status` is null while the very first `auth:status`
// answer (which waits on the main process's session auto-restore) is in
// flight — the gate renders a splash for that instant. `configured: false`
// means there is no cloud auth wired at all (dev checkout / smoke without
// .env): the app runs ungated on local data, exactly as before Task 4.
const useAuth = () => {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    let mounted = true;
    // Subscribe BEFORE the initial fetch so a login/logout that lands
    // between the two never gets dropped. `auth:changed` only ever fires
    // when auth is wired, so `configured: true` is implied on that path.
    const unsubscribe = window.qaflow.on('auth:changed', (payload) => {
      if (mounted) setStatus({ ...payload, configured: true });
    });
    window.qaflow.auth.status().then((s) => {
      if (mounted) setStatus((prev) => prev ?? s);
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  return { status, refresh: (s) => setStatus({ ...s, configured: true }) };
}

// Owns the single in-flight run kicked off from a Run Suite modal. Lives
// above the modal (which closes/unmounts immediately on "Run Suite") so the
// `qaflow.runs.run()` promise and the `run:progress` stream both survive the
// navigate("#/runs") that follows — a fixed banner (rather than in-screen
// state) is what carries the live progress, and a completion modal (rather
// than an auto-navigate) is what lands the verdict.
const useRunManager = (reload) => {
  const toast = useToast();
  const [activeRun, setActiveRun] = useState(null);
  const [completedRun, setCompletedRun] = useState(null);

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
        if (event.type === 'step-end') {
          return {
            ...run,
            completedSteps: run.completedSteps + 1,
            currentStepName: event.name,
            // Latest live-preview frame from the runner (jpeg data URI) —
            // kept if a step-end arrives without one so the panel never
            // flashes back to empty mid-run.
            previewFrame: event.preview || run.previewFrame,
          };
        }
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
          setCompletedRun(report);
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

  return {
    activeRun,
    startRun,
    dismissActiveRun: () => setActiveRun(null),
    completedRun,
    dismissCompletedRun: () => setCompletedRun(null),
  };
}

// Surfaces the scheduler's fire events at the app level — not just the
// Dashboard — so the pass/fail toast and the app-wide data refresh happen
// no matter which screen the user is on when a scheduled run completes.
// Dashboard keeps a lighter local subscription (no toast) just to refresh
// its own schedules list/statuses.
const useScheduleFiredListener = (reload) => {
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
const useBrowserBootstrapListener = () => {
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
const useUpdateReadyListener = () => {
  const [readyVersion, setReadyVersion] = useState(null);

  useEffect(() => {
    const unsubscribe = window.qaflow.on('updates:status', (payload) => {
      if (payload?.state === 'ready') setReadyVersion(payload.version);
    });
    return unsubscribe;
  }, []);

  return { readyVersion, dismiss: () => setReadyVersion(null) };
}

const Screen = ({ route, data, onNewProject, startRun }) => {
  const [top, second] = route.segments;

  if (!top || top === 'dashboard') return <Dashboard data={data} onNewProject={onNewProject} />;

  if (top === 'projects') {
    if (second) return <ProjectDetail id={second} data={data} startRun={startRun} />;
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

  if (top === 'repo') return <Repo data={data} route={route} />;

  if (top === 'guide') return <Guide />;

  if (top === 'settings') return <Settings data={data} />;

  if (top === 'workspace') return <Workspace />;

  if (top === 'reports') return <Reports data={data} />;

  return <EmptyScreen title="Not found" subtitle={`No screen registered for "#/${route.path}".`} />;
}

const activeNavKey = (route) => route.segments[0] || 'dashboard';

const CenteredNote = ({ children }) => {
  return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{children}</div>;
}

// Catches anything a screen throws — a render bug, or a lazy chunk that
// failed to load (classic case: the renderer was rebuilt while the app was
// open, so the old bundle asks for chunk filenames that no longer exist).
// Without this, one broken screen unmounts the entire React tree and the
// window goes blank. Keyed by route in AppShell so navigating away retries.
// (A class, not an arrow — error boundaries are the one thing React still
// only supports via class components.)
class ScreenErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    console.error('[qaflow] screen crashed:', error);
  }

  render() {
    if (this.state.error) {
      const chunkFailed = /dynamically imported module|Loading chunk|Failed to fetch/i.test(String(this.state.error));
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
          <h2 className="text-lg font-semibold text-foreground">
            {chunkFailed ? 'The app was updated behind this window' : 'This screen hit an error'}
          </h2>
          <p className="max-w-md text-sm text-muted-foreground">
            {chunkFailed
              ? 'A newer build replaced the files this window loaded from. Reload to pick up the new version.'
              : String(this.state.error?.message || this.state.error)}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Reload app
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const AppShell = ({ authStatus }) => {
  const route = useHashRoute();
  const data = useAppData();
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const { activeRun, startRun, dismissActiveRun, completedRun, dismissCompletedRun } = useRunManager(data.reload);
  useScheduleFiredListener(data.reload);
  useBrowserBootstrapListener();
  const { readyVersion, dismiss: dismissUpdateReady } = useUpdateReadyListener();
  const [confirmRestartOpen, setConfirmRestartOpen] = useState(false);

  // A run or recording in flight is driving a real Playwright process
  // mid-write (video, screenshots, report.json) — quitAndInstall()
  // force-kills the whole app, so restarting needs an explicit "abort it?"
  // confirmation instead of installing straight away. Main is the source of
  // truth for "busy" (it also sees scheduled runs and recordings the
  // renderer's own `activeRun` state can't see) — call install() first and
  // only show the confirm dialog if main reports back blocked.
  const handleRestartClick = async () => {
    const result = await window.qaflow.updates.install();
    if (result && result.blocked) {
      setConfirmRestartOpen(true);
    }
  }

  return (
    <>
      <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
        <Sidebar
          activeSegment={activeNavKey(route)}
          userName={authStatus?.name || data.settings?.userName}
          userEmail={authStatus?.email || data.settings?.userEmail}
          workspaceName={authStatus?.workspace?.name}
          version={data.version}
        />
        <main className="flex-1 overflow-y-auto">
          {data.loaded ? (
            <ScreenErrorBoundary key={route.path}>
              <Suspense fallback={<CenteredNote>Loading…</CenteredNote>}>
                <Screen route={route} data={data} onNewProject={() => setNewProjectOpen(true)} startRun={startRun} />
              </Suspense>
            </ScreenErrorBoundary>
          ) : (
            <CenteredNote>Loading…</CenteredNote>
          )}
        </main>
      </div>

      <NewProjectModal
        open={newProjectOpen}
        onClose={() => setNewProjectOpen(false)}
        onCreated={() => data.reload()}
      />

      <RunProgressBanner run={activeRun} onDismiss={dismissActiveRun} />
      <RunCompletionModal report={completedRun} onClose={dismissCompletedRun} />
      <UpdateReadyBanner
        version={readyVersion}
        onInstall={handleRestartClick}
        onDismiss={dismissUpdateReady}
      />

      <ConfirmDialog
        open={confirmRestartOpen}
        title="A test run/recording is in progress"
        description="A test run/recording is in progress — restarting now will abort it. Restart anyway?"
        confirmLabel="Restart anyway"
        variant="danger"
        onConfirm={() => window.qaflow.updates.install({ force: true })}
        onClose={() => setConfirmRestartOpen(false)}
      />
    </>
  );
}

// The auth gate wraps the entire shell: while cloud auth is configured and
// no session is active, ONLY the Login screen exists — no data hooks mount,
// so no gated IPC call ever fires while signed out ("Not signed in" errors
// stay impossible by construction, not by scattered guards).
const AuthGate = () => {
  const { status, refresh } = useAuth();

  if (!status) {
    return <div className="flex h-screen w-screen items-center justify-center bg-background text-sm text-muted-foreground">Starting…</div>;
  }
  if (status.configured && !status.loggedIn) {
    return <Login onLoggedIn={refresh} />;
  }
  if (status.configured && !status.workspace) {
    return <WorkspaceGate status={status} kind="none" />;
  }
  if (status.configured && status.workspace.status === 'suspended') {
    return <WorkspaceGate status={status} kind="suspended" />;
  }
  return <AppShell authStatus={status.configured ? status : null} />;
}

const App = () => {
  return (
    <ToastProvider>
      <AuthGate />
    </ToastProvider>
  );
}

export default App;

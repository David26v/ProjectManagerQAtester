import { useCallback, useEffect, useState } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { EmptyScreen } from '@/components/EmptyScreen';
import { NewProjectModal } from '@/components/NewProjectModal';
import { RunProgressBanner } from '@/components/RunProgressBanner';
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
// navigate("#/runs") that follows — the Runs screen itself is still a
// Task 9 placeholder, so a fixed banner is what carries the live progress
// and the pass/fail toast in the meantime.
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

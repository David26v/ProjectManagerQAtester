import { useCallback, useEffect, useState } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { EmptyScreen } from '@/components/EmptyScreen';
import { NewProjectModal } from '@/components/NewProjectModal';
import { Dashboard } from '@/screens/Dashboard';
import { Projects } from '@/screens/Projects';
import { ProjectDetail } from '@/screens/ProjectDetail';
import { ToastProvider } from '@/lib/toast';
import { useHashRoute } from '@/hooks/useHashRoute';

function useAppData() {
  const [state, setState] = useState({
    projects: [],
    suites: [],
    runs: [],
    settings: {},
    version: '',
    loaded: false,
  });

  const reload = useCallback(async () => {
    const [projects, suites, runs, settings, version] = await Promise.all([
      window.qaflow.projects.list(),
      window.qaflow.suites.list(),
      window.qaflow.runs.list(),
      window.qaflow.settings.get(),
      window.qaflow.app.version(),
    ]);
    setState({ projects, suites, runs, settings, version, loaded: true });
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { ...state, reload };
}

function Screen({ route, data, onNewProject }) {
  const [top, second] = route.segments;

  if (!top || top === 'dashboard') return <Dashboard data={data} onNewProject={onNewProject} />;

  if (top === 'projects') {
    if (second) return <ProjectDetail id={second} data={data} />;
    return <Projects data={data} onNewProject={onNewProject} />;
  }

  switch (top) {
    case 'suites':
      return <EmptyScreen title="Test Suites" subtitle="Build and record test suites here — coming in a later task." />;
    case 'runs':
      return <EmptyScreen title={second ? 'Run Detail' : 'Runs'} subtitle="Run history and live progress land here in a later task." />;
    case 'kanban':
      return <EmptyScreen title="Kanban Board" subtitle="Bug ticket board — coming in a later task." />;
    case 'reports':
      return <EmptyScreen title="Reports" subtitle="Report export and bundling — coming in a later task." />;
    case 'credentials':
      return <EmptyScreen title="Credentials" subtitle="Saved login sessions for automated runs — coming in a later task." />;
    case 'settings':
      return <EmptyScreen title="Settings" subtitle="App preferences — coming in a later task." />;
    default:
      return <EmptyScreen title="Not found" subtitle={`No screen registered for "#/${route.path}".`} />;
  }
}

export default function App() {
  const route = useHashRoute();
  const data = useAppData();
  const [newProjectOpen, setNewProjectOpen] = useState(false);

  return (
    <ToastProvider>
      <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
        <Sidebar
          activeSegment={route.segments[0] || 'dashboard'}
          userName={data.settings?.userName}
          userEmail={data.settings?.userEmail}
          version={data.version}
        />
        <main className="flex-1 overflow-y-auto">
          {data.loaded ? (
            <Screen route={route} data={data} onNewProject={() => setNewProjectOpen(true)} />
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
    </ToastProvider>
  );
}

import {
  Home,
  Folder,
  ListChecks,
  Circle,
  Play,
  LayoutGrid,
  FileBarChart2,
  KeyRound,
  Settings,
  ChevronUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { label: 'Dashboard', href: '#/dashboard', icon: Home, match: 'dashboard' },
  { label: 'Projects', href: '#/projects', icon: Folder, match: 'projects' },
  { label: 'Test Suites', href: '#/suites', icon: ListChecks, match: 'suites' },
  // `?panel=recorder` (not a `#` fragment inside the hash, which the router
  // can't parse) — Task 8's Suites screen reads `route.query.panel` to
  // scroll to the recorder panel. Sharing the `suites` route segment with
  // Test Suites means only one of the two nav items highlights at a time;
  // App.jsx picks Recorder's highlight only when that query param is set,
  // Test Suites otherwise.
  { label: 'Recorder', href: '#/suites?panel=recorder', icon: Circle, match: 'recorder' },
  { label: 'Runs', href: '#/runs', icon: Play, match: 'runs' },
  { label: 'Kanban Board', href: '#/kanban', icon: LayoutGrid, match: 'kanban' },
  { label: 'Reports', href: '#/reports', icon: FileBarChart2, match: 'reports' },
  { label: 'Credentials', href: '#/credentials', icon: KeyRound, match: 'credentials' },
  { label: 'Settings', href: '#/settings', icon: Settings, match: 'settings' },
];

function initials(name) {
  const parts = String(name || 'QA Engineer').trim().split(/\s+/);
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() || '').join('') || 'QA';
}

export function Sidebar({ activeSegment, userName, userEmail, version }) {
  return (
    <aside className="flex w-[230px] shrink-0 flex-col border-r border-border bg-card">
      <div className="flex items-center gap-2 px-5 py-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
          Q
        </div>
        <span className="text-base font-semibold text-foreground">QA Flow</span>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-1">
        <ul className="flex flex-col gap-0.5">
          {NAV_ITEMS.map((item) => {
            const active = item.match === activeSegment;
            const Icon = item.icon;
            return (
              <li key={item.label}>
                <a
                  href={item.href}
                  className={cn(
                    'relative flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    active
                      ? 'bg-accent text-primary'
                      : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                  )}
                >
                  {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-primary" />}
                  <Icon className="h-4 w-4" />
                  {item.label}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-border p-3">
        <div className="flex items-center gap-2.5 rounded-md px-2 py-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-primary">
            {initials(userName)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-foreground">{userName || 'QA Engineer'}</div>
            <div className="truncate text-xs text-muted-foreground">{userEmail || 'qa.engineer@company.com'}</div>
          </div>
          <ChevronUp className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </div>
        <div className="mt-2 rounded-md bg-secondary/60 px-2.5 py-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
            Astreus {version ? `v${version}` : '—'}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 pl-3">All systems operational</div>
        </div>
      </div>
    </aside>
  );
}

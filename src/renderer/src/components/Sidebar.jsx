import {
  Home,
  Folder,
  ListChecks,
  Play,
  LayoutGrid,
  FileBarChart2,
  KeyRound,
  GitBranch,
  BookOpen,
  Settings,
  ChevronUp,
  Building2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { PRODUCT, VENDOR } from '@/lib/brand';

const NAV_ITEMS = [
  { label: 'Dashboard', href: '#/dashboard', icon: Home, match: 'dashboard' },
  { label: 'Projects', href: '#/projects', icon: Folder, match: 'projects' },
  // Test Suites and the recorder live on one screen — the list on top, the
  // recorder panel below. There's deliberately no separate "Recorder" nav
  // item: two entries pointing at the same screen read as a bug. The screen
  // still honors `?panel=recorder` (from "New Suite" and project cards) to
  // scroll straight to the recorder.
  { label: 'Test Suites', href: '#/suites', icon: ListChecks, match: 'suites' },
  { label: 'Runs', href: '#/runs', icon: Play, match: 'runs' },
  { label: 'Kanban Board', href: '#/kanban', icon: LayoutGrid, match: 'kanban' },
  { label: 'Reports', href: '#/reports', icon: FileBarChart2, match: 'reports' },
  { label: 'Credentials', href: '#/credentials', icon: KeyRound, match: 'credentials' },
  { label: 'Workspace', href: '#/workspace', icon: Building2, match: 'workspace' },
  { label: 'Repository', href: '#/repo', icon: GitBranch, match: 'repo' },
  { label: 'Guide', href: '#/guide', icon: BookOpen, match: 'guide' },
  { label: 'Settings', href: '#/settings', icon: Settings, match: 'settings' },
];

function initials(name) {
  const parts = String(name || 'QA Engineer').trim().split(/\s+/);
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() || '').join('') || 'QA';
}

export const Sidebar = ({ activeSegment, userName, userEmail, workspaceName, version }) => {
  return (
    <aside className="flex w-[230px] shrink-0 flex-col border-r border-border bg-card">
      <div className="flex items-center gap-2 px-5 py-5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
          A
        </div>
        <span className="text-sm font-semibold leading-tight text-foreground">{PRODUCT}</span>
      </div>

      {workspaceName && (
        <div className="-mt-3 px-5 pb-3">
          <span className="inline-flex max-w-full items-center gap-1.5 truncate rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-medium text-primary" title="Your workspace">
            {workspaceName}
          </span>
        </div>
      )}

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
            {PRODUCT} {version ? `v${version}` : '—'}
          </div>
          <div className="mt-0.5 pl-3">All systems operational</div>
          <div className="mt-1.5 border-t border-border/60 pt-1.5 text-[10px] leading-tight text-muted-foreground/80">{VENDOR}</div>
        </div>
      </div>
    </aside>
  );
};

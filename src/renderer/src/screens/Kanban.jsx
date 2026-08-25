import { useMemo, useState } from 'react';
import { Search, Plus, MessageSquare, Paperclip, Play, Clock, TrendingUp, History } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { QuickAddTicketModal } from '@/components/QuickAddTicketModal';
import { fmtShortDate, timeAgo } from '@/lib/format';
import { shortRunId } from '@/lib/media';
import { withinLastDays } from '@/lib/stats';
import { STATUSES, SEVERITIES, severityMeta, ticketAgeDays } from '@/lib/tickets';
import { navigate } from '@/hooks/useHashRoute';
import { useToast } from '@/lib/toast';
import { cn } from '@/lib/utils';

// `#/kanban` — bug ticket board (kanban-3 mockup). Tickets are created by
// `reports.createTicket` (Task 9, from a failed run) and by this screen's
// per-column "+ Add Ticket" quick modal; both write through `tickets.save`,
// so `data.tickets` (fed by App.jsx's single `useAppData` Promise.all) is
// the one source of truth for every column here.
function TicketCard({ ticket, project, run, onDragStart }) {
  const severity = severityMeta(ticket.severity);
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, ticket.id)}
      onClick={() => navigate(`/kanban/${ticket.id}`)}
      className="flex cursor-grab flex-col gap-2 rounded-xl border border-border bg-card p-3.5 shadow-sm transition-shadow hover:shadow-md active:cursor-grabbing"
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          navigate(`/kanban/${ticket.id}`);
        }}
        className="w-fit text-xs font-semibold text-primary hover:underline"
      >
        {ticket.id}
      </button>
      <div className="text-sm font-medium leading-snug text-foreground">{ticket.title}</div>
      <div className="text-xs text-muted-foreground">{project?.name || 'Unknown project'}</div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', severity.chip)}>{severity.label}</span>
        {run?.environment && (
          <span className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">{run.environment}</span>
        )}
      </div>
      {run && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/runs/${run.runId}`);
          }}
          className="flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-primary"
        >
          <Play className="h-3 w-3" /> Run: {shortRunId(run.runId)}
        </button>
      )}
      <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <Paperclip className="h-3 w-3" /> {ticket.attachments?.length || 0}
          </span>
          <span className="flex items-center gap-1">
            <MessageSquare className="h-3 w-3" /> {ticket.comments?.length || 0}
          </span>
        </div>
        <span>{fmtShortDate(ticket.updatedAt || ticket.createdAt)}</span>
      </div>
    </div>
  );
}

export function Kanban({ data }) {
  const { projects, runs, tickets, reload } = data;
  const toast = useToast();

  const [projectFilter, setProjectFilter] = useState('all');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [assigneeFilter, setAssigneeFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [addModal, setAddModal] = useState(null); // status key of the column being added to, or null
  const [dragOverStatus, setDragOverStatus] = useState(null);

  const projectsById = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p])), [projects]);
  const runsById = useMemo(() => Object.fromEntries(runs.map((r) => [r.runId, r])), [runs]);

  const assignees = useMemo(
    () => [...new Set(tickets.map((t) => t.assignee).filter(Boolean))].sort(),
    [tickets]
  );

  const filteredTickets = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tickets.filter((t) => {
      if (projectFilter !== 'all' && t.projectId !== projectFilter) return false;
      if (severityFilter !== 'all' && t.severity !== severityFilter) return false;
      if (assigneeFilter !== 'all' && t.assignee !== assigneeFilter) return false;
      if (q && !t.id.toLowerCase().includes(q) && !t.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [tickets, projectFilter, severityFilter, assigneeFilter, search]);

  const byStatus = useMemo(() => {
    const map = Object.fromEntries(STATUSES.map((s) => [s.key, []]));
    for (const t of filteredTickets) {
      (map[t.status] || map.backlog).push(t);
    }
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
    }
    return map;
  }, [filteredTickets]);

  const workflowCounts = useMemo(
    () => Object.fromEntries(STATUSES.map((s) => [s.key, tickets.filter((t) => t.status === s.key).length])),
    [tickets]
  );
  const severityCounts = useMemo(
    () => Object.fromEntries(SEVERITIES.map((s) => [s.key, tickets.filter((t) => t.severity === s.key).length])),
    [tickets]
  );

  const insights = useMemo(() => {
    const open = tickets.filter((t) => t.status !== 'done');
    const aging7 = open.filter((t) => ticketAgeDays(t) > 7).length;
    const aging14 = open.filter((t) => ticketAgeDays(t) > 14).length;
    const aging30 = open.filter((t) => ticketAgeDays(t) > 30).length;
    const createdThisWeek = tickets.filter((t) => withinLastDays(t.createdAt, 7)).length;
    const completedThisWeek = tickets.filter((t) => t.status === 'done' && withinLastDays(t.updatedAt, 7)).length;
    const inProgress = workflowCounts.in_progress || 0;
    const recent = [...tickets].sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt)).slice(0, 5);
    return { aging7, aging14, aging30, createdThisWeek, completedThisWeek, inProgress, recent };
  }, [tickets, workflowCounts]);

  async function moveTicket(ticketId, status) {
    const ticket = tickets.find((t) => t.id === ticketId);
    if (!ticket || ticket.status === status) return;
    try {
      await window.qaflow.tickets.save({ ...ticket, status });
      reload();
    } catch (e) {
      toast(`Failed to move "${ticket.id}": ${e.message}`, 'error');
    }
  }

  function onDragStart(e, ticketId) {
    e.dataTransfer.setData('text/plain', ticketId);
    e.dataTransfer.effectAllowed = 'move';
  }

  function onDrop(e, status) {
    e.preventDefault();
    setDragOverStatus(null);
    const ticketId = e.dataTransfer.getData('text/plain');
    if (ticketId) moveTicket(ticketId, status);
  }

  return (
    <div className="flex flex-col gap-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Kanban Board</h1>
        <p className="mt-1 text-sm text-muted-foreground">Track, prioritize, and resolve quality issues across your projects.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="w-48">
          <Select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
            <option value="all">All Projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-40">
          <Select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)}>
            <option value="all">All Severities</option>
            {SEVERITIES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-44">
          <Select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)} disabled={assignees.length === 0}>
            <option value="all">All Assignees</option>
            {assignees.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
        </div>
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search tickets..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 rounded-xl border border-border bg-card p-5 shadow-sm sm:grid-cols-2 xl:grid-cols-[1fr_1fr_auto]">
        <div>
          <div className="text-sm font-semibold text-foreground">Workflow Summary</div>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {STATUSES.map((s) => (
              <div key={s.key} className="flex items-center gap-1.5">
                <span className="text-muted-foreground">{s.label}</span>
                <span className="font-semibold text-foreground">{workflowCounts[s.key] || 0}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="text-sm font-semibold text-foreground">Severity Summary</div>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {SEVERITIES.map((s) => (
              <div key={s.key} className="flex items-center gap-1.5">
                <span className={cn('h-2 w-2 rounded-full', s.dot)} />
                <span className="text-muted-foreground">{s.label}</span>
                <span className="font-semibold text-foreground">{severityCounts[s.key] || 0}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col items-start justify-center xl:items-end">
          <div className="text-xs text-muted-foreground">Total Tickets</div>
          <div className="text-2xl font-semibold text-foreground">{tickets.length}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_320px]">
        <div className="grid grid-cols-1 gap-4 overflow-x-auto sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 xl:items-start">
          {STATUSES.map((s) => {
            const columnTickets = byStatus[s.key] || [];
            return (
              <div
                key={s.key}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverStatus(s.key);
                }}
                onDragLeave={() => setDragOverStatus((k) => (k === s.key ? null : k))}
                onDrop={(e) => onDrop(e, s.key)}
                className={cn(
                  'flex min-h-[200px] flex-col gap-3 rounded-xl border border-border bg-secondary/30 p-3 transition-colors',
                  dragOverStatus === s.key && 'border-primary bg-accent/60'
                )}
              >
                <div className="flex items-center justify-between px-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">{s.label}</span>
                    <span className="rounded-full bg-secondary px-1.5 py-0.5 text-xs font-medium text-muted-foreground">{columnTickets.length}</span>
                  </div>
                  <button
                    onClick={() => setAddModal(s.key)}
                    className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-primary"
                    title="Add Ticket"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="flex flex-1 flex-col gap-3">
                  {columnTickets.length === 0 && (
                    <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">No tickets here.</div>
                  )}
                  {columnTickets.map((t) => (
                    <TicketCard key={t.id} ticket={t} project={projectsById[t.projectId]} run={t.runId ? runsById[t.runId] : null} onDragStart={onDragStart} />
                  ))}
                </div>

                <button
                  onClick={() => setAddModal(s.key)}
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-2 text-xs font-medium text-muted-foreground hover:border-primary hover:text-primary"
                >
                  <Plus className="h-3.5 w-3.5" /> Add Ticket
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <TrendingUp className="h-4 w-4 text-muted-foreground" /> Board Insights
            </div>

            <div className="mt-4">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Aging Tickets</div>
              <div className="mt-2 flex flex-col gap-1.5 text-sm">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <Clock className="h-3 w-3 text-amber-500" /> &gt; 7 days
                  </span>
                  <span className="font-medium text-foreground">{insights.aging7}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <Clock className="h-3 w-3 text-danger" /> &gt; 14 days
                  </span>
                  <span className="font-medium text-foreground">{insights.aging14}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <Clock className="h-3 w-3 text-primary" /> &gt; 30 days
                  </span>
                  <span className="font-medium text-foreground">{insights.aging30}</span>
                </div>
              </div>
            </div>

            <div className="mt-4 border-t border-border pt-4">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Throughput (This Week)</div>
              <div className="mt-2 flex flex-col gap-1.5 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Completed</span>
                  <span className="font-medium text-success">{insights.completedThisWeek}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Created</span>
                  <span className="font-medium text-foreground">{insights.createdThisWeek}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">In Progress</span>
                  <span className="font-medium text-foreground">{insights.inProgress}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <History className="h-4 w-4 text-muted-foreground" /> Recent Updates
            </div>
            <div className="mt-3 flex flex-col gap-3">
              {insights.recent.length === 0 && <p className="text-sm text-muted-foreground">No ticket activity yet.</p>}
              {insights.recent.map((t) => (
                <button
                  key={t.id}
                  onClick={() => navigate(`/kanban/${t.id}`)}
                  className="flex items-start justify-between gap-2 text-left text-xs hover:text-primary"
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-primary">{t.id}</div>
                    <div className="truncate text-muted-foreground">{t.title}</div>
                  </div>
                  <span className="shrink-0 text-muted-foreground">{timeAgo(t.updatedAt || t.createdAt)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <QuickAddTicketModal
        open={Boolean(addModal)}
        status={addModal}
        projects={projects}
        defaultProjectId={projectFilter !== 'all' ? projectFilter : undefined}
        onClose={() => setAddModal(null)}
        onCreated={reload}
      />
    </div>
  );
}

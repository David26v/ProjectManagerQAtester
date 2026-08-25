// Shared bug-ticket vocabulary — kanban column order/labels, severity
// palette, and the static checklist template. Used by both the Kanban board
// and the Ticket Detail screen so column order, chip colors, and the
// checklist items agree everywhere a ticket renders.

export const STATUSES = [
  { key: 'backlog', label: 'Backlog' },
  { key: 'ready', label: 'Ready for QA' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'done', label: 'Done' },
];

export const STATUS_LABELS = Object.fromEntries(STATUSES.map((s) => [s.key, s.label]));

export function statusLabel(status) {
  return STATUS_LABELS[status] || status || 'Unknown';
}

export const SEVERITIES = [
  { key: 'critical', label: 'Critical', chip: 'bg-danger-bg text-danger', dot: 'bg-danger' },
  { key: 'high', label: 'High', chip: 'bg-orange-50 text-orange-700', dot: 'bg-orange-500' },
  { key: 'medium', label: 'Medium', chip: 'bg-warning-bg text-amber-800', dot: 'bg-amber-500' },
  { key: 'low', label: 'Low', chip: 'bg-success-bg text-success', dot: 'bg-success' },
];

const SEVERITY_BY_KEY = Object.fromEntries(SEVERITIES.map((s) => [s.key, s]));

export function severityMeta(severity) {
  return SEVERITY_BY_KEY[severity] || { key: severity, label: severity || 'Unknown', chip: 'bg-secondary text-muted-foreground', dot: 'bg-muted-foreground' };
}

// Static 6-item checklist (kanban-4 mockup) — every ticket gets the same
// template; per-ticket completion state persists on `ticket.checklist` as
// `[{ label, done }]` so item text always matches this list even for
// tickets created before the checklist existed.
export const CHECKLIST_TEMPLATE = [
  'Reproduced on staging',
  'Captured console error',
  'Verified API response',
  'Validated error message',
  'Reproduced on multiple environments',
  'Updated documentation',
];

export function ensureChecklist(ticket) {
  if (Array.isArray(ticket?.checklist) && ticket.checklist.length === CHECKLIST_TEMPLATE.length) {
    return ticket.checklist;
  }
  return CHECKLIST_TEMPLATE.map((label) => ({ label, done: false }));
}

export function ticketAgeDays(ticket) {
  if (!ticket?.createdAt) return 0;
  const created = new Date(ticket.createdAt).getTime();
  if (Number.isNaN(created)) return 0;
  return Math.floor((Date.now() - created) / (24 * 60 * 60 * 1000));
}

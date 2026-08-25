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

// High reuses the `danger` token at lower opacity (rather than a raw
// Tailwind `orange-*` swatch outside the app's token system) so all four
// severities stay on the same success/danger/warning palette as everything
// else in the app.
export const SEVERITIES = [
  { key: 'critical', label: 'Critical', chip: 'bg-danger-bg text-danger', dot: 'bg-danger' },
  { key: 'high', label: 'High', chip: 'bg-danger/10 text-danger', dot: 'bg-danger/70' },
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

// `ticketFromRun` (engine/exporters/ticket.js) stuffs the entire Jira-style
// dump — Summary/Environment/Severity/Reporter/Status/Steps to
// reproduce/Expected/Actual/Attachments — into `ticket.description`. That
// duplicates the Reproduction Steps card and shows a hardcoded "Status:
// Open" line that goes stale the moment the ticket moves columns. Pull just
// the summary (+ Expected/Actual, which aren't shown elsewhere) out of it
// for display; plain descriptions (quick-add tickets, user edits) pass
// through untouched.
export function parseTicketDescription(description) {
  if (!description) return { summary: '', expected: null, actual: null, isRawDump: false };

  const isRawDump = /^Summary:/m.test(description) && /^Steps to reproduce:/m.test(description) && /^Reporter:/m.test(description);
  if (!isRawDump) return { summary: description, expected: null, actual: null, isRawDump: false };

  const summaryMatch = description.match(/^Summary:\s*(.*)$/m);
  const expectedMatch = description.match(/^Expected:\s*(.*)$/m);
  const actualMatch = description.match(/^Actual:\s*([\s\S]*?)(?:\n\n|\nAttachments:|$)/m);

  return {
    summary: summaryMatch ? summaryMatch[1].trim() : description,
    expected: expectedMatch ? expectedMatch[1].trim() : null,
    actual: actualMatch ? actualMatch[1].trim() : null,
    isRawDump: true,
  };
}

export function ticketAgeDays(ticket) {
  if (!ticket?.createdAt) return 0;
  const created = new Date(ticket.createdAt).getTime();
  if (Number.isNaN(created)) return 0;
  return Math.floor((Date.now() - created) / (24 * 60 * 60 * 1000));
}

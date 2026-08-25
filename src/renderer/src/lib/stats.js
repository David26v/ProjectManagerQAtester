// Pure aggregation helpers over the raw store arrays (projects/suites/runs).
// Shared by Dashboard and ProjectDetail so "last 7 days" means the same
// thing everywhere.

const DAY_MS = 24 * 60 * 60 * 1000;

function since(days) {
  return Date.now() - days * DAY_MS;
}

export function withinLastDays(iso, days) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return t >= since(days);
}

// Items whose `dateField` falls in [now-2*days, now-days) — the period
// immediately before the "last N days" window, for computing deltas.
export function withinPriorWindow(iso, days) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return t >= since(days * 2) && t < since(days);
}

export function successRate(runs) {
  if (!runs.length) return 0;
  const passed = runs.filter((r) => r.status === 'passed').length;
  return (passed / runs.length) * 100;
}

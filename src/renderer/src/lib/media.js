// Resolves `qaflow-media://` URLs for a run's captured media through
// `window.qaflow.app.mediaUrl` (never build file:// paths by hand). Batches
// every item behind one `Promise.all` so grids/galleries do a single pass
// instead of one IPC round trip per render.

export async function resolveMediaUrls(runId, mediaList = [], extra = {}) {
  if (!runId) return {};
  const entries = await Promise.all(
    (mediaList || []).map(async (m) => [m.id, await window.qaflow.app.mediaUrl(runId, m.path)])
  );
  const extraEntries = await Promise.all(
    Object.entries(extra).map(async ([key, relPath]) => [key, relPath ? await window.qaflow.app.mediaUrl(runId, relPath) : null])
  );
  return Object.fromEntries([...entries, ...extraEntries]);
}

export function shortRunId(runId) {
  if (!runId) return '—';
  const hex = String(runId).split('-').pop();
  return `#${hex.toUpperCase()}`;
}

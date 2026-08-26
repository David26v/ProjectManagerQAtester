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

// Shared "Open Folder" behavior for the three screens that offer it. Local
// runs open their folder in the file manager; cloud runs (media in Supabase
// Storage, local dir already reclaimed) get a signed playback URL copied to
// the clipboard instead. `toast` is the caller's useToast() function.
export async function openRunFolder(runId, toast) {
  try {
    const result = await window.qaflow.runs.openDir(runId);
    if (result?.cloud) {
      if (result.mediaLink) {
        await navigator.clipboard?.writeText(result.mediaLink);
        toast('This run\'s media lives in the cloud — signed video link copied to clipboard.', 'info');
      } else {
        toast('This run\'s media lives in the cloud — open it from Run Details instead.', 'info');
      }
    } else if (result && result.opened === false) {
      toast('No local folder exists for this run.', 'warning');
    }
  } catch (e) {
    toast(`Failed to open run folder: ${e.message}`, 'error');
  }
}

export function shortRunId(runId) {
  if (!runId) return '—';
  const hex = String(runId).split('-').pop();
  return `#${hex.toUpperCase()}`;
}

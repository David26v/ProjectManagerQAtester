import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  Download,
  Upload,
  RefreshCw,
  RotateCcw,
  Plus,
  Check,
  KeyRound,
  FolderGit2,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { EmptyScreen } from '@/components/EmptyScreen';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/lib/toast';
import { computeGraph, laneColor } from '@/lib/commitGraph';
import { timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';

const LANE_W = 14;
const ROW_H = 44;

// Per-row slice of the commit graph — verticals for lanes passing through,
// curves from incoming lanes into the dot, curves from the dot out to each
// parent's lane. Rows stack, so segments meet exactly at row boundaries.
function GraphCell({ row, maxLanes }) {
  const cx = (i) => i * LANE_W + LANE_W / 2;
  const H = ROW_H;
  const width = maxLanes * LANE_W;

  return (
    <svg width={width} height={H} className="shrink-0" aria-hidden="true">
      {row.passThrough.map((j) => (
        <line key={`p${j}`} x1={cx(j)} y1={0} x2={cx(j)} y2={H} stroke={laneColor(j)} strokeWidth="2" />
      ))}
      {row.incoming.map((i) => (
        <path
          key={`i${i}`}
          d={`M ${cx(i)} 0 C ${cx(i)} ${H / 4}, ${cx(row.lane)} ${H / 4}, ${cx(row.lane)} ${H / 2}`}
          stroke={laneColor(i)}
          strokeWidth="2"
          fill="none"
        />
      ))}
      {row.parentLanes.map((p, idx) => (
        <path
          key={`o${p}-${idx}`}
          d={`M ${cx(row.lane)} ${H / 2} C ${cx(row.lane)} ${(3 * H) / 4}, ${cx(p)} ${(3 * H) / 4}, ${cx(p)} ${H}`}
          stroke={laneColor(p)}
          strokeWidth="2"
          fill="none"
        />
      ))}
      <circle cx={cx(row.lane)} cy={H / 2} r="4.5" fill={laneColor(row.lane)} />
    </svg>
  );
}

function DiffView({ diff }) {
  if (!diff) return <div className="p-6 text-sm text-muted-foreground">Select a file to see its changes.</div>;
  if (diff.binary) return <div className="p-6 text-sm text-muted-foreground">Binary file — no text diff.</div>;
  if (diff.tooLarge) return <div className="p-6 text-sm text-muted-foreground">File too large to diff.</div>;
  if (!diff.hunks || diff.hunks.length === 0)
    return <div className="p-6 text-sm text-muted-foreground">No changes in this file.</div>;

  return (
    <div className="overflow-x-auto font-mono text-xs leading-relaxed">
      {diff.hunks.map((h, i) => (
        <div key={i} className="mb-2">
          <div className="bg-secondary/70 px-3 py-1 text-muted-foreground">{h.header}</div>
          {h.lines.map((line, j) => (
            <div
              key={j}
              className={cn(
                'whitespace-pre px-3',
                line.startsWith('+') && 'bg-success-bg text-success',
                line.startsWith('-') && 'bg-danger-bg text-danger'
              )}
            >
              {line || ' '}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function stateBadge(state) {
  const map = {
    added: ['A', 'text-success'],
    untracked: ['?', 'text-success'],
    modified: ['M', 'text-primary'],
    deleted: ['D', 'text-danger'],
    'deleted-staged-readded': ['M', 'text-primary'],
  };
  const [letter, cls] = map[state] || ['·', 'text-muted-foreground'];
  return <span className={cn('w-4 shrink-0 text-center font-mono text-xs font-bold', cls)}>{letter}</span>;
}

function FileRow({ file, selected, onSelect, actions }) {
  return (
    <div
      className={cn(
        'group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm',
        selected ? 'bg-accent text-primary' : 'hover:bg-secondary'
      )}
      onClick={onSelect}
    >
      {stateBadge(file.state)}
      <span className="min-w-0 flex-1 truncate" title={file.filepath}>
        {file.filepath}
      </span>
      <div className="hidden shrink-0 gap-1 group-hover:flex">{actions}</div>
    </div>
  );
}

// `#/repo` — the embedded Sourcetree-style git client. One local working
// copy per project per device; the GitHub token is stored encrypted
// device-side and never shown back.
export function Repo({ data }) {
  const { projects } = data;
  const toast = useToast();

  const [projectId, setProjectId] = useState(projects[0]?.id || '');
  const [info, setInfo] = useState(null);
  const [view, setView] = useState('working');
  const [busy, setBusy] = useState(null);

  // clone form
  const [cloneUrl, setCloneUrl] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [cloneProgress, setCloneProgress] = useState(null);

  // working copy
  const [status, setStatus] = useState({ staged: [], unstaged: [] });
  const [commitMessage, setCommitMessage] = useState('');
  const [discardTarget, setDiscardTarget] = useState(null);

  // history
  const [history, setHistory] = useState([]);
  const [selectedCommit, setSelectedCommit] = useState(null);
  const [commitFileList, setCommitFileList] = useState([]);

  // shared diff panel
  const [selectedFile, setSelectedFile] = useState(null); // { filepath, oid|null }
  const [diff, setDiff] = useState(null);

  // branches
  const [newBranchName, setNewBranchName] = useState('');

  useEffect(() => {
    if (!projectId && projects[0]) setProjectId(projects[0].id);
  }, [projects, projectId]);

  const loadInfo = useCallback(async () => {
    if (!projectId) return;
    try {
      const result = await window.qaflow.repo.info(projectId);
      setInfo(result);
      setCloneUrl((u) => u || result.url || '');
    } catch (e) {
      toast(`Failed to load repository info: ${e.message}`, 'error');
    }
  }, [projectId, toast]);

  const loadWorkbench = useCallback(async () => {
    if (!projectId) return;
    try {
      const [s, h] = await Promise.all([
        window.qaflow.repo.status(projectId),
        window.qaflow.repo.log(projectId, { depth: 200 }),
      ]);
      setStatus(s);
      setHistory(h);
    } catch (e) {
      toast(`Failed to read repository: ${e.message}`, 'error');
    }
  }, [projectId, toast]);

  useEffect(() => {
    setInfo(null);
    setSelectedFile(null);
    setDiff(null);
    setSelectedCommit(null);
    setHistory([]);
    setStatus({ staged: [], unstaged: [] });
    loadInfo();
  }, [projectId, loadInfo]);

  useEffect(() => {
    if (info?.cloned) loadWorkbench();
  }, [info?.cloned, loadWorkbench]);

  useEffect(() => {
    const unsubscribe = window.qaflow.on('repo:progress', (p) => {
      if (p.projectId === projectId) setCloneProgress(p);
    });
    return unsubscribe;
  }, [projectId]);

  const graph = useMemo(() => computeGraph(history), [history]);

  async function run(key, fn, { successMsg = null, refresh = true } = {}) {
    setBusy(key);
    try {
      await fn();
      if (successMsg) toast(successMsg, 'success');
      if (refresh) {
        await loadInfo();
        await loadWorkbench();
      }
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(null);
    }
  }

  async function doClone() {
    if (tokenInput.trim()) {
      await window.qaflow.repo.saveAuth({ token: tokenInput.trim() });
      setTokenInput('');
    }
    setCloneProgress(null);
    await run('clone', () => window.qaflow.repo.clone({ projectId, url: cloneUrl.trim() }), {
      successMsg: 'Repository cloned.',
    });
    setCloneProgress(null);
  }

  async function openWorkingFile(file) {
    setSelectedFile({ filepath: file.filepath, oid: null });
    setDiff(null);
    try {
      setDiff(await window.qaflow.repo.diff({ projectId, filepath: file.filepath }));
    } catch (e) {
      toast(`Failed to diff ${file.filepath}: ${e.message}`, 'error');
    }
  }

  async function openCommit(oid) {
    setSelectedCommit(oid);
    setSelectedFile(null);
    setDiff(null);
    setCommitFileList([]);
    try {
      setCommitFileList(await window.qaflow.repo.commitFiles({ projectId, oid }));
    } catch (e) {
      toast(`Failed to read commit: ${e.message}`, 'error');
    }
  }

  async function openCommitFile(oid, file) {
    setSelectedFile({ filepath: file.filepath, oid });
    setDiff(null);
    try {
      setDiff(await window.qaflow.repo.diff({ projectId, filepath: file.filepath, oid }));
    } catch (e) {
      toast(`Failed to diff ${file.filepath}: ${e.message}`, 'error');
    }
  }

  async function doCommit() {
    if (!status.staged.length) {
      toast('Stage at least one file first.', 'warning');
      return;
    }
    await run('commit', () => window.qaflow.repo.commit({ projectId, message: commitMessage }), {
      successMsg: 'Committed.',
    });
    setCommitMessage('');
    setSelectedFile(null);
    setDiff(null);
  }

  const project = projects.find((p) => p.id === projectId);
  const selectedCommitMeta = history.find((c) => c.oid === selectedCommit);

  if (!projects.length) {
    return <EmptyScreen title="No projects yet" subtitle="Create a project first — each project gets its own repository connection." />;
  }

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Repository</h1>
        <p className="mt-1 text-sm text-muted-foreground">Built-in git client — clone, branch, commit, pull and push without leaving the app.</p>
      </div>
      <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="w-56">
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Select>
    </div>
  );

  if (!info) {
    return (
      <div className="flex flex-col gap-6 p-8">
        {header}
        <div className="text-sm text-muted-foreground">Loading…</div>
      </div>
    );
  }

  // ---- not cloned yet: connect card ----
  if (!info.cloned) {
    const pct = cloneProgress && cloneProgress.total ? Math.round((cloneProgress.loaded / cloneProgress.total) * 100) : null;
    return (
      <div className="flex flex-col gap-6 p-8">
        {header}
        <div className="max-w-lg rounded-xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center gap-2 text-base font-semibold text-foreground">
            <FolderGit2 className="h-4 w-4 text-muted-foreground" /> Connect {project?.name} to GitHub
          </div>
          <div className="mt-4 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="repo-url">Repository HTTPS URL</Label>
              <Input id="repo-url" placeholder="https://github.com/owner/repo.git" value={cloneUrl} onChange={(e) => setCloneUrl(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="repo-token">
                GitHub personal access token {info.hasToken && <span className="font-normal text-success">— saved ✓</span>}
              </Label>
              <Input
                id="repo-token"
                type="password"
                placeholder={info.hasToken ? 'Leave blank to keep the saved token' : 'ghp_… or github_pat_…'}
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                <KeyRound className="mr-1 inline h-3 w-3" />
                Needed for private repos and for pushing. Stored encrypted on this device only — never synced.
              </p>
            </div>
            {busy === 'clone' && (
              <div className="rounded-md bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
                Cloning{cloneProgress ? ` — ${cloneProgress.phase}${pct != null ? ` (${pct}%)` : ''}` : '…'}
              </div>
            )}
            <Button className="self-start" onClick={doClone} disabled={busy === 'clone' || !cloneUrl.trim()}>
              <Download className="h-4 w-4" /> {busy === 'clone' ? 'Cloning…' : 'Clone Repository'}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ---- cloned: the workbench ----
  const branches = info.branches || { current: null, local: [], remote: [] };
  const remoteOnly = branches.remote.filter((b) => !branches.local.includes(b));

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      {header}

      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => run('pull', () => window.qaflow.repo.pull(projectId), { successMsg: 'Pulled latest changes.' })} disabled={Boolean(busy)}>
          <Download className="h-4 w-4" /> {busy === 'pull' ? 'Pulling…' : 'Pull'}
        </Button>
        <Button variant="outline" size="sm" onClick={() => run('push', () => window.qaflow.repo.push(projectId), { successMsg: 'Pushed to origin.' })} disabled={Boolean(busy)}>
          <Upload className="h-4 w-4" /> {busy === 'push' ? 'Pushing…' : 'Push'}
        </Button>
        <Button variant="outline" size="sm" onClick={() => run('fetch', () => window.qaflow.repo.fetch(projectId), { successMsg: 'Fetched from origin.' })} disabled={Boolean(busy)}>
          <RefreshCw className="h-4 w-4" /> {busy === 'fetch' ? 'Fetching…' : 'Fetch'}
        </Button>
        <div className="mx-2 h-5 w-px bg-border" />
        <span className="flex items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-xs font-medium text-primary">
          <GitBranch className="h-3.5 w-3.5" /> {branches.current || 'detached'}
        </span>
        <div className="flex-1" />
        <div className="flex gap-1 rounded-md bg-secondary p-0.5">
          <button
            onClick={() => setView('working')}
            className={cn('rounded px-3 py-1 text-xs font-medium', view === 'working' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground')}
          >
            Working Copy {status.staged.length + status.unstaged.length > 0 && `(${status.staged.length + status.unstaged.length})`}
          </button>
          <button
            onClick={() => setView('history')}
            className={cn('rounded px-3 py-1 text-xs font-medium', view === 'history' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground')}
          >
            History
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-4">
        {/* branch rail */}
        <aside className="flex w-52 shrink-0 flex-col gap-3 overflow-y-auto">
          <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
            <div className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Branches</div>
            <div className="mt-1.5 flex flex-col">
              {branches.local.map((b) => (
                <button
                  key={b}
                  onClick={() =>
                    b !== branches.current &&
                    run('checkout', () => window.qaflow.repo.checkout({ projectId, ref: b }), { successMsg: `Switched to ${b}.` })
                  }
                  className={cn(
                    'flex items-center gap-1.5 truncate rounded-md px-2 py-1.5 text-left text-sm',
                    b === branches.current ? 'bg-accent font-medium text-primary' : 'text-foreground hover:bg-secondary'
                  )}
                  title={b}
                >
                  <GitBranch className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{b}</span>
                  {b === branches.current && <Check className="ml-auto h-3.5 w-3.5 shrink-0" />}
                </button>
              ))}
            </div>
            <div className="mt-2 flex gap-1.5 px-1">
              <Input
                placeholder="new-branch"
                value={newBranchName}
                onChange={(e) => setNewBranchName(e.target.value)}
                className="h-7 text-xs"
              />
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2"
                title="Create branch from current"
                disabled={!newBranchName.trim() || Boolean(busy)}
                onClick={async () => {
                  const name = newBranchName.trim();
                  await run('branch', () => window.qaflow.repo.createBranch({ projectId, name }), { successMsg: `Created ${name}.` });
                  setNewBranchName('');
                }}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {remoteOnly.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
              <div className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Remote only</div>
              <div className="mt-1.5 flex flex-col">
                {remoteOnly.map((b) => (
                  <button
                    key={b}
                    onClick={() => run('checkout', () => window.qaflow.repo.checkout({ projectId, ref: b }), { successMsg: `Checked out ${b}.` })}
                    className="flex items-center gap-1.5 truncate rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
                    title={`origin/${b} — click to check out`}
                  >
                    <GitMerge className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{b}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </aside>

        {/* main panel */}
        {view === 'working' ? (
          <div className="flex min-h-0 flex-1 gap-4">
            <div className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto">
              <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
                <div className="flex items-center justify-between px-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Staged ({status.staged.length})</span>
                </div>
                <div className="mt-1.5 flex flex-col">
                  {status.staged.length === 0 && <div className="px-2 py-2 text-xs text-muted-foreground">Nothing staged.</div>}
                  {status.staged.map((f) => (
                    <FileRow
                      key={`s-${f.filepath}`}
                      file={f}
                      selected={selectedFile?.filepath === f.filepath && !selectedFile?.oid}
                      onSelect={() => openWorkingFile(f)}
                      actions={
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            run('unstage', () => window.qaflow.repo.unstage({ projectId, filepath: f.filepath }));
                          }}
                          className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-primary"
                          title="Unstage"
                        >
                          Unstage
                        </button>
                      }
                    />
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
                <div className="flex items-center justify-between px-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Unstaged ({status.unstaged.length})</span>
                  {status.unstaged.length > 0 && (
                    <button
                      onClick={() =>
                        run('stageAll', async () => {
                          for (const f of status.unstaged) await window.qaflow.repo.stage({ projectId, filepath: f.filepath });
                        })
                      }
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      Stage all
                    </button>
                  )}
                </div>
                <div className="mt-1.5 flex flex-col">
                  {status.unstaged.length === 0 && <div className="px-2 py-2 text-xs text-muted-foreground">Working copy is clean.</div>}
                  {status.unstaged.map((f) => (
                    <FileRow
                      key={`u-${f.filepath}`}
                      file={f}
                      selected={selectedFile?.filepath === f.filepath && !selectedFile?.oid}
                      onSelect={() => openWorkingFile(f)}
                      actions={
                        <>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              run('stage', () => window.qaflow.repo.stage({ projectId, filepath: f.filepath }));
                            }}
                            className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-primary"
                            title="Stage"
                          >
                            Stage
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setDiscardTarget(f.filepath);
                            }}
                            className="rounded px-1.5 py-0.5 text-xs text-danger hover:bg-danger-bg"
                            title="Discard changes"
                          >
                            <RotateCcw className="h-3 w-3" />
                          </button>
                        </>
                      }
                    />
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
                <textarea
                  value={commitMessage}
                  onChange={(e) => setCommitMessage(e.target.value)}
                  placeholder="Commit message"
                  rows={3}
                  className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
                <Button className="mt-2 w-full" size="sm" onClick={doCommit} disabled={busy === 'commit' || !commitMessage.trim() || !status.staged.length}>
                  <GitCommitHorizontal className="h-4 w-4" /> {busy === 'commit' ? 'Committing…' : `Commit ${status.staged.length} file${status.staged.length === 1 ? '' : 's'}`}
                </Button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-border bg-card shadow-sm">
              <div className="border-b border-border px-4 py-2.5 font-mono text-xs text-muted-foreground">
                {selectedFile ? selectedFile.filepath : 'Diff'}
              </div>
              <DiffView diff={selectedFile ? diff : null} />
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 gap-4">
            <div className="min-h-0 w-[46%] shrink-0 overflow-y-auto rounded-xl border border-border bg-card shadow-sm">
              {history.length === 0 && <div className="p-6 text-sm text-muted-foreground">No commits yet.</div>}
              {graph.rows.map((row, i) => {
                const c = history[i];
                return (
                  <div
                    key={row.oid}
                    onClick={() => openCommit(row.oid)}
                    className={cn(
                      'flex cursor-pointer items-center border-b border-border/60 pr-3 last:border-0',
                      selectedCommit === row.oid ? 'bg-accent' : 'hover:bg-secondary/60'
                    )}
                    style={{ height: ROW_H }}
                  >
                    <GraphCell row={row} maxLanes={graph.maxLanes} />
                    <div className="min-w-0 flex-1 pl-1">
                      <div className={cn('truncate text-sm', selectedCommit === row.oid ? 'font-medium text-primary' : 'text-foreground')}>
                        {c.summary}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {c.author} · {timeAgo(c.timestamp)} · <span className="font-mono">{c.oid.slice(0, 7)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
              {selectedCommitMeta ? (
                <>
                  <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
                    <div className="text-sm font-semibold text-foreground">{selectedCommitMeta.summary}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {selectedCommitMeta.author} &lt;{selectedCommitMeta.email}&gt; · {new Date(selectedCommitMeta.timestamp).toLocaleString()} ·{' '}
                      <span className="font-mono">{selectedCommitMeta.oid.slice(0, 10)}</span>
                    </div>
                    {selectedCommitMeta.message.trim() !== selectedCommitMeta.summary && (
                      <pre className="mt-2 whitespace-pre-wrap font-sans text-xs text-muted-foreground">
                        {selectedCommitMeta.message.split('\n').slice(1).join('\n').trim()}
                      </pre>
                    )}
                    <div className="mt-3 flex flex-col">
                      {commitFileList.map((f) => (
                        <FileRow
                          key={f.filepath}
                          file={f}
                          selected={selectedFile?.filepath === f.filepath && selectedFile?.oid === selectedCommitMeta.oid}
                          onSelect={() => openCommitFile(selectedCommitMeta.oid, f)}
                        />
                      ))}
                      {commitFileList.length === 0 && <div className="py-1 text-xs text-muted-foreground">Loading changed files…</div>}
                    </div>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-border bg-card shadow-sm">
                    <div className="border-b border-border px-4 py-2.5 font-mono text-xs text-muted-foreground">
                      {selectedFile ? selectedFile.filepath : 'Diff'}
                    </div>
                    <DiffView diff={selectedFile ? diff : null} />
                  </div>
                </>
              ) : (
                <div className="flex flex-1 items-center justify-center rounded-xl border border-border bg-card text-sm text-muted-foreground shadow-sm">
                  Select a commit to inspect it.
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(discardTarget)}
        title="Discard changes?"
        description={`"${discardTarget}" will be restored to its last committed state. This can't be undone.`}
        confirmLabel="Discard"
        variant="danger"
        onConfirm={() => run('discard', () => window.qaflow.repo.discard({ projectId, filepath: discardTarget }))}
        onClose={() => setDiscardTarget(null)}
      />
    </div>
  );
}

'use strict';

// Embedded git client engine — wraps isomorphic-git (pure JS, no native
// modules, packages cleanly under electron-builder) with the operations the
// Repository screen needs: clone/fetch/pull/push over HTTPS with a GitHub
// token, working-copy status + stage/unstage/discard/commit, branch
// listing/checkout/create, commit history with parent links (for the lane
// graph), per-commit changed files, and line diffs (jsdiff). Never
// `require('electron')` — token/auth and directories arrive as parameters.
//
// Local clones live under `<baseDir>/repos/<projectId>` (one working copy
// per project per device); nothing here touches the network except the four
// explicitly-remote operations.

const fs = require('node:fs');
const path = require('node:path');
const git = require('isomorphic-git');
const http = require('isomorphic-git/http/node');
const { structuredPatch } = require('diff');

const MAX_DIFF_BYTES = 1024 * 1024; // beyond this a diff view stops being useful

function repoDirFor(baseDir, projectId) {
  return path.join(baseDir, 'repos', projectId);
}

function isCloned(dir) {
  return fs.existsSync(path.join(dir, '.git'));
}

// GitHub over HTTPS accepts a PAT as the password with any username;
// 'x-access-token' is the documented convention. Also works for fine-grained
// tokens and for most other Git hosts that accept token-as-password.
function onAuthFor(token) {
  if (!token) return undefined;
  return () => ({ username: 'x-access-token', password: token });
}

async function clone({ dir, url, token, onProgress = null }) {
  fs.mkdirSync(dir, { recursive: true });
  await git.clone({
    fs,
    http,
    dir,
    url,
    onAuth: onAuthFor(token),
    onProgress: onProgress
      ? (e) => onProgress({ phase: e.phase, loaded: e.loaded, total: e.total })
      : undefined,
  });
}

async function fetch({ dir, token }) {
  await git.fetch({ fs, http, dir, onAuth: onAuthFor(token), prune: true });
}

// Remote and remoteRef are passed explicitly: a local branch created by our
// `checkout` (from origin/<ref>) has no upstream merge config, and
// isomorphic-git's defaults would refuse to guess.
async function pull({ dir, token, author }) {
  const current = await git.currentBranch({ fs, dir, fullname: false });
  if (!current) throw new Error('Not on a branch (detached HEAD)');
  await git.pull({
    fs,
    http,
    dir,
    ref: current,
    remote: 'origin',
    remoteRef: current,
    onAuth: onAuthFor(token),
    author,
    singleBranch: true,
  });
}

async function push({ dir, token }) {
  const current = await git.currentBranch({ fs, dir, fullname: false });
  if (!current) throw new Error('Not on a branch (detached HEAD)');
  const result = await git.push({
    fs,
    http,
    dir,
    ref: current,
    remote: 'origin',
    remoteRef: current,
    onAuth: onAuthFor(token),
  });
  if (result && result.error) throw new Error(result.error);
  return result;
}

// statusMatrix rows are [filepath, head, workdir, stage] with 0/1/2/3 codes —
// translate them into the two Sourcetree panes: staged (index differs from
// HEAD) and unstaged (workdir differs from index). A file can appear in both
// (staged, then edited again).
async function status(dir) {
  const matrix = await git.statusMatrix({ fs, dir });
  const staged = [];
  const unstaged = [];

  for (const [filepath, head, workdir, stage] of matrix) {
    if (head === 1 && workdir === 1 && stage === 1) continue; // unmodified

    if (stage !== head) {
      let state;
      if (head === 0) state = 'added';
      else if (stage === 0) state = 'deleted';
      else state = 'modified';
      staged.push({ filepath, state });
    }

    if (workdir !== stage || stage === 3) {
      let state;
      if (stage === 0 && workdir === 2) state = head === 0 ? 'untracked' : 'deleted-staged-readded';
      else if (workdir === 0) state = 'deleted';
      else if (head === 0 && stage === 0) state = 'untracked';
      else state = 'modified';
      // stage===3 means "staged with unstaged changes on top"
      if (stage === 3 || workdir !== stage) unstaged.push({ filepath, state });
    }
  }

  return { staged, unstaged };
}

async function stage(dir, filepath) {
  const exists = fs.existsSync(path.join(dir, filepath));
  if (exists) {
    await git.add({ fs, dir, filepath });
  } else {
    await git.remove({ fs, dir, filepath });
  }
}

async function unstage(dir, filepath) {
  await git.resetIndex({ fs, dir, filepath });
}

// Restores the file to its HEAD state (Sourcetree's "Discard"). Untracked
// files are simply deleted from the working copy.
async function discard(dir, filepath) {
  const head = await headOidFor(dir, filepath);
  if (head === null) {
    const abs = path.join(dir, filepath);
    if (fs.existsSync(abs)) fs.rmSync(abs);
    return;
  }
  await git.checkout({ fs, dir, filepaths: [filepath], force: true });
}

async function headOidFor(dir, filepath) {
  try {
    const oid = await git.resolveRef({ fs, dir, ref: 'HEAD' });
    await git.readBlob({ fs, dir, oid, filepath });
    return oid;
  } catch {
    return null;
  }
}

async function commit({ dir, message, author }) {
  if (!message || !message.trim()) throw new Error('Commit message is required');
  const oid = await git.commit({ fs, dir, message: message.trim(), author });
  return oid;
}

async function log({ dir, depth = 200, ref = 'HEAD' }) {
  const commits = await git.log({ fs, dir, depth, ref });
  return commits.map((c) => ({
    oid: c.oid,
    parents: c.commit.parent,
    message: c.commit.message,
    summary: c.commit.message.split('\n')[0],
    author: c.commit.author.name,
    email: c.commit.author.email,
    timestamp: c.commit.author.timestamp * 1000,
  }));
}

async function branches(dir) {
  const [local, remote, current] = await Promise.all([
    git.listBranches({ fs, dir }),
    git.listBranches({ fs, dir, remote: 'origin' }).catch(() => []),
    git.currentBranch({ fs, dir, fullname: false }),
  ]);
  return {
    current: current || null,
    local,
    remote: remote.filter((b) => b !== 'HEAD'),
  };
}

// Tip oids for every local and origin branch — the renderer pins these as
// ref badges on matching rows of the commit graph (Sourcetree's branch
// labels). HEAD's tip is implied by `branches().current`.
async function branchTips(dir) {
  const { local, remote } = await branches(dir);
  const tips = [];
  for (const name of local) {
    try {
      const oid = await git.resolveRef({ fs, dir, ref: `refs/heads/${name}` });
      tips.push({ name, oid, kind: 'local' });
    } catch {
      // ref vanished between listing and resolving — skip
    }
  }
  for (const name of remote) {
    try {
      const oid = await git.resolveRef({ fs, dir, ref: `refs/remotes/origin/${name}` });
      tips.push({ name: `origin/${name}`, oid, kind: 'remote' });
    } catch {
      // ditto
    }
  }
  return tips;
}

// How far the current branch has diverged from its origin counterpart —
// drawn as the ↑ / ↓ counters on the Push / Pull buttons. Depth-limited
// set difference (500 commits is far beyond any badge worth reading);
// returns null when there is no upstream to compare against.
async function aheadBehind(dir) {
  const current = await git.currentBranch({ fs, dir, fullname: false });
  if (!current) return null;

  let localLog;
  let remoteLog;
  try {
    [localLog, remoteLog] = await Promise.all([
      git.log({ fs, dir, ref: current, depth: 500 }),
      git.log({ fs, dir, ref: `origin/${current}`, depth: 500 }),
    ]);
  } catch {
    return null;
  }

  const localOids = new Set(localLog.map((c) => c.oid));
  const remoteOids = new Set(remoteLog.map((c) => c.oid));
  return {
    ahead: localLog.filter((c) => !remoteOids.has(c.oid)).length,
    behind: remoteLog.filter((c) => !localOids.has(c.oid)).length,
  };
}

// Lightweight per-project repo summary for project pickers and cards —
// cheap checks only (no statusMatrix), safe to run for every project at
// once.
async function overview(baseDir, projectIds) {
  const result = {};
  for (const id of projectIds) {
    const dir = repoDirFor(baseDir, id);
    if (!isCloned(dir)) {
      result[id] = { cloned: false };
      continue;
    }
    try {
      const current = await git.currentBranch({ fs, dir, fullname: false });
      result[id] = { cloned: true, branch: current || null };
    } catch {
      result[id] = { cloned: true, branch: null };
    }
  }
  return result;
}

// Checking out a branch that only exists on origin creates a local tracking
// branch first — the everyday Sourcetree double-click-a-remote-branch flow.
async function checkout({ dir, ref }) {
  const { local } = await branches(dir);
  if (!local.includes(ref)) {
    await git.branch({ fs, dir, ref, object: `origin/${ref}` });
  }
  await git.checkout({ fs, dir, ref });
}

async function createBranch({ dir, name }) {
  await git.branch({ fs, dir, ref: name, checkout: true });
}

// Files changed by a commit relative to its first parent (or everything for
// a root commit) — walks the two trees comparing blob oids.
async function commitFiles({ dir, oid }) {
  const { commit: meta } = await git.readCommit({ fs, dir, oid });
  const parent = meta.parent[0] || null;

  const trees = parent ? [git.TREE({ ref: parent }), git.TREE({ ref: oid })] : [git.TREE({ ref: oid })];
  const results = [];

  await git.walk({
    fs,
    dir,
    trees,
    map: async (filepath, entries) => {
      if (filepath === '.') return;
      const [before, after] = parent ? entries : [null, entries[0]];
      const beforeType = before && (await before.type());
      const afterType = after && (await after.type());
      if (beforeType === 'tree' || afterType === 'tree') return;

      const beforeOid = before ? await before.oid() : null;
      const afterOid = after ? await after.oid() : null;
      if (beforeOid === afterOid) return;

      let state;
      if (!beforeOid) state = 'added';
      else if (!afterOid) state = 'deleted';
      else state = 'modified';
      results.push({ filepath, state });
    },
  });

  return results.sort((a, b) => a.filepath.localeCompare(b.filepath));
}

function looksBinary(buffer) {
  const scan = buffer.subarray(0, 8000);
  return scan.includes(0);
}

async function readAtRef(dir, filepath, ref) {
  if (ref === 'WORKDIR') {
    const abs = path.join(dir, filepath);
    if (!fs.existsSync(abs)) return null;
    return fs.readFileSync(abs);
  }
  try {
    const oid = await git.resolveRef({ fs, dir, ref });
    const { blob } = await git.readBlob({ fs, dir, oid, filepath });
    return Buffer.from(blob);
  } catch {
    return null; // file doesn't exist at that ref
  }
}

async function readAtCommit(dir, filepath, oid) {
  try {
    const { blob } = await git.readBlob({ fs, dir, oid, filepath });
    return Buffer.from(blob);
  } catch {
    return null;
  }
}

function toDiff(filepath, beforeBuf, afterBuf) {
  if ((beforeBuf && beforeBuf.length > MAX_DIFF_BYTES) || (afterBuf && afterBuf.length > MAX_DIFF_BYTES)) {
    return { filepath, tooLarge: true };
  }
  if ((beforeBuf && looksBinary(beforeBuf)) || (afterBuf && looksBinary(afterBuf))) {
    return { filepath, binary: true };
  }
  const before = beforeBuf ? beforeBuf.toString('utf8') : '';
  const after = afterBuf ? afterBuf.toString('utf8') : '';
  const patch = structuredPatch(filepath, filepath, before, after, '', '', { context: 3 });
  return {
    filepath,
    hunks: patch.hunks.map((h) => ({
      header: `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`,
      lines: h.lines,
    })),
  };
}

// Diff of the working copy (or index) against HEAD for one file — powers the
// Working Copy pane's diff view.
async function workingDiff({ dir, filepath }) {
  const [before, after] = await Promise.all([
    readAtRef(dir, filepath, 'HEAD'),
    readAtRef(dir, filepath, 'WORKDIR'),
  ]);
  return toDiff(filepath, before, after);
}

// Diff of one file inside a commit against that commit's first parent —
// powers the History pane's diff view.
async function commitDiff({ dir, oid, filepath }) {
  const { commit: meta } = await git.readCommit({ fs, dir, oid });
  const parent = meta.parent[0] || null;
  const [before, after] = await Promise.all([
    parent ? readAtCommit(dir, filepath, parent) : Promise.resolve(null),
    readAtCommit(dir, filepath, oid),
  ]);
  return toDiff(filepath, before, after);
}

module.exports = {
  repoDirFor,
  isCloned,
  clone,
  fetch,
  pull,
  push,
  status,
  branchTips,
  aheadBehind,
  overview,
  stage,
  unstage,
  discard,
  commit,
  log,
  branches,
  checkout,
  createBranch,
  commitFiles,
  workingDiff,
  commitDiff,
};

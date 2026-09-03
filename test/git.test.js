'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const isogit = require('isomorphic-git');

const gitEngine = require('../src/engine/git.js');

const AUTHOR = { name: 'Test QA', email: 'qa@test.local' };

const makeRepo = async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaflow-git-'));
  await isogit.init({ fs, dir, defaultBranch: 'main' });
  return dir;
}

const write = (dir, file, content) => {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), content);
}

test('git engine: status/stage/commit/log roundtrip', async () => {
  const dir = await makeRepo();

  write(dir, 'readme.md', 'hello\n');
  let s = await gitEngine.status(dir);
  assert.equal(s.staged.length, 0);
  assert.deepEqual(s.unstaged.map((f) => f.filepath), ['readme.md']);
  assert.equal(s.unstaged[0].state, 'untracked');

  await gitEngine.stage(dir, 'readme.md');
  s = await gitEngine.status(dir);
  assert.deepEqual(s.staged.map((f) => f.filepath), ['readme.md']);
  assert.equal(s.staged[0].state, 'added');
  assert.equal(s.unstaged.length, 0);

  const oid = await gitEngine.commit({ dir, message: 'first commit', author: AUTHOR });
  assert.ok(oid);

  s = await gitEngine.status(dir);
  assert.equal(s.staged.length, 0);
  assert.equal(s.unstaged.length, 0);

  const history = await gitEngine.log({ dir });
  assert.equal(history.length, 1);
  assert.equal(history[0].summary, 'first commit');
  assert.equal(history[0].author, 'Test QA');
  assert.deepEqual(history[0].parents, []);
});

test('git engine: modify, unstage, discard', async () => {
  const dir = await makeRepo();
  write(dir, 'a.txt', 'one\n');
  await gitEngine.stage(dir, 'a.txt');
  await gitEngine.commit({ dir, message: 'add a', author: AUTHOR });

  write(dir, 'a.txt', 'one\ntwo\n');
  let s = await gitEngine.status(dir);
  assert.equal(s.unstaged[0].state, 'modified');

  await gitEngine.stage(dir, 'a.txt');
  s = await gitEngine.status(dir);
  assert.equal(s.staged[0].state, 'modified');
  assert.equal(s.unstaged.length, 0);

  await gitEngine.unstage(dir, 'a.txt');
  s = await gitEngine.status(dir);
  assert.equal(s.staged.length, 0);
  assert.equal(s.unstaged[0].state, 'modified');

  await gitEngine.discard(dir, 'a.txt');
  assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'one\n');
  s = await gitEngine.status(dir);
  assert.equal(s.unstaged.length, 0);

  // discard on an untracked file deletes it
  write(dir, 'junk.txt', 'x');
  await gitEngine.discard(dir, 'junk.txt');
  assert.ok(!fs.existsSync(path.join(dir, 'junk.txt')));
});

test('git engine: staged deletion shows as deleted', async () => {
  const dir = await makeRepo();
  write(dir, 'gone.txt', 'bye\n');
  await gitEngine.stage(dir, 'gone.txt');
  await gitEngine.commit({ dir, message: 'add gone', author: AUTHOR });

  fs.rmSync(path.join(dir, 'gone.txt'));
  let s = await gitEngine.status(dir);
  assert.equal(s.unstaged[0].state, 'deleted');

  await gitEngine.stage(dir, 'gone.txt');
  s = await gitEngine.status(dir);
  assert.equal(s.staged[0].state, 'deleted');
  assert.equal(s.unstaged.length, 0);
});

test('git engine: branches, createBranch, checkout', async () => {
  const dir = await makeRepo();
  write(dir, 'f.txt', '1\n');
  await gitEngine.stage(dir, 'f.txt');
  await gitEngine.commit({ dir, message: 'base', author: AUTHOR });

  let b = await gitEngine.branches(dir);
  assert.equal(b.current, 'main');
  assert.deepEqual(b.local, ['main']);

  await gitEngine.createBranch({ dir, name: 'feature-x' });
  b = await gitEngine.branches(dir);
  assert.equal(b.current, 'feature-x');
  assert.ok(b.local.includes('feature-x'));

  write(dir, 'f.txt', '1\n2\n');
  await gitEngine.stage(dir, 'f.txt');
  await gitEngine.commit({ dir, message: 'on feature', author: AUTHOR });

  await gitEngine.checkout({ dir, ref: 'main' });
  assert.equal(fs.readFileSync(path.join(dir, 'f.txt'), 'utf8'), '1\n');
  b = await gitEngine.branches(dir);
  assert.equal(b.current, 'main');
});

test('git engine: commitFiles and commitDiff against first parent', async () => {
  const dir = await makeRepo();
  write(dir, 'kept.txt', 'same\n');
  write(dir, 'changed.txt', 'old line\n');
  write(dir, 'removed.txt', 'to be removed\n');
  for (const f of ['kept.txt', 'changed.txt', 'removed.txt']) await gitEngine.stage(dir, f);
  await gitEngine.commit({ dir, message: 'base', author: AUTHOR });

  write(dir, 'changed.txt', 'new line\n');
  write(dir, 'added.txt', 'brand new\n');
  fs.rmSync(path.join(dir, 'removed.txt'));
  for (const f of ['changed.txt', 'added.txt', 'removed.txt']) await gitEngine.stage(dir, f);
  const oid = await gitEngine.commit({ dir, message: 'change set', author: AUTHOR });

  const files = await gitEngine.commitFiles({ dir, oid });
  assert.deepEqual(
    files.map((f) => `${f.state}:${f.filepath}`),
    ['added:added.txt', 'modified:changed.txt', 'deleted:removed.txt']
  );

  const diff = await gitEngine.commitDiff({ dir, oid, filepath: 'changed.txt' });
  assert.equal(diff.hunks.length, 1);
  assert.ok(diff.hunks[0].lines.includes('-old line'));
  assert.ok(diff.hunks[0].lines.includes('+new line'));
});

test('git engine: workingDiff shows uncommitted edits and flags binary', async () => {
  const dir = await makeRepo();
  write(dir, 'doc.txt', 'alpha\n');
  await gitEngine.stage(dir, 'doc.txt');
  await gitEngine.commit({ dir, message: 'base', author: AUTHOR });

  write(dir, 'doc.txt', 'alpha\nbeta\n');
  const diff = await gitEngine.workingDiff({ dir, filepath: 'doc.txt' });
  assert.ok(diff.hunks[0].lines.includes('+beta'));

  fs.writeFileSync(path.join(dir, 'blob.bin'), Buffer.from([0, 1, 2, 3, 0, 255]));
  const bin = await gitEngine.workingDiff({ dir, filepath: 'blob.bin' });
  assert.equal(bin.binary, true);
});

test('git engine: branchTips maps names to tip oids', async () => {
  const dir = await makeRepo();
  write(dir, 'f.txt', '1\n');
  await gitEngine.stage(dir, 'f.txt');
  await gitEngine.commit({ dir, message: 'base', author: AUTHOR });
  await gitEngine.createBranch({ dir, name: 'topic' });
  write(dir, 'f.txt', '1\n2\n');
  await gitEngine.stage(dir, 'f.txt');
  const topicOid = await gitEngine.commit({ dir, message: 'topic work', author: AUTHOR });

  const tips = await gitEngine.branchTips(dir);
  const byName = Object.fromEntries(tips.map((t) => [t.name, t]));
  assert.equal(byName['topic'].oid, topicOid);
  assert.equal(byName['topic'].kind, 'local');
  assert.ok(byName['main']);
  assert.notEqual(byName['main'].oid, topicOid);
});

test('git engine: aheadBehind counts divergence from origin', async () => {
  const dir = await makeRepo();
  write(dir, 'f.txt', '1\n');
  await gitEngine.stage(dir, 'f.txt');
  const baseOid = await gitEngine.commit({ dir, message: 'base', author: AUTHOR });

  // Fake an origin tracking ref pinned at the base commit, then move main
  // one commit past it — ahead 1, behind 0.
  await isogit.writeRef({ fs, dir, ref: 'refs/remotes/origin/main', value: baseOid, force: true });
  write(dir, 'f.txt', '1\n2\n');
  await gitEngine.stage(dir, 'f.txt');
  await gitEngine.commit({ dir, message: 'local only', author: AUTHOR });

  const ab = await gitEngine.aheadBehind(dir);
  assert.deepEqual(ab, { ahead: 1, behind: 0 });
});

test('git engine: aheadBehind is null with no origin counterpart', async () => {
  const dir = await makeRepo();
  write(dir, 'f.txt', '1\n');
  await gitEngine.stage(dir, 'f.txt');
  await gitEngine.commit({ dir, message: 'base', author: AUTHOR });
  assert.equal(await gitEngine.aheadBehind(dir), null);
});

test('git engine: overview reports cloned state and branch per project', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'qaflow-gitov-'));
  const dir = gitEngine.repoDirFor(base, 'p1');
  fs.mkdirSync(dir, { recursive: true });
  await isogit.init({ fs, dir, defaultBranch: 'main' });
  fs.writeFileSync(path.join(dir, 'a.txt'), 'x\n');
  await gitEngine.stage(dir, 'a.txt');
  await gitEngine.commit({ dir, message: 'base', author: AUTHOR });

  const ov = await gitEngine.overview(base, ['p1', 'p2']);
  assert.deepEqual(ov.p1, { cloned: true, branch: 'main' });
  assert.deepEqual(ov.p2, { cloned: false });
});

test('git engine: repoDirFor and isCloned', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'qaflow-gitbase-'));
  const dir = gitEngine.repoDirFor(base, 'proj-1');
  assert.equal(dir, path.join(base, 'repos', 'proj-1'));
  assert.equal(gitEngine.isCloned(dir), false);

  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  assert.equal(gitEngine.isCloned(dir), true);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EditProposalManager } from '../src/desktop/edit-proposals.ts';

async function createProject(t: test.TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'vyomara-edit-proposals-'));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  return realpath(directory);
}

test('proposing an edit returns a full diff without changing the file; explicit approval applies it', async t => {
  const project = await createProject(t);
  await mkdir(join(project, 'src'));
  await writeFile(join(project, 'src', 'greeting.ts'), 'export const greeting = "hello";\n');
  const proposals = new EditProposalManager(project);

  const staged = await proposals.propose(
    'src/greeting.ts',
    'export const greeting = "namaste";\n',
    new AbortController().signal,
  );
  assert.equal(staged.status, 'awaiting-approval');
  assert.equal(staged.path, 'src/greeting.ts');
  assert.equal(await readFile(join(project, 'src', 'greeting.ts'), 'utf8'), 'export const greeting = "hello";\n');

  const [proposal] = proposals.list();
  assert.ok(proposal);
  assert.match(proposal.diff, /^--- a\/src\/greeting\.ts\n\+\+\+ b\/src\/greeting\.ts/m);
  assert.match(proposal.diff, /-export const greeting = "hello";/);
  assert.match(proposal.diff, /\+export const greeting = "namaste";/);

  assert.deepEqual(await proposals.apply(staged.proposalId), {
    path: 'src/greeting.ts',
    status: 'applied',
  });
  assert.equal(await readFile(join(project, 'src', 'greeting.ts'), 'utf8'), 'export const greeting = "namaste";\n');
  assert.deepEqual(proposals.list(), []);
});

test('rejecting a proposal leaves the original project file untouched', async t => {
  const project = await createProject(t);
  await writeFile(join(project, 'README.txt'), 'original\n');
  const proposals = new EditProposalManager(project);
  const staged = await proposals.propose('README.txt', 'suggested\n', new AbortController().signal);

  assert.equal(proposals.reject(staged.proposalId), true);
  assert.equal(await readFile(join(project, 'README.txt'), 'utf8'), 'original\n');
  assert.equal(proposals.reject(staged.proposalId), false);
});

test('applying a stale proposal fails without overwriting newer user changes', async t => {
  const project = await createProject(t);
  await writeFile(join(project, 'file.ts'), 'before\n');
  const proposals = new EditProposalManager(project);
  const staged = await proposals.propose('file.ts', 'proposed\n', new AbortController().signal);
  await writeFile(join(project, 'file.ts'), 'user update\n');

  await assert.rejects(proposals.apply(staged.proposalId), /file changed after this diff was created/i);
  assert.equal(await readFile(join(project, 'file.ts'), 'utf8'), 'user update\n');
  assert.equal(proposals.list().length, 1);
});

test('edit proposals reject traversal, symlinks, sensitive files, binaries, and oversized text', async t => {
  const project = await createProject(t);
  const outside = join(project, 'outside.txt');
  await writeFile(outside, 'outside\n');
  await writeFile(join(project, '.env'), 'TOKEN=private\n');
  await writeFile(join(project, '.npmrc'), '//registry.example/:_authToken=private\n');
  await writeFile(join(project, 'binary.dat'), Buffer.from([0, 1, 2]));
  await symlink(outside, join(project, 'linked.txt'));
  const proposals = new EditProposalManager(project);
  const signal = new AbortController().signal;

  await assert.rejects(proposals.propose('../outside.txt', 'changed\n', signal), /relative path/i);
  await assert.rejects(proposals.propose('linked.txt', 'changed\n', signal), /symbolic links/i);
  await assert.rejects(proposals.propose('.env', 'TOKEN=changed\n', signal), /sensitive/i);
  await assert.rejects(proposals.propose('.npmrc', '//registry.example/:_authToken=changed\n', signal), /sensitive/i);
  await assert.rejects(proposals.propose('binary.dat', 'text\n', signal), /Binary files/i);
  await assert.rejects(proposals.propose('missing.txt', 'new\n', signal), /ENOENT|not found/i);
  await assert.rejects(
    proposals.propose('binary.dat', 'x'.repeat(16_385), signal),
    /no larger than 16384/i,
  );
});

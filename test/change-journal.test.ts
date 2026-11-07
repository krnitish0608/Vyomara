import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config/config.ts';
import { ChangeJournal, sha256 } from '../src/desktop/change-journal.ts';
import { FileOperationApprovalManager } from '../src/desktop/file-operation-approval.ts';

async function fixture(t: TestContext) {
  const parent = await mkdtemp(join(tmpdir(), 'vyomara-undo-'));
  await mkdir(join(parent, 'project'));
  // Recorded paths are real paths (/private/var/… on macOS).
  const root = await realpath(join(parent, 'project'));
  t.after(async () => rm(parent, { recursive: true, force: true }));
  const trashed: string[] = [];
  const moveToTrash = async (path: string): Promise<void> => {
    trashed.push(path);
    await rm(path, { recursive: true, force: true });
  };
  const journal = new ChangeJournal({ moveToTrash });
  const config = loadConfig({
    VYOM_PROVIDER: 'placeholder',
    VYOM_ALLOWED_ROOTS: JSON.stringify([root]),
    VYOM_TOOL_TIMEOUT_MS: '10000',
  });
  let requestId = 'request-1';
  const approvals = new FileOperationApprovalManager({
    config,
    onProposal: proposal => queueMicrotask(() => { void approvals.approve(proposal.id); }),
    moveToTrash,
    onApplied: entry => journal.record(requestId, entry),
  });
  const signal = new AbortController().signal;
  return {
    root,
    journal,
    approvals,
    trashed,
    signal,
    startRequest(id: string) {
      requestId = id;
      journal.begin(id);
    },
  };
}

test('undo restores edited files and trashes created ones from the last request only', async t => {
  const { root, journal, approvals, trashed, signal, startRequest } = await fixture(t);
  const cart = join(root, 'cart.js');
  await writeFile(cart, 'const total = 1;\n', { mode: 0o640 });

  startRequest('first');
  await approvals.request({ operation: 'edit-file', path: cart, content: 'const total = 2;\n' }, signal);

  startRequest('second');
  await approvals.request({ operation: 'edit-file', path: cart, content: 'const total = 3;\n' }, signal);
  const helper = join(root, 'helper.js');
  await approvals.request({ operation: 'create-file', path: helper, content: 'export {};\n' }, signal);

  const result = await journal.undoLast();
  assert.deepEqual([...result.restored].sort(), [cart, helper].sort());
  assert.deepEqual(result.skipped, []);
  assert.equal(await readFile(cart, 'utf8'), 'const total = 2;\n');
  assert.equal((await stat(cart)).mode & 0o777, 0o640);
  assert.deepEqual(trashed, [helper]);
  assert.deepEqual(result.movedToTrash, [helper]);

  // The next undo goes one request further back.
  const earlier = await journal.undoLast();
  assert.deepEqual(earlier.restored, [cart]);
  assert.equal(await readFile(cart, 'utf8'), 'const total = 1;\n');
  assert.equal(journal.last(), undefined);
});

test('undo leaves a file alone if it was changed after Vyomara edited it', async t => {
  const { root, journal, approvals, signal, startRequest } = await fixture(t);
  const file = join(root, 'notes.md');
  await writeFile(file, 'one\n');
  startRequest('edit');
  await approvals.request({ operation: 'edit-file', path: file, content: 'two\n' }, signal);
  await writeFile(file, 'two, then my own edit\n');

  const result = await journal.undoLast();
  assert.deepEqual(result.restored, []);
  assert.equal(result.skipped[0]?.path, file);
  assert.match(result.skipped[0]?.reason ?? '', /changed again/);
  assert.equal(await readFile(file, 'utf8'), 'two, then my own edit\n');
});

test('undo removes a created folder once its new files are gone', async t => {
  const { root, journal, approvals, signal, startRequest } = await fixture(t);
  startRequest('folder');
  const folder = join(root, 'src');
  await approvals.request({ operation: 'create-directory', path: folder }, signal);
  await approvals.request({ operation: 'create-file', path: join(folder, 'a.ts'), content: 'a\n' }, signal);

  const result = await journal.undoLast();
  assert.deepEqual(result.restored, [join(folder, 'a.ts'), folder]);
  await assert.rejects(stat(folder));
});

test('items moved to Trash are reported, not restored', async () => {
  const journal = new ChangeJournal({ moveToTrash: async () => undefined });
  journal.begin('delete');
  journal.record('delete', { kind: 'trashed', path: '/tmp/old.txt' });
  const result = await journal.undoLast();
  assert.deepEqual(result.restored, []);
  assert.match(result.skipped[0]?.reason ?? '', /Trash/);
});

test('undo restores the exact original bytes, including a byte-order mark', async t => {
  const { root, journal, approvals, signal, startRequest } = await fixture(t);
  const file = join(root, 'bom.txt');
  const original = Buffer.from('\uFEFFhello\r\n', 'utf8');
  await writeFile(file, original);
  startRequest('bom');
  await approvals.request({ operation: 'edit-file', path: file, content: 'changed\n' }, signal);
  await journal.undoLast();
  assert.equal(sha256(await readFile(file)), sha256(original));
});

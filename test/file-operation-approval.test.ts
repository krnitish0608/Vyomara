import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config/config.ts';
import { runAgent } from '../src/agent/agent.ts';
import { createLogger } from '../src/diagnostics/logger.ts';
import type { DesktopFileOperationProposal } from '../src/desktop/contracts.ts';
import { FileOperationApprovalManager } from '../src/desktop/file-operation-approval.ts';
import { Session } from '../src/session/session.ts';
import { ToolRegistry } from '../src/tools/contracts.ts';
import { ToolExecutionError, ToolExecutor } from '../src/tools/executor.ts';
import { PolicyGateway } from '../src/tools/policy.ts';
import { registerFilesystemTools } from '../src/tools/filesystem-tools.ts';
import type { ModelProvider } from '../src/providers/provider.ts';

async function fixture(t: TestContext) {
  const parent = await mkdtemp(join(tmpdir(), 'vyomara-review-'));
  const root = join(parent, 'allowed');
  await mkdir(root);
  t.after(async () => rm(parent, { recursive: true, force: true }));
  const config = loadConfig({
    VYOM_PROVIDER: 'placeholder',
    VYOM_ALLOWED_ROOTS: JSON.stringify([root]),
    VYOM_TOOL_TIMEOUT_MS: '10000',
  });
  let resolveProposal!: (proposal: DesktopFileOperationProposal) => void;
  const proposal = new Promise<DesktopFileOperationProposal>(resolve => { resolveProposal = resolve; });
  const trashedPaths: string[] = [];
  const approvals = new FileOperationApprovalManager({
    config,
    onProposal: resolveProposal,
    async moveToTrash(path) {
      trashedPaths.push(path);
    },
  });
  const registry = new ToolRegistry();
  registerFilesystemTools(registry, config, {}, approvals);
  const executor = new ToolExecutor({
    registry,
    policy: new PolicyGateway(),
    config,
    logger: createLogger(() => {}),
  });
  return { root, config, proposal, approvals, executor, trashedPaths };
}

function execute(executor: ToolExecutor, id: string, input: unknown, signal = new AbortController().signal) {
  return executor.execute(id, input, signal);
}

test('create-file waits for review and writes only after explicit approval', async t => {
  const { root, proposal, approvals, executor } = await fixture(t);
  const path = join(root, 'new.txt');
  const resultPromise = execute(executor, 'filesystem.propose-create-file', {
    path,
    content: 'new reviewed content\n',
  });
  const review = await proposal;
  assert.equal(review.operation, 'create-file');
  assert.equal(review.proposedContent, 'new reviewed content\n');
  await assert.rejects(readFile(path), { code: 'ENOENT' });

  await approvals.approve(review.id);
  assert.deepEqual(await resultPromise, { status: 'applied', operation: 'create-file', path });
  assert.equal(await readFile(path, 'utf8'), 'new reviewed content\n');
});

test('agent reports a file change only after the user approves and it applies', async t => {
  const { root, config, proposal, approvals, executor } = await fixture(t);
  const path = join(root, 'agent-created.txt');
  const responses: unknown[] = [
    {
      kind: 'tool-calls',
      calls: [{
        toolId: 'filesystem.propose-create-file',
        arguments: { path, content: 'approved\n' },
      }],
    },
    { kind: 'final', text: 'I created the file.' },
  ];
  const provider: ModelProvider = {
    id: 'test',
    async complete() {
      const response = responses.shift();
      if (response === undefined) throw new Error('No fake provider response remains.');
      return response;
    },
  };
  const resultPromise = runAgent('Create this file.', new AbortController().signal, {
    provider,
    tools: executor,
    config,
    session: new Session(),
    logger: createLogger(() => {}),
  });
  const review = await proposal;
  await approvals.approve(review.id);

  assert.equal(await resultPromise, 'I created the file.');
  assert.equal(await readFile(path, 'utf8'), 'approved\n');
});

test('agent rejects a false success claim after the user rejects the operation', async t => {
  const { root, config, proposal, approvals, executor } = await fixture(t);
  const path = join(root, 'rejected.txt');
  const responses: unknown[] = [
    {
      kind: 'tool-calls',
      calls: [{
        toolId: 'filesystem.propose-create-file',
        arguments: { path, content: 'not written\n' },
      }],
    },
    { kind: 'final', text: 'I created the file.' },
  ];
  const provider: ModelProvider = {
    id: 'test',
    async complete() {
      const response = responses.shift();
      if (response === undefined) throw new Error('No fake provider response remains.');
      return response;
    },
  };
  const resultPromise = runAgent('Create this file.', new AbortController().signal, {
    provider,
    tools: executor,
    config,
    session: new Session(),
    logger: createLogger(() => {}),
  });
  const review = await proposal;
  approvals.reject(review.id);

  assert.equal(
    await resultPromise,
    'I cannot claim a file change because no matching user-approved operation completed successfully.',
  );
  await assert.rejects(readFile(path), { code: 'ENOENT' });
});

test('rejecting an edit leaves the original file unchanged', async t => {
  const { root, proposal, approvals, executor } = await fixture(t);
  const path = join(root, 'existing.txt');
  await writeFile(path, 'before\n');
  const resultPromise = execute(executor, 'filesystem.propose-edit', {
    path,
    content: 'after\n',
  });
  const review = await proposal;
  assert.equal(review.currentContent, 'before\n');
  assert.equal(review.proposedContent, 'after\n');

  approvals.reject(review.id);
  assert.deepEqual(await resultPromise, { status: 'rejected', operation: 'edit-file', path });
  assert.equal(await readFile(path, 'utf8'), 'before\n');
});

test('edits fail closed if the reviewed file changes before approval', async t => {
  const { root, proposal, approvals, executor } = await fixture(t);
  const path = join(root, 'existing.txt');
  await writeFile(path, 'before\n');
  const resultPromise = execute(executor, 'filesystem.propose-edit', {
    path,
    content: 'proposed\n',
  });
  const review = await proposal;
  await writeFile(path, 'concurrent update\n');

  await assert.rejects(approvals.approve(review.id), /changed after review/);
  await assert.rejects(resultPromise, /changed after review/);
  assert.equal(await readFile(path, 'utf8'), 'concurrent update\n');
});

test('each deletion waits for approval and uses the reversible Trash operation', async t => {
  const { root, proposal, approvals, executor, trashedPaths } = await fixture(t);
  const path = join(root, 'remove.txt');
  await writeFile(path, 'content');
  const resultPromise = execute(executor, 'filesystem.propose-delete', { path });
  const review = await proposal;
  assert.equal(review.operation, 'delete');
  assert.equal(review.targetType, 'file');
  assert.deepEqual(trashedPaths, []);

  await assert.rejects(approvals.approve(review.id), /Type DELETE/);
  assert.deepEqual(trashedPaths, []);
  await approvals.approve(review.id, 'DELETE');
  assert.deepEqual(await resultPromise, { status: 'applied', operation: 'delete', path });
  assert.deepEqual(trashedPaths, [await realpath(path)]);
});

test('directory creation is a separate approved operation', async t => {
  const { root, proposal, approvals, executor } = await fixture(t);
  const path = join(root, 'new-folder');
  const resultPromise = execute(executor, 'filesystem.propose-create-directory', { path });
  const review = await proposal;
  assert.equal(review.operation, 'create-directory');
  assert.equal(review.targetType, 'directory');
  await assert.rejects(readFile(path), { code: 'ENOENT' });

  await approvals.approve(review.id);
  assert.deepEqual(await resultPromise, { status: 'applied', operation: 'create-directory', path });
});

test('cancelling a pending review prevents later approval', async t => {
  const { root, proposal, approvals, executor } = await fixture(t);
  const path = join(root, 'cancelled.txt');
  const controller = new AbortController();
  const resultPromise = execute(executor, 'filesystem.propose-create-file', {
    path,
    content: 'never written',
  }, controller.signal);
  const review = await proposal;
  controller.abort();

  await assert.rejects(
    resultPromise,
    (error: unknown) => error instanceof ToolExecutionError && error.code === 'cancelled',
  );
  await assert.rejects(approvals.approve(review.id), /no longer active/);
  await assert.rejects(readFile(path), { code: 'ENOENT' });
});

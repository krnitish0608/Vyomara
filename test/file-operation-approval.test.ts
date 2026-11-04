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
  let proposalCount = 0;
  const trashedPaths: string[] = [];
  const approvals = new FileOperationApprovalManager({
    config,
    onProposal(value) {
      proposalCount++;
      resolveProposal(value);
    },
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
  return { root, config, proposal, proposalCount: () => proposalCount, approvals, executor, trashedPaths };
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

  assert.equal(await resultPromise, 'The approved file creation was applied.');
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
    'The proposed file creation was rejected. No changes were made.',
  );
  await assert.rejects(readFile(path), { code: 'ENOENT' });
});

test('agent must read an existing file before proposing an edit', async t => {
  const { root, config, proposal, approvals, executor } = await fixture(t);
  const path = join(root, 'existing.txt');
  const original = 'const greeting = "Hello";\nexport const label = "Welcome";\n';
  const updated = 'const greeting = "Hi";\nexport const label = "Welcome";\n';
  let repairInstructionSeen = false;
  await writeFile(path, original);
  const responses: unknown[] = [
    {
      kind: 'tool-calls',
      calls: [{
        toolId: 'filesystem.propose-edit',
        arguments: { path, content: 'Hi' },
      }],
    },
    { kind: 'final', text: 'I prepared an edit; please provide the complete file.' },
    {
      kind: 'tool-calls',
      calls: [{
        toolId: 'filesystem.propose-replace-text',
        arguments: {
          path,
          oldText: 'const greeting = "Hello";',
          newText: 'const greeting = "Hi";',
        },
      }],
    },
    { kind: 'final', text: 'I updated the greeting.' },
  ];
  const provider: ModelProvider = {
    id: 'test.read-before-edit',
    async complete(messages) {
      repairInstructionSeen ||= messages.some(message =>
        message.role === 'user' && message.content.startsWith('Correction:'));
      const response = responses.shift();
      if (response === undefined) throw new Error('No fake provider response remains.');
      return response;
    },
  };
  const session = new Session();
  const resultPromise = runAgent('Change the greeting in the existing file.', new AbortController().signal, {
    provider,
    tools: executor,
    config,
    session,
    logger: createLogger(() => {}),
  });
  const review = await proposal;
  assert.equal(review.currentContent, original);
  assert.equal(review.proposedContent, updated);
  assert.equal(repairInstructionSeen, true);
  const rejectedEdit = session.messages().find(message =>
    message.role === 'tool' &&
    message.toolId === 'filesystem.propose-edit' &&
    message.content.includes('Edit proposal not created'));
  assert.ok(rejectedEdit);
  approvals.reject(review.id);

  assert.equal(await resultPromise, 'The proposed edit was rejected. No changes were made.');
  assert.equal(await readFile(path, 'utf8'), original);
});

test('agent converts an explicit exact-text edit into a reviewed replacement', async t => {
  const { root, config, proposal, approvals, executor } = await fixture(t);
  const path = join(root, 'existing.txt');
  const original = 'const greeting = "Hello";\n';
  const updated = 'const greeting = "Hi";\n';
  await writeFile(path, original);
  const responses: unknown[] = [
    {
      kind: 'tool-calls',
      calls: [{
        toolId: 'filesystem.propose-edit',
        arguments: { path, content: 'Hi' },
      }],
    },
    { kind: 'final', text: 'I prepared the edit.' },
  ];
  const provider: ModelProvider = {
    id: 'test.localized-replacement',
    async complete() {
      const response = responses.shift();
      if (response === undefined) throw new Error('No fake provider response remains.');
      return response;
    },
  };
  const session = new Session();
  const resultPromise = runAgent(
    `In the file ${path}, replace the exact text "Hello" with "Hi".`,
    new AbortController().signal,
    {
      provider,
      tools: executor,
      config,
      session,
      logger: createLogger(() => {}),
    },
  );
  const review = await proposal;
  assert.equal(review.currentContent, original);
  assert.equal(review.proposedContent, updated);
  assert.ok(session.messages().some(message =>
    message.role === 'tool' && message.toolId === 'filesystem.read-file'));
  assert.equal(await readFile(path, 'utf8'), original);
  approvals.reject(review.id);

  assert.equal(await resultPromise, 'The proposed edit was rejected. No changes were made.');
  assert.equal(await readFile(path, 'utf8'), original);
});

test('agent turns a complete model edit into a review proposal rather than displaying it as applied', async t => {
  const { root, config, proposal, approvals, executor } = await fixture(t);
  const path = join(root, 'existing.ts');
  const original = 'export const greeting = "Hello";\n';
  const updated = 'export const greeting = "Hi";\n';
  await writeFile(path, original);
  const responses: unknown[] = [
    {
      kind: 'tool-calls',
      calls: [{ toolId: 'filesystem.read-file', arguments: { path } }],
    },
    { kind: 'final', text: `Here is the complete updated file:\n\`\`\`ts\n${updated}\`\`\`` },
  ];
  const provider: ModelProvider = {
    id: 'test.complete-edit-fallback',
    async complete() {
      const response = responses.shift();
      if (response === undefined) throw new Error('No fake provider response remains.');
      return response;
    },
  };
  const resultPromise = runAgent(
    'Edit the existing file to change the greeting from Hello to Hi.',
    new AbortController().signal,
    {
      provider,
      tools: executor,
      config,
      session: new Session(),
      logger: createLogger(() => {}),
    },
  );
  const review = await proposal;
  assert.equal(review.currentContent, original);
  assert.equal(review.proposedContent, updated);
  assert.equal(await readFile(path, 'utf8'), original);
  approvals.reject(review.id);

  assert.equal(await resultPromise, 'The proposed edit was rejected. No changes were made.');
  assert.equal(await readFile(path, 'utf8'), original);
});

test('agent can analyze a project and tests, then submit and apply the requested code fix', async t => {
  const { root, config, proposal, approvals, executor } = await fixture(t);
  const project = join(root, 'sample-project');
  const sourcePath = join(project, 'src', 'index.ts');
  const testPath = join(project, 'test', 'index.test.ts');
  const original = 'export function add(a: number, b: number): number { return a - b; }\n';
  const updated = 'export function add(a: number, b: number): number { return a + b; }\n';
  await mkdir(join(project, 'src'), { recursive: true });
  await mkdir(join(project, 'test'));
  await writeFile(sourcePath, original);
  await writeFile(testPath, 'assert.equal(add(2, 3), 5);\n');
  const responses: unknown[] = [
    { kind: 'tool-calls', calls: [{
      toolId: 'filesystem.directory-tree',
      arguments: { path: project },
    }] },
    { kind: 'tool-calls', calls: [{
      toolId: 'filesystem.read-file',
      arguments: { path: sourcePath },
    }] },
    { kind: 'tool-calls', calls: [{
      toolId: 'filesystem.read-file',
      arguments: { path: testPath },
    }] },
    { kind: 'tool-calls', calls: [{
      toolId: 'filesystem.propose-edit',
      arguments: { path: sourcePath, content: updated },
    }] },
    { kind: 'final', text: 'The fix is ready for your review.' },
  ];
  const advertisedToolIds: string[][] = [];
  const provider: ModelProvider = {
    id: 'test.project-code-fix',
    async complete(_messages, _signal, tools) {
      advertisedToolIds.push((tools ?? []).map(tool => tool.id));
      const response = responses.shift();
      if (response === undefined) throw new Error('No fake provider response remains.');
      return response;
    },
  };
  const session = new Session();
  const resultPromise = runAgent(
    `Deep dive into this repo, analyze the source and tests, then fix the bug in src/index.ts so add returns the sum. Project: ${project}`,
    new AbortController().signal,
    {
      provider,
      tools: executor,
      config,
      session,
      logger: createLogger(() => {}),
    },
  );
  const review = await proposal;

  assert.equal(review.path, sourcePath);
  assert.equal(review.currentContent, original);
  assert.equal(review.proposedContent, updated);
  assert.deepEqual(advertisedToolIds[0], ['filesystem.directory-tree']);
  assert.deepEqual(advertisedToolIds[1], ['filesystem.read-file']);
  assert.deepEqual(advertisedToolIds[2], ['filesystem.read-file']);
  assert.ok(advertisedToolIds[3]?.includes('filesystem.propose-edit'));
  assert.equal(await readFile(sourcePath, 'utf8'), original);

  await approvals.approve(review.id);

  assert.equal(await resultPromise, 'The approved edit was applied.');
  assert.equal(await readFile(sourcePath, 'utf8'), updated);
  assert.deepEqual(
    session.messages().filter(message => message.role === 'tool').map(message =>
      message.role === 'tool' ? message.toolId : undefined),
    [
      'filesystem.directory-tree',
      'filesystem.read-file',
      'filesystem.read-file',
      'filesystem.propose-edit',
    ],
  );
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

test('localized text replacements show the full file diff and apply only after approval', async t => {
  const { root, proposal, approvals, executor } = await fixture(t);
  const path = join(root, 'existing.txt');
  const original = 'const greeting = "Hello";\nexport const label = "Welcome";\n';
  const updated = 'const greeting = "Hi";\nexport const label = "Welcome";\n';
  await writeFile(path, original);
  const resultPromise = execute(executor, 'filesystem.propose-replace-text', {
    path,
    oldText: '"Hello"',
    newText: '"Hi"',
  });
  const review = await proposal;

  assert.equal(review.currentContent, original);
  assert.equal(review.proposedContent, updated);
  assert.equal(await readFile(path, 'utf8'), original);
  await approvals.approve(review.id);
  assert.deepEqual(await resultPromise, { status: 'applied', operation: 'edit-file', path });
  assert.equal(await readFile(path, 'utf8'), updated);
});

test('localized text replacements fail when their exact source is missing or ambiguous', async t => {
  const { root, proposalCount, executor } = await fixture(t);
  const path = join(root, 'existing.txt');
  await writeFile(path, 'same same\n');

  await assert.rejects(
    execute(executor, 'filesystem.propose-replace-text', {
      path,
      oldText: 'missing',
      newText: 'replacement',
    }),
    /must match the file exactly once/u,
  );
  await assert.rejects(
    execute(executor, 'filesystem.propose-replace-text', {
      path,
      oldText: 'same',
      newText: 'replacement',
    }),
    /must match the file exactly once/u,
  );
  assert.equal(await readFile(path, 'utf8'), 'same same\n');
  assert.equal(proposalCount(), 0);
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

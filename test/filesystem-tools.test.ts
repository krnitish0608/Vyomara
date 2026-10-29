import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtemp, mkdir, open, opendir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config/config.ts';
import { createLogger } from '../src/diagnostics/logger.ts';
import { ToolRegistry } from '../src/tools/contracts.ts';
import { ToolExecutionError, ToolExecutor } from '../src/tools/executor.ts';
import { registerFilesystemTools } from '../src/tools/filesystem-tools.ts';
import type { FilesystemToolOperations } from '../src/tools/filesystem-tools.ts';
import { PolicyGateway } from '../src/tools/policy.ts';

async function fixture(
  t: TestContext,
  env: Record<string, string> = {},
  operations: FilesystemToolOperations = {},
) {
  const parent = await mkdtemp(join(tmpdir(), 'vyomara-fs-'));
  const root = join(parent, 'allowed');
  t.after(async () => rm(parent, { recursive: true, force: true }));
  await mkdir(root);
  const config = loadConfig({
    VYOM_PROVIDER: 'placeholder',
    VYOM_ALLOWED_ROOTS: JSON.stringify([root]),
    ...env,
  });
  const registry = new ToolRegistry();
  registerFilesystemTools(registry, config, operations);
  const logLines: string[] = [];
  const executor = new ToolExecutor({
    registry,
    policy: new PolicyGateway(),
    config,
    logger: createLogger(line => logLines.push(line)),
  });
  return { parent, root, config, registry, executor, logLines };
}

function orderedDirectoryOpener(order: 'ascending' | 'descending'): NonNullable<FilesystemToolOperations['openDirectory']> {
  return async path => {
    const entries = await readdir(path, { withFileTypes: true });
    entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    if (order === 'descending') entries.reverse();
    let index = 0;
    return {
      async read(): Promise<Dirent | null> {
        return entries[index++] ?? null;
      },
      async close(): Promise<void> {},
    };
  };
}

function execute(
  executor: ToolExecutor,
  id: string,
  input: unknown,
): Promise<unknown> {
  return executor.execute(id, input, new AbortController().signal);
}

test('filesystem listing returns bounded structured entries for an allowed directory', async t => {
  const { root, executor } = await fixture(t);
  await writeFile(join(root, 'zeta.txt'), 'zeta');
  await mkdir(join(root, 'Alpha'));
  await writeFile(join(root, 'alpha.txt'), 'alpha');

  assert.deepEqual(await execute(executor, 'filesystem.list-directory', { path: root }), {
    entries: [
      { name: 'Alpha', type: 'directory' },
      { name: 'alpha.txt', type: 'file' },
      { name: 'zeta.txt', type: 'file' },
    ],
    truncated: false,
  });
});

test('filesystem listing subset is independent of directory enumeration order', async t => {
  const outputs = [];
  for (const order of ['ascending', 'descending'] as const) {
    const { root, executor } = await fixture(
      t,
      { VYOM_MAX_DIRECTORY_ENTRIES: '2' },
      { openDirectory: orderedDirectoryOpener(order) },
    );
    await writeFile(join(root, 'z.txt'), 'z');
    await writeFile(join(root, 'a.txt'), 'a');
    await writeFile(join(root, 'm.txt'), 'm');
    outputs.push(await execute(executor, 'filesystem.list-directory', { path: root }));
  }
  assert.deepEqual(outputs[0], outputs[1]);
  assert.deepEqual(outputs[0], {
    entries: [{ name: 'a.txt', type: 'file' }, { name: 'm.txt', type: 'file' }],
    truncated: true,
  });
});

test('filesystem read returns permitted UTF-8 text without exposing the path in results', async t => {
  const { root, executor } = await fixture(t);
  const file = join(root, 'example.ts');
  await writeFile(file, 'export const greeting = "hello";\n');

  assert.deepEqual(await execute(executor, 'filesystem.read-file', { path: file }), {
    content: 'export const greeting = "hello";\n',
    bytes: Buffer.byteLength('export const greeting = "hello";\n'),
  });
});

test('filesystem access rejects paths outside configured roots', async t => {
  const { parent, root, executor } = await fixture(t);
  const outside = join(parent, 'private.txt');
  const prefixSibling = join(parent, 'allowed-evil');
  await mkdir(prefixSibling);
  const siblingFile = join(prefixSibling, 'private.txt');
  await writeFile(outside, 'private');
  await writeFile(siblingFile, 'private sibling');

  await assert.rejects(
    execute(executor, 'filesystem.read-file', { path: outside }),
    /outside the configured allowed roots/,
  );
  await assert.rejects(
    execute(executor, 'filesystem.read-file', { path: siblingFile }),
    /outside the configured allowed roots/,
  );
  assert.notEqual(root, outside);
});

test('filesystem access rejects explicit parent traversal', async t => {
  const { parent, root, executor } = await fixture(t);
  const outside = join(parent, 'outside.txt');
  await writeFile(outside, 'private');
  const traversal = `${root}/../outside.txt`;

  await assert.rejects(
    execute(executor, 'filesystem.read-file', { path: traversal }),
    (error: unknown) => error instanceof ToolExecutionError && error.code === 'invalid-input',
  );
});

test('filesystem tools reject a symlink to a file outside an allowed root', async t => {
  const { parent, root, executor } = await fixture(t);
  const outside = join(parent, 'outside.txt');
  const outsideDirectory = join(parent, 'outside-directory');
  const link = join(root, 'outside-link.txt');
  const directoryLink = join(root, 'outside-directory-link');
  await writeFile(outside, 'must not be read');
  await mkdir(outsideDirectory);
  await writeFile(join(outsideDirectory, 'secret.txt'), 'must not be traversed');
  try {
    await symlink(outside, link);
    await symlink(outsideDirectory, directoryLink);
  } catch (error) {
    assert.fail(`Symlink security test could not create its fixture on this platform: ${String(error)}`);
  }

  await assert.rejects(
    execute(executor, 'filesystem.read-file', { path: link }),
    /Symbolic links are not allowed/,
  );
  const listing = await execute(executor, 'filesystem.list-directory', { path: root }) as {
    entries: Array<{ name: string; type: string }>;
  };
  assert.deepEqual(listing.entries, [
    { name: 'outside-directory-link', type: 'symlink' },
    { name: 'outside-link.txt', type: 'symlink' },
  ]);
  const tree = await execute(executor, 'filesystem.directory-tree', { path: root }) as {
    entries: Array<{ name: string; path: string; type: string; depth: number }>;
  };
  assert.deepEqual(tree.entries, [
    {
      name: 'outside-directory-link',
      path: 'outside-directory-link',
      type: 'symlink',
      depth: 1,
    },
    { name: 'outside-link.txt', path: 'outside-link.txt', type: 'symlink', depth: 1 },
  ]);
});

test('filesystem tools handle missing files and directories without exposing machine paths', async t => {
  const { root, executor } = await fixture(t);
  const missingFile = join(root, 'missing.txt');
  const missingDirectory = join(root, 'missing-directory');

  await assert.rejects(
    execute(executor, 'filesystem.read-file', { path: missingFile }),
    error => error instanceof Error &&
      error.message.includes('does not exist') &&
      !error.message.includes(root),
  );
  await assert.rejects(
    execute(executor, 'filesystem.list-directory', { path: missingDirectory }),
    error => error instanceof Error &&
      error.message.includes('does not exist') &&
      !error.message.includes(root),
  );
});

test('filesystem read rejects files above the byte limit', async t => {
  const { root, executor } = await fixture(t, { VYOM_MAX_FILE_BYTES: '8' });
  const file = join(root, 'large.txt');
  await writeFile(file, '123456789');

  await assert.rejects(
    execute(executor, 'filesystem.read-file', { path: file }),
    /maximum size/,
  );
});

test('filesystem read stays within the configured serialized output limit', async t => {
  const { root, executor } = await fixture(t, { VYOM_MAX_TOOL_OUTPUT_CHARS: '300' });
  const file = join(root, 'output-bound.txt');
  await writeFile(file, 'x'.repeat(400));

  await assert.rejects(
    execute(executor, 'filesystem.read-file', { path: file }),
    /tool-output limit/,
  );
});

test('filesystem read rejects binary and invalid UTF-8 content', async t => {
  const { root, executor } = await fixture(t);
  const binary = join(root, 'binary.dat');
  const control = join(root, 'control.txt');
  const invalid = join(root, 'invalid.txt');
  await writeFile(binary, Buffer.from([0x61, 0x00, 0x62]));
  await writeFile(control, Buffer.from([0x61, 0x07, 0x62]));
  await writeFile(invalid, Buffer.from([0xc3, 0x28]));

  await assert.rejects(execute(executor, 'filesystem.read-file', { path: binary }), /Binary files/);
  await assert.rejects(execute(executor, 'filesystem.read-file', { path: control }), /Binary files/);
  await assert.rejects(execute(executor, 'filesystem.read-file', { path: invalid }), /valid UTF-8/);
});

test('directory tree honors configured depth, entry, and output bounds', async t => {
  const { root, executor } = await fixture(t, {
    VYOM_MAX_TREE_DEPTH: '1',
    VYOM_MAX_DIRECTORY_ENTRIES: '2',
    VYOM_MAX_TOOL_OUTPUT_CHARS: '200',
  });
  await mkdir(join(root, 'a'));
  await mkdir(join(root, 'a', 'nested'));
  await writeFile(join(root, 'a', 'nested', 'deep.txt'), 'x');
  await writeFile(join(root, 'b.txt'), 'x');
  await writeFile(join(root, 'c.txt'), 'x');

  const tree = await execute(executor, 'filesystem.directory-tree', {
    path: root,
    maxDepth: 1,
    maxEntries: 1,
  }) as { entries: Array<{ depth: number }>; truncated: boolean };
  assert.equal(tree.entries.length, 1);
  assert.ok(tree.entries.every(entry => entry.depth <= 1));
  assert.equal(tree.truncated, true);

  const list = await execute(executor, 'filesystem.list-directory', { path: root }) as {
    entries: unknown[];
    truncated: boolean;
  };
  assert.ok(list.entries.length <= 2);
  assert.equal(list.truncated, true);
  assert.ok(JSON.stringify(list).length <= 200);
});

test('directory tree subset is independent of enumeration order at a nested entry limit', async t => {
  const outputs = [];
  for (const order of ['ascending', 'descending'] as const) {
    const { root, executor } = await fixture(
      t,
      {
        VYOM_MAX_DIRECTORY_ENTRIES: '4',
        VYOM_MAX_TREE_DEPTH: '2',
      },
      { openDirectory: orderedDirectoryOpener(order) },
    );
    await mkdir(join(root, 'a'));
    await writeFile(join(root, 'a', 'z-child.txt'), 'z');
    await writeFile(join(root, 'a', 'm-child.txt'), 'm');
    await writeFile(join(root, 'a', 'b-child.txt'), 'b');
    await writeFile(join(root, 'a', 'a-child.txt'), 'a');
    await writeFile(join(root, 'b.txt'), 'b');
    await writeFile(join(root, 'c.txt'), 'c');
    outputs.push(await execute(executor, 'filesystem.directory-tree', { path: root }));
  }
  assert.deepEqual(outputs[0], outputs[1]);
  assert.deepEqual(outputs[0], {
    entries: [
      { name: 'a', path: 'a', type: 'directory', depth: 1 },
      { name: 'a-child.txt', path: 'a/a-child.txt', type: 'file', depth: 2 },
      { name: 'b-child.txt', path: 'a/b-child.txt', type: 'file', depth: 2 },
      { name: 'm-child.txt', path: 'a/m-child.txt', type: 'file', depth: 2 },
    ],
    truncated: true,
  });
});

test('directory tree enforces maxEntries across nested directories', async t => {
  const { root, executor } = await fixture(t, {
    VYOM_MAX_DIRECTORY_ENTRIES: '3',
    VYOM_MAX_TREE_DEPTH: '3',
  });
  await mkdir(join(root, 'a'));
  await writeFile(join(root, 'a', 'first.txt'), 'first');
  await writeFile(join(root, 'a', 'second.txt'), 'second');
  await writeFile(join(root, 'b.txt'), 'b');

  const tree = await execute(executor, 'filesystem.directory-tree', { path: root }) as {
    entries: Array<{ path: string }>;
    truncated: boolean;
  };
  assert.deepEqual(tree.entries.map(entry => entry.path), ['a', 'a/first.txt', 'a/second.txt']);
  assert.equal(tree.entries.length, 3);
  assert.equal(tree.truncated, true);
});

test('directory tree marks omitted descendants when the depth limit is reached', async t => {
  const { root, executor } = await fixture(t, {
    VYOM_MAX_TREE_DEPTH: '1',
    VYOM_MAX_DIRECTORY_ENTRIES: '20',
  });
  await mkdir(join(root, 'folder'));
  await writeFile(join(root, 'folder', 'child.txt'), 'x');

  const tree = await execute(executor, 'filesystem.directory-tree', { path: root }) as {
    entries: Array<{ path: string; depth: number }>;
    truncated: boolean;
  };
  assert.deepEqual(tree.entries, [{ name: 'folder', path: 'folder', type: 'directory', depth: 1 }]);
  assert.equal(tree.truncated, true);
});

test('directory tree does not report truncation for empty directories at the depth limit', async t => {
  const { root, executor } = await fixture(t, { VYOM_MAX_TREE_DEPTH: '1' });
  await mkdir(join(root, 'empty'));

  const tree = await execute(executor, 'filesystem.directory-tree', { path: root }) as {
    entries: Array<{ path: string }>;
    truncated: boolean;
  };
  assert.deepEqual(tree.entries.map(entry => entry.path), ['empty']);
  assert.equal(tree.truncated, false);
});

test('directory tree output-size truncation stays valid and within the configured limit', async t => {
  const { root, executor, config } = await fixture(t, {
    VYOM_MAX_TOOL_OUTPUT_CHARS: '180',
    VYOM_MAX_DIRECTORY_ENTRIES: '20',
    VYOM_MAX_TREE_DEPTH: '1',
  });
  for (let index = 0; index < 8; index += 1) {
    await writeFile(join(root, `long-entry-name-${index}.txt`), 'x');
  }

  const result = await execute(executor, 'filesystem.directory-tree', { path: root }) as {
    entries: Array<{ path: string }>;
    truncated: boolean;
  };
  assert.ok(result.entries.length > 0);
  assert.equal(result.truncated, true);
  assert.ok(JSON.stringify(result).length <= config.maxToolOutputChars);
});

test('filesystem cancellation and read errors close active directory and file handles', async t => {
  await t.test('directory read error closes its handle', async t => {
    let closed = false;
    const { root, executor } = await fixture(t, {}, {
      openDirectory: async path => {
        const handle = await opendir(path);
        return {
          async read(): Promise<Dirent | null> {
            throw new Error('injected directory error');
          },
          async close(): Promise<void> {
            closed = true;
            await handle.close();
          },
        };
      },
    });
    await assert.rejects(execute(executor, 'filesystem.directory-tree', { path: root }), /failed safely/);
    assert.equal(closed, true);
  });

  await t.test('directory cancellation closes its handle', async t => {
    let closed = false;
    let markReadStarted!: () => void;
    const readStarted = new Promise<void>(resolve => { markReadStarted = resolve; });
    const { root, executor } = await fixture(t, {}, {
      openDirectory: async path => {
        const handle = await opendir(path);
        return {
          read(): Promise<Dirent | null> {
            markReadStarted();
            return new Promise<Dirent | null>(() => {});
          },
          async close(): Promise<void> {
            closed = true;
            await handle.close();
          },
        };
      },
    });
    const controller = new AbortController();
    const pending = executor.execute('filesystem.directory-tree', { path: root }, controller.signal);
    await readStarted;
    controller.abort();
    await assert.rejects(pending, (error: unknown) =>
      error instanceof ToolExecutionError && error.code === 'cancelled');
    assert.equal(closed, true);
  });

  await t.test('file read error closes its handle', async t => {
    let closed = false;
    const { root, executor } = await fixture(t, {}, {
      openFile: async (path, flags) => {
        const handle = await open(path, flags);
        return {
          stat: () => handle.stat(),
          async read(): Promise<{ bytesRead: number; buffer: Buffer }> {
            throw new Error('injected file error');
          },
          async close(): Promise<void> {
            closed = true;
            await handle.close();
          },
        };
      },
    });
    const file = join(root, 'read.txt');
    await writeFile(file, 'contents');
    await assert.rejects(execute(executor, 'filesystem.read-file', { path: file }), /failed safely/);
    assert.equal(closed, true);
  });

  await t.test('file cancellation closes its handle', async t => {
    let closed = false;
    let markReadStarted!: () => void;
    const readStarted = new Promise<void>(resolve => { markReadStarted = resolve; });
    const { root, executor } = await fixture(t, {}, {
      openFile: async (path, flags) => {
        const handle = await open(path, flags);
        return {
          stat: () => handle.stat(),
          read(): Promise<{ bytesRead: number; buffer: Buffer }> {
            markReadStarted();
            return new Promise<{ bytesRead: number; buffer: Buffer }>(() => {});
          },
          async close(): Promise<void> {
            closed = true;
            await handle.close();
          },
        };
      },
    });
    const file = join(root, 'read.txt');
    await writeFile(file, 'contents');
    const controller = new AbortController();
    const pending = executor.execute('filesystem.read-file', { path: file }, controller.signal);
    await readStarted;
    controller.abort();
    await assert.rejects(pending, (error: unknown) =>
      error instanceof ToolExecutionError && error.code === 'cancelled');
    assert.equal(closed, true);
  });
});

test('filesystem tool inputs reject malformed objects, unknown fields, and unreasonable limits', async t => {
  const { root, executor } = await fixture(t);
  const invalidInputs = [
    null,
    [],
    { path: root, unexpected: true },
    { path: 'relative/path' },
    { path: root, maxEntries: 0 },
    { path: root, maxEntries: 501 },
    { path: root, maxDepth: -1 },
  ];
  for (const input of invalidInputs) {
    await assert.rejects(
      execute(executor, 'filesystem.directory-tree', input),
      (error: unknown) => error instanceof ToolExecutionError && error.code === 'invalid-input',
    );
  }
});

test('filesystem registry exposes no write or delete tools and policy denies side effects', async t => {
  const { root, registry, executor } = await fixture(t);
  const file = join(root, 'keep.txt');
  await writeFile(file, 'unchanged');

  assert.equal(registry.get('filesystem.write-file'), undefined);
  assert.equal(registry.get('filesystem.delete-file'), undefined);
  await assert.rejects(
    execute(executor, 'filesystem.write-file', { path: file, content: 'changed' }),
    (error: unknown) => error instanceof ToolExecutionError && error.code === 'unknown-tool',
  );
  await assert.rejects(
    execute(executor, 'filesystem.delete-file', { path: file }),
    (error: unknown) => error instanceof ToolExecutionError && error.code === 'unknown-tool',
  );
  assert.equal(await readFile(file, 'utf8'), 'unchanged');
  const policy = new PolicyGateway();
  assert.deepEqual(policy.authorize('write'), { allowed: false, reason: 'side-effects-disabled' });
  assert.deepEqual(policy.authorize('delete'), { allowed: false, reason: 'side-effects-disabled' });
  assert.deepEqual(policy.authorize('shell'), { allowed: false, reason: 'side-effects-disabled' });
});

test('filesystem operations fail closed when no allowed roots are configured', async t => {
  const { root } = await fixture(t);
  const config = loadConfig({ VYOM_PROVIDER: 'placeholder' });
  const registry = new ToolRegistry();
  registerFilesystemTools(registry, config);
  const executor = new ToolExecutor({
    registry,
    policy: new PolicyGateway(),
    config,
    logger: createLogger(() => {}),
  });

  await assert.rejects(
    execute(executor, 'filesystem.list-directory', { path: root }),
    /no allowed roots are configured/,
  );
});

test('filesystem diagnostics omit file content and absolute paths', async t => {
  const { root, executor, logLines } = await fixture(t);
  const file = join(root, 'private.txt');
  const secretText = 'private filesystem content must not enter logs';
  await writeFile(file, secretText);
  await execute(executor, 'filesystem.read-file', { path: file });

  const logs = logLines.join('\n');
  assert.doesNotMatch(logs, new RegExp(secretText));
  assert.doesNotMatch(logs, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(logs, /filesystem\.read-file/);
});

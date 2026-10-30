import assert from 'node:assert/strict';
import { access, chmod, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { approvedChecks, runApprovedCheck, validateCheckDirectory } from '../src/desktop/check-runner.ts';

async function setupFakePnpm(t: test.TestContext, source: string): Promise<{ project: string; bin: string }> {
  const root = await mkdtemp(join(tmpdir(), 'vyomara-check-runner-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  const bin = join(root, 'bin');
  await mkdir(project);
  await mkdir(bin);
  const executable = join(bin, 'pnpm');
  await writeFile(executable, `#!/usr/bin/env node\n${source}\n`, { mode: 0o700 });
  await chmod(executable, 0o700);
  return { project, bin };
}

function withPath<T>(bin: string, operation: () => Promise<T>): Promise<T> {
  const previous = process.env.PATH;
  process.env.PATH = `${bin}${previous ? `:${previous}` : ''}`;
  return operation().finally(() => {
    if (previous === undefined) delete process.env.PATH;
    else process.env.PATH = previous;
  });
}

test('approved project checks expose only fixed package scripts', () => {
  assert.deepEqual(Object.keys(approvedChecks), [
    'test',
    'typecheck',
    'build:desktop',
    'test:desktop-ui',
  ]);
  assert.equal(approvedChecks.test.label, 'pnpm test');
  assert.equal(approvedChecks.typecheck.label, 'pnpm typecheck');
});

test('approved check runner passes only the selected fixed script and captures bounded results', async t => {
  const { project, bin } = await setupFakePnpm(
    t,
    "process.stdout.write(JSON.stringify(process.argv.slice(2))); process.exitCode = 0;",
  );
  const result = await withPath(bin, () =>
    runApprovedCheck(project, 'typecheck', new AbortController().signal));
  assert.equal(result.status, 'passed');
  assert.equal(result.command, 'pnpm typecheck');
  assert.equal(result.exitCode, 0);
  assert.equal(result.output, '["typecheck"]');
});

test('approved project checks do not inherit arbitrary environment variables', async t => {
  const { project, bin } = await setupFakePnpm(
    t,
    "process.stdout.write(JSON.stringify({ path: process.env.PATH, secret: process.env.VYOMARA_TEST_SECRET_SENTINEL ?? null }));",
  );
  const previous = process.env.VYOMARA_TEST_SECRET_SENTINEL;
  process.env.VYOMARA_TEST_SECRET_SENTINEL = 'test-only-not-secret';
  try {
    const result = await withPath(bin, () =>
      runApprovedCheck(project, 'test', new AbortController().signal));
    assert.equal(result.status, 'passed');
    assert.match(result.output, /"path":/);
    assert.match(result.output, /"secret":null/);
  } finally {
    if (previous === undefined) delete process.env.VYOMARA_TEST_SECRET_SENTINEL;
    else process.env.VYOMARA_TEST_SECRET_SENTINEL = previous;
  }
});

test('approved check runner reports nonzero exit codes without success-shaped fallback', async t => {
  const { project, bin } = await setupFakePnpm(
    t,
    "process.stdout.write('script failed'); process.exitCode = 7;",
  );
  const result = await withPath(bin, () =>
    runApprovedCheck(project, 'test', new AbortController().signal));
  assert.equal(result.status, 'failed');
  assert.equal(result.exitCode, 7);
  assert.equal(result.output, 'script failed');
});

test('approved check runner cancels the spawned process group', async t => {
  const root = await mkdtemp(join(tmpdir(), 'vyomara-check-cancel-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  const bin = join(root, 'bin');
  const marker = join(root, 'started');
  await mkdir(project);
  await mkdir(bin);
  const executable = join(bin, 'pnpm');
  await writeFile(
    executable,
    `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, 'yes'); process.stdout.write('started'); setInterval(() => {}, 1000);\n`,
    { mode: 0o700 },
  );
  await chmod(executable, 0o700);
  const controller = new AbortController();
  const pending = withPath(bin, () => runApprovedCheck(project, 'test', controller.signal));
  const markerDeadline = Date.now() + 5_000;
  let started = false;
  while (Date.now() < markerDeadline) {
    try {
      await access(marker);
      started = true;
      break;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  await new Promise(resolve => setTimeout(resolve, 20));
  controller.abort();
  const result = await pending;
  assert.ok(started, 'fake pnpm process should start before the deadline');
  assert.equal(result.status, 'cancelled');
  assert.equal(result.output, 'started');
});

test('approved check runner stops at the combined output limit', async t => {
  const { project, bin } = await setupFakePnpm(
    t,
    "process.stdout.write('x'.repeat(70000)); setInterval(() => {}, 1000);",
  );
  const result = await withPath(bin, () =>
    runApprovedCheck(project, 'test', new AbortController().signal));
  assert.equal(result.status, 'output-limit');
  assert.equal(result.output.length, 64_000);
});

test('approved check runner rejects unknown checks and validates the selected directory', async t => {
  const { project } = await setupFakePnpm(t, 'process.exitCode = 0;');
  assert.match(await validateCheckDirectory(project), /\/project$/);
  await assert.rejects(runApprovedCheck(project, 'arbitrary command', new AbortController().signal), /not supported/i);
  await assert.rejects(validateCheckDirectory('relative/path'), /valid project directory/i);
});

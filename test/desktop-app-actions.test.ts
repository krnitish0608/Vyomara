import assert from 'node:assert/strict';
import test from 'node:test';
import { detectDesktopAppAction, isCodeEditRequest, requestsVSCode } from '../src/desktop/action-intent.ts';
import { parseDesktopAppAction, runDesktopAppAction } from '../src/desktop/app-actions.ts';

test('only clear direct requests are converted into supported application actions', () => {
  assert.deepEqual(detectDesktopAppAction('Open VS Code'), { type: 'open-vscode' });
  assert.deepEqual(detectDesktopAppAction('launch Visual Studio Code.'), { type: 'open-vscode' });
  assert.deepEqual(detectDesktopAppAction('VS Code kholo'), { type: 'open-vscode' });
  assert.deepEqual(detectDesktopAppAction('Open Google Chrome'), { type: 'open-chrome' });
  assert.deepEqual(detectDesktopAppAction('Google browser open karo'), { type: 'open-chrome' });
  assert.deepEqual(
    detectDesktopAppAction('Open Chrome and search for React Native'),
    { type: 'search-chrome', query: 'React Native' },
  );
  assert.deepEqual(
    detectDesktopAppAction('Search Chrome for local-first assistants'),
    { type: 'search-chrome', query: 'local-first assistants' },
  );
  assert.deepEqual(
    detectDesktopAppAction('Chrome mein Vyomara privacy search karo'),
    { type: 'search-chrome', query: 'Vyomara privacy' },
  );
  assert.equal(detectDesktopAppAction('Open VS Code and fix my project'), undefined);
  assert.equal(detectDesktopAppAction('Open VS Code and fix the login bug'), undefined);
  assert.equal(detectDesktopAppAction('Search for this'), undefined);
  assert.equal(detectDesktopAppAction(`Search Chrome for ${'x'.repeat(257)}`), undefined);
  assert.equal(isCodeEditRequest('Fix the login bug in this project'), true);
  assert.equal(isCodeEditRequest('Open VS Code and fix the login bug'), true);
  assert.equal(isCodeEditRequest('Delete the config file in this project'), false);
  assert.equal(isCodeEditRequest('Explain how this project works'), false);
  assert.equal(requestsVSCode('Open VS Code and fix the login bug'), true);
  assert.equal(requestsVSCode('Fix the login bug in this project'), false);
});

test('VS Code requests launch only the fixed installed application name', async () => {
  const calls: string[][] = [];
  const result = await runDesktopAppAction(
    { type: 'open-vscode' },
    async args => { calls.push([...args]); },
  );
  assert.deepEqual(calls, [['-a', 'Visual Studio Code']]);
  assert.deepEqual(result, { application: 'Visual Studio Code', action: 'opened' });
});

test('opening a selected project in VS Code passes only the selected directory as an argument', async () => {
  const calls: string[][] = [];
  await runDesktopAppAction(
    { type: 'open-vscode', projectDirectory: '/tmp/vyomara project' },
    async args => { calls.push([...args]); },
  );
  assert.deepEqual(calls, [['-a', 'Visual Studio Code', '/tmp/vyomara project']]);
});

test('Chrome search uses a fixed HTTPS search origin and safely encoded query', async () => {
  const calls: string[][] = [];
  const result = await runDesktopAppAction(
    { type: 'search-chrome', query: 'Vyomara & privacy' },
    async args => { calls.push([...args]); },
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.slice(0, 2), ['-a', 'Google Chrome']);
  const url = new URL(calls[0]?.[2] ?? '');
  assert.equal(url.origin, 'https://www.google.com');
  assert.equal(url.pathname, '/search');
  assert.equal(url.searchParams.get('q'), 'Vyomara & privacy');
  assert.deepEqual(result, {
    application: 'Google Chrome',
    action: 'search-opened',
    searchUrl: url.toString(),
  });
});

test('malformed or overlong IPC application actions are rejected before launch', async () => {
  const launch = async (): Promise<void> => { throw new Error('must not launch'); };
  for (const input of [
    { type: 'run-shell', command: 'open -a Chrome' },
    { type: 'search-chrome', query: `x${'x'.repeat(256)}` },
    { type: 'open-chrome', query: 'unexpected' },
    null,
  ]) {
    assert.throws(() => parseDesktopAppAction(input));
    await assert.rejects(runDesktopAppAction(input, launch));
  }
});

test('non-macOS launch failures surface as errors instead of false success', async () => {
  await assert.rejects(
    runDesktopAppAction({ type: 'open-chrome' }, async () => {
      throw new Error('application is not installed');
    }),
    /application is not installed/,
  );
});

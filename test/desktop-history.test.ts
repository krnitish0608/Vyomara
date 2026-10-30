import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deleteDesktopSession, readDesktopSession, readDesktopSessions } from '../src/app/application.ts';
import { loadConfig } from '../src/config/config.ts';
import { SqliteStore } from '../src/storage/sqlite-store.ts';

test('desktop session history lists local chats and returns only user and final assistant messages', t => {
  const root = mkdtempSync(join(tmpdir(), 'vyomara-desktop-history-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = loadConfig({
    VYOM_PROVIDER: 'placeholder',
    VYOM_DATA_DIR: root,
  });
  const store = new SqliteStore(root);
  const session = store.createSession();
  session.add({ role: 'user', content: 'List this folder.' });
  session.add({
    role: 'assistant',
    kind: 'tool-call',
    content: '',
    toolCalls: [{ toolId: 'filesystem.list-directory', arguments: { path: '/private' } }],
  });
  session.add({ role: 'tool', toolId: 'filesystem.list-directory', content: 'private tool output' });
  session.add({ role: 'assistant', content: 'The folder contains two items.' });
  store.saveSession(session);
  store.close();

  const summaries = readDesktopSessions(config);
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0]?.id, session.id);
  assert.equal(summaries[0]?.messageCount, 4);
  assert.ok(Number.isFinite(Date.parse(summaries[0]?.createdAt ?? '')));
  assert.ok(Number.isFinite(Date.parse(summaries[0]?.updatedAt ?? '')));

  assert.deepEqual(readDesktopSession(config, session.id), {
    sessionId: session.id,
    messages: [
      { role: 'user', content: 'List this folder.' },
      { role: 'assistant', content: 'The folder contains two items.' },
    ],
  });
  assert.equal(deleteDesktopSession(config, session.id), true);
  assert.deepEqual(readDesktopSessions(config), []);
  assert.throws(() => readDesktopSession(config, session.id), /not found/i);
  assert.equal(deleteDesktopSession(config, session.id), false);
  const reopened = new SqliteStore(root);
  assert.deepEqual(reopened.listSessions(), []);
  assert.throws(() => reopened.getSession(session.id), /not found/i);
  reopened.close();
  assert.throws(() => readDesktopSession(config, 'not-a-uuid'), /invalid/i);
});

import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  deleteAllDesktopSessionsAndMemories,
  deleteDesktopSession,
  exportDesktopBackup,
  exportDesktopSession,
  inspectDesktopBackup,
  readDesktopMemories,
  readDesktopMemory,
  readDesktopSession,
  readDesktopSessions,
  restoreDesktopBackup,
  saveDesktopMemory,
} from '../src/app/application.ts';
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
  const exported = JSON.parse(exportDesktopSession(config, session.id));
  assert.equal(exported.format, 'vyomara-session');
  assert.equal(exported.version, 1);
  assert.equal(exported.sessionId, session.id);
  assert.ok(Number.isFinite(Date.parse(exported.exportedAt)));
  assert.deepEqual(exported.messages, session.messages());
  const backupPath = join(root, 'desktop-backup.sqlite');
  exportDesktopBackup(config, backupPath);
  assert.equal(statSync(backupPath).mode & 0o777, 0o600);
  const backup = new DatabaseSync(backupPath, { readOnly: true });
  assert.equal(
    (backup.prepare('SELECT COUNT(*) AS count FROM sessions').get() as { count: number }).count,
    1,
  );
  backup.close();
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

test('desktop delete-all clears sessions and memories without resetting settings or folder grants', t => {
  const root = mkdtempSync(join(tmpdir(), 'vyomara-desktop-delete-all-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = loadConfig({
    VYOM_PROVIDER: 'placeholder',
    VYOM_DATA_DIR: root,
  });
  const store = new SqliteStore(root);
  const session = store.createSession();
  session.add({ role: 'user', content: 'saved conversation' });
  store.saveSession(session);
  store.initializeFilesystemRoots([root]);
  store.setAppSettings({ provider: 'placeholder' });
  store.close();
  saveDesktopMemory(config, 'saved memory');

  assert.deepEqual(deleteAllDesktopSessionsAndMemories(config), {
    sessionsDeleted: 1,
    memoriesDeleted: 1,
  });
  assert.deepEqual(readDesktopSessions(config), []);
  assert.deepEqual(readDesktopMemories(config), []);
  const reopened = new SqliteStore(root);
  assert.deepEqual(reopened.listFilesystemRoots(), [root]);
  assert.equal(reopened.getAppSetting('provider'), 'placeholder');
  reopened.close();
});

test('desktop restore validates a backup and preserves a pre-restore safety copy', t => {
  const root = mkdtempSync(join(tmpdir(), 'vyomara-desktop-restore-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const backupSourceDirectory = join(root, 'backup-source');
  const currentDataDirectory = join(root, 'current-data');
  const backupPath = join(root, 'selected-backup.sqlite');
  const backupStore = new SqliteStore(backupSourceDirectory);
  const restoredSession = backupStore.createSession();
  restoredSession.add({ role: 'user', content: 'from selected backup' });
  backupStore.saveSession(restoredSession);
  backupStore.saveMemory('memory from selected backup');
  backupStore.initializeFilesystemRoots([join(root, 'restored-folder')]);
  backupStore.setAppSettings({ provider: 'placeholder', 'ollama-model': 'llama3.2' });
  backupStore.exportBackup(backupPath);
  backupStore.close();

  const config = loadConfig({
    VYOM_PROVIDER: 'ollama',
    VYOM_DATA_DIR: currentDataDirectory,
  });
  const currentStore = new SqliteStore(currentDataDirectory);
  const currentSession = currentStore.createSession();
  currentSession.add({ role: 'user', content: 'before restore' });
  currentStore.saveSession(currentSession);
  currentStore.saveMemory('memory before restore');
  currentStore.close();

  assert.deepEqual(inspectDesktopBackup(config, backupPath), {
    fileName: 'selected-backup.sqlite',
    sessions: 1,
    memories: 1,
  });
  const restored = restoreDesktopBackup(config, backupPath);
  assert.equal(restored.fileName, 'selected-backup.sqlite');
  assert.equal(restored.sessions, 1);
  assert.equal(restored.memories, 1);
  assert.match(restored.safetyBackupName, /^vyomara-pre-restore-/);
  assert.deepEqual(readDesktopSessions(config).map(session => session.id), [restoredSession.id]);
  const memoriesAfterRestore = readDesktopMemories(config);
  assert.equal(memoriesAfterRestore.length, 1);
  assert.equal(readDesktopMemory(config, memoriesAfterRestore[0]!.id), 'memory from selected backup');
  const afterRestore = new SqliteStore(currentDataDirectory);
  assert.deepEqual(afterRestore.listFilesystemRoots(), [join(root, 'restored-folder')]);
  assert.equal(afterRestore.getAppSetting('provider'), 'placeholder');
  assert.equal(afterRestore.getAppSetting('ollama-model'), 'llama3.2');
  afterRestore.close();

  const safetyBackup = new DatabaseSync(join(currentDataDirectory, restored.safetyBackupName), { readOnly: true });
  assert.equal(statSync(join(currentDataDirectory, restored.safetyBackupName)).mode & 0o777, 0o600);
  assert.equal(
    (safetyBackup.prepare('SELECT id FROM sessions').get() as { id: string }).id,
    currentSession.id,
  );
  assert.equal(
    (safetyBackup.prepare('SELECT content FROM memories').get() as { content: string }).content,
    'memory before restore',
  );
  safetyBackup.close();
});

test('invalid desktop backup is rejected without replacing the current database', t => {
  const root = mkdtempSync(join(tmpdir(), 'vyomara-invalid-restore-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const currentDataDirectory = join(root, 'current-data');
  const backupPath = join(root, 'invalid.sqlite');
  writeFileSync(backupPath, 'not a SQLite backup');
  const config = loadConfig({
    VYOM_PROVIDER: 'placeholder',
    VYOM_DATA_DIR: currentDataDirectory,
  });
  const store = new SqliteStore(currentDataDirectory);
  const session = store.createSession();
  session.add({ role: 'user', content: 'keep existing data' });
  store.saveSession(session);
  store.close();

  assert.throws(() => inspectDesktopBackup(config, backupPath), /not a valid Vyomara backup/i);
  assert.throws(() => restoreDesktopBackup(config, backupPath), /not a valid Vyomara backup/i);
  assert.deepEqual(readDesktopSessions(config).map(item => item.id), [session.id]);
  assert.deepEqual(
    readdirSync(currentDataDirectory).filter(file => file.startsWith('vyomara-pre-restore-')),
    [],
  );
});

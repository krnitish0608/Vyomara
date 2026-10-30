import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  deleteDesktopMemory,
  exportDesktopMemory,
  readDesktopMemories,
  readDesktopMemory,
  saveDesktopMemory,
} from '../src/app/application.ts';
import { loadConfig } from '../src/config/config.ts';

test('desktop memory operations stay explicit, local, inspectable, and deletable', t => {
  const root = mkdtempSync(join(tmpdir(), 'vyomara-desktop-memory-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = loadConfig({
    VYOM_PROVIDER: 'placeholder',
    VYOM_DATA_DIR: root,
  });

  assert.deepEqual(readDesktopMemories(config), []);
  const id = saveDesktopMemory(config, 'Remember that I prefer concise answers.');
  assert.equal(readDesktopMemory(config, id), 'Remember that I prefer concise answers.');
  const exported = JSON.parse(exportDesktopMemory(config, id));
  assert.equal(exported.format, 'vyomara-memory');
  assert.equal(exported.version, 1);
  assert.equal(exported.memoryId, id);
  assert.ok(Number.isFinite(Date.parse(exported.exportedAt)));
  assert.equal(exported.content, 'Remember that I prefer concise answers.');
  assert.deepEqual(readDesktopMemories(config).map(memory => memory.id), [id]);
  assert.equal(deleteDesktopMemory(config, id), true);
  assert.deepEqual(readDesktopMemories(config), []);
  assert.equal(deleteDesktopMemory(config, id), false);
});

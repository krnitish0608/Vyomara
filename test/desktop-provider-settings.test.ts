import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  initializeDesktopProviderSettings,
  resetDesktopProviderSettings,
  saveDesktopProviderSettings,
} from '../src/app/application.ts';
import { loadConfig } from '../src/config/config.ts';
import { SqliteStore } from '../src/storage/sqlite-store.ts';

test('desktop provider settings persist locally and override startup provider defaults', t => {
  const root = mkdtempSync(join(tmpdir(), 'vyomara-provider-settings-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = loadConfig({ VYOM_DATA_DIR: root });

  assert.equal(initializeDesktopProviderSettings(config).provider, 'ollama');
  const saved = saveDesktopProviderSettings(config, {
    provider: 'placeholder',
    model: 'qwen2.5-coder:latest',
  });
  assert.equal(saved.config.provider, 'placeholder');
  assert.equal(saved.config.ollamaModel, 'qwen2.5-coder:latest');
  assert.deepEqual(saved.status, {
    provider: 'placeholder',
    model: 'qwen2.5-coder:latest',
    connection: 'not-checked',
  });

  const restartedConfig = loadConfig({
    VYOM_DATA_DIR: root,
    VYOM_PROVIDER: 'ollama',
    VYOM_OLLAMA_MODEL: 'llama3.2',
  });
  assert.deepEqual(
    (({ provider, ollamaModel }) => ({ provider, ollamaModel }))(
      initializeDesktopProviderSettings(restartedConfig),
    ),
    { provider: 'placeholder', ollamaModel: 'qwen2.5-coder:latest' },
  );

  const ollama = saveDesktopProviderSettings(saved.config, {
    provider: 'ollama',
    model: 'llama3.2',
  });
  assert.equal(initializeDesktopProviderSettings(ollama.config).provider, 'ollama');
  assert.equal(initializeDesktopProviderSettings(ollama.config).ollamaModel, 'llama3.2');

  const overrideStore = new SqliteStore(root);
  overrideStore.initializeFilesystemRoots(['/tmp/vyomara-approved-root']);
  overrideStore.close();
  const environmentDefaults = loadConfig({
    VYOM_DATA_DIR: root,
    VYOM_PROVIDER: 'ollama',
    VYOM_OLLAMA_MODEL: 'gemma3:4b',
  });
  const reset = resetDesktopProviderSettings(ollama.config, environmentDefaults);
  assert.deepEqual(
    { provider: reset.config.provider, model: reset.config.ollamaModel },
    { provider: 'ollama', model: 'gemma3:4b' },
  );
  assert.deepEqual(reset.status, {
    provider: 'ollama',
    model: 'gemma3:4b',
    connection: 'not-checked',
  });
  assert.deepEqual(initializeDesktopProviderSettings(environmentDefaults), environmentDefaults);

  const resetStore = new SqliteStore(root);
  assert.equal(resetStore.getAppSetting('provider'), undefined);
  assert.equal(resetStore.getAppSetting('ollama-model'), undefined);
  assert.deepEqual(resetStore.listFilesystemRoots(), ['/tmp/vyomara-approved-root']);
  assert.equal(resetStore.getAppSetting('filesystem-roots-initialized'), 'true');
  resetStore.close();
});

test('desktop provider settings fail closed when persisted values are incomplete', t => {
  const root = mkdtempSync(join(tmpdir(), 'vyomara-provider-settings-invalid-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = loadConfig({ VYOM_DATA_DIR: root });
  const store = new SqliteStore(root);
  store.setAppSettings({ provider: 'ollama' });
  store.close();

  assert.throws(
    () => initializeDesktopProviderSettings(config),
    /Saved provider settings are incomplete or invalid/,
  );
});

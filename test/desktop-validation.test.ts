import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseDesktopChatRequest,
  parseDesktopFilesystemRoot,
  parseDesktopMemoryDeleteRequest,
  parseDesktopMemoryId,
  parseDesktopMemorySaveRequest,
  parseDesktopOllamaModelName,
  parseDesktopProviderSettings,
  parseDesktopSessionDeleteRequest,
  parseDesktopSessionId,
} from '../src/desktop/validation.ts';

const validSessionId = 'c523a2a9-8619-4cf4-8e0a-5e1bfab013f0';

test('desktop IPC accepts only bounded chat requests and optional UUID session IDs', () => {
  assert.deepEqual(
    parseDesktopChatRequest({ prompt: 'Explain this file.' }, 100),
    { prompt: 'Explain this file.' },
  );
  assert.deepEqual(
    parseDesktopChatRequest({ prompt: 'Continue', sessionId: validSessionId }, 100),
    { prompt: 'Continue', sessionId: validSessionId },
  );
  for (const invalid of [
    null,
    [],
    {},
    { prompt: '  ' },
    { prompt: 'x'.repeat(101) },
    { prompt: 'valid', sessionId: '../outside' },
    { prompt: 'valid', unexpected: true },
  ]) {
    assert.throws(() => parseDesktopChatRequest(invalid, 100), /Chat request is invalid/);
  }
});

test('desktop IPC accepts only UUID session identifiers', () => {
  assert.equal(parseDesktopSessionId(validSessionId), validSessionId);
  for (const invalid of [null, undefined, {}, '../session', '']) {
    assert.throws(() => parseDesktopSessionId(invalid), /Session request is invalid/);
  }
});

test('desktop IPC accepts only local providers and bounded Ollama model names', () => {
  assert.deepEqual(
    parseDesktopProviderSettings({ provider: 'ollama', model: 'llama3.2:latest' }),
    { provider: 'ollama', model: 'llama3.2:latest' },
  );
  assert.deepEqual(
    parseDesktopProviderSettings({ provider: 'placeholder', model: 'qwen2.5-coder' }),
    { provider: 'placeholder', model: 'qwen2.5-coder' },
  );
  for (const invalid of [
    null,
    {},
    { provider: 'remote', model: 'model' },
    { provider: 'ollama', model: 'model name' },
    { provider: 'ollama', model: 'x'.repeat(129) },
    { provider: 'ollama', model: 'model', extra: true },
  ]) {
    assert.throws(
      () => parseDesktopProviderSettings(invalid),
      /Provider settings|supported provider|Ollama model names/,
    );
  }
});

test('desktop IPC validates Ollama model availability check input', () => {
  assert.equal(parseDesktopOllamaModelName(' qwen2.5-coder:latest '), 'qwen2.5-coder:latest');
  for (const invalid of [null, {}, '', 'model name', 'https://example.com', 'x'.repeat(129)]) {
    assert.throws(
      () => parseDesktopOllamaModelName(invalid),
      /Ollama model name|Ollama model names/,
    );
  }
});

test('desktop IPC requires an exact DELETE confirmation for reviewed session history', () => {
  assert.deepEqual(
    parseDesktopSessionDeleteRequest({ id: validSessionId, confirmation: 'DELETE' }),
    { id: validSessionId, confirmation: 'DELETE' },
  );
  for (const invalid of [
    null,
    {},
    { id: validSessionId },
    { id: validSessionId, confirmation: 'delete' },
    { id: '../outside', confirmation: 'DELETE' },
    { id: validSessionId, confirmation: 'DELETE', extra: true },
  ]) {
    assert.throws(
      () => parseDesktopSessionDeleteRequest(invalid),
      /Session deletion request|Session request|type DELETE/,
    );
  }
});

test('desktop IPC accepts only bounded absolute filesystem roots', () => {
  assert.equal(parseDesktopFilesystemRoot('/Users/test/Documents'), '/Users/test/Documents');
  for (const invalid of [null, undefined, {}, '', 'relative/path', '/bad\0path', ' '.repeat(4097)]) {
    assert.throws(() => parseDesktopFilesystemRoot(invalid), /Filesystem permission request is invalid/);
  }
});

test('desktop IPC requires exact SAVE confirmation for reviewed memory content', () => {
  assert.deepEqual(
    parseDesktopMemorySaveRequest({ content: 'Keep my answer concise.', confirmation: 'SAVE' }),
    { content: 'Keep my answer concise.', confirmation: 'SAVE' },
  );
  for (const invalid of [
    null,
    {},
    { content: 'private note' },
    { content: 'private note', confirmation: 'save' },
    { content: '  ', confirmation: 'SAVE' },
    { content: 'x'.repeat(32_001), confirmation: 'SAVE' },
    { content: 'private note', confirmation: 'SAVE', unexpected: true },
  ]) {
    assert.throws(() => parseDesktopMemorySaveRequest(invalid), /Memory save request|type SAVE/);
  }
});

test('desktop IPC requires a valid memory ID and exact DELETE confirmation', () => {
  assert.equal(parseDesktopMemoryId(validSessionId), validSessionId);
  assert.deepEqual(
    parseDesktopMemoryDeleteRequest({ id: validSessionId, confirmation: 'DELETE' }),
    { id: validSessionId, confirmation: 'DELETE' },
  );
  for (const invalid of [
    null,
    {},
    { id: validSessionId, confirmation: 'delete' },
    { id: '../outside', confirmation: 'DELETE' },
    { id: validSessionId, confirmation: 'DELETE', extra: true },
  ]) {
    assert.throws(
      () => parseDesktopMemoryDeleteRequest(invalid),
      /Memory deletion request|Memory request|type DELETE/,
    );
  }
});

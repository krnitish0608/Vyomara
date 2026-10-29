import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseDesktopChatRequest,
  parseDesktopFilesystemRoot,
  parseDesktopMemoryDeleteRequest,
  parseDesktopMemoryId,
  parseDesktopMemorySaveRequest,
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

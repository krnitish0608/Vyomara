import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDesktopChatRequest, parseDesktopSessionId } from '../src/desktop/validation.ts';

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

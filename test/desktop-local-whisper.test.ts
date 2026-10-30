import assert from 'node:assert/strict';
import test from 'node:test';
import { extractWhisperTranscriptions, matchWakePhrase } from '../src/desktop/local-whisper.ts';

test('Whisper transcription parser extracts clean lines from VAD output', () => {
  const output = [
    'noise',
    '### Transcription 0 START',
    '[00:00:00.000 --> 00:00:01.200]  Hello Vyomara, open VS Code.',
    '### Transcription 0 END',
    '### Transcription 1 START',
    '[00:00:02.000 --> 00:00:02.500] Search for weather.',
    '### Transcription 1 END',
  ].join('\n');

  assert.deepEqual(extractWhisperTranscriptions(output), [
    'Hello Vyomara, open VS Code.',
    'Search for weather.',
  ]);
});

test('wake phrase matching accepts English and Hindi phrases and preserves command text', () => {
  assert.deepEqual(matchWakePhrase(' Hello Vyomara, open VS Code '), {
    detected: true,
    remainder: 'open VS Code',
  });
  assert.deepEqual(matchWakePhrase('नमस्ते व्योम, मौसम बताओ'), {
    detected: true,
    remainder: 'मौसम बताओ',
  });
  assert.deepEqual(matchWakePhrase('open VS Code'), {
    detected: false,
    remainder: 'open VS Code',
  });
  assert.equal(matchWakePhrase('hello vyomaram').detected, false);
});

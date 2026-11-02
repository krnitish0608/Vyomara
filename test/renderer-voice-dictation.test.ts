import assert from 'node:assert/strict';
import test from 'node:test';
import { appendVoiceDraft, resolveVoiceTranscriptAction } from '../src/renderer/src/ui/voice-dictation.ts';

test('composer dictation turns partial transcripts into a draft instead of a command', () => {
  assert.deepEqual(
    resolveVoiceTranscriptAction('partial', true, 'hello there'),
    { type: 'draft', transcript: 'hello there' },
  );
  assert.deepEqual(
    resolveVoiceTranscriptAction('command', true, 'hello there'),
    { type: 'draft', transcript: 'hello there' },
  );
});

test('voice command submission remains available outside composer dictation', () => {
  assert.deepEqual(
    resolveVoiceTranscriptAction('command', false, 'open VS Code'),
    { type: 'submit', transcript: 'open VS Code' },
  );
  assert.deepEqual(
    resolveVoiceTranscriptAction('partial', false, 'open VS Code'),
    { type: 'preview', transcript: 'open VS Code' },
  );
});

test('dictation appends each finalized speech segment to the editable draft', () => {
  assert.equal(appendVoiceDraft('', 'first segment'), 'first segment');
  assert.equal(appendVoiceDraft('first segment', 'second segment'), 'first segment second segment');
});

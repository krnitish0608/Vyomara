import assert from 'node:assert/strict';
import test from 'node:test';
import { PERSONAS } from '../src/shared/persona.ts';

test('each assistant introduces itself, with "AI" spelled for its voice', () => {
  // Checked with whisper: Rishi says "AI" as "air" but "A. I." clearly; Tara the reverse.
  assert.equal(PERSONAS.vyom.greeting, "Hi, I'm Vyom, your personal A. I. assistant. Tell me what you need.");
  assert.equal(PERSONAS.vyomara.greeting, "Hi, I'm Vyomara, your personal AI assistant. Tell me what you need.");
});

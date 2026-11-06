import assert from 'node:assert/strict';
import test from 'node:test';
import { PERSONAS } from '../src/shared/persona.ts';

test('each assistant introduces itself with the welcome text', () => {
  assert.match(PERSONAS.vyom.greeting, /^Hi, I'm Vyom, your personal AI assistant\. Tell me what you need\./);
  assert.match(PERSONAS.vyomara.greeting, /^Hi, I'm Vyomara, your personal AI assistant\./);
  assert.match(PERSONAS.vyom.greeting, /AI Twins\. One Orbit\. Your Control\.$/);
  for (const persona of Object.values(PERSONAS)) assert.ok(persona.greeting.length <= 2_000);
});

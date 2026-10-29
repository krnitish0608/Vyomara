import type { DesktopChatRequest } from './contracts.ts';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseDesktopChatRequest(
  value: unknown,
  maxInputChars: number,
): DesktopChatRequest {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new Error('Chat request is invalid.');
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.some(key => key !== 'prompt' && key !== 'sessionId') ||
    typeof record.prompt !== 'string' ||
    record.prompt.trim() === '' ||
    record.prompt.length > maxInputChars ||
    (record.sessionId !== undefined &&
      (typeof record.sessionId !== 'string' || !uuidPattern.test(record.sessionId)))
  ) {
    throw new Error('Chat request is invalid or exceeds the configured input limit.');
  }

  return record.sessionId === undefined
    ? { prompt: record.prompt }
    : { prompt: record.prompt, sessionId: record.sessionId };
}

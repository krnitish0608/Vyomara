import { isAbsolute } from 'node:path';
import type { DesktopChatRequest } from './contracts.ts';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const maximumMemoryChars = 32_000;

export class DesktopValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DesktopValidationError';
  }
}

export function parseDesktopSessionId(value: unknown): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw new Error('Session request is invalid.');
  }
  return value;
}

export function parseDesktopMemoryId(value: unknown): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw new DesktopValidationError('Memory request is invalid.');
  }
  return value;
}

export function parseDesktopMemorySaveRequest(value: unknown): { readonly content: string; readonly confirmation: string } {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new DesktopValidationError('Memory save request is invalid.');
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 2 ||
    !Object.hasOwn(record, 'content') ||
    !Object.hasOwn(record, 'confirmation') ||
    typeof record.content !== 'string' ||
    record.content.trim() === '' ||
    record.content.length > maximumMemoryChars ||
    record.confirmation !== 'SAVE'
  ) {
    throw new DesktopValidationError('Review the memory and type SAVE to store it.');
  }
  return { content: record.content, confirmation: record.confirmation };
}

export function parseDesktopMemoryDeleteRequest(value: unknown): { readonly id: string; readonly confirmation: string } {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new DesktopValidationError('Memory deletion request is invalid.');
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 2 ||
    !Object.hasOwn(record, 'id') ||
    !Object.hasOwn(record, 'confirmation') ||
    record.confirmation !== 'DELETE'
  ) {
    throw new DesktopValidationError('Review the selected memory and type DELETE to remove it.');
  }
  return { id: parseDesktopMemoryId(record.id), confirmation: record.confirmation };
}

export function parseDesktopFilesystemRoot(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !isAbsolute(value) ||
    value.trim() !== value ||
    value.includes('\0') ||
    value.length > 4_096
  ) {
    throw new Error('Filesystem permission request is invalid.');
  }
  return value;
}

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

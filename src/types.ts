import type { DiagnosticEvent } from './diagnostics/logger.ts';

export interface Logger {
  emit(event: DiagnosticEvent): void;
  failure(error?: unknown): void;
}

export type DiagnosticEvent =
  | { readonly event: 'request.completed'; readonly durationMs: number; readonly iterations: number }
  | { readonly event: 'request.failed'; readonly code: string }
  | { readonly event: 'tool.completed'; readonly toolId: string; readonly durationMs: number }
  | { readonly event: 'tool.denied'; readonly toolId: string; readonly reason: string };

export type LogWriter = (line: string) => void;

export function createLogger(write: LogWriter = line => console.error(line)) {
  const emit = (event: DiagnosticEvent): void => {
    write(JSON.stringify({
      timestamp: new Date().toISOString(),
      ...event,
    }));
  };

  return {
    emit,
    failure(_error?: unknown): void {
      emit({ event: 'request.failed', code: 'request.failed' });
    },
  };
}

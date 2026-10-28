import type { SessionMessage } from '../session/session.ts';

export type ProviderResponse =
  | { readonly kind: 'final'; readonly text: string }
  | { readonly kind: 'tool-call'; readonly toolId: string; readonly input: unknown };

export interface ModelProvider {
  readonly id: string;
  complete(
    messages: readonly SessionMessage[],
    signal: AbortSignal,
  ): Promise<unknown>;
}

export class PlaceholderProvider implements ModelProvider {
  readonly id = 'deterministic-placeholder';

  async complete(
    _messages: readonly SessionMessage[],
    signal: AbortSignal,
  ): Promise<ProviderResponse> {
    if (signal.aborted) throw new Error('Request cancelled.');
    return {
      kind: 'final',
      text: '[Placeholder provider] No language model is configured; this is a deterministic skeleton response.',
    };
  }
}

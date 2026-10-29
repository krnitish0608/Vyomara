import type { DiagnosticEvent } from '../diagnostics/logger.ts';

export interface DesktopChatRequest {
  readonly prompt: string;
  readonly sessionId?: string;
}

export interface DesktopChatResponse {
  readonly response: string;
  readonly sessionId: string;
}

export interface DesktopProviderStatus {
  readonly provider: 'ollama' | 'placeholder';
  readonly model: string;
  readonly connection: 'not-checked';
}

export interface VyomaraDesktopApi {
  getProviderStatus(): Promise<DesktopProviderStatus>;
  sendMessage(request: DesktopChatRequest): Promise<DesktopChatResponse>;
  cancelRequest(): Promise<boolean>;
  onActivity(listener: (event: DiagnosticEvent) => void): () => void;
}

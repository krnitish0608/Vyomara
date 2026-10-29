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

export interface DesktopSessionSummary {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly messageCount: number;
}

export interface DesktopConversationMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface DesktopSessionHistory {
  readonly sessionId: string;
  readonly messages: readonly DesktopConversationMessage[];
}

export interface VyomaraDesktopApi {
  getProviderStatus(): Promise<DesktopProviderStatus>;
  sendMessage(request: DesktopChatRequest): Promise<DesktopChatResponse>;
  cancelRequest(): Promise<boolean>;
  listSessions(): Promise<readonly DesktopSessionSummary[]>;
  loadSession(sessionId: string): Promise<DesktopSessionHistory>;
  onActivity(listener: (event: DiagnosticEvent) => void): () => void;
}

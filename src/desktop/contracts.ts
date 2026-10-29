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

export type DesktopProviderConnectionResult =
  | { readonly status: 'available' }
  | { readonly status: 'unavailable'; readonly message: string };

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

export interface DesktopMemorySummary {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type DesktopFilesystemRootGrant =
  | { readonly status: 'cancelled'; readonly roots: readonly string[] }
  | { readonly status: 'granted'; readonly roots: readonly string[] };

export interface VyomaraDesktopApi {
  getProviderStatus(): Promise<DesktopProviderStatus>;
  checkProviderConnection(): Promise<DesktopProviderConnectionResult>;
  sendMessage(request: DesktopChatRequest): Promise<DesktopChatResponse>;
  cancelRequest(): Promise<boolean>;
  listSessions(): Promise<readonly DesktopSessionSummary[]>;
  loadSession(sessionId: string): Promise<DesktopSessionHistory>;
  listFilesystemRoots(): Promise<readonly string[]>;
  grantFilesystemRoot(): Promise<DesktopFilesystemRootGrant>;
  revokeFilesystemRoot(root: string): Promise<readonly string[]>;
  listMemories(): Promise<readonly DesktopMemorySummary[]>;
  readMemory(id: string): Promise<string>;
  saveMemory(content: string, confirmation: string): Promise<string>;
  deleteMemory(id: string, confirmation: string): Promise<boolean>;
  onActivity(listener: (event: DiagnosticEvent) => void): () => void;
}

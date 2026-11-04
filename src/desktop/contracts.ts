import type { DiagnosticEvent } from '../diagnostics/logger.ts';

export interface DesktopChatRequest {
  readonly prompt: string;
  readonly requestId: string;
  readonly sessionId?: string;
}

export interface DesktopChatTextChunk {
  readonly requestId: string;
  readonly text: string;
}

export interface DesktopChatResponse {
  readonly response: string;
  readonly sessionId: string;
}

export interface DesktopProviderStatus {
  readonly provider: 'ollama' | 'placeholder';
  readonly model: string;
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

export type DesktopSessionExportResult =
  | { readonly status: 'cancelled' }
  | { readonly status: 'exported' };

export type DesktopSpeechResult =
  | { readonly status: 'completed' }
  | { readonly status: 'cancelled' };

export type DesktopSpeechRecognitionEvent =
  | { readonly type: 'listening' }
  | { readonly type: 'partial' | 'command'; readonly transcript: string }
  | { readonly type: 'stopped' }
  | { readonly type: 'model-progress'; readonly received: number; readonly total: number }
  | { readonly type: 'model-ready' }
  | { readonly type: 'error'; readonly message: string };

export interface DesktopSpeechSetupStatus {
  readonly modelReady: boolean;
  readonly runtimeAvailable: boolean;
  readonly listeningEnabled: boolean;
}

export interface VyomaraDesktopApi {
  getProviderStatus(): Promise<DesktopProviderStatus>;
  sendMessage(request: DesktopChatRequest): Promise<DesktopChatResponse>;
  onChatText(listener: (chunk: DesktopChatTextChunk) => void): () => void;
  cancelRequest(): Promise<boolean>;
  listSessions(): Promise<readonly DesktopSessionSummary[]>;
  loadSession(sessionId: string): Promise<DesktopSessionHistory>;
  exportSession(sessionId: string): Promise<DesktopSessionExportResult>;
  deleteSession(sessionId: string, confirmation: string): Promise<boolean>;
  getSpeechSetupStatus(): Promise<DesktopSpeechSetupStatus>;
  downloadSpeechModel(): Promise<void>;
  setSpeechListening(enabled: boolean): Promise<DesktopSpeechSetupStatus>;
  onSpeechRecognition(listener: (event: DesktopSpeechRecognitionEvent) => void): () => void;
  speakText(text: string): Promise<DesktopSpeechResult>;
  stopSpeaking(): Promise<boolean>;
  onActivity(listener: (event: DiagnosticEvent) => void): () => void;
}

import type { DiagnosticEvent } from '../diagnostics/logger.ts';
import type { ActionProposal } from '../tools/action-tools.ts';

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

export type FileOperationKind = 'create-file' | 'create-directory' | 'edit-file' | 'delete';

export interface FileOperationRequest {
  readonly operation: FileOperationKind;
  readonly path: string;
  readonly content?: string;
  readonly replacement?: {
    readonly find: string;
    readonly replace: string;
    /** Replace every occurrence instead of requiring exactly one. */
    readonly all?: true;
  };
}

export interface DesktopFileOperationProposal {
  readonly id: string;
  readonly operation: FileOperationKind;
  readonly path: string;
  readonly targetType: 'file' | 'directory';
  readonly currentContent?: string;
  readonly proposedContent?: string;
}

/** A command, application launch, or web page awaiting the user's approval. */
export type DesktopActionProposal = ActionProposal & { readonly id: string };

/** A short, human-readable description of what the agent is doing right now. */
export interface DesktopToolActivity {
  readonly requestId: string;
  readonly id: string;
  readonly toolId: string;
  readonly label: string;
  readonly status: 'running' | 'done' | 'failed' | 'rejected';
  readonly detail?: string;
}

export interface DesktopModelInfo {
  readonly name: string;
  readonly sizeBytes?: number;
  readonly parameterSize?: string;
  readonly family?: string;
}

export interface DesktopModelList {
  readonly current: string;
  readonly models: readonly DesktopModelInfo[];
}

export interface DesktopModelPullProgress {
  readonly model: string;
  readonly status: string;
  readonly completed?: number;
  readonly total?: number;
}

export type FileOperationResult =
  | { readonly status: 'applied' }
  | { readonly status: 'rejected' };

export interface FileOperationApprovalPort {
  request(request: FileOperationRequest, signal: AbortSignal): Promise<FileOperationResult>;
}

export interface DesktopProviderStatus {
  readonly provider: 'ollama' | 'placeholder';
  readonly model: string;
  readonly contextTokens: number;
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
  onFileOperationProposal(listener: (proposal: DesktopFileOperationProposal) => void): () => void;
  approveFileOperation(id: string, confirmation?: string): Promise<void>;
  rejectFileOperation(id: string): Promise<void>;
  onActionProposal(listener: (proposal: DesktopActionProposal) => void): () => void;
  approveAction(id: string): Promise<void>;
  rejectAction(id: string): Promise<void>;
  onToolActivity(listener: (activity: DesktopToolActivity) => void): () => void;
  listModels(): Promise<DesktopModelList>;
  selectModel(model: string): Promise<DesktopProviderStatus>;
  pullModel(model: string): Promise<void>;
  onModelPullProgress(listener: (progress: DesktopModelPullProgress) => void): () => void;
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

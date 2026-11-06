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

/** The agent's live checklist for the current request. */
export interface DesktopPlan {
  readonly requestId: string;
  readonly steps: readonly { readonly text: string; readonly status: 'pending' | 'in_progress' | 'done' }[];
}

/** A permission granted once that skips future approvals for that kind of action. */
export interface DesktopPermission {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
}

export interface DesktopPermissions {
  readonly grants: readonly DesktopPermission[];
}

export interface DesktopModelInfo {
  readonly name: string;
  readonly sizeBytes?: number;
  readonly parameterSize?: string;
  readonly family?: string;
  /** e.g. "completion", "tools", "thinking", "vision". */
  readonly capabilities: readonly string[];
  /** The model's maximum context window in tokens, when Ollama reports it. */
  readonly contextLength?: number;
}

export interface DesktopModelSettings {
  readonly numCtx: number;
  readonly think: boolean;
}

export interface DesktopModelList {
  /** False when the local Ollama service is not running. */
  readonly available: boolean;
  readonly current: string;
  readonly models: readonly DesktopModelInfo[];
  readonly settings: DesktopModelSettings;
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

export interface DesktopSpeechModel {
  readonly id: 'fast' | 'best';
  readonly label: string;
  readonly approxMegabytes: number;
  readonly ready: boolean;
}

export interface DesktopSpeechSetupStatus {
  readonly modelReady: boolean;
  readonly runtimeAvailable: boolean;
  readonly listeningEnabled: boolean;
  /** The speech model in use. */
  readonly model: 'fast' | 'best';
  readonly models: readonly DesktopSpeechModel[];
}

/** What the mini window (PiP) shows; published by the main window, which owns the conversation. */
export interface DesktopPipState {
  readonly listening: boolean;
  readonly voiceReady: boolean;
  readonly busy: boolean;
  /** One line: what Vyom is doing or waiting for. */
  readonly status: string;
  /** The last phrase heard by the microphone. */
  readonly heard?: string;
  /** A short version of the last reply. */
  readonly reply?: string;
  readonly plan?: { readonly done: number; readonly total: number };
  /** The approval waiting for the user, if any. */
  readonly approval?: {
    readonly id: string;
    readonly question: string;
    /** Deletions must be confirmed in the main window (typed DELETE). */
    readonly needsMainWindow: boolean;
  };
}

export type DesktopPipCommand =
  | { readonly type: 'toggle-listening' }
  | { readonly type: 'approve'; readonly id: string }
  | { readonly type: 'reject'; readonly id: string }
  | { readonly type: 'stop' }
  | { readonly type: 'open-main' };

export interface VyomaraDesktopApi {
  /** Main window → mini window. */
  publishPipState(state: DesktopPipState): void;
  onPipState(listener: (state: DesktopPipState) => void): () => void;
  /** Mini window → main window. */
  sendPipCommand(command: DesktopPipCommand): void;
  onPipCommand(listener: (command: DesktopPipCommand) => void): () => void;
  getProviderStatus(): Promise<DesktopProviderStatus>;
  sendMessage(request: DesktopChatRequest): Promise<DesktopChatResponse>;
  onChatText(listener: (chunk: DesktopChatTextChunk) => void): () => void;
  onFileOperationProposal(listener: (proposal: DesktopFileOperationProposal) => void): () => void;
  approveFileOperation(id: string, confirmation?: string): Promise<void>;
  rejectFileOperation(id: string): Promise<void>;
  onActionProposal(listener: (proposal: DesktopActionProposal) => void): () => void;
  /** `always` remembers an approved command for this folder until the app quits. */
  approveAction(id: string, always?: boolean): Promise<void>;
  rejectAction(id: string): Promise<void>;
  onToolActivity(listener: (activity: DesktopToolActivity) => void): () => void;
  listPermissions(): Promise<DesktopPermissions>;
  /** Grant IDs look like "app:Visual Studio Code", "browser:Google Chrome", "host:react.dev". */
  grantPermission(id: string): Promise<DesktopPermissions>;
  revokePermission(id: string): Promise<DesktopPermissions>;
  onPlan(listener: (plan: DesktopPlan) => void): () => void;
  listModels(): Promise<DesktopModelList>;
  selectModel(model: string): Promise<DesktopProviderStatus>;
  pullModel(model: string): Promise<void>;
  setModelSettings(settings: Partial<DesktopModelSettings>): Promise<DesktopProviderStatus>;
  /** Removes an installed model; requires confirmation "DELETE". */
  deleteModel(model: string, confirmation: string): Promise<void>;
  /** Opens the Ollama app and waits until it responds. */
  startOllama(): Promise<void>;
  onModelPullProgress(listener: (progress: DesktopModelPullProgress) => void): () => void;
  cancelRequest(): Promise<boolean>;
  listSessions(): Promise<readonly DesktopSessionSummary[]>;
  loadSession(sessionId: string): Promise<DesktopSessionHistory>;
  exportSession(sessionId: string): Promise<DesktopSessionExportResult>;
  deleteSession(sessionId: string, confirmation: string): Promise<boolean>;
  getSpeechSetupStatus(): Promise<DesktopSpeechSetupStatus>;
  /** Downloads the selected speech model. */
  downloadSpeechModel(): Promise<void>;
  selectSpeechModel(model: 'fast' | 'best'): Promise<DesktopSpeechSetupStatus>;
  setSpeechListening(enabled: boolean): Promise<DesktopSpeechSetupStatus>;
  onSpeechRecognition(listener: (event: DesktopSpeechRecognitionEvent) => void): () => void;
  speakText(text: string): Promise<DesktopSpeechResult>;
  stopSpeaking(): Promise<boolean>;
  onActivity(listener: (event: DiagnosticEvent) => void): () => void;
}

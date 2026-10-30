import type { DiagnosticEvent } from '../diagnostics/logger.ts';

export interface DesktopChatRequest {
  readonly prompt: string;
  readonly sessionId?: string;
}

export interface DesktopChatResponse {
  readonly response: string;
  readonly sessionId: string;
  readonly editProposals?: readonly DesktopEditProposal[];
}

export interface DesktopEditProposal {
  readonly id: string;
  readonly path: string;
  readonly diff: string;
}

export interface DesktopEditApplyResult {
  readonly path: string;
  readonly status: 'applied';
}

export interface DesktopProviderStatus {
  readonly provider: 'ollama' | 'placeholder';
  readonly model: string;
  readonly connection: 'not-checked';
}

export interface DesktopProviderSettings {
  readonly provider: 'ollama' | 'placeholder';
  readonly model: string;
}

export type DesktopProviderConnectionResult =
  | { readonly status: 'available' }
  | { readonly status: 'unavailable'; readonly message: string };

export type DesktopProviderModelCheckResult =
  | { readonly status: 'installed' }
  | { readonly status: 'not-installed'; readonly message: string }
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

export type DesktopSessionExportResult =
  | { readonly status: 'cancelled' }
  | { readonly status: 'exported' };

export type DesktopMemoryExportResult =
  | { readonly status: 'cancelled' }
  | { readonly status: 'exported' };

export type DesktopBackupResult =
  | { readonly status: 'cancelled' }
  | { readonly status: 'exported' };

export interface DesktopMemorySummary {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DesktopDeleteAllHistoryResult {
  readonly sessionsDeleted: number;
  readonly memoriesDeleted: number;
}

export interface DesktopBackupRestorePreview {
  readonly fileName: string;
  readonly sessions: number;
  readonly memories: number;
}

export interface DesktopBackupRestoreResult extends DesktopBackupRestorePreview {
  readonly safetyBackupName: string;
}

export type DesktopApprovedCheckId = 'test' | 'typecheck' | 'build:desktop' | 'test:desktop-ui';

export interface DesktopApprovedCheckResult {
  readonly checkId: DesktopApprovedCheckId;
  readonly command: string;
  readonly status: 'passed' | 'failed' | 'cancelled' | 'timed-out' | 'output-limit';
  readonly exitCode: number | null;
  readonly output: string;
  readonly durationMs: number;
}

export type DesktopAppAction =
  | { readonly type: 'open-vscode'; readonly projectDirectory?: string }
  | { readonly type: 'open-chrome' }
  | { readonly type: 'search-chrome'; readonly query: string };

export interface DesktopAppActionResult {
  readonly application: 'Visual Studio Code' | 'Google Chrome';
  readonly action: 'opened' | 'search-opened';
  readonly searchUrl?: string;
}

export type DesktopSpeechResult =
  | { readonly status: 'completed' }
  | { readonly status: 'cancelled' };

export type DesktopFilesystemRootGrant =
  | { readonly status: 'cancelled'; readonly roots: readonly string[] }
  | { readonly status: 'granted'; readonly roots: readonly string[] };

export interface VyomaraDesktopApi {
  getProviderStatus(): Promise<DesktopProviderStatus>;
  saveProviderSettings(settings: DesktopProviderSettings): Promise<DesktopProviderStatus>;
  resetProviderSettings(): Promise<DesktopProviderStatus>;
  checkProviderConnection(): Promise<DesktopProviderConnectionResult>;
  checkProviderModel(model: string): Promise<DesktopProviderModelCheckResult>;
  sendMessage(request: DesktopChatRequest): Promise<DesktopChatResponse>;
  applyEditProposal(id: string): Promise<DesktopEditApplyResult>;
  rejectEditProposal(id: string): Promise<boolean>;
  cancelRequest(): Promise<boolean>;
  listSessions(): Promise<readonly DesktopSessionSummary[]>;
  loadSession(sessionId: string): Promise<DesktopSessionHistory>;
  exportSession(sessionId: string): Promise<DesktopSessionExportResult>;
  deleteSession(sessionId: string, confirmation: string): Promise<boolean>;
  listFilesystemRoots(): Promise<readonly string[]>;
  grantFilesystemRoot(): Promise<DesktopFilesystemRootGrant>;
  revokeFilesystemRoot(root: string): Promise<readonly string[]>;
  listMemories(): Promise<readonly DesktopMemorySummary[]>;
  readMemory(id: string): Promise<string>;
  exportMemory(id: string): Promise<DesktopMemoryExportResult>;
  saveMemory(content: string, confirmation: string): Promise<string>;
  deleteMemory(id: string, confirmation: string): Promise<boolean>;
  deleteAllHistoryAndMemories(confirmation: string): Promise<DesktopDeleteAllHistoryResult>;
  backupLocalData(): Promise<DesktopBackupResult>;
  selectBackupForRestore(): Promise<DesktopBackupRestorePreview | undefined>;
  restoreLocalData(confirmation: string): Promise<DesktopBackupRestoreResult>;
  selectCheckProject(): Promise<string | undefined>;
  runApprovedCheck(checkId: DesktopApprovedCheckId): Promise<DesktopApprovedCheckResult>;
  cancelApprovedCheck(): Promise<boolean>;
  runDesktopAppAction(action: DesktopAppAction): Promise<DesktopAppActionResult>;
  requestMicrophoneAccess(): Promise<boolean>;
  speakText(text: string): Promise<DesktopSpeechResult>;
  stopSpeaking(): Promise<boolean>;
  onActivity(listener: (event: DiagnosticEvent) => void): () => void;
}

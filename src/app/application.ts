import { realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute, join } from 'node:path';
import type { AppConfig } from '../config/config.ts';
import { validateOllamaModel } from '../config/config.ts';
import type { Logger } from '../types.ts';
import type { SessionMessage } from '../session/session.ts';
import { runAgent } from '../agent/agent.ts';
import { OllamaProvider, PlaceholderProvider } from '../providers/provider.ts';
import { SqliteStore } from '../storage/sqlite-store.ts';
import type {
  DesktopConversationMessage,
  DesktopMemorySummary,
  DesktopProviderSettings,
  DesktopProviderStatus,
  DesktopSessionHistory,
  DesktopSessionSummary,
} from '../desktop/contracts.ts';
import { createDefaultToolRegistry } from '../tools/default-tools.ts';
import { ToolExecutor } from '../tools/executor.ts';
import { PolicyGateway } from '../tools/policy.ts';
import { withPersistentAudit } from '../diagnostics/persistent-logger.ts';
import type { DesktopEditProposal } from '../desktop/contracts.ts';
import type { EditProposalManager } from '../desktop/edit-proposals.ts';

export interface RequestResult {
  readonly response: string;
  readonly sessionId: string;
  readonly editProposals?: readonly DesktopEditProposal[];
}

export function initializeDesktopFilesystemRoots(config: AppConfig): AppConfig {
  const store = new SqliteStore(config.dataDirectory);
  try {
    return { ...config, filesystemAllowedRoots: store.initializeFilesystemRoots(config.filesystemAllowedRoots) };
  } finally {
    store.close();
  }
}

export function initializeDesktopProviderSettings(config: AppConfig): AppConfig {
  const store = new SqliteStore(config.dataDirectory);
  try {
    const provider = store.getAppSetting('provider');
    const model = store.getAppSetting('ollama-model');
    if (provider === undefined && model === undefined) return config;
    if (
      (provider !== 'ollama' && provider !== 'placeholder') ||
      model === undefined
    ) {
      throw new Error('Saved provider settings are incomplete or invalid.');
    }
    try {
      return { ...config, provider, ollamaModel: validateOllamaModel(model) };
    } catch {
      throw new Error('Saved provider settings are invalid.');
    }
  } finally {
    store.close();
  }
}

export function saveDesktopProviderSettings(
  config: AppConfig,
  settings: DesktopProviderSettings,
): { readonly config: AppConfig; readonly status: DesktopProviderStatus } {
  const model = validateOllamaModel(settings.model);
  const store = new SqliteStore(config.dataDirectory);
  try {
    store.setAppSettings({ provider: settings.provider, 'ollama-model': model });
  } finally {
    store.close();
  }
  const updated = { ...config, provider: settings.provider, ollamaModel: model };
  return {
    config: updated,
    status: { provider: updated.provider, model: updated.ollamaModel, connection: 'not-checked' },
  };
}

export function resetDesktopProviderSettings(
  config: AppConfig,
  defaults: AppConfig,
): { readonly config: AppConfig; readonly status: DesktopProviderStatus } {
  const store = new SqliteStore(config.dataDirectory);
  try {
    store.deleteAppSettings(['provider', 'ollama-model']);
  } finally {
    store.close();
  }
  const updated = {
    ...config,
    provider: defaults.provider,
    ollamaModel: defaults.ollamaModel,
  };
  return {
    config: updated,
    status: { provider: updated.provider, model: updated.ollamaModel, connection: 'not-checked' },
  };
}

export async function grantDesktopFilesystemRoot(config: AppConfig, selectedPath: string): Promise<AppConfig> {
  if (
    !isAbsolute(selectedPath) ||
    selectedPath.trim() !== selectedPath ||
    selectedPath.includes('\0') ||
    selectedPath.length > 4_096
  ) {
    throw new Error('The selected folder path is invalid.');
  }
  let canonicalPath: string;
  try {
    canonicalPath = await realpath(selectedPath);
    if (!(await stat(canonicalPath)).isDirectory()) {
      throw new Error('The selected item is not a folder.');
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'The selected item is not a folder.') throw error;
    throw new Error('The selected folder is unavailable or cannot be accessed.');
  }

  const store = new SqliteStore(config.dataDirectory);
  try {
    return { ...config, filesystemAllowedRoots: store.addFilesystemRoot(canonicalPath) };
  } finally {
    store.close();
  }
}

export function revokeDesktopFilesystemRoot(config: AppConfig, root: string): AppConfig {
  const store = new SqliteStore(config.dataDirectory);
  try {
    return { ...config, filesystemAllowedRoots: store.removeFilesystemRoot(root) };
  } finally {
    store.close();
  }
}

export function readDesktopMemories(config: AppConfig): readonly DesktopMemorySummary[] {
  const store = new SqliteStore(config.dataDirectory);
  try {
    return store.listMemories();
  } finally {
    store.close();
  }
}

export function readDesktopMemory(config: AppConfig, id: string): string {
  const store = new SqliteStore(config.dataDirectory);
  try {
    return store.getMemory(id);
  } finally {
    store.close();
  }
}

export function exportDesktopMemory(config: AppConfig, id: string): string {
  const content = readDesktopMemory(config, id);
  return `${JSON.stringify({
    format: 'vyomara-memory',
    version: 1,
    memoryId: id,
    exportedAt: new Date().toISOString(),
    content,
  }, null, 2)}\n`;
}

export function saveDesktopMemory(config: AppConfig, content: string): string {
  const store = new SqliteStore(config.dataDirectory);
  try {
    return store.saveMemory(content);
  } finally {
    store.close();
  }
}

export function deleteDesktopMemory(config: AppConfig, id: string): boolean {
  const store = new SqliteStore(config.dataDirectory);
  try {
    return store.deleteMemory(id);
  } finally {
    store.close();
  }
}

export function deleteAllDesktopSessionsAndMemories(config: AppConfig): {
  readonly sessionsDeleted: number;
  readonly memoriesDeleted: number;
} {
  const store = new SqliteStore(config.dataDirectory);
  try {
    return store.deleteAllSessionsAndMemories();
  } finally {
    store.close();
  }
}

export function exportDesktopBackup(config: AppConfig, destination: string): void {
  const store = new SqliteStore(config.dataDirectory);
  try {
    store.exportBackup(destination);
  } finally {
    store.close();
  }
}

export function inspectDesktopBackup(config: AppConfig, sourcePath: string): {
  readonly fileName: string;
  readonly sessions: number;
  readonly memories: number;
} {
  const store = new SqliteStore(config.dataDirectory);
  try {
    return { fileName: basename(sourcePath), ...store.inspectBackup(sourcePath) };
  } finally {
    store.close();
  }
}

export function restoreDesktopBackup(config: AppConfig, sourcePath: string): {
  readonly fileName: string;
  readonly sessions: number;
  readonly memories: number;
  readonly safetyBackupName: string;
} {
  const store = new SqliteStore(config.dataDirectory);
  const safetyBackupPath = join(
    config.dataDirectory,
    `vyomara-pre-restore-${new Date().toISOString().replaceAll(':', '-')}.sqlite`,
  );
  try {
    const summary = store.restoreBackup(sourcePath, safetyBackupPath);
    return {
      fileName: basename(sourcePath),
      ...summary,
      safetyBackupName: basename(safetyBackupPath),
    };
  } finally {
    store.close();
  }
}

export function readDesktopSessions(config: AppConfig): readonly DesktopSessionSummary[] {
  const store = new SqliteStore(config.dataDirectory);
  try {
    return store.listSessions();
  } finally {
    store.close();
  }
}

export function deleteDesktopSession(config: AppConfig, sessionId: string): boolean {
  const store = new SqliteStore(config.dataDirectory);
  try {
    return store.deleteSession(sessionId);
  } finally {
    store.close();
  }
}

export function readDesktopSession(config: AppConfig, sessionId: string): DesktopSessionHistory {
  const store = new SqliteStore(config.dataDirectory);
  try {
    const messages: DesktopConversationMessage[] = [];
    for (const message of store.getSession(sessionId).messages()) {
      if (message.role === 'user') {
        messages.push({ role: 'user', content: message.content });
      } else if (message.role === 'assistant' && message.kind !== 'tool-call') {
        messages.push({ role: 'assistant', content: message.content });
      }
    }
    return { sessionId, messages };
  } finally {
    store.close();
  }
}

export function exportDesktopSession(config: AppConfig, sessionId: string): string {
  const store = new SqliteStore(config.dataDirectory);
  try {
    const messages: readonly SessionMessage[] = store.getSession(sessionId).messages();
    return `${JSON.stringify({
      format: 'vyomara-session',
      version: 1,
      sessionId,
      exportedAt: new Date().toISOString(),
      messages,
    }, null, 2)}\n`;
  } finally {
    store.close();
  }
}

export async function runRequest(
  prompt: string,
  signal: AbortSignal,
  config: AppConfig,
  logger: Logger,
  sessionId?: string,
  editProposals?: EditProposalManager,
): Promise<RequestResult> {
  const store = new SqliteStore(config.dataDirectory);
  try {
    const session = sessionId === undefined
      ? store.createSession()
      : store.getSession(sessionId);
    const taskLogger = withPersistentAudit(logger, store);
    const provider = config.provider === 'ollama'
      ? new OllamaProvider({
        baseUrl: config.ollamaBaseUrl,
        model: config.ollamaModel,
        maxResponseChars: config.maxResponseChars,
        maxToolCallArgumentsChars: config.maxToolOutputChars,
      })
      : new PlaceholderProvider();
    const tools = new ToolExecutor({
      registry: createDefaultToolRegistry(config, editProposals),
      policy: new PolicyGateway(),
      config,
      logger: taskLogger,
    });

    let response: string | undefined;
    let requestError: unknown;
    try {
      response = await runAgent(prompt, signal, {
        provider,
        tools,
        config,
        session,
        logger: taskLogger,
      });
    } catch (error) {
      requestError = error;
    }

    let historyError: unknown;
    try {
      store.saveSession(session);
    } catch (error) {
      historyError = error;
    }
    if (requestError !== undefined && historyError !== undefined) {
      throw new AggregateError(
        [requestError, historyError],
        'The request failed and its local history could not be saved.',
      );
    }
    if (requestError !== undefined) throw requestError;
    if (historyError !== undefined) throw historyError;
    if (response === undefined) {
      throw new Error('The request ended without a response.');
    }
    return {
      response,
      sessionId: session.id,
      ...(editProposals && editProposals.list().length > 0
        ? { editProposals: editProposals.list() }
        : {}),
    };
  } finally {
    store.close();
  }
}

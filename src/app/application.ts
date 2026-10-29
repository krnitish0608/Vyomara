import { realpath, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type { AppConfig } from '../config/config.ts';
import type { Logger } from '../types.ts';
import { runAgent } from '../agent/agent.ts';
import { OllamaProvider, PlaceholderProvider } from '../providers/provider.ts';
import { SqliteStore } from '../storage/sqlite-store.ts';
import type {
  DesktopConversationMessage,
  DesktopMemorySummary,
  DesktopSessionHistory,
  DesktopSessionSummary,
} from '../desktop/contracts.ts';
import { createDefaultToolRegistry } from '../tools/default-tools.ts';
import { ToolExecutor } from '../tools/executor.ts';
import { PolicyGateway } from '../tools/policy.ts';
import { withPersistentAudit } from '../diagnostics/persistent-logger.ts';

export interface RequestResult {
  readonly response: string;
  readonly sessionId: string;
}

export function initializeDesktopFilesystemRoots(config: AppConfig): AppConfig {
  const store = new SqliteStore(config.dataDirectory);
  try {
    return { ...config, filesystemAllowedRoots: store.initializeFilesystemRoots(config.filesystemAllowedRoots) };
  } finally {
    store.close();
  }
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

export function readDesktopSessions(config: AppConfig): readonly DesktopSessionSummary[] {
  const store = new SqliteStore(config.dataDirectory);
  try {
    return store.listSessions();
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

export async function runRequest(
  prompt: string,
  signal: AbortSignal,
  config: AppConfig,
  logger: Logger,
  sessionId?: string,
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
      registry: createDefaultToolRegistry(config),
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
    return { response, sessionId: session.id };
  } finally {
    store.close();
  }
}

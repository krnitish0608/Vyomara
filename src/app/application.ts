import type { AppConfig } from '../config/config.ts';
import type { Logger } from '../types.ts';
import { runAgent } from '../agent/agent.ts';
import { OllamaProvider, PlaceholderProvider } from '../providers/provider.ts';
import { SqliteStore } from '../storage/sqlite-store.ts';
import { createDefaultToolRegistry } from '../tools/default-tools.ts';
import { ToolExecutor } from '../tools/executor.ts';
import { PolicyGateway } from '../tools/policy.ts';
import { withPersistentAudit } from '../diagnostics/persistent-logger.ts';

export interface RequestResult {
  readonly response: string;
  readonly sessionId: string;
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

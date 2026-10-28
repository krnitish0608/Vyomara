import type { AppConfig } from '../config/config.ts';
import type { Logger } from '../types.ts';
import type { ModelProvider, ProviderResponse } from '../providers/provider.ts';
import { OperationStoppedError, runBounded } from '../shared/bounded.ts';
import { Session } from '../session/session.ts';
import { ToolExecutionError, ToolExecutor } from '../tools/executor.ts';

export class AgentError extends Error {
  readonly code: 'invalid-request' | 'timeout' | 'cancelled' | 'iteration-limit' | 'tool-limit' | 'policy-denied' | 'invalid-provider-response';

  constructor(
    message: string,
    code: AgentError['code'],
  ) {
    super(message);
    this.name = 'AgentError';
    this.code = code;
  }
}

function parseProviderResponse(value: unknown, maxTextChars: number): ProviderResponse {
  if (typeof value !== 'object' || value === null) {
    throw new AgentError('Provider returned an invalid response.', 'invalid-provider-response');
  }
  const response = value as Record<string, unknown>;
  if (response.kind === 'final' && typeof response.text === 'string' && response.text.length <= maxTextChars) {
    return { kind: 'final', text: response.text };
  }
  if (
    response.kind === 'tool-call' &&
    typeof response.toolId === 'string' &&
    response.toolId.length <= 64 &&
    Object.hasOwn(response, 'input')
  ) {
    return { kind: 'tool-call', toolId: response.toolId, input: response.input };
  }
  throw new AgentError('Provider returned an invalid response.', 'invalid-provider-response');
}

export interface AgentOptions {
  readonly provider: ModelProvider;
  readonly tools: ToolExecutor;
  readonly config: AppConfig;
  readonly session: Session;
  readonly logger: Logger;
}

export async function runAgent(
  prompt: string,
  signal: AbortSignal,
  options: AgentOptions,
): Promise<string> {
  if (!prompt.trim() || prompt.length > options.config.maxInputChars) {
    throw new AgentError('Request is empty or exceeds the configured input limit.', 'invalid-request');
  }
  options.session.add({ role: 'user', content: prompt });
  const start = Date.now();
  let toolCalls = 0;

  for (let iteration = 1; iteration <= options.config.maxAgentIterations; iteration++) {
    let rawResponse: unknown;
    try {
      rawResponse = await runBounded(
        providerSignal => options.provider.complete(options.session.messages(), providerSignal),
        options.config.requestTimeoutMs,
        signal,
      );
    } catch (error) {
      if (error instanceof OperationStoppedError) {
        throw new AgentError(error.message, error.reason);
      }
      throw error;
    }
    const response = parseProviderResponse(rawResponse, options.config.maxToolOutputChars);
    if (response.kind === 'final') {
      options.session.add({ role: 'assistant', content: response.text });
      options.logger.emit({
        event: 'request.completed',
        durationMs: Date.now() - start,
        iterations: iteration,
      });
      return response.text;
    }

    if (toolCalls >= options.config.maxToolCalls) {
      throw new AgentError('Tool call limit reached.', 'tool-limit');
    }
    toolCalls++;
    options.session.add({
      role: 'assistant',
      content: JSON.stringify({ kind: response.kind, toolId: response.toolId }),
    });
    try {
      const result = await options.tools.execute(response.toolId, response.input, signal);
      options.session.add({ role: 'tool', content: JSON.stringify(result) });
    } catch (error) {
      if (error instanceof ToolExecutionError && error.code === 'policy-denied') {
        throw new AgentError('Requested tool was denied by policy.', 'policy-denied');
      }
      throw error;
    }
  }

  throw new AgentError('Agent iteration limit reached without a final response.', 'iteration-limit');
}

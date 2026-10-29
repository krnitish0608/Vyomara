import type { AppConfig } from '../config/config.ts';
import type { Logger } from '../types.ts';
import { OperationStoppedError, runBounded } from '../shared/bounded.ts';
import { PolicyGateway } from './policy.ts';
import { ToolRegistry } from './contracts.ts';
import { ToolFailure } from './contracts.ts';
import type { ModelToolDefinition } from './contracts.ts';

type ToolExecutionErrorCode =
  | 'unknown-tool'
  | 'invalid-input'
  | 'input-too-large'
  | 'policy-denied'
  | 'invalid-output'
  | 'output-too-large'
  | 'timeout'
  | 'cancelled'
  | 'not-found'
  | 'invalid-path'
  | 'outside-root'
  | 'permission-denied'
  | 'unsupported-operation'
  | 'tool-failed';

export class ToolExecutionError extends Error {
  readonly code: ToolExecutionErrorCode;

  constructor(
    message: string,
    code: ToolExecutionErrorCode,
  ) {
    super(message);
    this.name = 'ToolExecutionError';
    this.code = code;
  }
}

export interface ToolExecutorOptions {
  readonly registry: ToolRegistry;
  readonly policy: PolicyGateway;
  readonly config: AppConfig;
  readonly logger: Logger;
}

export class ToolExecutor {
  private readonly options: ToolExecutorOptions;

  constructor(options: ToolExecutorOptions) {
    this.options = options;
  }

  modelTools(): readonly ModelToolDefinition[] {
    return this.options.registry.modelTools();
  }

  async execute(toolId: string, input: unknown, signal: AbortSignal): Promise<unknown> {
    const tool = this.options.registry.get(toolId);
    if (!tool) throw new ToolExecutionError('This capability is not available.', 'unknown-tool');
    if (!tool.validateInput(input)) {
      throw new ToolExecutionError(
        tool.inputError?.(input) ?? 'Tool arguments were invalid; no operation was performed.',
        'invalid-input',
      );
    }
    let serializedInput: string | undefined;
    try {
      serializedInput = JSON.stringify(input);
    } catch {
      throw new ToolExecutionError('Tool input could not be serialized.', 'invalid-input');
    }
    if (serializedInput === undefined || serializedInput.length > this.options.config.maxToolOutputChars) {
      throw new ToolExecutionError(
        'Tool arguments exceeded the configured limit; no operation was performed.',
        'input-too-large',
      );
    }

    const decision = this.options.policy.authorize(tool.effect);
    if (!decision.allowed) {
      this.options.logger.emit({
        event: 'tool.denied',
        toolId,
        reason: decision.reason,
      });
      throw new ToolExecutionError('Tool execution is denied by policy.', 'policy-denied');
    }

    const start = Date.now();
    try {
      const result = await runBounded(
        toolSignal => tool.run(input, toolSignal),
        this.options.config.toolTimeoutMs,
        signal,
      );
      if (!tool.validateOutput(result)) {
        throw new ToolExecutionError('Tool output did not match its schema.', 'invalid-output');
      }
      let serialized: string | undefined;
      try {
        serialized = JSON.stringify(result);
      } catch {
        throw new ToolExecutionError('Tool output could not be serialized.', 'invalid-output');
      }
      if (serialized === undefined) {
        throw new ToolExecutionError('Tool output could not be serialized.', 'invalid-output');
      }
      if (serialized.length > this.options.config.maxToolOutputChars) {
        throw new ToolExecutionError('Tool output exceeded the configured limit.', 'output-too-large');
      }
      this.options.logger.emit({
        event: 'tool.completed',
        toolId,
        durationMs: Date.now() - start,
      });
      return result;
    } catch (error) {
      if (error instanceof OperationStoppedError) {
        throw new ToolExecutionError(
          error.message,
          error.reason,
        );
      }
      if (error instanceof ToolFailure) {
        throw new ToolExecutionError(error.message, error.code);
      }
      throw error;
    }
  }
}

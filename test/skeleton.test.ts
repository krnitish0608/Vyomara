import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentError, runAgent } from '../src/agent/agent.ts';
import { loadConfig } from '../src/config/config.ts';
import { createLogger } from '../src/diagnostics/logger.ts';
import type { ModelProvider, ProviderResponse } from '../src/providers/provider.ts';
import { PlaceholderProvider } from '../src/providers/provider.ts';
import { Session } from '../src/session/session.ts';
import type { Tool } from '../src/tools/contracts.ts';
import { ToolRegistry } from '../src/tools/contracts.ts';
import { ToolExecutionError, ToolExecutor } from '../src/tools/executor.ts';
import { PolicyGateway } from '../src/tools/policy.ts';
import type { Logger } from '../src/types.ts';

function config(overrides: Partial<ReturnType<typeof loadConfig>> = {}) {
  return { ...loadConfig({}), ...overrides };
}

function loggerWithLines() {
  const lines: string[] = [];
  return { logger: createLogger(line => lines.push(line)), lines };
}

function executor(
  registry: ToolRegistry,
  currentConfig = config(),
  currentLogger: Logger = createLogger(() => {}),
) {
  return new ToolExecutor({
    registry,
    policy: new PolicyGateway(),
    config: currentConfig,
    logger: currentLogger,
  });
}

function simpleTool(
  overrides: Partial<Tool<{ value: string }, string>> = {},
): Tool<{ value: string }, string> {
  return {
    id: 'test.echo',
    effect: 'read',
    validateInput: (value): value is { value: string } =>
      typeof value === 'object' && value !== null &&
      'value' in value && typeof value.value === 'string',
    validateOutput: (value): value is string => typeof value === 'string',
    async run(input) {
      return input.value;
    },
    ...overrides,
  };
}

function agentOptions(
  provider: ModelProvider,
  currentConfig = config(),
  currentLogger: Logger = createLogger(() => {}),
  registry = new ToolRegistry(),
) {
  return {
    provider,
    tools: executor(registry, currentConfig, currentLogger),
    config: currentConfig,
    session: new Session(),
    logger: currentLogger,
  };
}

test('configuration uses safe defaults and rejects invalid values without echoing them', () => {
  assert.equal(loadConfig({}).provider, 'placeholder');
  assert.equal(loadConfig({}).maxAgentIterations, 3);
  assert.throws(
    () => loadConfig({ VYOM_PROVIDER: 'secret-provider-token' }),
    error => error instanceof Error &&
      error.message.includes('VYOM_PROVIDER') &&
      !error.message.includes('secret-provider-token'),
  );
  assert.throws(() => loadConfig({ VYOM_MAX_TOOL_CALLS: '999999' }), /VYOM_MAX_TOOL_CALLS/);
});

test('placeholder provider is deterministic and clearly not an LLM', async () => {
  const provider = new PlaceholderProvider();
  const response = await provider.complete(
    [{ role: 'user', content: 'private prompt' }],
    new AbortController().signal,
  );
  assert.deepEqual(response, {
    kind: 'final',
    text: '[Placeholder provider] No language model is configured; this is a deterministic skeleton response.',
  });
  assert.equal(provider.id, 'deterministic-placeholder');
});

test('session keeps temporary messages in memory and returns defensive copies', () => {
  const session = new Session();
  session.add({ role: 'user', content: 'hello' });
  const messages = session.messages();
  assert.deepEqual(messages, [{ role: 'user', content: 'hello' }]);
  (messages as { role: 'user'; content: string }[])[0]!.content = 'changed';
  assert.equal(session.messages()[0]?.content, 'hello');
});

test('tool registry rejects duplicate IDs', () => {
  const registry = new ToolRegistry();
  registry.register(simpleTool());
  assert.throws(() => registry.register(simpleTool()), /already registered/);
});

test('tool inputs are validated before execution', async () => {
  let executed = false;
  const registry = new ToolRegistry();
  registry.register(simpleTool({
    async run(input) {
      executed = true;
      return input.value;
    },
  }));
  await assert.rejects(
    executor(registry).execute('test.echo', { value: 42 }, new AbortController().signal),
    (error: unknown) => error instanceof ToolExecutionError && error.code === 'invalid-input',
  );
  assert.equal(executed, false);
});

test('tool inputs are bounded before execution', async () => {
  let executed = false;
  const registry = new ToolRegistry();
  registry.register(simpleTool({
    async run(input) {
      executed = true;
      return input.value;
    },
  }));
  await assert.rejects(
    executor(registry, config({ maxToolOutputChars: 16 }))
      .execute('test.echo', { value: 'too long' }, new AbortController().signal),
    (error: unknown) => error instanceof ToolExecutionError && error.code === 'input-too-large',
  );
  assert.equal(executed, false);
});

test('policy gateway denies side effects before tool execution', async () => {
  let executed = false;
  const sideEffectTool: Tool<{ value: string }, string> = {
    ...simpleTool(),
    id: 'test.write',
    effect: 'write',
    async run(input) {
      executed = true;
      return input.value;
    },
  };
  const registry = new ToolRegistry();
  registry.register(sideEffectTool);
  await assert.rejects(
    executor(registry).execute('test.write', { value: 'x' }, new AbortController().signal),
    (error: unknown) => error instanceof ToolExecutionError && error.code === 'policy-denied',
  );
  assert.equal(executed, false);
});

test('tool outputs are bounded and validated', async () => {
  const registry = new ToolRegistry();
  registry.register(simpleTool({
    async run() {
      return 'this output is too long';
    },
  }));
  await assert.rejects(
    executor(registry, config({ maxToolOutputChars: 16 }))
      .execute('test.echo', { value: 'x' }, new AbortController().signal),
    (error: unknown) => error instanceof ToolExecutionError && error.code === 'output-too-large',
  );
});

test('invalid tool outputs are rejected', async () => {
  const registry = new ToolRegistry();
  registry.register(simpleTool({
    validateOutput: (value): value is string => value === 'expected',
    async run() {
      return 'unexpected';
    },
  }));
  await assert.rejects(
    executor(registry).execute('test.echo', { value: 'x' }, new AbortController().signal),
    (error: unknown) => error instanceof ToolExecutionError && error.code === 'invalid-output',
  );
});

test('agent rejects malformed provider responses', async () => {
  const provider: ModelProvider = {
    id: 'test.invalid',
    async complete() {
      return { kind: 'final', text: 42 };
    },
  };
  await assert.rejects(
    runAgent('hello', new AbortController().signal, agentOptions(provider)),
    (error: unknown) => error instanceof AgentError && error.code === 'invalid-provider-response',
  );
});

test('agent enforces the iteration limit', async () => {
  const registry = new ToolRegistry();
  registry.register(simpleTool());
  const provider: ModelProvider = {
    id: 'test.loop',
    async complete(): Promise<ProviderResponse> {
      return { kind: 'tool-call', toolId: 'test.echo', input: { value: 'continue' } };
    },
  };
  await assert.rejects(
    runAgent('hello', new AbortController().signal, agentOptions(
      provider,
      config({ maxAgentIterations: 1 }),
      createLogger(() => {}),
      registry,
    )),
    (error: unknown) => error instanceof AgentError && error.code === 'iteration-limit',
  );
});

test('provider timeout is enforced even if a provider ignores its signal', async () => {
  const provider: ModelProvider = {
    id: 'test.never',
    async complete() {
      return new Promise<never>(() => {});
    },
  };
  await assert.rejects(
    runAgent('hello', new AbortController().signal, agentOptions(
      provider,
      config({ requestTimeoutMs: 100 }),
    )),
    (error: unknown) => error instanceof AgentError && error.code === 'timeout',
  );
});

test('tool timeout is enforced even if a tool ignores its signal', async () => {
  const registry = new ToolRegistry();
  registry.register(simpleTool({
    async run() {
      return new Promise<never>(() => {});
    },
  }));
  await assert.rejects(
    executor(registry, config({ toolTimeoutMs: 50 }))
      .execute('test.echo', { value: 'x' }, new AbortController().signal),
    (error: unknown) => error instanceof ToolExecutionError && error.code === 'timeout',
  );
});

test('cancellation stops a pending provider request', async () => {
  const controller = new AbortController();
  const provider: ModelProvider = {
    id: 'test.cancellable',
    async complete(_messages, signal) {
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    },
  };
  const pending = runAgent('hello', controller.signal, agentOptions(provider));
  controller.abort();
  await assert.rejects(
    pending,
    (error: unknown) => error instanceof AgentError && error.code === 'cancelled',
  );
});

test('structured diagnostics omit error messages, prompts, and secrets', () => {
  const { logger, lines } = loggerWithLines();
  logger.failure(new Error('private prompt fixture with diagnostic details'));
  const output = lines.join('\n');
  assert.doesNotMatch(output, /private prompt fixture|diagnostic details/);
  assert.deepEqual(JSON.parse(lines[0]!), {
    timestamp: JSON.parse(lines[0]!).timestamp,
    event: 'request.failed',
    code: 'request.failed',
  });
});

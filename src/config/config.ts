export interface AppConfig {
  readonly provider: 'placeholder';
  readonly maxAgentIterations: number;
  readonly maxToolCalls: number;
  readonly requestTimeoutMs: number;
  readonly toolTimeoutMs: number;
  readonly maxInputChars: number;
  readonly maxToolOutputChars: number;
}

type Environment = Readonly<Record<string, string | undefined>>;

function boundedInteger(
  env: Environment,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

export function loadConfig(env: Environment): AppConfig {
  const provider = env.VYOM_PROVIDER;
  if (provider !== undefined && provider !== '' && provider !== 'placeholder') {
    throw new Error("VYOM_PROVIDER must be 'placeholder' in this skeleton.");
  }

  return {
    provider: 'placeholder',
    maxAgentIterations: boundedInteger(env, 'VYOM_MAX_AGENT_ITERATIONS', 3, 1, 10),
    maxToolCalls: boundedInteger(env, 'VYOM_MAX_TOOL_CALLS', 2, 0, 10),
    requestTimeoutMs: boundedInteger(env, 'VYOM_REQUEST_TIMEOUT_MS', 20_000, 100, 120_000),
    toolTimeoutMs: boundedInteger(env, 'VYOM_TOOL_TIMEOUT_MS', 2_000, 50, 10_000),
    maxInputChars: boundedInteger(env, 'VYOM_MAX_INPUT_CHARS', 8_000, 1, 32_000),
    maxToolOutputChars: boundedInteger(env, 'VYOM_MAX_TOOL_OUTPUT_CHARS', 4_000, 1, 20_000),
  };
}

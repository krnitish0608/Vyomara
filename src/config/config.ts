export interface AppConfig {
  readonly provider: 'ollama' | 'placeholder';
  readonly ollamaBaseUrl: string;
  readonly ollamaModel: string;
  readonly maxAgentIterations: number;
  readonly maxToolCalls: number;
  readonly requestTimeoutMs: number;
  readonly toolTimeoutMs: number;
  readonly maxInputChars: number;
  readonly maxToolOutputChars: number;
  readonly maxResponseChars: number;
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

function localOllamaBaseUrl(raw: string | undefined): string {
  const value = raw === undefined ? 'http://127.0.0.1:11434' : raw.trim();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('VYOM_OLLAMA_BASE_URL must be a valid local HTTP URL.');
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    url.protocol !== 'http:' ||
    !['localhost', '127.0.0.1', '::1'].includes(hostname) ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new Error('VYOM_OLLAMA_BASE_URL must use HTTP on localhost or a loopback address, without credentials or query parameters.');
  }

  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

function modelName(raw: string | undefined): string {
  const value = raw === undefined ? 'llama3.2' : raw.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(value)) {
    throw new Error('VYOM_OLLAMA_MODEL must be a non-empty model name of at most 128 valid characters.');
  }
  return value;
}

export function loadConfig(env: Environment): AppConfig {
  const providerValue = env.VYOM_PROVIDER?.trim() || 'ollama';
  if (providerValue !== 'ollama' && providerValue !== 'placeholder') {
    throw new Error("VYOM_PROVIDER must be 'ollama' or 'placeholder'.");
  }

  return {
    provider: providerValue,
    ollamaBaseUrl: localOllamaBaseUrl(env.VYOM_OLLAMA_BASE_URL),
    ollamaModel: modelName(env.VYOM_OLLAMA_MODEL),
    maxAgentIterations: boundedInteger(env, 'VYOM_MAX_AGENT_ITERATIONS', 3, 1, 10),
    maxToolCalls: boundedInteger(env, 'VYOM_MAX_TOOL_CALLS', 2, 0, 10),
    requestTimeoutMs: boundedInteger(env, 'VYOM_REQUEST_TIMEOUT_MS', 120_000, 1_000, 300_000),
    toolTimeoutMs: boundedInteger(env, 'VYOM_TOOL_TIMEOUT_MS', 2_000, 50, 10_000),
    maxInputChars: boundedInteger(env, 'VYOM_MAX_INPUT_CHARS', 8_000, 1, 32_000),
    maxToolOutputChars: boundedInteger(env, 'VYOM_MAX_TOOL_OUTPUT_CHARS', 4_000, 1, 20_000),
    maxResponseChars: boundedInteger(env, 'VYOM_MAX_RESPONSE_CHARS', 16_000, 1_000, 64_000),
  };
}

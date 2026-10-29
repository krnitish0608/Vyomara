import { isAbsolute, join } from 'node:path';
import { homedir } from 'node:os';

export interface AppConfig {
  readonly provider: 'ollama' | 'placeholder';
  readonly ollamaBaseUrl: string;
  readonly ollamaModel: string;
  readonly filesystemAllowedRoots: readonly string[];
  readonly dataDirectory: string;
  readonly maxAgentIterations: number;
  readonly maxToolCalls: number;
  readonly requestTimeoutMs: number;
  readonly toolTimeoutMs: number;
  readonly maxInputChars: number;
  readonly maxToolOutputChars: number;
  readonly maxResponseChars: number;
  readonly maxFileBytes: number;
  readonly maxDirectoryEntries: number;
  readonly maxTreeDepth: number;
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

function allowedRoots(raw: string | undefined): readonly string[] {
  if (raw === undefined) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('VYOM_ALLOWED_ROOTS must be a JSON array of absolute directory paths.');
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length > 32 ||
    parsed.some(root =>
      typeof root !== 'string' ||
      root.trim() === '' ||
      root !== root.trim() ||
      root.includes('\0') ||
      !isAbsolute(root))
  ) {
    throw new Error('VYOM_ALLOWED_ROOTS must be a JSON array of at most 32 absolute directory paths.');
  }
  return parsed;
}

function dataDirectory(raw: string | undefined): string {
  const value = raw ?? join(homedir(), 'Library', 'Application Support', 'Vyomara');
  if (value.trim() !== value || value.includes('\0') || !isAbsolute(value)) {
    throw new Error('VYOM_DATA_DIR must be an absolute local directory path.');
  }
  return value;
}

export function loadConfig(env: Environment): AppConfig {
  const providerValue = env.VYOM_PROVIDER?.trim() || 'ollama';
  if (providerValue !== 'ollama' && providerValue !== 'placeholder') {
    throw new Error("VYOM_PROVIDER must be 'ollama' or 'placeholder'.");
  }
  const usesOllama = providerValue === 'ollama';

  return {
    provider: providerValue,
    ollamaBaseUrl: usesOllama
      ? localOllamaBaseUrl(env.VYOM_OLLAMA_BASE_URL)
      : 'http://127.0.0.1:11434',
    ollamaModel: usesOllama ? modelName(env.VYOM_OLLAMA_MODEL) : 'llama3.2',
    filesystemAllowedRoots: allowedRoots(env.VYOM_ALLOWED_ROOTS),
    dataDirectory: dataDirectory(env.VYOM_DATA_DIR),
    maxAgentIterations: boundedInteger(env, 'VYOM_MAX_AGENT_ITERATIONS', 3, 1, 10),
    maxToolCalls: boundedInteger(env, 'VYOM_MAX_TOOL_CALLS', 2, 0, 10),
    requestTimeoutMs: boundedInteger(env, 'VYOM_REQUEST_TIMEOUT_MS', 120_000, 1_000, 300_000),
    toolTimeoutMs: boundedInteger(env, 'VYOM_TOOL_TIMEOUT_MS', 2_000, 50, 10_000),
    maxInputChars: boundedInteger(env, 'VYOM_MAX_INPUT_CHARS', 8_000, 1, 32_000),
    maxToolOutputChars: boundedInteger(env, 'VYOM_MAX_TOOL_OUTPUT_CHARS', 4_000, 1, 20_000),
    maxResponseChars: boundedInteger(env, 'VYOM_MAX_RESPONSE_CHARS', 16_000, 1_000, 64_000),
    maxFileBytes: boundedInteger(env, 'VYOM_MAX_FILE_BYTES', 65_536, 1, 1_048_576),
    maxDirectoryEntries: boundedInteger(env, 'VYOM_MAX_DIRECTORY_ENTRIES', 100, 1, 500),
    maxTreeDepth: boundedInteger(env, 'VYOM_MAX_TREE_DEPTH', 3, 1, 10),
  };
}

import { isAbsolute } from 'node:path';
import type { AppConfig } from '../config/config.ts';
import type { Tool, ToolRegistry } from './contracts.ts';
import { resolveSafeFilesystemPath } from './filesystem-tools.ts';

/** An action that changes something outside Vyomara and therefore needs the user's approval. */
export type ActionProposal =
  | {
    readonly kind: 'command';
    readonly command: string;
    readonly cwd: string;
    readonly timeoutSeconds: number;
  }
  | { readonly kind: 'application'; readonly application: string; readonly target?: string }
  | { readonly kind: 'url'; readonly url: string; readonly application?: string };

export interface ActionApprovalPort {
  /** Resolve true only when the user explicitly approves this exact action. */
  request(action: ActionProposal, signal: AbortSignal): Promise<boolean>;
}

export interface CommandResult {
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly timedOut: boolean;
  readonly output: string;
  readonly truncated: boolean;
  readonly durationMs: number;
}

export interface CommandRunnerPort {
  run(command: string, cwd: string, timeoutMs: number, signal: AbortSignal): Promise<CommandResult>;
}

export interface LauncherPort {
  openApplication(application: string, target: string | undefined, signal: AbortSignal): Promise<void>;
  openUrl(url: string, application: string | undefined, signal: AbortSignal): Promise<void>;
}

export interface ActionToolPorts {
  readonly approval: ActionApprovalPort;
  readonly commandRunner?: CommandRunnerPort;
  readonly launcher?: LauncherPort;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): string | undefined {
  const unknown = Object.keys(value).filter(key => !keys.includes(key));
  return unknown.length > 0 ? `Unknown argument(s): ${unknown.join(', ')}. Use only: ${keys.join(', ')}.` : undefined;
}

function dropNulls(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([, candidate]) => candidate !== null));
}

/** Application names as shown in /Applications, e.g. "Visual Studio Code", "Google Chrome". */
const APPLICATION_NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._&+'()-]{0,79}$/u;

const APPLICATION_ALIASES: Readonly<Record<string, string>> = {
  'vs code': 'Visual Studio Code',
  vscode: 'Visual Studio Code',
  code: 'Visual Studio Code',
  'visual studio code': 'Visual Studio Code',
  chrome: 'Google Chrome',
  'google chrome': 'Google Chrome',
  google: 'Google Chrome',
  safari: 'Safari',
  terminal: 'Terminal',
  finder: 'Finder',
  notes: 'Notes',
  calendar: 'Calendar',
  calculator: 'Calculator',
  calc: 'Calculator',
  settings: 'System Settings',
  'system settings': 'System Settings',
  'system preferences': 'System Settings',
  mail: 'Mail',
  music: 'Music',
  slack: 'Slack',
  iterm: 'iTerm',
  iterm2: 'iTerm',
  firefox: 'Firefox',
  cursor: 'Cursor',
};

export function normalizeApplicationName(value: string): string {
  const trimmed = value.trim().replace(/\.app$/iu, '');
  return APPLICATION_ALIASES[trimmed.toLocaleLowerCase()] ?? trimmed;
}

export function validateWebUrl(value: string): string | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'url must be a complete web address such as https://www.google.com/search?q=…';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'Only http and https web addresses can be opened.';
  if (url.username !== '' || url.password !== '') return 'Web addresses with embedded credentials are not allowed.';
  return undefined;
}

interface CommandInput {
  readonly command: string;
  readonly cwd: string;
  readonly timeout_seconds?: number;
}

interface CommandOutput {
  readonly status: 'completed' | 'rejected';
  readonly command: string;
  readonly cwd: string;
  readonly exitCode?: number | null;
  readonly timedOut?: boolean;
  readonly output?: string;
  readonly truncated?: boolean;
  readonly durationMs?: number;
}

interface ApplicationInput {
  readonly application: string;
  readonly path?: string;
}

interface ApplicationOutput {
  readonly status: 'opened' | 'rejected';
  readonly application: string;
  readonly path?: string;
}

interface UrlInput {
  readonly url: string;
  readonly browser?: string;
}

interface UrlOutput {
  readonly status: 'opened' | 'rejected';
  readonly url: string;
  readonly browser?: string;
}

function commandError(value: unknown, maxTimeoutSeconds: number): string | undefined {
  if (!isRecord(value)) return 'Arguments must be a JSON object.';
  const keys = onlyKeys(value, ['command', 'cwd', 'timeout_seconds']);
  if (keys) return keys;
  if (typeof value.command !== 'string' || value.command.trim() === '') return 'command must be a non-empty shell command.';
  if (value.command.length > 8_000 || value.command.includes('\0')) return 'command is too long or contains invalid characters.';
  if (typeof value.cwd !== 'string' || !isAbsolute(value.cwd)) return 'cwd must be the absolute directory to run the command in (usually the project root).';
  if (value.timeout_seconds !== undefined && (
    typeof value.timeout_seconds !== 'number' ||
    !Number.isSafeInteger(value.timeout_seconds) ||
    value.timeout_seconds < 1 ||
    value.timeout_seconds > maxTimeoutSeconds
  )) return `timeout_seconds must be an integer between 1 and ${maxTimeoutSeconds}.`;
  return undefined;
}

function applicationError(value: unknown): string | undefined {
  if (!isRecord(value)) return 'Arguments must be a JSON object.';
  const keys = onlyKeys(value, ['application', 'path']);
  if (keys) return keys;
  if (typeof value.application !== 'string' || !APPLICATION_NAME.test(normalizeApplicationName(value.application))) {
    return 'application must be a macOS application name such as "Visual Studio Code" or "Google Chrome".';
  }
  if (value.path !== undefined && (typeof value.path !== 'string' || !isAbsolute(value.path) || value.path.split('/').includes('..'))) {
    return 'path must be an absolute file or folder path to open in the application.';
  }
  return undefined;
}

function urlError(value: unknown): string | undefined {
  if (!isRecord(value)) return 'Arguments must be a JSON object.';
  const keys = onlyKeys(value, ['url', 'browser']);
  if (keys) return keys;
  if (typeof value.url !== 'string' || value.url.length > 4_096) return 'url must be a web address.';
  const invalid = validateWebUrl(value.url);
  if (invalid) return invalid;
  if (value.browser !== undefined && (typeof value.browser !== 'string' || !APPLICATION_NAME.test(normalizeApplicationName(value.browser)))) {
    return 'browser must be an application name such as "Google Chrome" or "Safari".';
  }
  return undefined;
}

export function registerActionTools(
  registry: ToolRegistry,
  config: AppConfig,
  ports: ActionToolPorts,
): void {
  const { approval, commandRunner, launcher } = ports;
  const maxTimeoutSeconds = Math.floor(config.commandTimeoutMs / 1_000);

  if (commandRunner) {
    const runCommand: Tool<CommandInput, CommandOutput> = {
      id: 'run_command',
      effect: 'shell',
      description: `Run a shell command (zsh) in a directory after the user approves it, e.g. tests, builds, git, package managers. Output (stdout+stderr) and exit code are returned. Commands must not wait for input. Default timeout ${Math.min(120, maxTimeoutSeconds)}s.`,
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The exact shell command, e.g. "pnpm test" or "git status".', maxLength: 8_000 },
          cwd: { type: 'string', description: 'Absolute working directory, usually the project root.', maxLength: 4_096 },
          timeout_seconds: { type: 'integer', description: 'Optional timeout in seconds.', minimum: 1, maximum: maxTimeoutSeconds },
        },
        required: ['command', 'cwd'],
        additionalProperties: false,
      },
      normalizeInput: dropNulls,
      validateInput: (value): value is CommandInput => commandError(value, maxTimeoutSeconds) === undefined,
      inputError: value => commandError(value, maxTimeoutSeconds),
      validateOutput: (value): value is CommandOutput =>
        isRecord(value) && (value.status === 'completed' || value.status === 'rejected'),
      async run(input, signal) {
        const cwd = (await resolveSafeFilesystemPath(input.cwd, config, 'directory', signal)).target;
        const timeoutSeconds = input.timeout_seconds ?? Math.min(120, maxTimeoutSeconds);
        const approved = await approval.request(
          { kind: 'command', command: input.command, cwd, timeoutSeconds },
          signal,
        );
        if (!approved) return { status: 'rejected', command: input.command, cwd };
        const result = await commandRunner.run(input.command, cwd, timeoutSeconds * 1_000, signal);
        return {
          status: 'completed',
          command: input.command,
          cwd,
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          output: result.output,
          truncated: result.truncated,
          durationMs: result.durationMs,
        };
      },
    };
    registry.register(runCommand);
  }

  if (launcher) {
    const openApplication: Tool<ApplicationInput, ApplicationOutput> = {
      id: 'open_application',
      effect: 'launch',
      description: 'Open a macOS application after the user approves, optionally with a file or folder. Examples: {"application":"Visual Studio Code","path":"/Users/me/Projects/app"} opens a project in VS Code; {"application":"Google Chrome"}.',
      parameters: {
        type: 'object',
        properties: {
          application: { type: 'string', description: 'Application name, e.g. "Visual Studio Code", "Google Chrome", "Finder", "Notes".', maxLength: 80 },
          path: { type: 'string', description: 'Optional absolute file or folder to open in it.', maxLength: 4_096 },
        },
        required: ['application'],
        additionalProperties: false,
      },
      normalizeInput: dropNulls,
      validateInput: (value): value is ApplicationInput => applicationError(value) === undefined,
      inputError: applicationError,
      validateOutput: (value): value is ApplicationOutput =>
        isRecord(value) && (value.status === 'opened' || value.status === 'rejected'),
      async run(input, signal) {
        const application = normalizeApplicationName(input.application);
        let target: string | undefined;
        if (input.path !== undefined) {
          try {
            target = (await resolveSafeFilesystemPath(input.path, config, 'directory', signal)).target;
          } catch {
            target = (await resolveSafeFilesystemPath(input.path, config, 'file', signal)).target;
          }
        }
        const approved = await approval.request(
          { kind: 'application', application, ...(target === undefined ? {} : { target }) },
          signal,
        );
        if (!approved) return { status: 'rejected', application, ...(target === undefined ? {} : { path: target }) };
        await launcher.openApplication(application, target, signal);
        return { status: 'opened', application, ...(target === undefined ? {} : { path: target }) };
      },
    };
    registry.register(openApplication);

    const openUrl: Tool<UrlInput, UrlOutput> = {
      id: 'open_url',
      effect: 'network',
      description: 'Open a web page in a browser after the user approves. For a web search use https://www.google.com/search?q=<url-encoded query>. Optional browser, e.g. "Google Chrome" or "Safari" (default browser if omitted). You cannot read the page contents.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Full http(s) address.', maxLength: 4_096 },
          browser: { type: 'string', description: 'Optional browser application name.', maxLength: 80 },
        },
        required: ['url'],
        additionalProperties: false,
      },
      normalizeInput: dropNulls,
      validateInput: (value): value is UrlInput => urlError(value) === undefined,
      inputError: urlError,
      validateOutput: (value): value is UrlOutput =>
        isRecord(value) && (value.status === 'opened' || value.status === 'rejected'),
      async run(input, signal) {
        const browser = input.browser === undefined ? undefined : normalizeApplicationName(input.browser);
        const url = new URL(input.url).toString();
        const approved = await approval.request(
          { kind: 'url', url, ...(browser === undefined ? {} : { application: browser }) },
          signal,
        );
        if (!approved) return { status: 'rejected', url, ...(browser === undefined ? {} : { browser }) };
        await launcher.openUrl(url, browser, signal);
        return { status: 'opened', url, ...(browser === undefined ? {} : { browser }) };
      },
    };
    registry.register(openUrl);
  }
}

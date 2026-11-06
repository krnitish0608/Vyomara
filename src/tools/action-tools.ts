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
  | { readonly kind: 'application'; readonly application: string; readonly target?: string; readonly line?: number }
  | { readonly kind: 'url'; readonly url: string; readonly application?: string }
  | {
    /** Vyomara itself requests a page or a search; the host receives the URL or query. */
    readonly kind: 'web';
    readonly operation: 'fetch' | 'search';
    readonly target: string;
    readonly host: string;
  };

/**
 * The user's answer: `false` rejects, `true` approves once, and `'always'`
 * approves and remembers this exact command in this folder for the rest of the
 * app session (commands and web hosts only).
 */
export type ApprovalDecision = boolean | 'always';

export interface ActionApprovalPort {
  /** Resolve truthy only when the user explicitly approves this exact action. */
  request(action: ActionProposal, signal: AbortSignal): Promise<ApprovalDecision>;
}

/**
 * What the user chose to "always allow" — an exact command in an exact folder,
 * or reading from one web host — kept in memory only until the app quits.
 */
export class ApprovalMemory {
  readonly #allowed = new Set<string>();
  readonly #hosts = new Set<string>();

  static key(command: string, cwd: string): string {
    return `${cwd}\n${command.trim()}`;
  }

  hasHost(host: string): boolean {
    return this.#hosts.has(host.toLowerCase());
  }

  allowHost(host: string): void {
    this.#hosts.add(host.toLowerCase());
  }

  has(command: string, cwd: string): boolean {
    return this.#allowed.has(ApprovalMemory.key(command, cwd));
  }

  allow(command: string, cwd: string): void {
    this.#allowed.add(ApprovalMemory.key(command, cwd));
  }

  clear(): void {
    this.#allowed.clear();
    this.#hosts.clear();
  }

  get size(): number {
    return this.#allowed.size + this.#hosts.size;
  }
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
  /** `line` jumps to that line when the editor supports it (VS Code). */
  openApplication(application: string, target: string | undefined, signal: AbortSignal, line?: number): Promise<void>;
  openUrl(url: string, application: string | undefined, signal: AbortSignal): Promise<void>;
}

export interface ActionToolPorts {
  readonly approval: ActionApprovalPort;
  /** Remembers commands approved with "always allow"; without it every run asks. */
  readonly approvalMemory?: ApprovalMemory;
  readonly commandRunner?: CommandRunnerPort;
  readonly launcher?: LauncherPort;
  /** Enables fetch_url (and web_search when a search backend is configured). */
  readonly web?: WebClientPort;
}

export interface WebPage {
  readonly url: string;
  readonly title: string;
  readonly text: string;
  readonly links: readonly { readonly text: string; readonly url: string }[];
}

export interface WebSearchResult {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
}

export interface WebClientPort {
  /** The host that receives search queries, or undefined when search is not configured. */
  readonly searchHost: string | undefined;
  fetchPage(url: string, signal: AbortSignal): Promise<WebPage>;
  search(query: string, signal: AbortSignal): Promise<readonly WebSearchResult[]>;
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
  /** How the run was approved: by the user now, or by an earlier "always allow". */
  readonly approval?: 'user' | 'remembered';
  readonly exitCode?: number | null;
  readonly timedOut?: boolean;
  readonly output?: string;
  readonly truncated?: boolean;
  readonly durationMs?: number;
}

interface ApplicationInput {
  readonly application: string;
  readonly path?: string;
  readonly line?: number;
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
  const keys = onlyKeys(value, ['application', 'path', 'line']);
  if (keys) return keys;
  if (typeof value.application !== 'string' || !APPLICATION_NAME.test(normalizeApplicationName(value.application))) {
    return 'application must be a macOS application name such as "Visual Studio Code" or "Google Chrome".';
  }
  if (value.path !== undefined && (typeof value.path !== 'string' || !isAbsolute(value.path) || value.path.split('/').includes('..'))) {
    return 'path must be an absolute file or folder path to open in the application.';
  }
  if (value.line !== undefined && (typeof value.line !== 'number' || !Number.isSafeInteger(value.line) || value.line < 1)) {
    return 'line must be a positive line number.';
  }
  if (value.line !== undefined && value.path === undefined) return 'line needs a file path.';
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
  const { approval, commandRunner, approvalMemory, launcher } = ports;
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
        const remembered = approvalMemory?.has(input.command, cwd) === true;
        const decision = remembered || await approval.request(
          { kind: 'command', command: input.command, cwd, timeoutSeconds },
          signal,
        );
        if (!decision) return { status: 'rejected', command: input.command, cwd };
        if (decision === 'always') approvalMemory?.allow(input.command, cwd);
        const result = await commandRunner.run(input.command, cwd, timeoutSeconds * 1_000, signal);
        return {
          status: 'completed',
          command: input.command,
          cwd,
          approval: remembered ? 'remembered' : 'user',
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
      description: 'Open a macOS application after the user approves, optionally with a file or folder (and, for VS Code, a line). Examples: {"application":"Visual Studio Code","path":"/Users/me/Projects/app"} opens a project; {"application":"Visual Studio Code","path":"/Users/me/Projects/app/src/cart.js","line":9} opens a file at line 9; {"application":"Google Chrome"}.',
      parameters: {
        type: 'object',
        properties: {
          application: { type: 'string', description: 'Application name, e.g. "Visual Studio Code", "Google Chrome", "Finder", "Notes".', maxLength: 80 },
          path: { type: 'string', description: 'Optional absolute file or folder to open in it.', maxLength: 4_096 },
          line: { type: 'integer', description: 'Optional line number to jump to in a file (VS Code).', minimum: 1 },
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
        const line = target === undefined ? undefined : input.line;
        const approved = await approval.request(
          {
            kind: 'application',
            application,
            ...(target === undefined ? {} : { target }),
            ...(line === undefined ? {} : { line }),
          },
          signal,
        );
        if (!approved) return { status: 'rejected', application, ...(target === undefined ? {} : { path: target }) };
        await launcher.openApplication(application, target, signal, line);
        return { status: 'opened', application, ...(target === undefined ? {} : { path: target }) };
      },
    };
    registry.register(openApplication);

    const openUrl: Tool<UrlInput, UrlOutput> = {
      id: 'open_url',
      effect: 'network',
      description: 'Show a web page to the USER in their browser (after approval), e.g. "open YouTube", "Chrome mein … search karo". You cannot see the page afterwards. To read a page yourself and answer from it, use fetch_url instead. For a search the user wants to see, use https://www.google.com/search?q=<url-encoded query>. Optional browser, e.g. "Google Chrome" or "Safari".',
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

/** Hosts Vyomara must never fetch on the model's behalf (loopback, private, link-local). */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (host === '0.0.0.0' || host === '::' || host === '::1') return true;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(host);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (host.includes(':')) {
    return /^(?:fc|fd|fe8|fe9|fea|feb)/u.test(host) || host.startsWith('::ffff:');
  }
  return false;
}

interface FetchInput {
  readonly url: string;
  readonly offset?: number;
}

interface SearchInput {
  readonly query: string;
}

function fetchInputError(value: unknown): string | undefined {
  if (!isRecord(value)) return 'Arguments must be a JSON object.';
  const keys = onlyKeys(value, ['url', 'offset']);
  if (keys) return keys;
  if (typeof value.url !== 'string' || value.url.length > 4_096) return 'url must be a web address.';
  const invalid = validateWebUrl(value.url);
  if (invalid) return invalid;
  if (isPrivateHost(new URL(value.url).hostname)) return 'Local and private network addresses cannot be fetched.';
  if (value.offset !== undefined && (typeof value.offset !== 'number' || !Number.isSafeInteger(value.offset) || value.offset < 0)) {
    return 'offset must be a non-negative integer (a character position from an earlier result).';
  }
  return undefined;
}

function searchInputError(value: unknown): string | undefined {
  if (!isRecord(value)) return 'Arguments must be a JSON object.';
  const keys = onlyKeys(value, ['query']);
  if (keys) return keys;
  if (typeof value.query !== 'string' || value.query.trim() === '' || value.query.length > 400) {
    return 'query must be non-empty search text of at most 400 characters.';
  }
  return undefined;
}

/** Register fetch_url and, when a search backend is configured, web_search. */
export function registerWebTools(
  registry: ToolRegistry,
  config: AppConfig,
  ports: ActionToolPorts,
): void {
  const { approval, approvalMemory, web } = ports;
  if (!web) return;
  const windowChars = Math.max(1_000, config.maxToolOutputChars - 4_000);

  const approve = async (operation: 'fetch' | 'search', target: string, host: string, signal: AbortSignal): Promise<boolean> => {
    if (approvalMemory?.hasHost(host)) return true;
    const decision = await approval.request({ kind: 'web', operation, target, host }, signal);
    if (decision === 'always') approvalMemory?.allowHost(host);
    return decision !== false;
  };

  const fetchUrl: Tool<FetchInput, Record<string, unknown>> = {
    id: 'fetch_url',
    effect: 'network',
    description: 'Read a public web page YOURSELF (after approval): returns its text, title, and links so you can answer from it. Use whenever the user wants information from a page or site ("padh ke batao", "check karo", "what does the docs say"). Long pages are split: call again with offset = nextOffset.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Full http(s) address.', maxLength: 4_096 },
        offset: { type: 'integer', description: 'Optional character offset from a previous truncated result.', minimum: 0 },
      },
      required: ['url'],
      additionalProperties: false,
    },
    normalizeInput: dropNulls,
    validateInput: (value): value is FetchInput => fetchInputError(value) === undefined,
    inputError: fetchInputError,
    validateOutput: (value): value is Record<string, unknown> => isRecord(value) && typeof value.status === 'string',
    async run(input, signal) {
      const url = new URL(input.url);
      if (!await approve('fetch', url.href, url.hostname, signal)) {
        return { status: 'rejected', url: url.href };
      }
      const page = await web.fetchPage(url.href, signal);
      const offset = Math.min(input.offset ?? 0, page.text.length);
      const content = page.text.slice(offset, offset + windowChars);
      const nextOffset = offset + content.length;
      return {
        status: 'fetched',
        url: page.url,
        title: page.title,
        content,
        totalChars: page.text.length,
        truncated: nextOffset < page.text.length,
        ...(nextOffset < page.text.length ? { nextOffset } : {}),
        ...(offset === 0 ? { links: page.links.slice(0, 25) } : {}),
      };
    },
  };
  registry.register(fetchUrl);

  const searchHost = web.searchHost;
  if (searchHost === undefined) return;
  const webSearch: Tool<SearchInput, Record<string, unknown>> = {
    id: 'web_search',
    effect: 'network',
    description: 'Search the web (after the user approves) and return result titles, URLs, and snippets. Then use fetch_url to read the most relevant pages before answering, and cite the URLs you used.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Search words.', maxLength: 400 } },
      required: ['query'],
      additionalProperties: false,
    },
    normalizeInput: dropNulls,
    validateInput: (value): value is SearchInput => searchInputError(value) === undefined,
    inputError: searchInputError,
    validateOutput: (value): value is Record<string, unknown> => isRecord(value) && typeof value.status === 'string',
    async run(input, signal) {
      const query = input.query.trim();
      if (!await approve('search', query, searchHost, signal)) return { status: 'rejected', query };
      const results = await web.search(query, signal);
      return { status: 'searched', query, results: results.slice(0, 10) };
    },
  };
  registry.register(webSearch);
}

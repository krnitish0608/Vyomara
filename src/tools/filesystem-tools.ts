import { constants as fsConstants } from 'node:fs';
import { lstat, open, opendir, realpath, stat } from 'node:fs/promises';
import type { Dir, Dirent, Stats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import type { AppConfig } from '../config/config.ts';
import type {
  FileOperationApprovalPort,
  FileOperationKind,
  FileOperationRequest,
} from '../desktop/contracts.ts';
import { ToolFailure } from './contracts.ts';
import type { Tool } from './contracts.ts';
import type { ToolRegistry } from './contracts.ts';
import type { ToolFailureCode } from './contracts.ts';

type EntryType = 'file' | 'directory' | 'symlink' | 'other';

interface PathInput {
  readonly path: string;
}

interface ListInput extends PathInput {
  readonly maxEntries?: number;
}

interface TreeInput extends PathInput {
  readonly maxDepth?: number;
  readonly maxEntries?: number;
}

interface SearchInput {
  readonly query: string;
  readonly path?: string;
  readonly maxEntries?: number;
}

interface SearchOutput {
  readonly matches: readonly { readonly path: string; readonly type: 'file' | 'directory' }[];
  readonly scannedDirectories: number;
  readonly skippedDirectories: number;
  readonly truncated: boolean;
}

interface ContentInput extends PathInput {
  readonly content: string;
}

interface OperationOutput {
  readonly status: 'applied' | 'rejected';
  readonly operation: FileOperationKind;
  readonly path: string;
}

interface ListedEntry {
  readonly name: string;
  readonly type: EntryType;
}

interface ListOutput {
  readonly entries: readonly ListedEntry[];
  readonly truncated: boolean;
}

interface TreeEntry extends ListedEntry {
  readonly path: string;
  readonly depth: number;
}

interface TreeOutput {
  readonly entries: readonly TreeEntry[];
  readonly truncated: boolean;
}

interface ReadOutput {
  readonly content: string;
  readonly bytes: number;
}

interface ResolvedPath {
  readonly root: string;
  readonly target: string;
  readonly stats: Stats;
}

export interface CanonicalRoot {
  readonly configured: string;
  readonly canonical: string;
}

export interface SafeFilesystemPath {
  readonly root: string;
  readonly target: string;
  readonly stats: Stats;
}

interface DirectoryHandle {
  read(): Promise<Dirent | null>;
  close(): Promise<void>;
}

interface ReadFileHandle {
  stat(): Promise<Stats>;
  read(buffer: Buffer, offset: number, length: number, position: number): Promise<{ bytesRead: number; buffer: Buffer }>;
  close(): Promise<void>;
}

export interface FilesystemToolOperations {
  readonly openDirectory?: (path: string) => Promise<DirectoryHandle>;
  readonly openFile?: (path: string, flags: number) => Promise<ReadFileHandle>;
}

class FilesystemToolError extends ToolFailure {
  constructor(message: string, code: ToolFailureCode = 'tool-failed') {
    super(message, code);
    this.name = 'FilesystemToolError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key));
}

function validUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const current = value.charCodeAt(index);
    if (current >= 0xD800 && current <= 0xDBFF) {
      if (index + 1 >= value.length) return false;
      const following = value.charCodeAt(index + 1);
      if (following < 0xDC00 || following > 0xDFFF) return false;
      index += 1;
    } else if (current >= 0xDC00 && current <= 0xDFFF) {
      return false;
    }
  }
  return true;
}

function validPath(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 4096 &&
    !value.includes('\0') &&
    validUnicode(value) &&
    isAbsolute(value) &&
    !value.split(sep).includes('..');
}

function boundedOptionalInteger(value: unknown, maximum: number): boolean {
  return value === undefined ||
    (Number.isSafeInteger(value) && typeof value === 'number' && value >= 1 && value <= maximum);
}

function inputError(
  value: unknown,
  allowedFields: readonly string[],
  limits: Readonly<Record<string, number>>,
): string {
  if (!isRecord(value)) return 'Arguments must be an object containing an absolute path.';
  if (!exactKeys(value, allowedFields)) {
    return `Use only these arguments: ${allowedFields.join(', ')}.`;
  }
  if (!Object.hasOwn(value, 'path')) return 'The required path argument is missing.';
  if (typeof value.path !== 'string') return 'Path must be a string.';
  if (value.path.length === 0) return 'Path must not be empty.';
  if (!validPath(value.path)) {
    return 'Path must be an absolute path without parent-directory traversal.';
  }
  for (const [name, maximum] of Object.entries(limits)) {
    const candidate = value[name];
    if (candidate === undefined) continue;
    if (typeof candidate !== 'number' || !Number.isSafeInteger(candidate)) {
      return `${name} must be an integer number; omit it to use the configured default.`;
    }
    if (candidate < 1 || candidate > maximum) {
      return `${name} must be between 1 and ${maximum}.`;
    }
  }
  return 'Tool arguments did not match the filesystem tool schema.';
}

function isWithin(root: string, target: string): boolean {
  const normalizedRoot = resolve(root);
  const normalizedTarget = resolve(target);
  return normalizedRoot === sep ||
    normalizedTarget === normalizedRoot ||
    normalizedTarget.startsWith(`${normalizedRoot}${sep}`);
}

function joinHome(...parts: string[]): string {
  return resolve(homedir(), ...parts);
}

const DEFAULT_PROTECTED_PATHS = [
  '/System',
  '/Library',
  '/Applications',
  '/usr',
  '/bin',
  '/sbin',
  '/etc',
  '/var',
  '/private/etc',
  '/private/var',
  '/dev',
  '/proc',
  '/sys',
  '/boot',
  '/root',
  joinHome('Library', 'Keychains'),
  joinHome('Library', 'Application Support', 'Vyomara'),
  joinHome('.ssh'),
  joinHome('.gnupg'),
  joinHome('.aws'),
  joinHome('.azure'),
  joinHome('.kube'),
  joinHome('.config', 'gcloud'),
  joinHome('.config', 'gh'),
  joinHome('.docker'),
  joinHome('.local', 'share', 'keyrings'),
  joinHome('.netrc'),
  joinHome('.npmrc'),
  joinHome('.git-credentials'),
].map(path => resolve(path));

export function isProtectedFilesystemPath(
  path: string,
  roots: readonly CanonicalRoot[],
  additionalProtectedPaths: readonly string[] = [],
): boolean {
  if (!roots.some(root => root.canonical === sep)) return false;
  const normalized = resolve(path);
  return DEFAULT_PROTECTED_PATHS.some(protectedPath => isWithin(protectedPath, normalized)) ||
    additionalProtectedPaths.some(protectedPath => isWithin(resolve(protectedPath), normalized));
}

function checkCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new FilesystemToolError('Filesystem operation was cancelled.');
}

function closeDirectoryOnAbort(directory: Pick<Dir, 'close'>, signal: AbortSignal): () => void {
  const close = () => {
    void directory.close().catch(() => undefined);
  };
  signal.addEventListener('abort', close, { once: true });
  return () => signal.removeEventListener('abort', close);
}

function closeFileOnAbort(file: Pick<FileHandle, 'close'>, signal: AbortSignal): () => void {
  const close = () => {
    void file.close().catch(() => undefined);
  };
  signal.addEventListener('abort', close, { once: true });
  return () => signal.removeEventListener('abort', close);
}

function publicFilesystemError(error: unknown): FilesystemToolError {
  if (error instanceof FilesystemToolError) return error;
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? error.code
    : undefined;
  if (code === 'ENOENT' || code === 'ENOTDIR') {
    return new FilesystemToolError('The requested file or directory was not found.', 'not-found');
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return new FilesystemToolError('The filesystem path is not accessible.', 'permission-denied');
  }
  if (code === 'ELOOP') {
    return new FilesystemToolError('Symbolic links are not allowed in requested paths.', 'invalid-path');
  }
  return new FilesystemToolError('The filesystem operation failed safely.', 'tool-failed');
}

async function canonicalRoots(roots: readonly string[], signal: AbortSignal): Promise<CanonicalRoot[]> {
  if (roots.length === 0) {
    throw new FilesystemToolError(
      'Filesystem access is unavailable because no allowed roots are configured.',
      'permission-denied',
    );
  }
  const result: CanonicalRoot[] = [];
  for (const configuredRoot of roots) {
    checkCancelled(signal);
    try {
      const root = await realpath(configuredRoot);
      if (!(await stat(root)).isDirectory()) {
        throw new FilesystemToolError('A configured filesystem root is not a directory.', 'invalid-path');
      }
      result.push({ configured: configuredRoot, canonical: root });
    } catch (error) {
      throw publicFilesystemError(error);
    }
  }
  return result.filter((item, index) =>
    result.findIndex(other => other.canonical === item.canonical) === index);
}

async function resolveAllowedPath(
  inputPath: string,
  roots: readonly CanonicalRoot[],
  kind: 'file' | 'directory',
  signal: AbortSignal,
  additionalProtectedPaths: readonly string[] = [],
): Promise<SafeFilesystemPath> {
  if (!validPath(inputPath)) {
    throw new FilesystemToolError(
      'The filesystem path is invalid; use an absolute path without parent traversal.',
      'invalid-path',
    );
  }
  const normalized = resolve(inputPath);
  if (isProtectedFilesystemPath(normalized, roots, additionalProtectedPaths)) {
    throw new FilesystemToolError('Protected system and credential paths are not accessible.', 'permission-denied');
  }
  const matchingRoots = roots
    .filter(root => isWithin(root.configured, normalized) || isWithin(root.canonical, normalized))
    .sort((left, right) => {
      const leftLength = Math.max(
        isWithin(left.configured, normalized) ? left.configured.length : 0,
        isWithin(left.canonical, normalized) ? left.canonical.length : 0,
      );
      const rightLength = Math.max(
        isWithin(right.configured, normalized) ? right.configured.length : 0,
        isWithin(right.canonical, normalized) ? right.canonical.length : 0,
      );
      return rightLength - leftLength;
    });
  const matchedRoot = matchingRoots[0];
  if (!matchedRoot) {
    throw new FilesystemToolError('The requested path is outside the allowed filesystem roots.', 'outside-root');
  }

  const lexicalRoot = isWithin(matchedRoot.configured, normalized)
    ? matchedRoot.configured
    : matchedRoot.canonical;
  const suffix = relative(lexicalRoot, normalized);
  const root = matchedRoot.canonical;
  const expectedTarget = resolve(root, suffix);
  let actualTarget: string;
  try {
    actualTarget = await realpath(normalized);
  } catch (error) {
    throw publicFilesystemError(error);
  }
  if (!isWithin(root, actualTarget)) {
    throw new FilesystemToolError('Symbolic links are not allowed in requested paths.', 'invalid-path');
  }
  if (isProtectedFilesystemPath(actualTarget, roots, additionalProtectedPaths)) {
    throw new FilesystemToolError('Protected system and credential paths are not accessible.', 'permission-denied');
  }
  if (actualTarget !== expectedTarget) {
    throw new FilesystemToolError('Symbolic links are not allowed in requested paths.', 'invalid-path');
  }

  const segments = relative(root, expectedTarget).split(sep).filter(Boolean);
  let current = root;
  let currentStats: Stats;
  try {
    currentStats = await lstat(root);
    if (currentStats.isSymbolicLink() || !currentStats.isDirectory()) {
      throw new FilesystemToolError('Configured filesystem root is not a safe directory.', 'invalid-path');
    }
    for (const segment of segments) {
      checkCancelled(signal);
      current = resolve(current, segment);
      currentStats = await lstat(current);
      if (currentStats.isSymbolicLink()) {
        throw new FilesystemToolError('Symbolic links are not allowed in requested paths.', 'invalid-path');
      }
    }
    const canonicalTarget = await realpath(current);
    if (!isWithin(root, canonicalTarget)) {
      throw new FilesystemToolError('The requested path is outside the allowed filesystem roots.', 'outside-root');
    }
    if (canonicalTarget !== expectedTarget) {
      throw new FilesystemToolError('Symbolic links are not allowed in requested paths.', 'invalid-path');
    }
  } catch (error) {
    throw publicFilesystemError(error);
  }

  if (kind === 'file' && !currentStats.isFile()) {
    throw new FilesystemToolError('The requested path is not a regular file.', 'invalid-path');
  }
  if (kind === 'directory' && !currentStats.isDirectory()) {
    throw new FilesystemToolError('The requested path is not a directory.', 'invalid-path');
  }
  return { root, target: current, stats: currentStats };
}

export async function resolveSafeFilesystemPath(
  inputPath: string,
  config: AppConfig,
  kind: 'file' | 'directory',
  signal: AbortSignal,
): Promise<SafeFilesystemPath> {
  return resolveAllowedPath(
    inputPath,
    await canonicalRoots(config.filesystemAllowedRoots, signal),
    kind,
    signal,
    [config.dataDirectory],
  );
}

function entryType(entry: { isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean }): EntryType {
  if (entry.isSymbolicLink()) return 'symlink';
  if (entry.isDirectory()) return 'directory';
  if (entry.isFile()) return 'file';
  return 'other';
}

function outputFits(value: unknown, maximum: number): boolean {
  return JSON.stringify(value).length <= maximum;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function retainLexicallyFirst<T extends { readonly name: string }>(
  entries: T[],
  candidate: T,
  maximum: number,
): boolean {
  if (maximum < 1) return false;
  const position = entries.findIndex(entry => compareText(entry.name, candidate.name) > 0);
  entries.splice(position < 0 ? entries.length : position, 0, candidate);
  if (entries.length > maximum) {
    entries.pop();
    return false;
  }
  return true;
}

async function hasDirectoryEntries(
  path: string,
  signal: AbortSignal,
  openDirectory: (path: string) => Promise<DirectoryHandle>,
): Promise<boolean> {
  let directory;
  let removeAbortListener: (() => void) | undefined;
  try {
    directory = await openDirectory(path);
    removeAbortListener = closeDirectoryOnAbort(directory, signal);
    checkCancelled(signal);
    return (await directory.read()) !== null;
  } catch (error) {
    throw publicFilesystemError(error);
  } finally {
    removeAbortListener?.();
    if (directory) {
      try {
        await directory.close();
      } catch {
        // The iterator may already have closed the directory handle.
      }
    }
  }
}

async function listDirectory(
  input: ListInput,
  config: AppConfig,
  signal: AbortSignal,
  openDirectory: (path: string) => Promise<DirectoryHandle>,
): Promise<ListOutput> {
  const roots = await canonicalRoots(config.filesystemAllowedRoots, signal);
  const target = await resolveAllowedPath(input.path, roots, 'directory', signal, [config.dataDirectory]);
  const limit = input.maxEntries ?? config.maxDirectoryEntries;
  const entries: ListedEntry[] = [];
  let truncated = false;
  let directory;
  let removeAbortListener: (() => void) | undefined;
  try {
    directory = await openDirectory(target.target);
    removeAbortListener = closeDirectoryOnAbort(directory, signal);
    while (true) {
      checkCancelled(signal);
      const entry = await directory.read();
      if (!entry) break;
      const candidate = { name: entry.name, type: entryType(entry) } satisfies ListedEntry;
      if (!retainLexicallyFirst(entries, candidate, limit)) {
        truncated = true;
      }
    }
  } catch (error) {
    throw publicFilesystemError(error);
  } finally {
    removeAbortListener?.();
    if (directory) {
      try {
        await directory.close();
      } catch {
        // The iterator may already have closed the directory handle.
      }
    }
  }
  while (entries.length > 0 && !outputFits({ entries, truncated: true }, config.maxToolOutputChars)) {
    entries.pop();
    truncated = true;
  }
  return { entries, truncated };
}

async function readFile(
  input: PathInput,
  config: AppConfig,
  signal: AbortSignal,
  openFile: (path: string, flags: number) => Promise<ReadFileHandle>,
): Promise<ReadOutput> {
  const roots = await canonicalRoots(config.filesystemAllowedRoots, signal);
  const target = await resolveAllowedPath(input.path, roots, 'file', signal, [config.dataDirectory]);
  if (target.stats.size > config.maxFileBytes) {
    throw new FilesystemToolError('File exceeds the configured maximum size.');
  }

  let file;
  let removeAbortListener: (() => void) | undefined;
  try {
    file = await openFile(target.target, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK);
    removeAbortListener = closeFileOnAbort(file, signal);
    const openedStats = await file.stat();
    if (!openedStats.isFile() || openedStats.dev !== target.stats.dev || openedStats.ino !== target.stats.ino) {
      throw new FilesystemToolError('File changed while it was being opened; retry the request.');
    }
    if (openedStats.size > config.maxFileBytes) {
      throw new FilesystemToolError('File exceeds the configured maximum size.');
    }

    const buffer = Buffer.alloc(config.maxFileBytes + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      checkCancelled(signal);
      const result = await file.read(buffer, bytes, buffer.length - bytes, bytes);
      if (result.bytesRead === 0) break;
      bytes += result.bytesRead;
    }
    if (bytes > config.maxFileBytes) {
      throw new FilesystemToolError('File exceeds the configured maximum size.');
    }

    let content: string;
    try {
      content = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytes));
    } catch {
      throw new FilesystemToolError('File is not valid UTF-8 text.');
    }
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(content)) {
      throw new FilesystemToolError('Binary files cannot be read as text.');
    }
    const result = { content, bytes };
    if (!outputFits(result, config.maxToolOutputChars)) {
      throw new FilesystemToolError('File content exceeds the configured tool-output limit.');
    }
    return result;
  } catch (error) {
    throw publicFilesystemError(error);
  } finally {
    removeAbortListener?.();
    if (file) {
      try {
        await file.close();
      } catch {
        // Preserve the original operation error.
      }
    }
  }
}

async function directoryTree(
  input: TreeInput,
  config: AppConfig,
  signal: AbortSignal,
  openDirectory: (path: string) => Promise<DirectoryHandle>,
): Promise<TreeOutput> {
  const roots = await canonicalRoots(config.filesystemAllowedRoots, signal);
  const target = await resolveAllowedPath(input.path, roots, 'directory', signal, [config.dataDirectory]);
  const maxDepth = input.maxDepth ?? config.maxTreeDepth;
  const maxEntries = input.maxEntries ?? config.maxDirectoryEntries;
  const entries: TreeEntry[] = [];
  let truncated = false;
  let stopTraversal = false;

  const visit = async (directoryPath: string, relativeParent: string, depth: number): Promise<void> => {
    if (depth > maxDepth || stopTraversal) return;
    checkCancelled(signal);
    let directory;
    const children: Dirent[] = [];
    let omittedChildren = false;
    let removeAbortListener: (() => void) | undefined;
    try {
      directory = await openDirectory(directoryPath);
      removeAbortListener = closeDirectoryOnAbort(directory, signal);
      while (true) {
        checkCancelled(signal);
        const entry = await directory.read();
        if (!entry) break;
        const remaining = maxEntries - entries.length;
        if (remaining <= 0) {
          omittedChildren = true;
          break;
        }
        // Scan the whole directory while retaining only the lexically first
        // candidates that can fit in the remaining global entry budget.
        if (!retainLexicallyFirst(children, entry, remaining)) omittedChildren = true;
      }
    } catch (error) {
      throw publicFilesystemError(error);
    } finally {
      removeAbortListener?.();
      if (directory) {
        try {
          await directory.close();
        } catch {
          // The iterator may already have closed the directory handle.
        }
      }
    }

    for (const child of children) {
      if (stopTraversal) break;
      if (entries.length >= maxEntries) {
        truncated = true;
        stopTraversal = true;
        break;
      }
      const entryPath = relativeParent ? `${relativeParent}/${child.name}` : child.name;
      const type = entryType(child);
      if (isProtectedFilesystemPath(resolve(directoryPath, child.name), roots, [config.dataDirectory])) {
        truncated = true;
        continue;
      }
      const candidate: TreeEntry = { name: child.name, path: entryPath, type, depth };
      if (!outputFits({ entries: [...entries, candidate], truncated: true }, config.maxToolOutputChars)) {
        truncated = true;
        stopTraversal = true;
        break;
      }
      entries.push(candidate);
      if (type !== 'directory') continue;

      let safeChild: ResolvedPath | undefined;
      try {
        safeChild = await resolveAllowedPath(
          resolve(directoryPath, child.name),
          roots,
          'directory',
          signal,
          [config.dataDirectory],
        );
      } catch (error) {
        if (
          error instanceof FilesystemToolError &&
          error.message === 'Symbolic links are not allowed in requested paths.'
        ) {
          const index = entries.findIndex(item => item.path === entryPath);
          if (index >= 0) entries[index] = { ...candidate, type: 'symlink' };
        } else {
          throw error;
        }
      }
      if (!safeChild) continue;
      if (depth < maxDepth) {
        await visit(safeChild.target, entryPath, depth + 1);
      } else if (await hasDirectoryEntries(safeChild.target, signal, openDirectory)) {
        truncated = true;
      }
    }

    if (omittedChildren) {
      truncated = true;
      stopTraversal = true;
    }
  };

  try {
    await visit(target.target, '', 1);
  } catch (error) {
    throw publicFilesystemError(error);
  }
  entries.sort((left, right) => compareText(left.path, right.path));
  return { entries, truncated };
}

async function searchFilesystem(
  input: SearchInput,
  config: AppConfig,
  signal: AbortSignal,
  openDirectory: (path: string) => Promise<DirectoryHandle>,
): Promise<SearchOutput> {
  const roots = await canonicalRoots(config.filesystemAllowedRoots, signal);
  const targetPath = input.path ?? roots[0]?.configured;
  if (!targetPath) {
    throw new FilesystemToolError('Filesystem access is unavailable because no allowed roots are configured.', 'permission-denied');
  }
  const target = await resolveAllowedPath(targetPath, roots, 'directory', signal, [config.dataDirectory]);
  const query = input.query.toLocaleLowerCase();
  const limit = input.maxEntries ?? config.maxDirectoryEntries;
  const directoryLimit = 10_000;
  const depthLimit = 32;
  const prioritizeHome = input.path === undefined && roots.some(root => root.canonical === sep);
  const home = resolve(homedir());
  const projectRootNames = new Set([
    'code',
    'codes',
    'developer',
    'development',
    'dev',
    'documents',
    'desktop',
    'downloads',
    'projects',
    'repos',
    'repositories',
    'source',
    'src',
    'work',
    'workspace',
    'workspaces',
  ]);
  const projectPending: { path: string; depth: number }[] = [];
  const homePending: { path: string; depth: number }[] = [];
  const otherPending: { path: string; depth: number }[] = [];
  let projectIndex = 0;
  let homeIndex = 0;
  let otherIndex = 0;
  const enqueue = (directory: { path: string; depth: number }): void => {
    const path = resolve(directory.path);
    const relativeToHome = relative(home, path);
    const isInsideHome = relativeToHome === '' ||
      (!isAbsolute(relativeToHome) &&
        relativeToHome !== '..' &&
        !relativeToHome.startsWith(`..${sep}`));
    const firstHomeSegment = relativeToHome.split(sep)[0]?.toLocaleLowerCase();
    const prioritizedProjectPath = isInsideHome && (
      relativeToHome === '' ||
      (firstHomeSegment !== undefined && projectRootNames.has(firstHomeSegment))
    );
    const isAncestorOfHome = path === sep || home.startsWith(`${path}${sep}`);
    if (prioritizeHome && (prioritizedProjectPath || isAncestorOfHome)) {
      projectPending.push(directory);
    } else if (prioritizeHome && isInsideHome) {
      homePending.push(directory);
    } else {
      otherPending.push(directory);
    }
  };
  enqueue({ path: target.target, depth: 0 });
  const matches: SearchOutput['matches'][number][] = [];
  let scannedDirectories = 0;
  let skippedDirectories = 0;
  let truncated = false;
  let exactNameMatchFound = false;

  while (
    projectIndex < projectPending.length ||
    homeIndex < homePending.length ||
    otherIndex < otherPending.length
  ) {
    checkCancelled(signal);
    if (scannedDirectories >= directoryLimit || matches.length >= limit) {
      truncated = true;
      break;
    }
    const current = projectIndex < projectPending.length
      ? projectPending[projectIndex++]
      : homeIndex < homePending.length
        ? homePending[homeIndex++]
        : otherPending[otherIndex++];
    if (!current) break;
    let directory;
    let removeAbortListener: (() => void) | undefined;
    const children: Dirent[] = [];
    try {
      directory = await openDirectory(current.path);
      removeAbortListener = closeDirectoryOnAbort(directory, signal);
      scannedDirectories += 1;
      while (true) {
        checkCancelled(signal);
        const entry = await directory.read();
        if (!entry) break;
        if (!retainLexicallyFirst(children, entry, 1_000)) truncated = true;
      }
    } catch (error) {
      if (
        scannedDirectories > 0 &&
        error instanceof Error &&
        typeof error === 'object' &&
        'code' in error &&
        (error.code === 'EACCES' || error.code === 'EPERM' || error.code === 'ENOENT' || error.code === 'ENOTDIR')
      ) {
        skippedDirectories += 1;
        truncated = true;
        continue;
      }
      throw publicFilesystemError(error);
    } finally {
      removeAbortListener?.();
      if (directory) {
        try {
          await directory.close();
        } catch {
          // The iterator may already have closed the directory handle.
        }
      }
    }

    const childDirectories: string[] = [];
    for (const child of children) {
      checkCancelled(signal);
      const childPath = resolve(current.path, child.name);
      const type = entryType(child);
      if (isProtectedFilesystemPath(childPath, roots, [config.dataDirectory])) {
        if (type === 'directory') skippedDirectories += 1;
        truncated = true;
        continue;
      }
      if ((type === 'file' || type === 'directory') && child.name.toLocaleLowerCase().includes(query)) {
        matches.push({ path: childPath, type });
        if (child.name.toLocaleLowerCase() === query) {
          exactNameMatchFound = true;
          break;
        }
        if (matches.length >= limit) {
          truncated = true;
          break;
        }
      }
      if (type !== 'directory') continue;
      if (current.depth >= depthLimit) {
        truncated = true;
        continue;
      }
      try {
        const safeChild = await resolveAllowedPath(
          childPath,
          roots,
          'directory',
          signal,
          [config.dataDirectory],
        );
        childDirectories.push(safeChild.target);
      } catch (error) {
        if (
          error instanceof FilesystemToolError &&
          ['invalid-path', 'permission-denied', 'not-found'].includes(error.code)
        ) {
          skippedDirectories += 1;
          truncated = true;
          continue;
        }
        throw error;
      }
    }
    if (exactNameMatchFound) {
      truncated = true;
      break;
    }
    for (const childPath of childDirectories) {
      enqueue({ path: childPath, depth: current.depth + 1 });
    }
  }

  matches.sort((left, right) => compareText(left.path, right.path));
  while (
    matches.length > 0 &&
    !outputFits(
      { matches, scannedDirectories, skippedDirectories, truncated: true },
      config.maxToolOutputChars,
    )
  ) {
    matches.pop();
    truncated = true;
  }
  return { matches, scannedDirectories, skippedDirectories, truncated };
}

function isListOutput(value: unknown): value is ListOutput {
  return isRecord(value) &&
    Array.isArray(value.entries) &&
    value.entries.every(entry =>
      isRecord(entry) &&
      typeof entry.name === 'string' &&
      ['file', 'directory', 'symlink', 'other'].includes(String(entry.type)) &&
      exactKeys(entry, ['name', 'type'])) &&
    typeof value.truncated === 'boolean' &&
    exactKeys(value, ['entries', 'truncated']);
}

function isTreeOutput(value: unknown): value is TreeOutput {
  return isRecord(value) &&
    Array.isArray(value.entries) &&
    value.entries.every(entry =>
      isRecord(entry) &&
      typeof entry.name === 'string' &&
      typeof entry.path === 'string' &&
      Number.isSafeInteger(entry.depth) &&
      ['file', 'directory', 'symlink', 'other'].includes(String(entry.type)) &&
      exactKeys(entry, ['name', 'path', 'type', 'depth'])) &&
    typeof value.truncated === 'boolean' &&
    exactKeys(value, ['entries', 'truncated']);
}

function isReadOutput(value: unknown): value is ReadOutput {
  return isRecord(value) &&
    typeof value.content === 'string' &&
    validUnicode(value.content) &&
    Number.isSafeInteger(value.bytes) &&
    exactKeys(value, ['content', 'bytes']);
}

function isSearchOutput(value: unknown): value is SearchOutput {
  return isRecord(value) &&
    Array.isArray(value.matches) &&
    value.matches.every(match =>
      isRecord(match) &&
      typeof match.path === 'string' &&
      (match.type === 'file' || match.type === 'directory') &&
      exactKeys(match, ['path', 'type'])) &&
    Number.isSafeInteger(value.scannedDirectories) &&
    Number.isSafeInteger(value.skippedDirectories) &&
    typeof value.truncated === 'boolean' &&
    exactKeys(value, ['matches', 'scannedDirectories', 'skippedDirectories', 'truncated']);
}

function isOperationOutput(value: unknown): value is OperationOutput {
  return isRecord(value) &&
    (value.status === 'applied' || value.status === 'rejected') &&
    typeof value.operation === 'string' &&
    ['create-file', 'create-directory', 'edit-file', 'delete'].includes(value.operation) &&
    typeof value.path === 'string' &&
    exactKeys(value, ['status', 'operation', 'path']);
}

export function registerFilesystemTools(
  registry: ToolRegistry,
  config: AppConfig,
  operations: FilesystemToolOperations = {},
  approval?: FileOperationApprovalPort,
): void {
  const openDirectory = operations.openDirectory ?? (path => opendir(path));
  const openFile = operations.openFile ?? ((path, flags) => open(path, flags));
  const listDirectoryTool: Tool<ListInput, ListOutput> = {
    id: 'filesystem.list-directory',
    effect: 'read',
    description: 'List direct children only (not recursively). Required path is the exact absolute path inside an allowed root; preserve it including spaces and Unicode. Optional maxEntries is a JSON integer; omit for the configured default. Never use tree-only arguments.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Exact absolute path inside an allowed root; preserve spaces, punctuation, and Unicode.', maxLength: 4096, pattern: '^/' },
        maxEntries: {
          type: 'integer',
          description: 'Optional maximum returned entries; omit to use the configured default.',
          nullable: true,
          minimum: 1,
          maximum: config.maxDirectoryEntries,
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
    validateInput(value): value is ListInput {
      return isRecord(value) &&
        exactKeys(value, ['path', 'maxEntries']) &&
        validPath(value.path) &&
        boundedOptionalInteger(value.maxEntries, config.maxDirectoryEntries);
    },
    inputError(value) {
      return inputError(value, ['path', 'maxEntries'], {
        maxEntries: config.maxDirectoryEntries,
      });
    },
    validateOutput: isListOutput,
    run(input, signal) {
      return listDirectory(input, config, signal, openDirectory);
    },
  };
  const readFileTool: Tool<PathInput, ReadOutput> = {
    id: 'filesystem.read-file',
    effect: 'read',
    description: 'Read one bounded UTF-8 text file. Required path is the exact absolute path inside an allowed root; preserve spaces, punctuation, and Unicode.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Exact absolute path inside an allowed root; preserve spaces, punctuation, and Unicode.', maxLength: 4096, pattern: '^/' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    validateInput(value): value is PathInput {
      return isRecord(value) && exactKeys(value, ['path']) && validPath(value.path);
    },
    inputError(value) {
      return inputError(value, ['path'], {});
    },
    validateOutput: isReadOutput,
    run(input, signal) {
      return readFile(input, config, signal, openFile);
    },
  };
  const tree: Tool<TreeInput, TreeOutput> = {
    id: 'filesystem.directory-tree',
    effect: 'read',
    description: 'Return a recursive tree (not a direct-child listing). Required path is the exact absolute path inside an allowed root; preserve spaces and Unicode. Optional maxDepth and maxEntries are JSON integers; omit either for its configured default. Does not follow symlinks.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Exact absolute path inside an allowed root; preserve spaces, punctuation, and Unicode.', maxLength: 4096, pattern: '^/' },
        maxDepth: {
          type: 'integer',
          description: 'Optional maximum tree depth; omit to use the configured default.',
          nullable: true,
          minimum: 1,
          maximum: config.maxTreeDepth,
        },
        maxEntries: {
          type: 'integer',
          description: 'Optional maximum total tree entries; omit to use the configured default.',
          nullable: true,
          minimum: 1,
          maximum: config.maxDirectoryEntries,
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
    validateInput(value): value is TreeInput {
      return isRecord(value) &&
        exactKeys(value, ['path', 'maxDepth', 'maxEntries']) &&
        validPath(value.path) &&
        boundedOptionalInteger(value.maxDepth, config.maxTreeDepth) &&
        boundedOptionalInteger(value.maxEntries, config.maxDirectoryEntries);
    },
    inputError(value) {
      return inputError(value, ['path', 'maxDepth', 'maxEntries'], {
        maxDepth: config.maxTreeDepth,
        maxEntries: config.maxDirectoryEntries,
      });
    },
    validateOutput: isTreeOutput,
    run(input, signal) {
      return directoryTree(input, config, signal, openDirectory);
    },
  };
  const search: Tool<SearchInput, SearchOutput> = {
    id: 'filesystem.search',
    effect: 'read',
    description: 'Search file and folder names by case-insensitive substring. If path is omitted, search starts at the configured filesystem root. Results are bounded, protected system and credential paths are skipped, and symlinks are never followed.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Non-empty case-insensitive filename or folder-name substring.', maxLength: 256 },
        path: { type: 'string', description: 'Optional exact absolute directory path to search; omit to search from the configured root.', nullable: true, maxLength: 4096, pattern: '^/' },
        maxEntries: {
          type: 'integer',
          description: 'Optional maximum number of matches; omit to use the configured default.',
          nullable: true,
          minimum: 1,
          maximum: config.maxDirectoryEntries,
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    validateInput(value): value is SearchInput {
      return isRecord(value) &&
        exactKeys(value, ['query', 'path', 'maxEntries']) &&
        typeof value.query === 'string' &&
        value.query.trim().length > 0 &&
        value.query.length <= 256 &&
        (value.path === undefined || validPath(value.path)) &&
        boundedOptionalInteger(value.maxEntries, config.maxDirectoryEntries);
    },
    inputError(value) {
      if (!isRecord(value) || !exactKeys(value, ['query', 'path', 'maxEntries'])) {
        return 'Use only the query, optional path, and optional maxEntries arguments.';
      }
      if (typeof value.query !== 'string' || value.query.trim() === '' || value.query.length > 256) {
        return 'Query must be a non-empty filename or folder-name substring of at most 256 characters.';
      }
      if (value.path !== undefined && !validPath(value.path)) {
        return 'Path must be an absolute directory path without parent-directory traversal.';
      }
      return inputError({ path: value.path ?? '/' , maxEntries: value.maxEntries }, ['path', 'maxEntries'], {
        maxEntries: config.maxDirectoryEntries,
      });
    },
    validateOutput: isSearchOutput,
    run(input, signal) {
      return searchFilesystem(input, config, signal, openDirectory);
    },
  };
  registry.register(listDirectoryTool);
  registry.register(readFileTool);
  registry.register(tree);
  registry.register(search);
  if (approval) {
    const contentMaximum = Math.min(config.maxFileBytes, 16_384);
    const contentOperation = (
      id: string,
      operation: 'create-file' | 'edit-file',
    ): Tool<ContentInput, OperationOutput> => ({
      id,
      effect: 'propose',
      description: `${operation === 'create-file' ? 'Propose creating' : 'Propose replacing'} one UTF-8 text file at an exact absolute path. Vyomara displays the full current/proposed contents and requires explicit user approval before any write.`,
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Exact absolute file path; preserve spaces and Unicode.', maxLength: 4096, pattern: '^/' },
          content: { type: 'string', description: 'Complete replacement UTF-8 text content.', maxLength: contentMaximum },
        },
        required: ['path', 'content'],
        additionalProperties: false,
      },
      validateInput(value): value is ContentInput {
        return isRecord(value) &&
          exactKeys(value, ['path', 'content']) &&
          validPath(value.path) &&
          typeof value.content === 'string' &&
          Buffer.byteLength(value.content, 'utf8') <= contentMaximum &&
          !/[\u0000\u0007-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value.content);
      },
      inputError(value) {
        if (!isRecord(value) || !exactKeys(value, ['path', 'content'])) {
          return 'Use only the path and content arguments.';
        }
        if (!validPath(value.path)) return 'Path must be an absolute path without parent-directory traversal.';
        return `Content must be UTF-8 text of at most ${contentMaximum} bytes without binary control characters.`;
      },
      validateOutput: isOperationOutput,
      async run(input, signal) {
        const request: FileOperationRequest = { operation, path: input.path, content: input.content };
        const result = await approval.request(request, signal);
        return { ...result, operation, path: input.path };
      },
    });
    const createDirectory: Tool<PathInput, OperationOutput> = {
      id: 'filesystem.propose-create-directory',
      effect: 'propose',
      description: 'Propose creating one empty directory under an existing parent directory. Vyomara requires explicit user approval.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Exact absolute destination directory path.', maxLength: 4096, pattern: '^/' },
        },
        required: ['path'],
        additionalProperties: false,
      },
      validateInput(value): value is PathInput {
        return isRecord(value) && exactKeys(value, ['path']) && validPath(value.path);
      },
      inputError(value) {
        return inputError(value, ['path'], {});
      },
      validateOutput: isOperationOutput,
      async run(input, signal) {
        const result = await approval.request({ operation: 'create-directory', path: input.path }, signal);
        return { ...result, operation: 'create-directory', path: input.path };
      },
    };
    const deletePath: Tool<PathInput, OperationOutput> = {
      id: 'filesystem.propose-delete',
      effect: 'propose',
      description: 'Propose moving one exact file or directory to the system Trash. Vyomara requires a separate explicit confirmation for every item.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Exact absolute file or directory path to move to Trash.', maxLength: 4096, pattern: '^/' },
        },
        required: ['path'],
        additionalProperties: false,
      },
      validateInput(value): value is PathInput {
        return isRecord(value) && exactKeys(value, ['path']) && validPath(value.path);
      },
      inputError(value) {
        return inputError(value, ['path'], {});
      },
      validateOutput: isOperationOutput,
      async run(input, signal) {
        const result = await approval.request({ operation: 'delete', path: input.path }, signal);
        return { ...result, operation: 'delete', path: input.path };
      },
    };
    registry.register(contentOperation('filesystem.propose-create-file', 'create-file'));
    registry.register(contentOperation('filesystem.propose-edit', 'edit-file'));
    registry.register(createDirectory);
    registry.register(deletePath);
  }
}

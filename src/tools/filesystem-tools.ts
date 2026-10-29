import { constants as fsConstants } from 'node:fs';
import { lstat, open, opendir, realpath, stat } from 'node:fs/promises';
import type { Dir, Dirent, Stats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { AppConfig } from '../config/config.ts';
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

interface CanonicalRoot {
  readonly configured: string;
  readonly canonical: string;
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

function validPath(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 4096 &&
    !value.includes('\0') &&
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
  const child = relative(root, target);
  return child === '' ||
    (!isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`));
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
): Promise<ResolvedPath> {
  if (!validPath(inputPath)) {
    throw new FilesystemToolError(
      'The filesystem path is invalid; use an absolute path without parent traversal.',
      'invalid-path',
    );
  }
  const normalized = resolve(inputPath);
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
  const target = await resolveAllowedPath(input.path, roots, 'directory', signal);
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
  const target = await resolveAllowedPath(input.path, roots, 'file', signal);
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
  const target = await resolveAllowedPath(input.path, roots, 'directory', signal);
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
    Number.isSafeInteger(value.bytes) &&
    exactKeys(value, ['content', 'bytes']);
}

export function registerFilesystemTools(
  registry: ToolRegistry,
  config: AppConfig,
  operations: FilesystemToolOperations = {},
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
  registry.register(listDirectoryTool);
  registry.register(readFileTool);
  registry.register(tree);
}

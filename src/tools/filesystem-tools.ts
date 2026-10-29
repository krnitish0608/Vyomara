import { constants as fsConstants } from 'node:fs';
import { lstat, open, opendir, realpath, stat } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { AppConfig } from '../config/config.ts';
import type { Tool } from './contracts.ts';
import type { ToolRegistry } from './contracts.ts';

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

class FilesystemToolError extends Error {
  constructor(message: string) {
    super(message);
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

function isWithin(root: string, target: string): boolean {
  const child = relative(root, target);
  return child === '' ||
    (!isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`));
}

function checkCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new FilesystemToolError('Filesystem operation was cancelled.');
}

function publicFilesystemError(error: unknown): FilesystemToolError {
  if (error instanceof FilesystemToolError) return error;
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? error.code
    : undefined;
  if (code === 'ENOENT' || code === 'ENOTDIR') {
    return new FilesystemToolError('Requested filesystem path does not exist.');
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return new FilesystemToolError('Filesystem path is not accessible.');
  }
  if (code === 'ELOOP') {
    return new FilesystemToolError('Symbolic links are not allowed in requested paths.');
  }
  return new FilesystemToolError('Filesystem operation failed safely.');
}

async function canonicalRoots(roots: readonly string[], signal: AbortSignal): Promise<CanonicalRoot[]> {
  if (roots.length === 0) {
    throw new FilesystemToolError('Filesystem access is disabled; no allowed roots are configured.');
  }
  const result: CanonicalRoot[] = [];
  for (const configuredRoot of roots) {
    checkCancelled(signal);
    try {
      const root = await realpath(configuredRoot);
      if (!(await stat(root)).isDirectory()) {
        throw new FilesystemToolError('A configured filesystem root is not a directory.');
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
    throw new FilesystemToolError('Filesystem paths must be absolute, valid, and contain no parent traversal.');
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
    throw new FilesystemToolError('Requested path is outside the configured allowed roots.');
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
    throw new FilesystemToolError('Symbolic links are not allowed in requested paths.');
  }
  if (actualTarget !== expectedTarget) {
    throw new FilesystemToolError('Symbolic links are not allowed in requested paths.');
  }

  const segments = relative(root, expectedTarget).split(sep).filter(Boolean);
  let current = root;
  let currentStats: Stats;
  try {
    currentStats = await lstat(root);
    if (currentStats.isSymbolicLink() || !currentStats.isDirectory()) {
      throw new FilesystemToolError('Configured filesystem root is not a safe directory.');
    }
    for (const segment of segments) {
      checkCancelled(signal);
      current = resolve(current, segment);
      currentStats = await lstat(current);
      if (currentStats.isSymbolicLink()) {
        throw new FilesystemToolError('Symbolic links are not allowed in requested paths.');
      }
    }
    const canonicalTarget = await realpath(current);
    if (!isWithin(root, canonicalTarget)) {
      throw new FilesystemToolError('Requested path is outside the configured allowed roots.');
    }
    if (canonicalTarget !== expectedTarget) {
      throw new FilesystemToolError('Symbolic links are not allowed in requested paths.');
    }
  } catch (error) {
    throw publicFilesystemError(error);
  }

  if (kind === 'file' && !currentStats.isFile()) {
    throw new FilesystemToolError('Requested path is not a regular file.');
  }
  if (kind === 'directory' && !currentStats.isDirectory()) {
    throw new FilesystemToolError('Requested path is not a directory.');
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

async function listDirectory(
  input: ListInput,
  config: AppConfig,
  signal: AbortSignal,
): Promise<ListOutput> {
  const roots = await canonicalRoots(config.filesystemAllowedRoots, signal);
  const target = await resolveAllowedPath(input.path, roots, 'directory', signal);
  const limit = input.maxEntries ?? config.maxDirectoryEntries;
  const entries: ListedEntry[] = [];
  let truncated = false;
  let directory;
  try {
    directory = await opendir(target.target);
    while (true) {
      checkCancelled(signal);
      const entry = await directory.read();
      if (!entry) break;
      if (entries.length >= limit) {
        truncated = true;
        break;
      }
      const candidate = { name: entry.name, type: entryType(entry) } satisfies ListedEntry;
      if (!outputFits({ entries: [...entries, candidate], truncated: true }, config.maxToolOutputChars)) {
        truncated = true;
        break;
      }
      entries.push(candidate);
    }
  } catch (error) {
    throw publicFilesystemError(error);
  } finally {
    if (directory) {
      try {
        await directory.close();
      } catch {
        // The iterator may already have closed the directory handle.
      }
    }
  }
  entries.sort((left, right) => left.name.localeCompare(right.name));
  return { entries, truncated };
}

async function readFile(
  input: PathInput,
  config: AppConfig,
  signal: AbortSignal,
): Promise<ReadOutput> {
  const roots = await canonicalRoots(config.filesystemAllowedRoots, signal);
  const target = await resolveAllowedPath(input.path, roots, 'file', signal);
  if (target.stats.size > config.maxFileBytes) {
    throw new FilesystemToolError('File exceeds the configured maximum size.');
  }

  let file;
  try {
    file = await open(target.target, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK);
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
    if (content.includes('\0')) {
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
    try {
      directory = await opendir(directoryPath);
      while (true) {
        checkCancelled(signal);
        const entry = await directory.read();
        if (!entry) break;
        if (entries.length >= maxEntries) {
          truncated = true;
          stopTraversal = true;
          break;
        }
        const entryPath = relativeParent ? `${relativeParent}/${entry.name}` : entry.name;
        const type = entryType(entry);
        const candidate: TreeEntry = { name: entry.name, path: entryPath, type, depth };
        if (!outputFits({ entries: [...entries, candidate], truncated: true }, config.maxToolOutputChars)) {
          truncated = true;
          stopTraversal = true;
          break;
        }
        entries.push(candidate);
        if (type === 'directory' && depth < maxDepth) {
          let safeChild: ResolvedPath | undefined;
          try {
            safeChild = await resolveAllowedPath(
              resolve(directoryPath, entry.name),
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
          if (safeChild && !stopTraversal) {
            await visit(safeChild.target, entryPath, depth + 1);
          }
        } else if (type === 'directory') {
          truncated = true;
        }
        if (stopTraversal) break;
      }
    } catch (error) {
      throw publicFilesystemError(error);
    } finally {
      if (directory) {
        try {
          await directory.close();
        } catch {
          // The iterator may already have closed the directory handle.
        }
      }
    }
  };

  try {
    await visit(target.target, '', 1);
  } catch (error) {
    throw publicFilesystemError(error);
  }
  entries.sort((left, right) => left.path.localeCompare(right.path));
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

export function registerFilesystemTools(registry: ToolRegistry, config: AppConfig): void {
  const listDirectoryTool: Tool<ListInput, ListOutput> = {
    id: 'filesystem.list-directory',
    effect: 'read',
    validateInput(value): value is ListInput {
      return isRecord(value) &&
        exactKeys(value, ['path', 'maxEntries']) &&
        validPath(value.path) &&
        boundedOptionalInteger(value.maxEntries, config.maxDirectoryEntries);
    },
    validateOutput: isListOutput,
    run(input, signal) {
      return listDirectory(input, config, signal);
    },
  };
  const readFileTool: Tool<PathInput, ReadOutput> = {
    id: 'filesystem.read-file',
    effect: 'read',
    validateInput(value): value is PathInput {
      return isRecord(value) && exactKeys(value, ['path']) && validPath(value.path);
    },
    validateOutput: isReadOutput,
    run(input, signal) {
      return readFile(input, config, signal);
    },
  };
  const tree: Tool<TreeInput, TreeOutput> = {
    id: 'filesystem.directory-tree',
    effect: 'read',
    validateInput(value): value is TreeInput {
      return isRecord(value) &&
        exactKeys(value, ['path', 'maxDepth', 'maxEntries']) &&
        validPath(value.path) &&
        boundedOptionalInteger(value.maxDepth, config.maxTreeDepth) &&
        boundedOptionalInteger(value.maxEntries, config.maxDirectoryEntries);
    },
    validateOutput: isTreeOutput,
    run(input, signal) {
      return directoryTree(input, config, signal);
    },
  };
  registry.register(listDirectoryTool);
  registry.register(readFileTool);
  registry.register(tree);
}

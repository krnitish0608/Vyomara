import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, open, realpath, rename, unlink } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';

export interface DesktopEditProposal {
  readonly id: string;
  readonly path: string;
  readonly diff: string;
}

export class EditProposalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EditProposalError';
  }
}

interface PendingEdit {
  readonly proposal: DesktopEditProposal;
  readonly originalHash: string;
  readonly proposedContent: string;
  readonly mode: number;
}

interface ProjectFile {
  readonly absolutePath: string;
  readonly content: string;
  readonly hash: string;
  readonly mode: number;
}

const maximumFileBytes = 16_384;
const maximumProposals = 3;

function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function makeDiff(path: string, before: string, after: string): string {
  const diffLines = (prefix: '-' | '+', content: string): string[] => {
    if (content === '') return [];
    const lines = content.split('\n');
    const endsWithNewline = lines.at(-1) === '';
    if (endsWithNewline) lines.pop();
    return lines.map((line, index) => {
      const marker = index === lines.length - 1 && !endsWithNewline
        ? '\n\\ No newline at end of file'
        : '';
      return `${prefix}${line}${marker}`;
    });
  };
  return [
    `--- a/${path}`,
    `+++ b/${path}`,
    ...diffLines('-', before),
    ...diffLines('+', after),
  ].join('\n');
}

function validateRelativePath(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 1_024 &&
    value.trim() === value &&
    !isAbsolute(value) &&
    !/[\u0000-\u001f\u007f]/u.test(value) &&
    !value.includes('\\') &&
    value.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}

function isSensitiveFile(path: string): boolean {
  const parts = path.toLowerCase().split('/');
  const name = basename(path).toLowerCase();
  return parts.some(part => ['.aws', '.gnupg', '.ssh'].includes(part)) ||
    name === '.env' ||
    name.startsWith('.env.') ||
    ['.npmrc', '.netrc', '.pypirc', '.git-credentials'].includes(name) ||
    /(^|[._-])(?:credentials?|secrets?)(?:[._-]|$)/u.test(name) ||
    ['.pem', '.key', '.p12', '.pfx'].some(extension => name.endsWith(extension));
}

async function readProjectFile(root: string, path: string): Promise<ProjectFile> {
  if (!validateRelativePath(path)) throw new EditProposalError('Use a relative path inside the selected project.');
  if (isSensitiveFile(path)) throw new EditProposalError('Sensitive environment and key files cannot be edited.');

  const canonicalRoot = await realpath(root);
  if (canonicalRoot !== root) throw new EditProposalError('The selected project folder changed; select it again.');
  const absolutePath = resolve(root, ...path.split('/'));
  const relativePath = relative(root, absolutePath);
  if (
    relativePath === '' ||
    isAbsolute(relativePath) ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`)
  ) {
    throw new EditProposalError('The requested file is outside the selected project.');
  }

  let current = root;
  const segments = relativePath.split(sep);
  for (let index = 0; index < segments.length; index += 1) {
    current = resolve(current, segments[index]!);
    const stats = await lstat(current);
    if (stats.isSymbolicLink()) throw new EditProposalError('Symbolic links are not allowed in project edit paths.');
    if (index < segments.length - 1 && !stats.isDirectory()) {
      throw new EditProposalError('A project path component is not a directory.');
    }
    if (index === segments.length - 1 && (!stats.isFile() || stats.nlink !== 1)) {
      throw new EditProposalError('Only regular, singly linked project files can be edited.');
    }
  }

  const file = await open(absolutePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK);
  try {
    const stats = await file.stat();
    const pathStats = await lstat(absolutePath);
    if (
      !stats.isFile() ||
      stats.dev !== pathStats.dev ||
      stats.ino !== pathStats.ino ||
      (typeof process.getuid === 'function' && stats.uid !== process.getuid())
    ) {
      throw new EditProposalError('The project file changed or is not owned by the current user; retry or choose another file.');
    }
    if (stats.size > maximumFileBytes) {
      throw new EditProposalError(`Project files larger than ${maximumFileBytes} bytes are not supported for approved edits.`);
    }
    const buffer = Buffer.alloc(maximumFileBytes + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const result = await file.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
      if (result.bytesRead === 0) break;
      bytesRead += result.bytesRead;
    }
    if (bytesRead > maximumFileBytes) {
      throw new EditProposalError(`Project files larger than ${maximumFileBytes} bytes are not supported for approved edits.`);
    }
    const content = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead));
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(content)) {
      throw new EditProposalError('Binary files cannot be edited.');
    }
    return {
      absolutePath,
      content,
      hash: hashContent(content),
      mode: stats.mode & 0o777,
    };
  } finally {
    await file.close();
  }
}

export class EditProposalManager {
  readonly #projectDirectory: string;
  readonly #pending = new Map<string, PendingEdit>();

  constructor(projectDirectory: string) {
    if (!isAbsolute(projectDirectory) || projectDirectory.trim() !== projectDirectory) {
      throw new EditProposalError('A valid selected project directory is required.');
    }
    this.#projectDirectory = projectDirectory;
  }

  list(): readonly DesktopEditProposal[] {
    return [...this.#pending.values()].map(item => item.proposal);
  }

  async propose(path: unknown, content: unknown, signal: AbortSignal): Promise<{
    readonly proposalId: string;
    readonly path: string;
    readonly status: 'awaiting-approval';
  }> {
    if (signal.aborted) throw new EditProposalError('The project edit proposal was cancelled.');
    if (this.#pending.size >= maximumProposals) {
      throw new EditProposalError(`A request can propose at most ${maximumProposals} project files.`);
    }
    if (!validateRelativePath(path)) throw new EditProposalError('Use a relative path inside the selected project.');
    if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > maximumFileBytes) {
      throw new EditProposalError(`Proposed file content must be text no larger than ${maximumFileBytes} bytes.`);
    }
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(content)) {
      throw new EditProposalError('Binary or control-character content cannot be proposed.');
    }
    if ([...this.#pending.values()].some(item => item.proposal.path === path)) {
      throw new EditProposalError('This file already has a pending proposal in the current request.');
    }

    const current = await readProjectFile(this.#projectDirectory, path);
    if (current.content === content) throw new EditProposalError('The proposed content does not change this file.');
    if (signal.aborted) throw new EditProposalError('The project edit proposal was cancelled.');

    const id = randomUUID();
    const proposal = { id, path, diff: makeDiff(path, current.content, content) };
    this.#pending.set(id, {
      proposal,
      originalHash: current.hash,
      proposedContent: content,
      mode: current.mode,
    });
    return { proposalId: id, path, status: 'awaiting-approval' };
  }

  async apply(id: unknown): Promise<{ readonly path: string; readonly status: 'applied' }> {
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) {
      throw new EditProposalError('The selected edit proposal is invalid.');
    }
    const pending = this.#pending.get(id);
    if (!pending) throw new EditProposalError('This edit proposal is no longer pending.');

    const current = await readProjectFile(this.#projectDirectory, pending.proposal.path);
    if (current.hash !== pending.originalHash) {
      throw new EditProposalError('The file changed after this diff was created. Reject it and request a fresh proposal.');
    }

    const temporaryPath = resolve(
      this.#projectDirectory,
      ...pending.proposal.path.split('/').slice(0, -1),
      `.vyomara-${id}.tmp`,
    );
    const temporaryFile = await open(
      temporaryPath,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW,
      pending.mode,
    );
    let closed = false;
    try {
      await temporaryFile.writeFile(pending.proposedContent, 'utf8');
      await temporaryFile.sync();
      await temporaryFile.close();
      closed = true;

      const latest = await readProjectFile(this.#projectDirectory, pending.proposal.path);
      if (latest.hash !== pending.originalHash) {
        throw new EditProposalError('The file changed while the approved edit was being applied; no replacement was made.');
      }
      await rename(temporaryPath, current.absolutePath);
      this.#pending.delete(id);
      return { path: pending.proposal.path, status: 'applied' };
    } catch (error) {
      if (!closed) await temporaryFile.close();
      try {
        await unlink(temporaryPath);
      } catch (cleanupError) {
        if (typeof cleanupError !== 'object' || cleanupError === null || !('code' in cleanupError) || cleanupError.code !== 'ENOENT') {
          throw new AggregateError([error, cleanupError], 'The edit failed and its temporary file could not be removed.');
        }
      }
      throw error;
    }
  }

  reject(id: unknown): boolean {
    if (typeof id !== 'string') throw new EditProposalError('The selected edit proposal is invalid.');
    return this.#pending.delete(id);
  }
}

import { spawn } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type { ChildProcess } from 'node:child_process';

export const approvedChecks = {
  test: { label: 'pnpm test', arguments: ['test'] },
  typecheck: { label: 'pnpm typecheck', arguments: ['typecheck'] },
  'build:desktop': { label: 'pnpm build:desktop', arguments: ['build:desktop'] },
  'test:desktop-ui': { label: 'pnpm test:desktop-ui', arguments: ['test:desktop-ui'] },
} as const;

export type ApprovedCheckId = keyof typeof approvedChecks;

export interface ApprovedCheckResult {
  readonly checkId: ApprovedCheckId;
  readonly command: string;
  readonly status: 'passed' | 'failed' | 'cancelled' | 'timed-out' | 'output-limit';
  readonly exitCode: number | null;
  readonly output: string;
  readonly durationMs: number;
}

const maximumOutputChars = 64_000;
const maximumRunMs = 5 * 60 * 1000;

function isCheckId(value: unknown): value is ApprovedCheckId {
  return typeof value === 'string' && Object.hasOwn(approvedChecks, value);
}

export async function validateCheckDirectory(path: unknown): Promise<string> {
  if (
    typeof path !== 'string' ||
    !isAbsolute(path) ||
    path.trim() !== path ||
    path.includes('\0')
  ) {
    throw new Error('Choose a valid project directory.');
  }
  const canonical = await realpath(path);
  if (!(await stat(canonical)).isDirectory()) {
    throw new Error('The selected project path is not a directory.');
  }
  return canonical;
}

function stopProcess(child: ChildProcess, killTimerRef: { timer?: NodeJS.Timeout }): void {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
  if (killTimerRef.timer) return;
  killTimerRef.timer = setTimeout(() => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    try {
      process.kill(-child.pid!, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }, 1_000);
  killTimerRef.timer.unref();
}

export async function runApprovedCheck(
  directory: string,
  checkId: unknown,
  signal: AbortSignal,
): Promise<ApprovedCheckResult> {
  if (!isCheckId(checkId)) throw new Error('The selected project check is not supported.');
  const cwd = await validateCheckDirectory(directory);
  const check = approvedChecks[checkId];
  const startedAt = Date.now();
  const child = spawn('pnpm', check.arguments, {
    cwd,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
    shell: false,
  });
  let output = '';
  let status: ApprovedCheckResult['status'] = 'failed';
  let outputLimitReached = false;
  let timedOut = false;
  let cancelled = false;
  const killTimerRef: { timer?: NodeJS.Timeout } = {};
  child.once('close', () => clearTimeout(killTimerRef.timer));

  const append = (chunk: Buffer | string): void => {
    const text = chunk.toString();
    const remaining = maximumOutputChars - output.length;
    output += text.slice(0, Math.max(0, remaining));
    if (text.length > remaining && !outputLimitReached) {
      outputLimitReached = true;
      stopProcess(child, killTimerRef);
    }
  };

  child.stdout?.on('data', append);
  child.stderr?.on('data', append);

  const spawned = new Promise<void>((resolveSpawn, reject) => {
    child.once('spawn', resolveSpawn);
    child.once('error', reject);
  });
  child.once('spawn', () => {
    if (cancelled || timedOut || outputLimitReached) stopProcess(child, killTimerRef);
  });
  const timeout = setTimeout(() => {
    timedOut = true;
    stopProcess(child, killTimerRef);
  }, maximumRunMs);
  const onAbort = (): void => {
    cancelled = true;
    stopProcess(child, killTimerRef);
  };
  signal.addEventListener('abort', onAbort, { once: true });
  if (signal.aborted) onAbort();

  try {
    await spawned;
    const exitCode = await new Promise<number | null>((resolveExit, reject) => {
      child.once('error', reject);
      child.once('close', (code: number | null) => resolveExit(code));
    });
    status = cancelled
      ? 'cancelled'
      : timedOut
        ? 'timed-out'
        : outputLimitReached
          ? 'output-limit'
          : exitCode === 0
            ? 'passed'
            : 'failed';
    return {
      checkId,
      command: check.label,
      status,
      exitCode,
      output,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    status = cancelled ? 'cancelled' : 'failed';
    return {
      checkId,
      command: check.label,
      status,
      exitCode: null,
      output: output || (
        error instanceof Error ? `The selected check could not be started: ${error.message}` :
          'The selected check could not be started.'
      ),
      durationMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', onAbort);
  }
}

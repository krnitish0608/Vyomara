import { spawn } from 'node:child_process';

export type MacSpeechResult =
  | { readonly status: 'completed' }
  | { readonly status: 'cancelled' };

export class MacSpeechError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MacSpeechError';
  }
}

export interface SpeechChild {
  once(event: 'error', listener: (error: Error) => void): this;
  once(event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  kill(signal?: NodeJS.Signals): boolean;
}

export type SpawnSpeechProcess = (executable: string, arguments_: readonly string[]) => SpeechChild;

const maximumSpeechChars = 2_000;
const maximumSpeechDurationMs = 180_000;

function spawnMacSpeechProcess(executable: string, arguments_: readonly string[]): SpeechChild {
  return spawn(executable, [...arguments_], {
    shell: false,
    stdio: 'ignore',
  });
}

export class MacSpeechRunner {
  readonly #spawnProcess: SpawnSpeechProcess;
  readonly #platform: NodeJS.Platform;
  #activeChild: SpeechChild | undefined;
  #cancelActive: (() => void) | undefined;

  constructor(spawnProcess: SpawnSpeechProcess = spawnMacSpeechProcess, platform: NodeJS.Platform = process.platform) {
    this.#spawnProcess = spawnProcess;
    this.#platform = platform;
  }

  speak(text: unknown): Promise<MacSpeechResult> {
    if (this.#platform !== 'darwin') {
      return Promise.reject(new MacSpeechError('Local speech output is available only on macOS.'));
    }
    if (typeof text !== 'string' || text.trim() !== text || text.length === 0 || text.length > maximumSpeechChars) {
      return Promise.reject(new MacSpeechError(`Speech text must contain 1 to ${maximumSpeechChars} characters.`));
    }
    if (this.#activeChild) {
      return Promise.reject(new MacSpeechError('Speech output is already in progress.'));
    }

    let child: SpeechChild;
    try {
      child = this.#spawnProcess('/usr/bin/say', ['-r', '190', '--', text]);
    } catch (error) {
      return Promise.reject(new MacSpeechError(error instanceof Error ? error.message : 'macOS speech could not be started.'));
    }
    this.#activeChild = child;

    return new Promise<MacSpeechResult>((resolve, reject) => {
      let cancelled = false;
      let timedOut = false;
      let settled = false;
      const finish = (error?: Error, result?: MacSpeechResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (this.#activeChild === child) {
          this.#activeChild = undefined;
          this.#cancelActive = undefined;
        }
        if (error) reject(error);
        else if (result) resolve(result);
        else reject(new MacSpeechError('macOS speech ended without a result.'));
      };
      const timeout = setTimeout(() => {
        timedOut = true;
        try {
          if (!child.kill('SIGTERM')) finish(new MacSpeechError('Local speech exceeded its three-minute limit.'));
        } catch (error) {
          finish(new MacSpeechError(error instanceof Error ? error.message : 'Timed-out speech could not be stopped.'));
        }
      }, maximumSpeechDurationMs);
      this.#cancelActive = () => {
        cancelled = true;
      };
      child.once('error', error => finish(new MacSpeechError(`macOS speech failed: ${error.message}`)));
      child.once('close', (code, signal) => {
        if (timedOut) {
          finish(new MacSpeechError('Local speech exceeded its three-minute limit.'));
        } else if (cancelled) {
          finish(undefined, { status: 'cancelled' });
        } else if (code === 0) {
          finish(undefined, { status: 'completed' });
        } else {
          finish(new MacSpeechError(
            signal
              ? `Local speech was interrupted (${signal}).`
              : `macOS speech failed (exit ${code ?? 'unknown'}).`,
          ));
        }
      });
    });
  }

  stop(): boolean {
    const child = this.#activeChild;
    if (!child) return false;
    const stopped = child.kill('SIGTERM');
    if (stopped) this.#cancelActive?.();
    return stopped;
  }
}

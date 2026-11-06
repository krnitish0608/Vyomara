import { spawn } from 'node:child_process';
import { ToolFailure } from '../tools/contracts.ts';
import type { LauncherPort } from '../tools/action-tools.ts';

/** Opens applications, files, and web pages through macOS LaunchServices (`/usr/bin/open`). */
export class MacApplicationLauncher implements LauncherPort {
  openApplication(application: string, target: string | undefined, signal: AbortSignal): Promise<void> {
    return this.#open(['-a', application, ...(target === undefined ? [] : [target])], signal,
      `macOS could not open “${application}”. Check that the application is installed.`);
  }

  openUrl(url: string, application: string | undefined, signal: AbortSignal): Promise<void> {
    return this.#open([...(application === undefined ? [] : ['-a', application]), url], signal,
      application === undefined
        ? 'macOS could not open the web page.'
        : `macOS could not open the web page in “${application}”. Check that the browser is installed.`);
  }

  #open(args: readonly string[], signal: AbortSignal, failure: string): Promise<void> {
    if (signal.aborted) {
      return Promise.reject(new ToolFailure('Opening was cancelled.', 'tool-failed'));
    }
    return new Promise((resolve, reject) => {
      // `--` is not supported by open(1); arguments are passed without a shell.
      const child = spawn('/usr/bin/open', [...args], { stdio: 'ignore' });
      const onAbort = (): void => {
        child.kill('SIGTERM');
        reject(new ToolFailure('Opening was cancelled.', 'tool-failed'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      child.once('error', () => {
        signal.removeEventListener('abort', onAbort);
        reject(new ToolFailure(failure, 'tool-failed'));
      });
      child.once('close', code => {
        signal.removeEventListener('abort', onAbort);
        if (code === 0) resolve();
        else reject(new ToolFailure(failure, 'not-found'));
      });
    });
  }
}

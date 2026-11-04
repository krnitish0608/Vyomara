import { spawn } from 'node:child_process';
import { ToolFailure } from '../tools/contracts.ts';
import type { ApplicationId, ApplicationLauncherPort } from '../tools/application-tools.ts';

const macApplications: Readonly<Record<ApplicationId, string>> = {
  calculator: 'Calculator',
  calendar: 'Calendar',
  finder: 'Finder',
  notes: 'Notes',
  safari: 'Safari',
  'system-settings': 'System Settings',
  terminal: 'Terminal',
  'visual-studio-code': 'Visual Studio Code',
};

export class MacApplicationLauncher implements ApplicationLauncherPort {
  launch(application: ApplicationId, signal: AbortSignal): Promise<void> {
    if (signal.aborted) {
      return Promise.reject(new ToolFailure('Application launch was cancelled.', 'tool-failed'));
    }

    return new Promise((resolve, reject) => {
      const child = spawn('/usr/bin/open', ['-a', macApplications[application]], {
        stdio: 'ignore',
      });
      const onAbort = (): void => {
        child.kill('SIGTERM');
        reject(new ToolFailure('Application launch was cancelled.', 'tool-failed'));
      };
      signal.addEventListener('abort', onAbort, { once: true });

      child.once('error', () => {
        signal.removeEventListener('abort', onAbort);
        reject(new ToolFailure('macOS could not start the application.', 'tool-failed'));
      });
      child.once('close', code => {
        signal.removeEventListener('abort', onAbort);
        if (code === 0) {
          resolve();
        } else {
          reject(new ToolFailure(
            'The application could not be opened. Check whether it is installed.',
            'not-found',
          ));
        }
      });
    });
  }
}

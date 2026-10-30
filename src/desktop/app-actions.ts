import { spawn } from 'node:child_process';
import type { DesktopAppAction } from './contracts.ts';

export class DesktopAppActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DesktopAppActionError';
  }
}

export interface DesktopAppActionResult {
  readonly application: 'Visual Studio Code' | 'Google Chrome';
  readonly action: 'opened' | 'search-opened';
  readonly searchUrl?: string;
}

export function parseDesktopAppAction(value: unknown): DesktopAppAction {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('The requested application action is invalid.');
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => key !== 'type' && key !== 'query' && key !== 'projectDirectory')) {
    throw new Error('The requested application action contains unsupported fields.');
  }
  if (
    input.type === 'open-vscode' &&
    input.query === undefined &&
    (input.projectDirectory === undefined ||
      (typeof input.projectDirectory === 'string' &&
        input.projectDirectory.length <= 4096 &&
        input.projectDirectory.trim() === input.projectDirectory &&
        input.projectDirectory.startsWith('/') &&
        !input.projectDirectory.includes('\0')))
  ) {
    return {
      type: 'open-vscode',
      ...(typeof input.projectDirectory === 'string' ? { projectDirectory: input.projectDirectory } : {}),
    };
  }
  if (input.type === 'open-chrome' && input.query === undefined && input.projectDirectory === undefined) {
    return { type: 'open-chrome' };
  }
  if (
    input.type === 'search-chrome' &&
    input.projectDirectory === undefined &&
    typeof input.query === 'string' &&
    input.query.trim() === input.query &&
    input.query.length > 0 &&
    input.query.length <= 256 &&
    !/[\u0000-\u001f\u007f]/.test(input.query)
  ) {
    return { type: 'search-chrome', query: input.query };
  }
  throw new Error('The requested application action is invalid.');
}

type LaunchApplication = (arguments_: readonly string[]) => Promise<void>;

async function launchMacApplication(arguments_: readonly string[]): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new DesktopAppActionError('Opening other Mac applications is available only on macOS.');
  }
  const child = spawn('/usr/bin/open', [...arguments_], {
    shell: false,
    stdio: 'ignore',
  });
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    };
    const timeout = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch {
        finish(new DesktopAppActionError('macOS application launch timed out and could not be stopped.'));
        return;
      }
      finish(new DesktopAppActionError('macOS application launch timed out.'));
    }, 10_000);
    child.once('error', error => finish(new DesktopAppActionError(`macOS could not launch the application: ${error.message}`)));
    child.once('close', (code, signal) => {
      if (code === 0) {
        finish();
        return;
      }
      finish(new DesktopAppActionError(
        signal
          ? `macOS application launch was stopped (${signal}).`
          : `macOS could not open the requested application (exit ${code ?? 'unknown'}).`,
      ));
    });
  });
}

export async function runDesktopAppAction(
  value: unknown,
  launch: LaunchApplication = launchMacApplication,
): Promise<DesktopAppActionResult> {
  const action = parseDesktopAppAction(value);
  if (action.type === 'open-vscode') {
    try {
      await launch([
        '-a',
        'Visual Studio Code',
        ...(action.projectDirectory ? [action.projectDirectory] : []),
      ]);
    } catch (error) {
      if (error instanceof DesktopAppActionError) throw error;
      throw new DesktopAppActionError(error instanceof Error ? error.message : 'VS Code could not be opened.');
    }
    return { application: 'Visual Studio Code', action: 'opened' };
  }
  if (action.type === 'open-chrome') {
    try {
      await launch(['-a', 'Google Chrome']);
    } catch (error) {
      if (error instanceof DesktopAppActionError) throw error;
      throw new DesktopAppActionError(error instanceof Error ? error.message : 'Chrome could not be opened.');
    }
    return { application: 'Google Chrome', action: 'opened' };
  }
  const searchUrl = new URL('https://www.google.com/search');
  searchUrl.searchParams.set('q', action.query);
  try {
    await launch(['-a', 'Google Chrome', searchUrl.toString()]);
  } catch (error) {
    if (error instanceof DesktopAppActionError) throw error;
    throw new DesktopAppActionError(error instanceof Error ? error.message : 'Chrome search could not be opened.');
  }
  return {
    application: 'Google Chrome',
    action: 'search-opened',
    searchUrl: searchUrl.toString(),
  };
}

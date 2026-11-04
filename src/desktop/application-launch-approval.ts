import { randomUUID } from 'node:crypto';
import { OperationStoppedError } from '../shared/bounded.ts';
import type { ApplicationLaunchApprovalPort, ApplicationId } from '../tools/application-tools.ts';
import type { DesktopApplicationLaunchProposal } from './contracts.ts';

interface PendingLaunch {
  readonly signal: AbortSignal;
  readonly resolve: (approved: boolean) => void;
  readonly reject: (error: Error) => void;
  readonly removeAbortListener: () => void;
}

export interface ApplicationLaunchApprovalOptions {
  readonly onProposal: (proposal: DesktopApplicationLaunchProposal) => void;
}

export class ApplicationLaunchApprovalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApplicationLaunchApprovalError';
  }
}

export class ApplicationLaunchApprovalManager implements ApplicationLaunchApprovalPort {
  readonly #options: ApplicationLaunchApprovalOptions;
  readonly #pending = new Map<string, PendingLaunch>();

  constructor(options: ApplicationLaunchApprovalOptions) {
    this.#options = options;
  }

  request(application: ApplicationId, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return Promise.reject(new OperationStoppedError('cancelled'));
    const id = randomUUID();
    return new Promise<boolean>((resolve, reject) => {
      const onAbort = (): void => {
        this.#finish(id, pending => pending.reject(new OperationStoppedError('cancelled')));
      };
      const pending: PendingLaunch = {
        signal,
        resolve,
        reject,
        removeAbortListener: () => signal.removeEventListener('abort', onAbort),
      };
      this.#pending.set(id, pending);
      signal.addEventListener('abort', onAbort, { once: true });
      try {
        this.#options.onProposal({ id, application });
      } catch (error) {
        const message = error instanceof ApplicationLaunchApprovalError
          ? error.message
          : 'The launch approval could not be displayed; no application was opened.';
        this.#finish(id, entry => entry.reject(
          new ApplicationLaunchApprovalError(message),
        ));
      }
    });
  }

  approve(id: string): void {
    this.#resolve(id, true);
  }

  reject(id: string): void {
    this.#resolve(id, false);
  }

  #resolve(id: string, approved: boolean): void {
    const pending = this.#pending.get(id);
    if (!pending) throw new ApplicationLaunchApprovalError('This launch approval is no longer active.');
    if (pending.signal.aborted) {
      this.#finish(id, entry => entry.reject(new OperationStoppedError('cancelled')));
      throw new ApplicationLaunchApprovalError('This launch approval was cancelled; no application was opened.');
    }
    this.#finish(id, entry => entry.resolve(approved));
  }

  #finish(id: string, finish: (pending: PendingLaunch) => void): void {
    const pending = this.#pending.get(id);
    if (!pending) return;
    this.#pending.delete(id);
    pending.removeAbortListener();
    finish(pending);
  }
}

import type { ToolEffect } from './contracts.ts';
import { normalizeApplicationId } from './application-tools.ts';
import type { ApplicationId } from './application-tools.ts';

export type PolicyDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: 'side-effects-disabled' };

export interface PolicyGatewayOptions {
  readonly authorizedApplication?: ApplicationId;
}

export class PolicyGateway {
  private readonly options: PolicyGatewayOptions;

  constructor(options: PolicyGatewayOptions = {}) {
    this.options = options;
  }

  authorize(
    effect: ToolEffect,
    toolId?: string,
    input?: unknown,
  ): PolicyDecision {
    if (effect === 'read' || effect === 'propose') return { allowed: true };
    if (
      effect === 'launch' &&
      toolId === 'application.open' &&
      typeof input === 'object' &&
      input !== null &&
      !Array.isArray(input) &&
      'application' in input &&
      normalizeApplicationId(input.application) === this.options.authorizedApplication &&
      this.options.authorizedApplication !== undefined
    ) return { allowed: true };
    return { allowed: false, reason: 'side-effects-disabled' };
  }
}

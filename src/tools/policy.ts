import type { ToolEffect } from './contracts.ts';

export type PolicyDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: 'side-effects-disabled' };

export class PolicyGateway {
  authorize(effect: ToolEffect): PolicyDecision {
    if (effect === 'read') return { allowed: true };
    return { allowed: false, reason: 'side-effects-disabled' };
  }
}

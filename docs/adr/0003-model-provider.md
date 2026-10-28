# ADR-0003: Replaceable provider interface and local Ollama adapter

- **Status:** Accepted

## Context and problem

The MVP requires a replaceable provider contract, local Ollama compatibility,
cancellation and typed provider errors, with no silent remote fallback. Exact
Ollama API/version, model, and context budget remain open.

## Decision

Accept a provider-neutral interface between the primary agent and provider
adapters. The first adapter target is a locally hosted Ollama-compatible
provider. Keep Ollama transport and request/response translation inside that
adapter. Treat API version, model, endpoint defaults, and resource limits as
unresolved configuration decisions, not accepted values.

## Alternatives considered

- Couple the agent directly to Ollama APIs: simpler initially, but violates
  replaceability and spreads provider-specific behavior.
- Add a multi-provider framework now: unnecessary and may encourage remote
  providers outside the local-first MVP.
- Silently fall back to a hosted provider: conflicts with privacy and FR-004.

## Consequences and trade-offs

A normalized contract adds a small adapter layer and contract tests. Ollama
compatibility may require translating model-specific capabilities and errors.
The MVP can support one adapter without committing to a provider framework.

## Security/privacy implications

Default to the configured local provider; fail visibly when unavailable.
Never transmit prompts or file content to a remote service through fallback.
Disclose provider identity/data flow before requests.

## Implementation implications for Phase 4

Define normalized request/response, cancellation, timeout, and error types.
Test the contract with a fake provider before implementing Ollama transport.
Do not leak Ollama SDK/API objects into agent or tool modules.

## Evidence

FR-003, FR-004, FR-016; NFR-007, NFR-018; Phase 2 local-first principle.

## Remaining choice

User must confirm the Ollama API/version, initial model, context/resource
budget, and local endpoint configuration before the adapter baseline is fixed.

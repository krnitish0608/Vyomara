# ADR-0007: Central policy and approval gateway

- **Status:** Accepted

## Context and problem

Model proposals and registered tools must not grant themselves authority.
Phase 2 requires read-only filesystem access by default and approval for
side-effects, while keeping writes, deletes, shell, and unattended network
actions out of MVP.

## Decision

Route every tool execution through one policy gateway that validates
capability, roots, effect class, and current approval. Deny by default when
policy or approval state is missing or ambiguous. MVP only exposes read-only
tools; no side-effect capability is enabled. Future approval is specific to a
displayed action and target, and denial/cancellation prevents execution.

## Alternatives considered

- Let each tool implement its own approval: risks inconsistent checks and
  bypasses.
- Trust the model's claim that the user approved: invalid authority source.
- Enable broad approval for a whole session: not justified and weakens
  least-privilege consent.

## Consequences and trade-offs

The gateway adds a central interface and may interrupt automation for future
actions. This cost is intentional; user consent and auditability take
precedence over convenience.

## Security/privacy implications

The gateway is a policy enforcement point, not a guarantee against malicious
in-process code; keep capabilities narrow and test deny paths. Path
containment remains enforced by filesystem tools as defense in depth.

## Implementation implications for Phase 4

Create policy decisions as explicit allow/deny/approval-required outcomes.
Record decision metadata without sensitive content. Build no write/delete,
shell, arbitrary network, or generic command capability in the MVP.

## Evidence

FR-006, FR-007, FR-008, FR-014, FR-015; NFR-001 through NFR-005.

## Remaining choice

Approval presentation, identity confirmation, and future action scopes need
user definition before any side-effect capability is considered.

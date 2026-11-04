# ADR-0007: Central policy and approval gateway

- **Status:** Accepted

## Context and problem

Model proposals and registered tools must not grant themselves authority.
The CLI remains read-only and restricted to configured roots. Desktop
filesystem operations can span the machine, but protected paths are excluded
and every mutation must be reviewed by the user.

## Decision

Route every tool execution through one policy gateway that validates
capability, roots, effect class, and current approval. Deny by default when
policy or approval state is missing or ambiguous. Desktop file creation,
folder creation, and text edits require approval of the exact destination and
content. Each deletion requires a separate typed confirmation and moves the
item to Trash. On macOS, launching one app from a fixed allowlist requires both
an explicit request for that exact app and a separate confirmation for every
launch. Rejection, cancellation, or a missing approval window prevents launch.
The CLI remains read-only; shell execution and unattended external network
actions are unavailable. See ADR-0014 for filesystem approval details.

## Alternatives considered

- Let each tool implement its own approval: risks inconsistent checks and
  bypasses.
- Trust the model's claim that the user approved: invalid authority source.
- Enable broad approval for a whole session: not justified and weakens
  least-privilege consent.

## Consequences and trade-offs

The gateway adds a central interface and interrupts automation for reviewed
filesystem actions and app launches. This cost is intentional; user consent
and auditability take precedence over convenience.

## Security/privacy implications

The gateway is a policy enforcement point, not a guarantee against malicious
in-process code; keep capabilities narrow and test deny paths. Path
containment remains enforced by filesystem tools as defense in depth.

## Implementation implications

Create policy decisions as explicit allow/deny/approval-required outcomes.
Record decision metadata without sensitive content. Keep each approval scoped
to one displayed filesystem operation or one exact app launch and the active
request. Do not infer authorization from model output or general conversation
context.

## Evidence

FR-006, FR-007, FR-008, FR-014, FR-015; NFR-001 through NFR-005.

## Approval scope

The only non-filesystem side effect currently implemented is launching an
allowlisted macOS app after per-launch user confirmation. Arbitrary app
control, shell execution, and other system actions remain unavailable.

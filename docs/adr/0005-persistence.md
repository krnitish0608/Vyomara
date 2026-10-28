# ADR-0005: Session history and explicit memory persistence

- **Status:** Proposed

## Context and problem

MVP requires locally stored, inspectable, deletable session history and
explicitly confirmed memory. Phase 2 leaves storage format, encryption,
retention, backup, and deletion guarantees open. These affect privacy and data
loss behavior.

## Decision

Accept the logical separation of session history and explicit memory, but do
not select a storage engine or begin durable persistence until the user
confirms the data-lifecycle choices. Propose a small local persistence
interface with distinct history and memory operations; do not introduce a
database dependency by default.

## Alternatives considered

- JSON files/JSONL using Node built-ins: low dependency cost, but atomic updates,
  corruption recovery, concurrency, encryption, and deletion semantics need
  explicit design.
- Embedded database: stronger query/transaction support, but adds a dependency
  and migration/backup decisions without a current requirement for it.
- Keep all data only in process memory: private by default but fails the
  session-history persistence requirement.

## Consequences and trade-offs

Deferring the engine prevents a premature data-format commitment. It blocks
the durable-history and memory implementation until retention and deletion
requirements are settled. Interfaces and in-memory test doubles can be
developed first.

## Security/privacy implications

History is not memory. No ordinary conversation becomes durable memory without
explicit user request and content confirmation. Select encryption, file
permissions, backup behavior, retention, and deletion guarantees before
persisting user data. Never store credentials in these records.

## Implementation implications for Phase 4

The Phase 4 skeleton may keep temporary session messages in process memory;
this is not durable session history and is lost at exit. Do not implement
durable history or long-term memory until the user decides format,
migrations/versioning, encryption, retention defaults, export/backup,
corruption recovery, and deletion behavior. Test inspect/review/delete paths
separately before persistent storage is enabled.

## Evidence

FR-009, FR-010; NFR-008, NFR-017; Phase 2 open questions on format, encryption,
retention, backups, and deletion.

# Vyomara Architecture Decision Records

ADRs capture project decisions and proposals. **Accepted** means supported by
the current product requirements or established project configuration;
**Proposed** means a reasoned recommendation awaiting user confirmation.
Proposed decisions must not be presented as approved implementation choices.

## Records

| ADR | Topic | Status |
|---|---|---|
| [0001](./0001-modular-monolith.md) | Overall architecture and module boundaries | Accepted |
| [0002](./0002-runtime-and-language.md) | Runtime and language | Accepted |
| [0003](./0003-model-provider.md) | Provider interface and local Ollama integration | Accepted |
| [0004](./0004-text-interaction.md) | First text interaction interface | Accepted |
| [0005](./0005-persistence.md) | Sessions, messages, and explicit memory | Proposed |
| [0006](./0006-tool-contracts.md) | Tool registration and execution | Accepted |
| [0007](./0007-permission-gateway.md) | Permissions and approval gateway | Accepted |
| [0008](./0008-configuration-and-secrets.md) | Configuration and secrets | Accepted |
| [0009](./0009-diagnostics-and-audit.md) | Logging, diagnostics, and audit events | Accepted |
| [0010](./0010-testing-and-evaluation.md) | Testing and repeatable agent evaluation | Accepted |
| [0011](./0011-platform-baseline.md) | macOS, Node.js, and compatibility baseline | Accepted |

## Open decisions

User confirmation is needed for:

1. **Persistence:** format/engine, encryption, retention, backup/export, and
   deletion guarantees for history and explicit memory.
2. **Approval UX:** how future side-effect requests are displayed and scoped.
3. **Configuration:** secret injection for any future credential-bearing
   provider.
4. **Diagnostics:** retention/rotation policy and any future opt-in content
   logging.
5. **Testing:** evaluation set, model-evaluation acceptance criteria, and
   benchmark environment.
6. **Compatibility:** minimum macOS release, packaging/distribution, and
   confirmation that Node.js `>=22.22.1` is the release baseline.
7. **Filesystem access UX:** selection, display, and revocation of allowed
   roots. The read-only tools and default resource limits are implemented;
   root configuration is currently environment-only and defaults to no access.

See [the architecture overview](../architecture.md) and each Proposed ADR for
the rationale and consequences. The model endpoint and initial model are
resolved defaults in [ADR-0003](./0003-model-provider.md); live Ollama
compatibility succeeded in one local request, but the installed server version
was not recorded. No Proposed ADR should be treated as user approval.

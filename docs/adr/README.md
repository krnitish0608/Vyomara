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
| [0005](./0005-persistence.md) | Sessions, messages, and explicit memory | Accepted |
| [0006](./0006-tool-contracts.md) | Tool registration and execution | Accepted |
| [0007](./0007-permission-gateway.md) | Permissions and approval gateway | Accepted |
| [0008](./0008-configuration-and-secrets.md) | Configuration and secrets | Accepted |
| [0009](./0009-diagnostics-and-audit.md) | Logging, diagnostics, and audit events | Accepted |
| [0010](./0010-testing-and-evaluation.md) | Testing and repeatable agent evaluation | Accepted |
| [0011](./0011-platform-baseline.md) | macOS, Node.js, and compatibility baseline | Accepted |
| [0012](./0012-desktop-interface.md) | Initial macOS desktop interaction shell | Superseded |
| [0013](./0013-voice-first-app-integrations.md) | Voice-first assistant and existing-app integrations | Accepted |
| [0014](./0014-approved-project-edit-proposals.md) | User-approved, selected-project code edits | Accepted |

## Open decisions

The current product direction is recorded in
[ADR-0013](./0013-voice-first-app-integrations.md) and
[docs/product-direction.md](../product-direction.md). Historical ADRs remain
useful only where compatible with it.

User confirmation is needed for:

1. **Approval UX:** how non-code side-effect requests beyond the implemented
   app-launch, project-edit, and fixed-check flows are displayed and scoped.
2. **Configuration:** secret injection for any future credential-bearing
   provider.
3. **Diagnostics:** retention/rotation policy and any future opt-in content
   logging.
4. **Testing:** evaluation set, model-evaluation acceptance criteria, and
   benchmark environment.
5. **Compatibility:** minimum macOS release, packaging/distribution, and
   confirmation that Node.js `>=22.22.1` is the release baseline.

See [the architecture overview](../architecture.md) and each Proposed ADR for
the rationale and consequences. The model endpoint and initial model are
resolved defaults in [ADR-0003](./0003-model-provider.md); live Ollama
compatibility succeeded in one local request, but the installed server version
was not recorded. No Proposed ADR should be treated as user approval.

# Vyomara

Vyomara is a local-first personal AI assistant for macOS. Its spoken assistant
name is **Vyom**.

## Development status

Initial implementation is in progress. The current CLI can use the local
Ollama provider or an explicit deterministic placeholder. Ollama can request
registered read-only tools; filesystem access remains disabled unless allowed
roots are explicitly configured.
Unsupported shell, web-search, and file-mutation requests are not executed.
Tool arguments are strictly validated, with at most one bounded correction
attempt; a model claim is not evidence that an action succeeded.

## Prerequisites

- macOS on Apple Silicon
- Node.js >=22.22.1
- pnpm 12.16.1

## Package manager

Use pnpm only. Do not mix npm and pnpm lockfiles in this project.

## Safety principles

- Default to read-only behavior.
- Require approval before sensitive or destructive actions.
- Never commit secrets.
- Test changes before marking work complete.

See [the Ollama setup and troubleshooting guide](./docs/ollama.md).
See [the read-only filesystem tool guide](./docs/filesystem-tools.md).

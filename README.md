# Vyomara

Vyomara is a local-first personal AI assistant for macOS. Its spoken assistant
name is **Vyom**.

## Development status

Initial implementation is in progress. The CLI can use the local Ollama
provider or an explicit deterministic placeholder. Requests have correlated
task/run lifecycle events and are stored as local, inspectable sessions. The
session history includes user prompts, assistant replies, tool calls, and
returned tool data, which may contain private file contents. Ollama can request
registered read-only tools; filesystem access remains disabled unless allowed
roots are explicitly configured.
Each session is capped at 1,000 messages or 8 MiB; start another session when
that limit is reached.
Unsupported shell, web-search, and file-mutation requests are not executed.
Tool arguments are strictly validated, with at most one bounded correction
attempt; a model claim is not evidence that an action succeeded.
Saved memory is separate from session history and is never extracted
automatically. A save displays the exact memory content before asking you to
type `SAVE`; deletion requires typing `DELETE` after reviewing the target.
The `--confirm` flag enables these interactive confirmation prompts. Data is
retained until explicitly deleted. The
application does not encrypt the database or create backups; macOS FileVault is
recommended, and OS backups may include the data.

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

## Local history and memory

The database defaults to `~/Library/Application Support/Vyomara`; override it
with an absolute `VYOM_DATA_DIR`. Inspect session IDs and content with:

```sh
pnpm dev -- --sessions list
pnpm dev -- --sessions show <session-id>
pnpm dev -- --session <session-id> "continue this conversation"
pnpm dev -- --sessions delete <session-id> --confirm
```

Memory is explicit and managed separately:

```sh
pnpm dev -- --memory save "content to remember" --confirm
pnpm dev -- --memory list
pnpm dev -- --memory show <memory-id>
pnpm dev -- --memory delete <memory-id> --confirm
```

Memory is not currently injected into model context. No UI, interactive
approval flow, or automated backup/export is provided.

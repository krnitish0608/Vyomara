# Vyomara

Vyomara is a local-first personal AI assistant for macOS. Its spoken assistant
name is **Vyom**.

## Development status

Initial implementation is in progress. The CLI and early Electron desktop
shell can use the local Ollama provider or an explicit deterministic
placeholder. The desktop shell has text chat, request cancellation, and a
task-activity panel. Provider/model information is configuration status; an
optional user-triggered check contacts only the configured local Ollama
`/api/tags` endpoint and does not verify that the selected model is installed.
Requests have correlated
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

## Desktop application

Install the pinned dependencies once, then launch the app:

```sh
pnpm install
pnpm desktop
```

By default, the app uses local Ollama. Start Ollama separately; use
**Check Ollama** in the app to test local service reachability. To run the UI
without a model provider, use `VYOM_PROVIDER=placeholder pnpm desktop`.

Create a local production build or preview it with:

```sh
pnpm build:desktop
pnpm preview:desktop
```

The app uses the current process environment. Vyomara does not automatically
load `.env` files. Use **Folders** to grant and revoke read-only access to
specific directories; permissions are stored locally. `VYOM_ALLOWED_ROOTS`
seeds the desktop permissions on first launch. Filesystem tools remain
unavailable until a folder is allowed. App signing, `.app`/`.dmg` distribution,
voice, and remote providers are not implemented. The desktop Settings panel
lets you switch between local Ollama and a deterministic placeholder and set
the Ollama model tag. These choices are stored locally and override
`VYOM_PROVIDER` and `VYOM_OLLAMA_MODEL` after you save them; the Ollama
endpoint remains configured through `VYOM_OLLAMA_BASE_URL` and must be
loopback-only. Saving a model tag does not download it or check its
availability. **Check model availability** performs a read-only request to
Ollama's local tags endpoint and reports whether the selected model is already
installed; it never downloads a model. **Reset to environment defaults**
removes the saved provider/model overrides and restores the current process
environment configuration without changing filesystem permissions or other
local data. Provider identity, local Ollama reachability, and selected-model
availability are shown together in Settings; reachability and model checks are
separate. Saved sessions can be reviewed and
continued from History; the desktop view displays user and final assistant
messages, not raw tool calls or tool results. The Memory panel supports
explicit review, save, inspection, and typed-confirmation deletion; saved
memory is not automatically inserted into model context. History entries can
be reviewed and deleted from the desktop after typing `DELETE`;
deleting the active conversation also clears it from the current view.

## Local history and memory

The database defaults to `~/Library/Application Support/Vyomara`; override it
with an absolute `VYOM_DATA_DIR`. Inspect session IDs and content with:

```sh
pnpm dev -- --sessions list
pnpm dev -- --sessions show <session-id>
pnpm dev -- --session <session-id> "continue this conversation"
pnpm dev -- --sessions delete <session-id> --confirm
```

Memory can be managed explicitly in the desktop Memory panel or through the CLI:

```sh
pnpm dev -- --memory save "content to remember" --confirm
pnpm dev -- --memory list
pnpm dev -- --memory show <memory-id>
pnpm dev -- --memory delete <memory-id> --confirm
```

Memory is not currently injected into model context. No interactive approval
flow or automated backup/export is provided.

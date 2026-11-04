# Vyomara

Vyomara is a local-first personal AI assistant for macOS. Its spoken assistant
name is **Vyom**.

**Current product direction:** build a voice-operated assistant that can
understand its environment without asking users to manually select a project.
The desktop UI is intentionally focused on Assistant, History, chat, voice,
and task activity while the agent workflow is developed. See
[the product direction](./docs/product-direction.md).

## Development status

Initial implementation is in progress. The CLI and Electron desktop shell can
use the local Ollama provider or an explicit deterministic placeholder. The
desktop shell has text chat, offline voice input, request cancellation,
task-activity status, and local conversation history. Its sidebar keeps History
alongside the assistant and task activity; Memory, Permissions, Project
workspace, and Settings panels are not part of the current desktop workflow.
Desktop chat does not expose filesystem tools or project editing. The agent's
project-awareness and coding workflow are deferred until they can work without
requiring manual project selection.
Requests have correlated task/run lifecycle events and are stored as local,
inspectable sessions. The session history includes user prompts, assistant
replies, tool calls, and returned tool data, which may contain private content.
Each session is capped at 1,000 messages or 8 MiB; start another session when
that limit is reached.
Unsupported shell, web-search, and direct file-mutation requests are not
executed.
Tool arguments are strictly validated, with at most one bounded correction
attempt; a model claim is not evidence that an action succeeded.
Desktop conversations are retained locally until deleted. The database is not
application-encrypted. macOS FileVault is recommended, and OS backups may
include local data.

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
The CLI's configured read-only tools are described in
[the filesystem tool guide](./docs/filesystem-tools.md).

## Desktop application

Install the pinned dependencies once, then launch the app:

```sh
pnpm install
pnpm desktop
```

The launcher builds the desktop app and opens a local, ad-hoc-signed
`Vyomara.app` bundle through macOS LaunchServices. This is required so macOS
attributes microphone and speech permissions to Vyomara, rather than to the
terminal or editor that started it. The launcher applies the Vyomara orbiter
mark as the macOS app icon. If Vyomara is already running, launching it again
brings the existing window forward instead of opening another instance.
Release signing and distribution are not implemented.

By default, the app uses local Ollama. Start Ollama separately and configure
the provider with environment variables. To run the UI without a model provider, use
`VYOM_PROVIDER=placeholder pnpm desktop`.

Create a local production build or preview it with:

```sh
pnpm build:desktop
pnpm preview:desktop
```

The app uses the current process environment and does not automatically load
`.env` files. Configure the local Ollama provider through `VYOM_PROVIDER`,
`VYOM_OLLAMA_MODEL`, and `VYOM_OLLAMA_BASE_URL`; the endpoint must be
loopback-only. Use `VYOM_PROVIDER=placeholder` to run without Ollama. Saved
provider overrides created by the former Settings panel are no longer loaded;
their local database records are left intact. App signing, `.app`/`.dmg`
distribution, and remote providers are not implemented.
Saved sessions can be reviewed and continued from History; the desktop view
shows user and final assistant messages, not raw tool calls or tool results.
History entries can be reviewed and deleted after typing `DELETE`; deleting
the active conversation also clears it from the current view. Conversations
can be exported as unencrypted JSON after review. Exports contain complete raw
history, including tool calls and results, are written to new owner-only files,
and never overwrite existing files.
All desktop controls are keyboard reachable, visible focus is preserved, and
Escape closes the open side panel and returns focus to its toolbar button.
Reduced-motion preferences disable animated progress and smooth scrolling.
Run `pnpm test:desktop-ui` on macOS Apple Silicon to build the desktop shell
and exercise its keyboard navigation, focus, and reduced-motion behavior in
Electron. an
in-app confirmation before Vyomara launches the existing macOS application.
Chrome searches display the exact query and disclose that Google receives it.
Assistant replies can be spoken with the local macOS voice. Voice input uses
the multilingual `whisper.cpp` base model and runs locally; it does not depend
on Siri or Dictation and never sends microphone audio to an online service.
Vyomara downloads the model only after you request it in the app. Install the
local runtime with `brew install whisper.cpp`, then turn listening on in the
app. Say “Hello Vyomara” to wake Vyom; it stays awake until Listening Off is
selected. Turning listening off stops microphone capture.
General control of app interfaces is not implemented.

## Local history and CLI memory

The database defaults to `~/Library/Application Support/Vyomara`; override it
with an absolute `VYOM_DATA_DIR`. Inspect session IDs and content with:

```sh
pnpm dev -- --sessions list
pnpm dev -- --sessions show <session-id>
pnpm dev -- --session <session-id> "continue this conversation"
pnpm dev -- --sessions delete <session-id> --confirm
```

The desktop app does not expose memory management. Existing CLI memory commands
remain available:

```sh
pnpm dev -- --memory save "content to remember" --confirm
pnpm dev -- --memory list
pnpm dev -- --memory show <memory-id>
pnpm dev -- --memory delete <memory-id> --confirm
```

Memory is not currently injected into model context. The CLI requires explicit
confirmation for saves and deletions. The desktop History panel manages
conversations only.

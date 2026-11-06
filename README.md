# Vyomara

Vyomara is a local-first AI agent for macOS. Its assistant is called **Vyom**.
You describe what you want in plain language — English, Hindi, or Hinglish —
and Vyom finds the right project and files on your Mac, reads and changes code,
runs tests, and opens apps or web pages. Everything runs on your Mac through
[Ollama](https://ollama.com); nothing is sent to a cloud model.

Typing is the main way to work today. Offline voice input already exists and
will become the primary interface later. See
[the product direction](./docs/product-direction.md).

## What Vyom can do

| Ask for… | What happens |
|---|---|
| "vyomara project mein num_ctx kaha set hota hai?" | Finds the project by name, searches the code, and answers with file and line. |
| "shop project ka failing test fix karo" | Runs the tests, reads the failing test and code, proposes an edit (you review a diff), re-runs the tests. |
| "open my shop project in VS Code" | Opens VS Code with that folder, after you approve. |
| "Chrome mein React Native search karo" | Opens a Google search in Chrome, after you approve. |
| "react.dev/blog padh ke batao latest post kya hai" | Reads the page itself (after you approve) and answers with a link. |
| "src/agent ka structure samjhao" | Maps the folder, reads key files, and explains. |
| "cart.js mein applyDiscount VS Code mein kholo" | Finds the definition and opens VS Code at that line, after you approve. |

**You approve every action.**
- **File edits:** shown as a diff.
- **Deletions:** require typing `DELETE`, and the item goes to Trash.
- **Shell commands:** shown exactly, with the folder they run in.
- **App launches and web pages:** shown before they open. Pages Vyom reads
  show which website receives the request. Choose **Always allow**, or use
  the **Permissions** panel, so VS Code, Chrome, or a docs site stop asking.
  You can revoke a permission there at any time.
- **Repeated commands:** for `pnpm test` and similar, "Always allow here"
  skips the prompt for that exact command in that folder until you quit.

Each reply ends with a **Verified actions** list built only from real tool
results, so Vyom never claims work it did not do.

## Requirements

- macOS on Apple Silicon
- Node.js >=22.22.1 and pnpm 12.16.1 (use pnpm only)
- [Ollama](https://ollama.com) running locally, with a model that supports
  tool calling. The default is `qwen3:14b` (about 9 GB; 24 GB RAM recommended):

```sh
ollama pull qwen3:14b
```

Any local model can be run from the app's **Models** panel without changing
code or configuration. In the panel you can:

- download any model from the Ollama library, or GGUF models from Hugging Face
  (`hf.co/…`);
- see each model's capabilities (Tools / Thinking / Vision / Chat only);
- switch the model in use;
- set the context window and thinking;
- remove models you no longer need;
- start Ollama if it is not running.

See [the Ollama guide](./docs/ollama.md#running-any-local-model-from-the-app).

## Desktop app

```sh
pnpm install
pnpm desktop
```

The launcher builds the app and opens a local, ad-hoc-signed `Vyomara.app`
through macOS LaunchServices. This makes macOS attribute microphone and speech
permissions to Vyomara rather than to your terminal. Launching again brings the
existing window forward. Release signing and `.dmg` distribution are not
implemented.

The desktop has these parts:
- **Chat** with Markdown replies.
- **Live checklist** of the agent's plan for multi-step tasks.
- **Live step list** showing each tool call ("Reading …", "Running `pnpm test`").
- **Approval cards** for every edit, command, app launch, and web page.
- **History** to review, export, or delete conversations.
- **Models**, where you pick an installed model or download a new one.
- **Offline voice input.**

Stop cancels a running task at any time.

Other commands:

```sh
pnpm build:desktop     # production build
pnpm preview:desktop   # build and open the app
pnpm test:desktop-ui   # Electron keyboard/focus/reduced-motion smoke test
```

### Voice

Voice input uses the local multilingual `whisper.cpp` base model. It does not
use Siri or Dictation, and microphone audio never leaves the Mac.

To set it up, run `brew install whisper.cpp`, then turn listening on in the app.
Vyomara downloads the speech model only when you ask it to. Say “Hello
Vyomara” to wake Vyom; it stays awake until you select Listening Off. Replies
can be spoken with the local macOS voice.

## Command line

The CLI uses the same agent, tools, and approvals. It shows diffs and asks
`y/N` in the terminal.

```sh
pnpm dev                                     # interactive chat
pnpm dev -- "find where the cart total is computed in my shop project"
pnpm dev -- --model qwen2.5-coder:14b "explain src/agent/agent.ts"
pnpm dev -- --session <session-id> "continue"
```

Set `VYOM_DEBUG=1` to print diagnostic events. Saved sessions and explicit
memory are managed with:

```sh
pnpm dev -- --sessions list | show <id> | delete <id> --confirm
pnpm dev -- --memory list | show <id> | save "text" --confirm | delete <id> --confirm
```

Memory is explicit only and is not yet given to the model.

## Configuration

Vyomara reads environment variables at startup and does not load `.env` files.
[`.env.example`](./.env.example) lists every setting. The most useful are:

| Variable | Default | Purpose |
|---|---|---|
| `VYOM_OLLAMA_MODEL` | `qwen3:14b` | Model (the desktop Models panel overrides it) |
| `VYOM_OLLAMA_NUM_CTX` | `32768` | Context window requested from Ollama |
| `VYOM_OLLAMA_THINK` | `false` | Let thinking models reason first (slower) |
| `VYOM_MAX_AGENT_ITERATIONS` | `40` | Model steps per request |
| `VYOM_MAX_TOOL_CALLS` | `80` | Tool calls per request |
| `VYOM_COMMAND_TIMEOUT_MS` | `120000` | Maximum command run time |
| `VYOM_ALLOWED_ROOTS` | whole Mac | JSON array to restrict file access; `[]` disables it |
| `VYOM_SEARXNG_URL` | unset | Your SearXNG instance; enables `web_search` |
| `VYOM_PROVIDER` | `ollama` | `placeholder` runs without a model |

The Ollama URL must be loopback (`localhost`, `127.0.0.1`, or `::1`).

## Safety model

- **Files:** Protected system and credential locations are blocked, including
  `/System`, `/usr`, `~/.ssh`, keychains, and cloud credentials. Symlinks are
  never followed.
- **Edits:** Edits are atomic and fail if the file changed after you reviewed
  it.
- **Commands:** Commands run with your user permissions after you approve
  them. There is no sandbox, so read the command before approving.
  Interactive commands are not supported.
- **Data:** Conversations, including tool calls and file contents the agent
  read, are stored locally until you delete them. The database is not
  application-encrypted, so use FileVault.
- **Instruction-like content:** Text in tool results and files is treated as
  data, not instructions.

Details:
- [Agent tools](./docs/tools.md)
- [ADR-0015](./docs/adr/0015-coding-agent-loop-and-approved-actions.md)
- [Architecture](./docs/architecture.md)

## Development

```sh
pnpm typecheck
pnpm test
```

Never commit secrets. Test changes before marking work complete.

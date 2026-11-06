# Agent tools

Vyom works through a fixed set of tools. The model chooses which to call; the
tool registry validates every argument, the policy gateway decides whether the
effect is allowed, and approval ports ask the user before anything changes.
Tool results go back to the model as data, never as instructions.

All paths are absolute. Protected locations are always refused, including:
- `/System`, `/Library`, `/Applications`, `/usr`, `/bin`, `/etc`, and `/var`
- `~/.ssh`, `~/.gnupg`, `~/.aws`, `~/.kube`, `~/.docker`, and
  `~/.config/gcloud`
- keychains, `.netrc`, `.npmrc`, and Vyomara's own data folder

Symlinks are never followed. `VYOM_ALLOWED_ROOTS` (JSON array) narrows access;
`[]` disables filesystem tools. The default is the whole Mac.

## Read-only (no approval)

| Tool | Arguments | Notes |
|---|---|---|
| `list_directory` | `path`, `maxEntries?` | Direct children only. |
| `directory_tree` | `path`, `maxDepth?`, `maxEntries?` | Recursive structure. `node_modules`, `.git`, `dist`, `build`, `.venv`, … are listed with `collapsed: true` and not expanded. |
| `find_files` | `query`, `path?`, `maxEntries?` | Name fragment (`vyomara`) or glob (`*.test.ts`). Without `path` it searches the whole Mac, home and project folders first. Dependency folders are skipped. |
| `search_text` | `pattern`, `path`, `glob?`, `ignore_case?`, `max_results?` | Content search like grep. Regex, or literal text when the regex is invalid. Skips binary files, files over 1 MiB, and dependency folders. Returns `path`, `line`, `text`. |
| `update_plan` | `plan` | The agent's checklist for multi-step tasks, one step per line: `- [x]` done, `- [>]` in progress, `- [ ]` to do. It has no side effects. The desktop shows it as a live checklist and the CLI prints it. |
| `read_file` | `path`, `offset?`, `limit?` | UTF-8 text, up to ~800 lines per call (max 2,000), within the output budget. Returns `startLine`, `endLine`, `totalLines`, `truncated`; continue with `offset = endLine + 1`. Files above `VYOM_MAX_FILE_BYTES` (2 MiB) are refused. |

## File changes (reviewed)

Each call waits for the user. The desktop shows a diff (the CLI prints one) and
nothing is written until approval.

| Tool | Arguments | Notes |
|---|---|---|
| `edit_file` | `path`, `old_text`, `new_text`, `replace_all?` | `old_text` must match exactly once (or every occurrence with `replace_all`). The error says when it is missing or ambiguous, so the model can retry. |
| `write_file` | `path`, `content` | Creates a new file or replaces an existing one. |
| `create_directory` | `path` | Parent must exist. |
| `delete_path` | `path` | User must type `DELETE`. Moves to Trash. `/`, `/Users`, and `/Volumes` are refused. |

All file changes follow these rules:
- **Atomic:** writes go to a temporary file in the same folder, then an atomic
  rename.
- **Stale-file check:** a change is refused if the file changed after review
  (device, inode, size, modification time, and SHA-256 are compared).
- **Permissions:** new files and folders are owner-only.

Results are `{status: "applied" | "rejected", operation, path}`.

## Actions (approved)

These tools exist only when the host provides an approval port (`fetch_url`
also needs a web client; `web_search` also needs a SearXNG backend). The desktop
and CLI both do. They are also gated by the policy effects `shell`, `launch`,
and `network`.

| Tool | Arguments | Notes |
|---|---|---|
| `run_command` | `command`, `cwd`, `timeout_seconds?` | Runs `zsh -l -c` in `cwd`, with `CI=1`, no color, no pager, no stdin, and an augmented `PATH`. The whole process group is stopped on timeout or Stop. Output keeps the first ~6 KB and last ~14 KB. Returns `exitCode`, `timedOut`, and `output`. |
| `open_application` | `application`, `path?`, `line?` | Any installed app, by name or alias (`vscode`, `chrome`, …). Optionally opens a file or folder in it. With `line`, VS Code jumps to that line (`code -g`). |
| `open_url` | `url`, `browser?` | Only `http`/`https`, without credentials. The approval card says the website receives the URL. Vyom cannot read the page. |

| `fetch_url` | `url`, `offset?` | Vyomara downloads a public page and returns its `title` and text `content`, paged with `nextOffset`. The first page of results also includes up to 25 `links`. See the limits below the table. |
| `web_search` | `query` | Only when `VYOM_SEARXNG_URL` points to a SearXNG instance with JSON output enabled. Returns up to 10 `{title, url, snippet}`. |

`fetch_url` limits:
- Only `http`/`https`, text content types, 3 MB, a 20 s timeout, and at most 5
  redirects.
- Requests are sent as `Vyomara/0.1` with no cookies or credentials.
- Loopback, private, link-local, and `.local` hosts are refused, including
  through redirects.

A rejected action returns `status: "rejected"` with a note telling the model
not to retry it unchanged.

**Remembered approvals.** For commands, "Always allow here" (CLI: answer `a`)
remembers that exact command in that exact folder. For `fetch_url` and
`web_search`, "Always allow \<host\>" remembers the host. Both last only until
the app or CLI quits, and runs approved this way are still listed in Verified
actions. Edits, deletions, app launches, and `open_url` always ask. See
[ADR-0016](./adr/0016-web-reading-and-remembered-approvals.md).

## Bounds

| Bound | Limit | Setting |
|---|---|---|
| Tool output | 24,000 characters | `VYOM_MAX_TOOL_OUTPUT_CHARS` |
| Tool input | 400,000 characters | `VYOM_MAX_TOOL_INPUT_CHARS` |
| Read-only tool timeout | 30 s | `VYOM_TOOL_TIMEOUT_MS` |
| Command timeout | 120 s default, configurable | `VYOM_COMMAND_TIMEOUT_MS` |
| Approval-gated tool wait | up to 30 min | — |

Stop always cancels a pending approval or running tool.

## Privacy

Tool calls, file contents that were read, command output, and reviewed
proposals are stored in local conversation history and sent only to the local
Ollama service. Diagnostic events record tool IDs, timings, and outcomes, not
arguments or file contents. The database is not application-encrypted, so use
FileVault.

Portable path APIs cannot rule out every race with a hostile local process.
Vyomara revalidates right before each change but does not claim race-free
protection.

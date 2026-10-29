# Read-only filesystem tools

The default tool registry includes `filesystem.list-directory`,
`filesystem.directory-tree`, and `filesystem.read-file`. They are registered
with the existing tool executor as `read` effects, so every invocation passes
through the policy gateway. No filesystem write, edit, delete, move, rename,
shell, or process-execution tool is registered.

## Allowed roots

Filesystem access is denied unless one or more roots are explicitly configured.
Set `VYOM_ALLOWED_ROOTS` to a JSON array of absolute directory paths, for
example in a local shell (replace the example with directories you intend to
allow). Up to 32 roots may be configured:

```sh
export VYOM_ALLOWED_ROOTS='["/Users/your-name/Projects"]'
```

`.env.example` uses `[]`, granting no filesystem access. Vyomara does not
expand `~`, load `.env` files, or silently grant access to the home directory.
The Electron app also provides a **Folders** screen for selecting and
revoking roots through the native directory picker. Those grants are persisted
in the owner-only local database and take effect on the next request.
`VYOM_ALLOWED_ROOTS` seeds that list the first time the desktop database is
initialized; after that, the Folders screen is authoritative for desktop
permissions. The CLI continues to use `VYOM_ALLOWED_ROOTS` directly.
At operation time it canonicalizes each root, rejects paths outside those
roots, requires requested paths to be absolute, and rejects `..` path
components. Error messages and diagnostics do not include configured roots or
requested absolute paths.

## Operations and limits

- `filesystem.list-directory` returns entry names and types, including
  symlinks as `symlink` without following them.
- `filesystem.directory-tree` returns relative entry paths and depth. Its
  default depth is 3 and the configured maximum is 10.
  Depth 1 lists direct children of the requested directory; deeper values
  include descendants. If a directory at the depth boundary is non-empty,
  `truncated` is true because its children were omitted.
  Selection uses depth-first traversal with sibling names in lexical order;
  `maxEntries` is shared across the full tree. Returned entries are sorted by
  relative path. When there is remaining entry capacity, each directory is
  scanned to retain its lexically earliest candidates, independent of the
  filesystem's enumeration order. The scan retains at most the remaining
  entry budget in memory, and the executor timeout bounds its duration; a
  very large directory can therefore time out rather than return a partial
  selection.
- `filesystem.read-file` accepts UTF-8 text files only. It rejects invalid
  UTF-8, NUL bytes, and disallowed control characters as binary-looking
  content.
- A file is limited to 65,536 bytes by default, configurable from 1 byte to
  1 MiB with `VYOM_MAX_FILE_BYTES`.
- Listings and trees return at most 100 entries by default, configurable up
  to 500 with `VYOM_MAX_DIRECTORY_ENTRIES`.
- Tree depth defaults to 3, configurable up to 10 with `VYOM_MAX_TREE_DEPTH`.
- All tool results are also constrained by `VYOM_MAX_TOOL_OUTPUT_CHARS`
  (default 4,000 characters), and operations use the existing tool timeout
  (default 2 seconds) and cancellation boundary.

Pass `maxEntries` to a listing or tree request, and `maxDepth` to a tree
request, only to lower the configured maximum. Entries are selected and
returned deterministically: listings use lexical name order, and trees use
the traversal and final path order described above. `truncated` indicates omitted
entries due to count, depth, or output limits. Unknown input fields, relative
paths, negative limits, and values above configured maxima are rejected.

Invalid model-generated arguments are not coerced. The agent may return one
structured validation error to the model for a correction attempt; corrected
arguments pass through the same schema validation, executor, and policy checks.
If the correction is invalid, the request stops without a success response.
Missing paths, invalid paths, paths outside allowed roots, and permission
failures are reported with concise messages and safe error codes, without
printing absolute paths or stack traces.

File contents are sensitive user data. The filesystem tools do not log them,
but a model-requested read result is added to the temporary conversation and
sent to the configured local Ollama service on the next provider request.
Only explicitly registered read-only tools are advertised. Ollama tool calls
are bounded by the configured iteration, call, input, and output limits, and
every call still passes through executor validation and the fail-closed policy
gateway. Treat file contents as untrusted data; they cannot change system
policy.

Assistant prose is not proof of filesystem activity: a read is considered
successful only when the matching registered tool completed and returned a
validated result. Shell commands, web searches, and file mutations are
unsupported and are not implemented.

## Symlinks and race limitation

Configured roots are canonicalized before use. Requested paths are resolved
and checked with path-aware containment, and symbolic links in requested
paths are rejected. Directory listing and tree output may describe a symlink
entry but never descend through it. File reads use `O_NOFOLLOW` for the final
file and verify file identity after opening.

Portable Node.js path-based filesystem APIs do not provide a complete
`openat`-style, handle-relative walk for every operation. A hostile local
process could change a parent directory or symlink between a check and a
path-based directory operation (a TOCTOU race). The implementation narrows
that window and fails closed on detected changes, but does not claim
race-free protection against concurrent local filesystem mutation. Configure
only roots you trust and avoid concurrently changing their directory
structure during a read.

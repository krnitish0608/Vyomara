# Filesystem tools

Vyomara's CLI and desktop have different filesystem scopes:

- The CLI stays read-only and uses `VYOM_ALLOWED_ROOTS`, a JSON array of
  absolute directory paths. Its default `[]` grants no filesystem access.
- The desktop can search, list, read, create, edit, and delete user files without
  asking the user to select a project. It runs with the current macOS user's
  operating-system permissions, not as root. The desktop's broad scope does not
  override macOS privacy permissions; access may require the user to grant
  Vyomara access in System Settings.

The desktop blocks system and credential locations, including `/System`,
`/Library`, `/Applications`, `/usr`, `/bin`, `/sbin`, `/etc`, `/var`,
`/private/etc`, `/private/var`, `/dev`, `/proc`, `/sys`, `/boot`, `/root`,
the user's Keychains and Vyomara application data, and common credential
stores such as `.ssh`, `.gnupg`, `.aws`, `.azure`, `.kube`, and
`.config/gcloud`, `.config/gh`, `.docker`, `.local/share/keyrings`, `.netrc`,
`.npmrc`, and `.git-credentials`. Protected paths are blocked for reads and
changes; recursive search and tree traversal skip them and report incomplete
results.

## Discovery and reading

- `filesystem.search` matches file and folder names case-insensitively. It
  starts at `/` on desktop when no path is supplied, does not search file
  contents, and never follows symlinks. A default whole-machine search
  prioritizes common project roots in the current user's home directory before
  other accessible locations. An exact filename/folder-name match is returned
  immediately with `truncated: true` because the rest of the machine was not
  searched. Otherwise, search returns at most 100 results by default, scans at
  most 10,000 directories and 1,000 entries per directory, and stops at depth
  32. Permission failures and protected paths are counted as skipped;
  `truncated` and `skippedDirectories` must be considered when interpreting
  results.
- `filesystem.list-directory` returns direct child names and types.
- `filesystem.directory-tree` returns relative entry paths up to the configured
  depth and entry limits. Symlinks may be described but are never followed.
- `filesystem.read-file` accepts bounded UTF-8 text. It rejects invalid UTF-8,
  NUL bytes, and disallowed control characters.
- Reads are limited to 65,536 bytes by default, configurable up to 1 MiB.
  Directory lists and trees default to 100 entries (maximum 500); tree depth
  defaults to 3 (maximum 10).
- Search and other filesystem reads are bounded by tool output limits and
  cancellation/timeouts. The desktop uses a 10-second filesystem timeout.
- User-facing filesystem answers are phrased conversationally from verified
  results: search returns matching paths, listings report direct-child counts,
  and file reads show the requested content. Counts are not presented as
  recursive unless a tree was requested; truncated or skipped results are
  identified as incomplete.

## Reviewed changes

Desktop writes are proposals, never direct model actions:

- Creating a file, creating an empty folder, or editing a text file pauses the
  request and displays the exact path and full current/proposed text in the
  conversation. The user must approve each operation before it is applied.
- File creation requires an existing parent folder. File edits are limited to
  16 KiB and fail if the reviewed file changes before approval. Existing file
  permission bits are retained for edits; new files and folders are owner-only.
- Each deletion requires the user to type `DELETE` for that specific item. It
  moves the item to the system Trash rather than permanently erasing it.
  Deleting `/`, `/Users`, or `/Volumes` is blocked.
- Protected paths, symlinks, invalid paths, and inaccessible paths are
  rejected. Pending approvals expire with the request or are discarded on
  cancellation/restart.
- Shell execution, package installation, web access, and arbitrary application
  control remain unavailable.

## Validation and privacy

Tool arguments are strictly schema-validated; relative paths and parent
traversal are rejected. Requested paths are checked against canonical roots,
and file reads use `O_NOFOLLOW` plus file-identity checks. File creation uses
exclusive creation. Edits and deletions re-check the reviewed file identity
and content before acting. Model results remain untrusted data.

The agent exposes filesystem tools only when the current request explicitly
asks for a filesystem action. A request to locate a file, folder, or project
exposes name search rather than a broad directory listing. Calls to tools not
available for that request are not executed. Short follow-ups such as "search
it", "where is the repo?", or "check again" use the latest verified search
result as context. Project-location answers prioritize matching directories
over similarly named files. Ordinary greetings still do not expose filesystem
tools. Requests to inspect a project and its subfolders use the recursive tree
tool and reuse the verified project path rather than trusting an inferred
relative path from the model.

File contents are sensitive. Read results, tool calls, and approved-change
proposals are stored in local conversation history and sent to the configured
local Ollama provider for follow-up. Vyomara does not send them to a cloud
provider. The local database is not application-encrypted; use FileVault and
review saved conversations before sharing or exporting them.

Portable path-based filesystem APIs cannot provide a fully handle-relative
walk for every operation. A hostile local process could race parent-directory
changes between validation and a filesystem action (a TOCTOU race). Vyomara
revalidates immediately before changes but does not claim race-free protection
against concurrent local filesystem mutation.

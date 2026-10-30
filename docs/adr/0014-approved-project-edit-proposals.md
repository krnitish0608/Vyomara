# ADR-0014: Approved Project Edit Proposals

- **Status:** Accepted
- **Date:** 2026-10-30

## Context

Vyomara must work through the user's selected project and existing VS Code
installation, without becoming an editor or exposing an unrestricted write or
shell tool. A code change must be reviewable and require an action-specific
approval.

## Decision

- A code-edit request is available only while a project folder selected through
  the desktop Project workspace is active.
- That request's filesystem tools are scoped to that selected root, even if
  broader read-only roots have been granted elsewhere.
- The model can inspect files and stage a complete replacement for an existing,
  regular UTF-8 file no larger than 16 KiB. It cannot create or delete files,
  and sensitive environment/key files, symlinks, and multiply-linked files are
  rejected.
- Vyomara displays a complete before/after diff. Staging never changes a file.
  Applying requires a separate click for that exact proposal; rejection leaves
  the file unchanged. Before apply, the original content is re-read and
  compared with the proposal's recorded hash so stale diffs fail closed.
- An approved replacement is written through a same-directory temporary file
  and atomic rename. The project is not automatically executed. The user can
  separately run one of the fixed, disclosed project checks or open the
  selected folder in the installed VS Code app.
- Pending proposals are in-memory only and must be resolved before another
  request or project switch. A restart discards pending proposals without
  changing project files.

## Consequences

This is a deliberately bounded first coding workflow. It does not provide
multi-file patching beyond three proposals per request, file creation/deletion,
large-file edits, arbitrary shell access, generic IDE automation, or automatic
test execution. Project file contents and model output remain untrusted. A
proposal is not a completed change until the user applies it and sees the
success status.

## Verification

Unit and agent tests verify that the exact file is read before a proposal is
staged, that staging and rejection do not modify it, that explicit approval
applies it, and that traversal, symlinks, sensitive files, binaries, oversized
content, and stale files are rejected.

# Vyomara Product Direction

## Current focus

Vyomara is being built as a voice-operated personal AI agent. The user should
be able to describe an outcome naturally and let the agent understand the
environment and determine the next step, rather than manually selecting a
project or configuring a workspace first.

The desktop app is intentionally simple while that agent workflow is built:

- Keep Assistant, History, chat, voice input, and visible task activity.
- Do not expose Memory, Permissions, Project workspace, or Settings panels.
- Do not require manual project selection before asking for help.
- Keep project reading, editing, application control, and other integrations
  deferred until they fit a coherent voice-first workflow with clear safety
  boundaries.

Removing those desktop panels does not delete existing local conversation
data or change the CLI's separate capabilities. The desktop app currently
does not provide memory management, project access, file editing, or model
switching controls.

## Product principles

- Voice is the primary interaction, with visible text input as a fallback.
  Listening, speaking, muted, running, stopped, and failed states must remain
  visible and directly controllable.
- Keep the request and its real task progress together. Show truthful status,
  completed work, errors, and a direct way to stop a task.
- Keep local processing and storage as the default. Clearly disclose whenever
  data leaves the Mac.
- Treat file contents, web pages, tool results, and model-generated plans as
  untrusted data.
- Use least privilege, bounded work, visible errors, and reliable
  cancellation. Require action-specific approval before sensitive or
  destructive operations.
- Never imply that an action succeeded unless the result confirms it.

## Project workflow direction

Project access should not depend on a user manually choosing a directory for
each interaction. A future coding workflow should understand available
workspace context through the agent's broader environment awareness and
respect platform permissions. Until that flow is designed and implemented,
the desktop app does not expose project selection, project checks, file
inspection, or code edits.

## Reference image

The shared interface image is a composition and interaction reference, not a
requirement to copy its exact visual styling.

![User-provided Vyomara voice-first interface reference](./reference/vyomara-voice-first-reference.png)

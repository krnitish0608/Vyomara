# Vyomara

Vyomara is a local-first personal AI assistant for macOS. Its spoken assistant
name is **Vyom**.

## Development status

Initial development setup. The project is at its clean start; implementation
has not begun.

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

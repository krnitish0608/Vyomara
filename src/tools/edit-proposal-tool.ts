import type { AppConfig } from '../config/config.ts';
import type { EditProposalManager } from '../desktop/edit-proposals.ts';
import type { Tool } from './contracts.ts';
import type { ToolRegistry } from './contracts.ts';

interface EmptyInput {
  readonly [key: string]: never;
}

interface ProjectRootOutput {
  readonly path: string;
}

interface ProposalInput {
  readonly path: string;
  readonly content: string;
}

interface ProposalOutput {
  readonly proposalId: string;
  readonly path: string;
  readonly status: 'awaiting-approval';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function registerEditProposalTools(
  registry: ToolRegistry,
  config: AppConfig,
  proposals: EditProposalManager,
): void {
  const projectRoot: Tool<EmptyInput, ProjectRootOutput> = {
    id: 'assistant.project-root',
    effect: 'read',
    description: 'Return the user-selected project root for this coding request. All project reads are limited to this folder.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    validateInput(value): value is EmptyInput {
      return isRecord(value) && Object.keys(value).length === 0;
    },
    validateOutput(value): value is ProjectRootOutput {
      return isRecord(value) && Object.keys(value).length === 1 && typeof value.path === 'string';
    },
    async run() {
      return { path: config.filesystemAllowedRoots[0]! };
    },
  };
  const proposeEdit: Tool<ProposalInput, ProposalOutput> = {
    id: 'filesystem.propose-edit',
    effect: 'read',
    description: 'Stage a complete replacement for one existing UTF-8 project file, using a path relative to the selected project root. This never writes the file. The user must review the full diff and explicitly approve it in Vyomara before it is applied. Never use for deletion, secrets, or files outside the selected project.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to one existing UTF-8 file inside the selected project.', maxLength: 1024 },
        content: { type: 'string', description: 'Complete proposed replacement file contents, maximum 16384 UTF-8 bytes.', maxLength: 16384 },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
    validateInput(value): value is ProposalInput {
      return isRecord(value) &&
        Object.keys(value).length === 2 &&
        typeof value.path === 'string' &&
        value.path.length > 0 &&
        value.path.length <= 1024 &&
        typeof value.content === 'string' &&
        Buffer.byteLength(value.content, 'utf8') <= 16384;
    },
    inputError() {
      return 'Provide a relative project file path and complete replacement text no larger than 16384 UTF-8 bytes.';
    },
    validateOutput(value): value is ProposalOutput {
      return isRecord(value) &&
        Object.keys(value).length === 3 &&
        typeof value.proposalId === 'string' &&
        typeof value.path === 'string' &&
        value.status === 'awaiting-approval';
    },
    run(input, signal) {
      return proposals.propose(input.path, input.content, signal);
    },
  };
  registry.register(projectRoot);
  registry.register(proposeEdit);
}

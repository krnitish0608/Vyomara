import type { Tool } from './contracts.ts';
import type { ToolRegistry } from './contracts.ts';

interface EmptyInput {
  readonly [key: string]: never;
}

interface ProjectRootOutput {
  readonly path: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function registerProjectContextTool(
  registry: ToolRegistry,
  projectDirectory: string,
): void {
  const projectRoot: Tool<EmptyInput, ProjectRootOutput> = {
    id: 'assistant.project-root',
    effect: 'read',
    description: 'Return the user-selected project root. Use this when the user asks where the selected project is or to inspect its contents.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    validateInput(value): value is EmptyInput {
      return isRecord(value) && Object.keys(value).length === 0;
    },
    validateOutput(value): value is ProjectRootOutput {
      return isRecord(value) && Object.keys(value).length === 1 && typeof value.path === 'string';
    },
    async run() {
      return { path: projectDirectory };
    },
  };
  registry.register(projectRoot);
}

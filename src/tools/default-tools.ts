import type { Tool } from './contracts.ts';
import { ToolRegistry } from './contracts.ts';
import type { AppConfig } from '../config/config.ts';
import { registerFilesystemTools } from './filesystem-tools.ts';
import type { EditProposalManager } from '../desktop/edit-proposals.ts';
import { registerEditProposalTools } from './edit-proposal-tool.ts';

interface EmptyInput {
  readonly [key: string]: never;
}

interface AppInfo {
  readonly app: 'Vyomara';
  readonly assistant: 'Vyom';
  readonly provider: 'ollama' | 'deterministic-placeholder';
}

const isEmptyInput = (value: unknown): value is EmptyInput =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 0;

const isAppInfo = (value: unknown): value is AppInfo =>
  typeof value === 'object' &&
  value !== null &&
  'app' in value && value.app === 'Vyomara' &&
  'assistant' in value && value.assistant === 'Vyom' &&
  'provider' in value &&
  (value.provider === 'ollama' || value.provider === 'deterministic-placeholder');

export function createDefaultToolRegistry(
  config: AppConfig,
  editProposals?: EditProposalManager,
): ToolRegistry {
  const registry = new ToolRegistry();
  const appInfoTool: Tool<EmptyInput, AppInfo> = {
    id: 'assistant.info',
    effect: 'read',
    description: 'Return the assistant and application identity.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    validateInput: isEmptyInput,
    validateOutput: isAppInfo,
    async run() {
      return {
        app: 'Vyomara',
        assistant: 'Vyom',
        provider: config.provider === 'ollama' ? 'ollama' : 'deterministic-placeholder',
      };
    },
  };
  registry.register(appInfoTool);
  if (editProposals) registerEditProposalTools(registry, config, editProposals);
  registerFilesystemTools(registry, config);
  return registry;
}

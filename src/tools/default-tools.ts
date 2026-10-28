import type { Tool } from './contracts.ts';
import { ToolRegistry } from './contracts.ts';

interface EmptyInput {
  readonly [key: string]: never;
}

interface AppInfo {
  readonly app: 'Vyomara';
  readonly assistant: 'Vyom';
  readonly provider: 'deterministic-placeholder';
}

const isEmptyInput = (value: unknown): value is EmptyInput =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 0;

const isAppInfo = (value: unknown): value is AppInfo =>
  typeof value === 'object' &&
  value !== null &&
  'app' in value && value.app === 'Vyomara' &&
  'assistant' in value && value.assistant === 'Vyom' &&
  'provider' in value && value.provider === 'deterministic-placeholder';

const appInfoTool: Tool<EmptyInput, AppInfo> = {
  id: 'assistant.info',
  effect: 'read',
  validateInput: isEmptyInput,
  validateOutput: isAppInfo,
  async run() {
    return {
      app: 'Vyomara',
      assistant: 'Vyom',
      provider: 'deterministic-placeholder',
    };
  },
};

export function createDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(appInfoTool);
  return registry;
}

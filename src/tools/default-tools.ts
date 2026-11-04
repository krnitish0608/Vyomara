import { ToolRegistry } from './contracts.ts';
import type { AppConfig } from '../config/config.ts';
import { registerFilesystemTools } from './filesystem-tools.ts';

export function createDefaultToolRegistry(
  config: AppConfig,
  includeFilesystemTools = true,
): ToolRegistry {
  const registry = new ToolRegistry();
  if (includeFilesystemTools) registerFilesystemTools(registry, config);
  return registry;
}

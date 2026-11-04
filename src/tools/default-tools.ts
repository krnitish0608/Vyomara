import { ToolRegistry } from './contracts.ts';
import type { AppConfig } from '../config/config.ts';
import { registerFilesystemTools } from './filesystem-tools.ts';
import type { FileOperationApprovalPort } from '../desktop/contracts.ts';

export function createDefaultToolRegistry(
  config: AppConfig,
  includeFilesystemTools = true,
  fileOperationApproval?: FileOperationApprovalPort,
): ToolRegistry {
  const registry = new ToolRegistry();
  if (includeFilesystemTools) registerFilesystemTools(registry, config, {}, fileOperationApproval);
  return registry;
}

import { ToolRegistry } from './contracts.ts';
import type { AppConfig } from '../config/config.ts';
import { registerFilesystemTools } from './filesystem-tools.ts';
import type { FileOperationApprovalPort } from '../desktop/contracts.ts';
import { registerActionTools, registerWebTools } from './action-tools.ts';
import type { ActionToolPorts } from './action-tools.ts';

export interface ToolRegistryOptions {
  readonly includeFilesystemTools?: boolean;
  /** Enables write_file, edit_file, create_directory, and delete_path (each reviewed by the user). */
  readonly fileOperationApproval?: FileOperationApprovalPort;
  /** Enables run_command, open_application, open_url, fetch_url, web_search (each approved by the user). */
  readonly actions?: ActionToolPorts;
}

export function createDefaultToolRegistry(
  config: AppConfig,
  options: ToolRegistryOptions = {},
): ToolRegistry {
  const registry = new ToolRegistry();
  const includeFilesystemTools = options.includeFilesystemTools ?? config.filesystemAllowedRoots.length > 0;
  if (includeFilesystemTools) {
    registerFilesystemTools(registry, config, {}, options.fileOperationApproval);
  }
  if (options.actions) {
    registerActionTools(registry, config, options.actions);
    registerWebTools(registry, config, options.actions);
  }
  return registry;
}

import { ToolRegistry } from './contracts.ts';
import type { AppConfig } from '../config/config.ts';
import { registerFilesystemTools } from './filesystem-tools.ts';
import type { FileOperationApprovalPort } from '../desktop/contracts.ts';
import { registerApplicationTools } from './application-tools.ts';
import type {
  ApplicationLaunchApprovalPort,
  ApplicationLauncherPort,
} from './application-tools.ts';

export function createDefaultToolRegistry(
  config: AppConfig,
  includeFilesystemTools = true,
  fileOperationApproval?: FileOperationApprovalPort,
  applicationLauncher?: ApplicationLauncherPort,
  applicationLaunchApproval?: ApplicationLaunchApprovalPort,
): ToolRegistry {
  const registry = new ToolRegistry();
  if (includeFilesystemTools) registerFilesystemTools(registry, config, {}, fileOperationApproval);
  if (applicationLauncher && applicationLaunchApproval) {
    registerApplicationTools(registry, applicationLauncher, applicationLaunchApproval);
  }
  return registry;
}

import { ToolRegistry } from './contracts.ts';
import type { AppConfig } from '../config/config.ts';
import { registerFilesystemTools } from './filesystem-tools.ts';
import type { EditProposalManager } from '../desktop/edit-proposals.ts';
import { registerEditProposalTools } from './edit-proposal-tool.ts';
import { registerProjectContextTool } from './project-context-tool.ts';

export function createDefaultToolRegistry(
  config: AppConfig,
  editProposals?: EditProposalManager,
  includeFilesystemTools = true,
  projectDirectory?: string,
): ToolRegistry {
  const registry = new ToolRegistry();
  if (editProposals) registerEditProposalTools(registry, editProposals);
  if (projectDirectory) registerProjectContextTool(registry, projectDirectory);
  if (includeFilesystemTools) registerFilesystemTools(registry, config);
  return registry;
}

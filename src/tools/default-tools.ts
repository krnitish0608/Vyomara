import { ToolRegistry } from './contracts.ts';
import type { AppConfig } from '../config/config.ts';
import { registerFilesystemTools } from './filesystem-tools.ts';
import type { EditProposalManager } from '../desktop/edit-proposals.ts';
import { registerEditProposalTools } from './edit-proposal-tool.ts';

export function createDefaultToolRegistry(
  config: AppConfig,
  editProposals?: EditProposalManager,
  includeFilesystemTools = true,
): ToolRegistry {
  const registry = new ToolRegistry();
  if (editProposals) registerEditProposalTools(registry, config, editProposals);
  if (includeFilesystemTools) registerFilesystemTools(registry, config);
  return registry;
}

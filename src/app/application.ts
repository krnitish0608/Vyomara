import type { AppConfig } from '../config/config.ts';
import type { Logger } from '../types.ts';
import { runAgent } from '../agent/agent.ts';
import { PlaceholderProvider } from '../providers/provider.ts';
import { Session } from '../session/session.ts';
import { createDefaultToolRegistry } from '../tools/default-tools.ts';
import { ToolExecutor } from '../tools/executor.ts';
import { PolicyGateway } from '../tools/policy.ts';

export async function runRequest(
  prompt: string,
  signal: AbortSignal,
  config: AppConfig,
  logger: Logger,
): Promise<string> {
  const session = new Session();
  const provider = new PlaceholderProvider();
  const tools = new ToolExecutor({
    registry: createDefaultToolRegistry(),
    policy: new PolicyGateway(),
    config,
    logger,
  });
  return runAgent(prompt, signal, {
    provider,
    tools,
    config,
    session,
    logger,
  });
}

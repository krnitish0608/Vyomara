import { runRequest } from './app/application.ts';
import { AgentError } from './agent/agent.ts';
import { loadConfig } from './config/config.ts';
import { createLogger } from './diagnostics/logger.ts';
import { ProviderError } from './providers/provider.ts';
import { ToolExecutionError } from './tools/executor.ts';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Configuration is invalid.');
    process.exitCode = 2;
    return;
  }

  const args = process.argv.slice(2);
  if (args[0] === '--') args.shift();
  const prompt = args.join(' ').trim();
  if (!prompt) {
    console.error('Usage: pnpm dev -- "your request"');
    process.exitCode = 2;
    return;
  }

  const controller = new AbortController();
  const onInterrupt = () => controller.abort();
  process.once('SIGINT', onInterrupt);
  try {
    console.log(config.provider === 'ollama'
      ? 'Provider: local Ollama; supported requests are sent to the configured local service.'
      : 'Provider: deterministic placeholder; no model service is contacted.');
    const response = await runRequest(prompt, controller.signal, config, createLogger());
    console.log(response);
  } catch (error) {
    createLogger().failure();
    if (
      error instanceof ProviderError ||
      error instanceof AgentError ||
      error instanceof ToolExecutionError
    ) {
      console.error(error.message);
    } else {
      console.error('Request failed or was cancelled. No success is implied; review configuration and retry.');
    }
    process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', onInterrupt);
  }
}

void main();

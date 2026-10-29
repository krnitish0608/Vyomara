import { createInterface } from 'node:readline/promises';
import { runRequest } from './app/application.ts';
import { AgentError } from './agent/agent.ts';
import { loadConfig } from './config/config.ts';
import { createLogger } from './diagnostics/logger.ts';
import { ProviderError } from './providers/provider.ts';
import { PersistenceError, SqliteStore } from './storage/sqlite-store.ts';
import { ToolExecutionError } from './tools/executor.ts';

async function confirmAction(message: string, confirmation: string): Promise<boolean> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question(`${message}\nType ${confirmation} to continue: `);
    return answer.trim() === confirmation;
  } finally {
    prompt.close();
  }
}

function printStorageUsage(): void {
  console.log([
    'Usage:',
    '  pnpm dev -- "your request"',
    '  pnpm dev -- --session <session-id> "your next turn"',
    '  pnpm dev -- --sessions list|show <session-id>|delete <session-id> [--confirm]',
    '  pnpm dev -- --memory list|show <memory-id>|save "content" --confirm|delete <memory-id> --confirm',
  ].join('\n'));
}

async function runStorageCommand(args: string[], dataDirectory: string): Promise<void> {
  const [group, action, id, ...remaining] = args;
  const store = new SqliteStore(dataDirectory);
  try {
    if (group === '--sessions' && action === 'list' && id === undefined) {
      const sessions = store.listSessions();
      console.log(JSON.stringify(sessions, null, 2));
      return;
    }
    if (group === '--sessions' && action === 'show' && id !== undefined && remaining.length === 0) {
      console.log(JSON.stringify(store.getSession(id).messages(), null, 2));
      return;
    }
    if (group === '--sessions' && action === 'delete' && id !== undefined) {
      if (remaining.length !== 1 || remaining[0] !== '--confirm') {
        throw new PersistenceError(
          'Session deletion requires --confirm after reviewing the session ID.',
          'invalid-data',
        );
      }
      if (!await confirmAction(`Delete session ${id}?`, 'DELETE')) {
        console.log('Session was not deleted.');
        process.exitCode = 1;
        return;
      }
      if (!store.deleteSession(id)) {
        throw new PersistenceError('The requested session was not found.', 'not-found');
      }
      console.log(`Deleted session ${id}.`);
      return;
    }
    if (group === '--memory' && action === 'list' && id === undefined) {
      console.log(JSON.stringify(store.listMemories(), null, 2));
      return;
    }
    if (group === '--memory' && action === 'show' && id !== undefined && remaining.length === 0) {
      console.log(JSON.stringify(store.getMemory(id)));
      return;
    }
    if (group === '--memory' && action === 'save' && id !== undefined) {
      const confirmed = remaining.at(-1) === '--confirm';
      const contentParts = confirmed ? [id, ...remaining.slice(0, -1)] : [id, ...remaining];
      const content = contentParts.join(' ').trim();
      console.log(`Memory content to save:\n${JSON.stringify(content)}`);
      if (!confirmed) {
        throw new PersistenceError(
          'Memory was not saved. Review the content above and repeat the command with --confirm.',
          'invalid-data',
        );
      }
      if (!await confirmAction('Review the memory content above.', 'SAVE')) {
        console.log('Memory was not saved.');
        process.exitCode = 1;
        return;
      }
      const memoryId = store.saveMemory(content);
      console.log(`Saved explicit memory ${memoryId}.`);
      return;
    }
    if (group === '--memory' && action === 'delete' && id !== undefined) {
      if (remaining.length !== 1 || remaining[0] !== '--confirm') {
        throw new PersistenceError(
          'Memory deletion requires --confirm after reviewing the memory ID.',
          'invalid-data',
        );
      }
      if (!await confirmAction(`Delete memory ${id}?`, 'DELETE')) {
        console.log('Memory was not deleted.');
        process.exitCode = 1;
        return;
      }
      if (!store.deleteMemory(id)) {
        throw new PersistenceError('The requested memory was not found.', 'not-found');
      }
      console.log(`Deleted memory ${id}.`);
      return;
    }
    printStorageUsage();
    process.exitCode = 2;
  } finally {
    store.close();
  }
}

async function main(): Promise<void> {
  const logger = createLogger();
  let config;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    logger.failure(error);
    console.error(error instanceof Error ? error.message : 'Configuration is invalid.');
    process.exitCode = 2;
    return;
  }

  const args = process.argv.slice(2);
  if (args[0] === '--') args.shift();
  if (args[0] === '--sessions' || args[0] === '--memory') {
    try {
      await runStorageCommand(args, config.dataDirectory);
    } catch (error) {
      console.error(error instanceof PersistenceError
        ? error.message
        : 'Local data operation failed safely.');
      process.exitCode = 1;
    }
    return;
  }
  let sessionId: string | undefined;
  if (args[0] === '--session') {
    sessionId = args[1];
    if (!sessionId) {
      printStorageUsage();
      process.exitCode = 2;
      return;
    }
    args.splice(0, 2);
  }
  const prompt = args.join(' ').trim();
  if (!prompt) {
    printStorageUsage();
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
    const result = await runRequest(prompt, controller.signal, config, logger, sessionId);
    console.log(`Session ID: ${result.sessionId}`);
    console.log(result.response);
  } catch (error) {
    if (
      error instanceof ProviderError ||
      error instanceof AgentError ||
      error instanceof ToolExecutionError ||
      error instanceof PersistenceError
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

import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config/config.ts';
import { createLogger } from '../src/diagnostics/logger.ts';
import { ToolRegistry } from '../src/tools/contracts.ts';
import { ToolExecutionError, ToolExecutor } from '../src/tools/executor.ts';
import { PolicyGateway } from '../src/tools/policy.ts';
import { registerApplicationTools } from '../src/tools/application-tools.ts';
import type { ApplicationId } from '../src/tools/application-tools.ts';

function executor(
  launched: ApplicationId[],
  approve = true,
  approvalRequests: ApplicationId[] = [],
) {
  const config = loadConfig({ VYOM_PROVIDER: 'placeholder' });
  const registry = new ToolRegistry();
  registerApplicationTools(registry, {
    async launch(application) {
      launched.push(application);
    },
  }, {
    async request(application) {
      approvalRequests.push(application);
      return approve;
    },
  });
  return new ToolExecutor({
    registry,
    policy: new PolicyGateway({ authorizedApplication: 'calculator' }),
    config,
    logger: createLogger(() => {}),
  });
}

test('application tool exposes a bounded allowlist and opens supported names', async () => {
  const launched: ApplicationId[] = [];
  const tools = executor(launched);

  assert.deepEqual(tools.modelTools().map(tool => tool.id), ['application.open']);
  assert.deepEqual(
    await tools.execute('application.open', { application: 'Calculator' }, new AbortController().signal),
    { application: 'calculator', status: 'opened' },
  );
  assert.deepEqual(launched, ['calculator']);
});

test('a rejected launch confirmation never opens the application', async () => {
  const launched: ApplicationId[] = [];
  const tools = executor(launched, false);

  assert.deepEqual(
    await tools.execute('application.open', { application: 'Calculator' }, new AbortController().signal),
    { application: 'calculator', status: 'rejected' },
  );
  assert.deepEqual(launched, []);
});

test('application tool rejects unsupported applications without launching anything', async () => {
  const launched: ApplicationId[] = [];
  const tools = executor(launched);

  await assert.rejects(
    tools.execute('application.open', { application: 'Photoshop' }, new AbortController().signal),
    (error: unknown) => error instanceof ToolExecutionError && error.code === 'invalid-input',
  );
  assert.deepEqual(launched, []);
});

test('application policy authorizes only the application explicitly requested', async () => {
  const launched: ApplicationId[] = [];
  const approvalRequests: ApplicationId[] = [];
  const tools = executor(launched, true, approvalRequests);

  await assert.rejects(
    tools.execute('application.open', { application: 'Safari' }, new AbortController().signal),
    (error: unknown) => error instanceof ToolExecutionError && error.code === 'policy-denied',
  );
  assert.deepEqual(launched, []);
  assert.deepEqual(approvalRequests, []);
});

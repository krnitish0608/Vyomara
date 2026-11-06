/**
 * Real-model evaluation: runs coding scenarios against temporary fixture
 * projects and reports pass/fail, time, and steps.
 *
 *   pnpm eval                       # every scenario once with the configured model
 *   pnpm eval -- --runs 3 --model qwen2.5-coder:14b --only fix-bug
 *
 * Approvals are automatic but confined: edits and commands are approved only
 * inside the fixture folder; app launches, URLs, and web access are rejected.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { runRequest } from '../src/app/application.ts';
import { loadConfig, validateOllamaModel } from '../src/config/config.ts';
import { createLogger } from '../src/diagnostics/logger.ts';
import { FileOperationApprovalManager } from '../src/desktop/file-operation-approval.ts';
import type { ActionApprovalPort } from '../src/tools/action-tools.ts';
import { ShellCommandRunner } from '../src/tools/command-runner.ts';

interface Scenario {
  readonly id: string;
  readonly prompt: (root: string) => string;
  readonly files: Readonly<Record<string, string>>;
  readonly check: (root: string, response: string) => string | undefined;
}

const CART = `// Shopping cart helpers.

/** Sum of item price × quantity. */
export function cartTotal(items) {
  return items.reduce((sum, item) => sum + item.price, 0);
}

/** Apply a percentage discount (0-100). */
export function applyDiscount(total, percent) {
  if (percent < 0 || percent > 100) throw new RangeError('percent must be 0-100');
  return total - (total * percent) / 100;
}
`;

const CART_TEST = `import assert from 'node:assert/strict';
import test from 'node:test';
import { applyDiscount, cartTotal } from '../src/cart.js';

test('cartTotal multiplies price by quantity', () => {
  assert.equal(cartTotal([{ price: 10, quantity: 2 }, { price: 5, quantity: 1 }]), 25);
});

test('applyDiscount', () => {
  assert.equal(applyDiscount(200, 10), 180);
});
`;

const SHOP: Readonly<Record<string, string>> = {
  'package.json': '{\n  "name": "shop",\n  "type": "module",\n  "scripts": { "test": "node --test" }\n}\n',
  'README.md': '# Shop\nTiny cart library.\n',
  'src/cart.js': CART,
  'test/cart.test.js': CART_TEST,
};

function testsPass(root: string): boolean {
  return spawnSync(process.execPath, ['--test'], { cwd: root, encoding: 'utf8', timeout: 60_000 }).status === 0;
}

const scenarios: readonly Scenario[] = [
  {
    id: 'locate-code',
    prompt: root => `In the project at ${root}, which file and line defines applyDiscount?`,
    files: SHOP,
    check: (_root, response) => /src\/cart\.js/u.test(response) && /\b9\b/u.test(response)
      ? undefined
      : 'answer should name src/cart.js and line 9',
  },
  {
    id: 'fix-bug',
    prompt: root => `${root} project mein ek test fail ho raha hai. bug dhundo, fix karo aur tests chala ke verify karo`,
    files: SHOP,
    check: root => {
      if (!testsPass(root)) return 'tests still fail';
      if (readFileSync(join(root, 'test/cart.test.js'), 'utf8') !== CART_TEST) return 'the test file was changed';
      return undefined;
    },
  },
  {
    id: 'add-feature',
    prompt: root => `In ${root}, add an exported function formatPrice(cents) to src/cart.js that returns a string like "$12.34" for 1234, add a test for it in test/cart.test.js, then run the tests. (The existing cartTotal test failure is a separate bug; fix it too.)`,
    files: SHOP,
    check: root => {
      const cart = readFileSync(join(root, 'src/cart.js'), 'utf8');
      if (!/export function formatPrice/u.test(cart)) return 'formatPrice is not exported from src/cart.js';
      if (!/formatPrice/u.test(readFileSync(join(root, 'test/cart.test.js'), 'utf8'))) return 'no test for formatPrice';
      const probe = spawnSync(process.execPath, ['--input-type=module', '-e',
        `import { formatPrice } from ${JSON.stringify(join(root, 'src/cart.js'))}; console.log(formatPrice(1234));`], { encoding: 'utf8' });
      if (probe.stdout.trim() !== '$12.34') return `formatPrice(1234) returned ${JSON.stringify(probe.stdout.trim())}`;
      return testsPass(root) ? undefined : 'tests fail';
    },
  },
  {
    id: 'explain-hinglish',
    prompt: root => `${root} wale project mein kya hai? short mein samjhao`,
    files: SHOP,
    check: (_root, response) => {
      if (/[ऀ-ॿ]/u.test(response)) return 'replied in Devanagari instead of Roman Hinglish';
      return /cart/iu.test(response) ? undefined : 'answer does not mention the cart code';
    },
  },
];

function parseArgs(argv: readonly string[]): { runs: number; model?: string; only?: string } {
  const args = argv[0] === '--' ? argv.slice(1) : [...argv];
  const result: { runs: number; model?: string; only?: string } = { runs: 1 };
  for (let index = 0; index < args.length; index += 2) {
    const value = args[index + 1];
    if (value === undefined) throw new Error(`Missing value for ${args[index]}`);
    if (args[index] === '--runs') result.runs = Math.max(1, Number.parseInt(value, 10) || 1);
    else if (args[index] === '--model') result.model = validateOllamaModel(value);
    else if (args[index] === '--only') result.only = value;
    else throw new Error(`Unknown option ${args[index]}`);
  }
  return result;
}

const options = parseArgs(process.argv.slice(2));
const base = loadConfig(process.env);
const work = realpathSync(mkdtempSync(join(tmpdir(), 'vyomara-eval-')));
chmodSync(work, 0o700);
const config = {
  ...base,
  ...(options.model ? { ollamaModel: options.model } : {}),
  dataDirectory: join(work, 'data'),
  filesystemAllowedRoots: [work],
};
mkdirSync(config.dataDirectory, { mode: 0o700 });

const results: { scenario: string; run: number; pass: boolean; reason?: string; seconds: number; steps: number }[] = [];
console.log(`Evaluating ${config.ollamaModel} (${config.ollamaNumCtx} ctx, think=${config.ollamaThink}) in ${work}\n`);

try {
  for (const scenario of scenarios.filter(item => !options.only || item.id === options.only)) {
    for (let run = 1; run <= options.runs; run += 1) {
      const root = join(work, `${scenario.id}-${run}`, 'shop');
      for (const [path, content] of Object.entries(scenario.files)) {
        mkdirSync(join(root, path, '..'), { recursive: true });
        writeFileSync(join(root, path), content);
      }
      const inside = (path: string): boolean => !relative(root, path).startsWith('..');
      const files = new FileOperationApprovalManager({
        config,
        moveToTrash: async () => { throw new Error('Deletion is not allowed during evaluation.'); },
        onProposal: proposal => queueMicrotask(() => {
          if (inside(proposal.path) && proposal.operation !== 'delete') void files.approve(proposal.id).catch(() => undefined);
          else files.reject(proposal.id);
        }),
      });
      const actions: ActionApprovalPort = {
        async request(action) {
          return action.kind === 'command' && inside(action.cwd);
        },
      };
      let steps = 0;
      const started = Date.now();
      let response = '';
      let reason: string | undefined;
      try {
        const result = await runRequest(scenario.prompt(root), AbortSignal.timeout(15 * 60_000), config, createLogger(() => {}), {
          onToolActivity: activity => { if (activity.status === 'running') steps += 1; },
          fileOperationApproval: files,
          actions: { approval: actions, commandRunner: new ShellCommandRunner() },
        });
        response = result.response;
        reason = scenario.check(root, response);
      } catch (error) {
        reason = `request failed: ${error instanceof Error ? error.message : String(error)}`;
      }
      const seconds = Math.round((Date.now() - started) / 1000);
      results.push({ scenario: scenario.id, run, pass: reason === undefined, ...(reason ? { reason } : {}), seconds, steps });
      console.log(`${reason === undefined ? 'PASS' : 'FAIL'}  ${scenario.id} #${run}  ${seconds}s  ${steps} steps${reason ? `  — ${reason}` : ''}`);
    }
  }
} finally {
  const passed = results.filter(result => result.pass).length;
  console.log(`\n${passed}/${results.length} passed`);
  const report = join(process.cwd(), 'eval-results.json');
  writeFileSync(report, `${JSON.stringify({ model: config.ollamaModel, date: new Date().toISOString(), results }, null, 2)}\n`);
  console.log(`Report: ${report}`);
  rmSync(work, { recursive: true, force: true });
}

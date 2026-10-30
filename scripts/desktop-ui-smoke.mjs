import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error('The desktop UI smoke test requires macOS on Apple Silicon.');
}

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const temporaryRoot = mkdtempSync(join(tmpdir(), 'vyomara-desktop-ui-smoke-'));
const debugPortProbe = createServer();
await new Promise((resolveListen, rejectListen) => {
  debugPortProbe.once('error', rejectListen);
  debugPortProbe.listen(0, '127.0.0.1', resolveListen);
});
const address = debugPortProbe.address();
if (!address || typeof address === 'string') throw new Error('A local debug port could not be allocated.');
const debugPort = address.port;
await new Promise((resolveClose, rejectClose) => {
  debugPortProbe.close(error => error ? rejectClose(error) : resolveClose());
});

const child = spawn(
  resolve(projectRoot, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
  [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${join(temporaryRoot, 'electron-profile')}`,
    resolve(projectRoot, 'out/main/index.js'),
  ],
  {
    cwd: projectRoot,
    env: {
      ...process.env,
      VYOM_PROVIDER: 'placeholder',
      VYOM_DATA_DIR: join(temporaryRoot, 'app-data'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);

let processOutput = '';
child.stdout.on('data', chunk => { processOutput = (processOutput + chunk).slice(-4_000); });
child.stderr.on('data', chunk => { processOutput = (processOutput + chunk).slice(-4_000); });

let socket;
let nextMessageId = 0;
const pending = new Map();
const checks = [];

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  checks.push(message);
}

async function waitFor(operation, description, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Electron exited while ${description}: ${processOutput}`);
    }
    const result = await operation();
    if (result) return result;
    await delay(100);
  }
  throw new Error(`Timed out while ${description}: ${processOutput}`);
}

async function send(method, params = {}) {
  const id = ++nextMessageId;
  return new Promise((resolveResponse, rejectResponse) => {
    pending.set(id, { resolve: resolveResponse, reject: rejectResponse });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const response = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
  }
  return response.result?.value;
}

async function clickButton(label) {
  const clicked = await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')]
      .find(candidate => candidate.innerText.trim() === ${JSON.stringify(label)});
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Could not click enabled button "${label}".`);
}

async function pressKey(key, code, windowsVirtualKeyCode) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode });
}

async function tabUntil(elementId) {
  for (let count = 0; count < 60; count++) {
    if (await evaluate(`document.activeElement?.id === ${JSON.stringify(elementId)}`)) return;
    await pressKey('Tab', 'Tab', 9);
  }
  throw new Error(`Keyboard navigation did not reach "${elementId}".`);
}

try {
  const targets = await waitFor(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      return response.ok ? response.json() : undefined;
    } catch {
      return undefined;
    }
  }, 'waiting for Electron DevTools');
  const target = targets.find(candidate => candidate.type === 'page' && candidate.webSocketDebuggerUrl);
  if (!target) throw new Error('Electron did not expose a page target.');

  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', rejectOpen, { once: true });
  });
  socket.addEventListener('message', event => {
    const response = JSON.parse(event.data);
    if (!response.id) return;
    const waiter = pending.get(response.id);
    if (!waiter) return;
    pending.delete(response.id);
    if (response.error) waiter.reject(new Error(response.error.message));
    else waiter.resolve(response.result);
  });

  await waitFor(
    async () => (await evaluate('document.body?.innerText ?? ""')).includes('Deterministic placeholder'),
    'waiting for the desktop shell',
  );
  await pressKey('Tab', 'Tab', 9);
  const initialFocus = await evaluate(`({
    outline: getComputedStyle(document.activeElement).outlineStyle,
    width: getComputedStyle(document.activeElement).outlineWidth,
  })`);
  assert(initialFocus.outline === 'solid' && initialFocus.width === '2px', 'keyboard focus has a visible outline');

  for (const [label, panelId] of [
    ['Settings', 'settings-panel'],
    ['History', 'history-panel'],
    ['Folders', 'permissions-panel'],
    ['Memory', 'memory-panel'],
  ]) {
    await clickButton(label);
    await waitFor(() => evaluate(`document.getElementById(${JSON.stringify(panelId)}) !== null`), `opening ${label}`);
    assert(
      await evaluate(`document.activeElement?.textContent.trim() === ${JSON.stringify(label)}`),
      `${label} opens with focus on its heading`,
    );
    assert(
      await evaluate(`(() => {
        const trigger = [...document.querySelectorAll('button')].find(button => button.innerText.trim() === ${JSON.stringify(label)});
        return trigger?.getAttribute('aria-expanded') === 'true' &&
          trigger.getAttribute('aria-controls') === ${JSON.stringify(panelId)};
      })()`),
      `${label} trigger exposes expanded state and panel relationship`,
    );
    await pressKey('Escape', 'Escape', 27);
    await waitFor(
      () => evaluate('document.querySelector(\'button[aria-expanded="true"]\') === null'),
      `closing ${label} with Escape`,
    );
    assert(
      await evaluate('document.activeElement?.innerText.trim()') === label,
      `${label} Escape restores focus to its toolbar trigger`,
    );
  }

  await clickButton('Settings');
  await waitFor(() => evaluate('document.getElementById("settings-panel") !== null'), 'reopening Settings');
  await tabUntil('model-name');
  const settingsInputFocus = await evaluate(`({
    outline: getComputedStyle(document.activeElement).outlineStyle,
    width: getComputedStyle(document.activeElement).outlineWidth,
  })`);
  assert(
    settingsInputFocus.outline === 'solid' && settingsInputFocus.width === '2px',
    'Settings text input retains its keyboard focus indicator',
  );
  await pressKey('Escape', 'Escape', 27);

  await clickButton('Memory');
  await waitFor(() => evaluate('document.getElementById("memory-panel") !== null'), 'reopening Memory');
  await tabUntil('memory-draft');
  const memoryInputFocus = await evaluate(`({
    outline: getComputedStyle(document.activeElement).outlineStyle,
    width: getComputedStyle(document.activeElement).outlineWidth,
  })`);
  assert(
    memoryInputFocus.outline === 'solid' && memoryInputFocus.width === '2px',
    'Memory textarea has a visible keyboard focus indicator',
  );
  await pressKey('Escape', 'Escape', 27);

  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  const motion = await evaluate(`(() => {
    const element = document.createElement('div');
    element.style.cssText = 'animation-name:pulse;animation-duration:1s;transition-duration:2s;scroll-behavior:smooth';
    document.body.append(element);
    const style = getComputedStyle(element);
    const result = {
      prefers: matchMedia('(prefers-reduced-motion: reduce)').matches,
      animation: style.animationDuration,
      iterations: style.animationIterationCount,
      transition: style.transitionDuration,
      scroll: style.scrollBehavior,
    };
    element.remove();
    return result;
  })()`);
  assert(
    motion.prefers &&
      motion.animation === '1e-05s' &&
      motion.iterations === '1' &&
      motion.transition === '1e-05s' &&
      motion.scroll === 'auto',
    'reduced-motion preference disables animation and smooth scrolling',
  );

  console.log('Desktop UI accessibility smoke checks: PASS');
  checks.forEach((check, index) => console.log(`${index + 1}. PASS ${check}`));
} finally {
  if (socket?.readyState === WebSocket.OPEN) socket.close();
  if (child.exitCode === null) {
    child.kill('SIGTERM');
    await Promise.race([
      new Promise(resolveExit => child.once('exit', resolveExit)),
      delay(7_000),
    ]);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  rmSync(temporaryRoot, { recursive: true, force: true });
}

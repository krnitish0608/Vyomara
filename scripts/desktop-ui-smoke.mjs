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
      .find(candidate => candidate.innerText.trim().endsWith(${JSON.stringify(label)}));
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Could not click enabled button "${label}".`);
}

async function typeText(text) {
  await send('Input.insertText', { text });
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
  const state = await evaluate(`({
    targetExists: Boolean(document.getElementById(${JSON.stringify(elementId)})),
    active: document.activeElement?.outerHTML?.slice(0, 160),
  })`);
  throw new Error(`Keyboard navigation did not reach "${elementId}": ${JSON.stringify(state)}`);
}

try {
  const target = await waitFor(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      if (!response.ok) return undefined;
      const targets = await response.json();
      return targets.find(candidate => candidate.type === 'page' && candidate.webSocketDebuggerUrl);
    } catch {
      return undefined;
    }
  }, 'waiting for Electron DevTools');

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
  const voiceCapabilities = await evaluate(`(async () => ({
    speechSynthesis: typeof window.speechSynthesis === 'object',
    localVoices: window.speechSynthesis?.getVoices().filter(voice => voice.localService).length ?? 0,
    speechSetup: await window.vyomara.getSpeechSetupStatus(),
  }))()`);
  console.log(`Electron voice capabilities: ${JSON.stringify(voiceCapabilities)}`);
  assert(
    voiceCapabilities.speechSetup.listeningEnabled === false,
    'startup does not enable microphone capture without a saved user preference',
  );
  assert(
    await evaluate(`Boolean(document.querySelector('nav[aria-label="Main navigation"]') &&
      document.querySelector('aside[aria-label="Task activity"]') &&
      document.querySelector('.welcome-card'))`),
    'assistant opens with navigation, chat-first welcome, and task activity',
  );
  assert(
    await evaluate(`document.documentElement.scrollHeight <= document.documentElement.clientHeight &&
      document.body.scrollHeight <= document.body.clientHeight &&
      document.querySelector('.message-list').scrollHeight <= document.querySelector('.message-list').clientHeight`),
    'the app fits the viewport and keeps conversation scrolling inside the message list',
  );
  assert(
    await evaluate(`document.getElementById('prompt')?.placeholder.includes('Hello Vyom') &&
      document.querySelector('.welcome-card')?.innerText.includes('Vyom will greet you')`),
    'empty chat clearly asks the user to start with Hello Vyom',
  );
  assert(
    await evaluate(`document.querySelector('.tool-execution-card')?.innerText.includes('No task running')`),
    'current task panel reports the truthful idle state',
  );
  await evaluate('document.getElementById("prompt").focus()');
  await typeText('Can you help me?');
  await pressKey('Enter', 'Enter', 13);
  await waitFor(
    () => evaluate('document.querySelector(".session-start-error")?.innerText.includes("Hello Vyom")'),
    'enforcing the Hello Vyom first-message boundary',
  );
  assert(
    await evaluate(`document.querySelectorAll('.message').length === 0 &&
      !document.querySelector('.session-badge')`),
    'a new conversation cannot bypass its greeting or create a session early',
  );
  await clickButton('New conversation');
  await evaluate('document.getElementById("prompt").focus()');
  await typeText('Hello Vyom');
  await pressKey('Enter', 'Enter', 13);
  await waitFor(
    () => evaluate(`document.querySelector('.message-user .message-text')?.innerText === 'Hello Vyom' &&
      document.querySelector('.message-assistant .message-text') &&
      !document.querySelector('.pending-state')`),
    'receiving Vyom’s greeting before continuing a new conversation',
  );
  assert(
    await evaluate('document.activeElement?.id === "prompt"'),
    'composer focus returns after sending the greeting with Enter',
  );
  assert(
    await evaluate(`document.querySelector('.message-user')?.classList.contains('message-user') &&
      document.querySelector('.message-assistant')?.classList.contains('message-assistant')`),
    'chat messages distinguish the user and Vyom in the conversation layout',
  );
  await evaluate('document.getElementById("prompt").focus()');
  await typeText('How are you?');
  await pressKey('Enter', 'Enter', 13);
  await waitFor(
    () => evaluate(`document.querySelectorAll('.message-user').length === 2 &&
      document.querySelectorAll('.message-assistant').length === 2 &&
      !document.querySelector('.pending-state')`),
    'continuing the same chat with a normal follow-up message',
  );
  assert(
    await evaluate('document.activeElement?.id === "prompt"'),
    'composer stays focused after an Enter-submitted follow-up',
  );
  await typeText('Tell me one more thing.');
  await evaluate('document.querySelector(".send-button").click()');
  await waitFor(
    () => evaluate(`document.querySelectorAll('.message-user').length === 3 &&
      document.querySelectorAll('.message-assistant').length === 3 &&
      !document.querySelector('.pending-state')`),
    'sending another chat message with the send button',
  );
  assert(
    await evaluate('document.activeElement?.id === "prompt"'),
    'composer focus returns after clicking Send',
  );
  const composerFocusStyle = await evaluate(`(() => {
    const textarea = document.querySelector('.composer textarea');
    const composer = document.querySelector('.composer');
    return {
      textareaOutline: getComputedStyle(textarea).outlineStyle,
      textareaResize: getComputedStyle(textarea).resize,
      composerBorder: getComputedStyle(composer).borderTopColor,
    };
  })()`);
  assert(
    composerFocusStyle.textareaOutline === 'none' &&
      composerFocusStyle.textareaResize === 'none' &&
      composerFocusStyle.composerBorder !== 'rgb(48, 56, 70)',
    'composer uses one subtle focus treatment without the textarea box or resize handle',
  );
  assert(
    await evaluate(`document.documentElement.scrollHeight <= document.documentElement.clientHeight &&
      document.body.scrollHeight <= document.body.clientHeight`),
    'longer conversations do not create an outer page scrollbar',
  );
  await evaluate('document.getElementById("prompt").focus()');
  await typeText('Open VS Code');
  await pressKey('Enter', 'Enter', 13);
  await waitFor(
    () => evaluate('document.querySelector(".app-action-approval")?.innerText.includes("Open Visual Studio Code")'),
    'showing explicit approval before opening an application',
  );
  assert(
    await evaluate('document.querySelector(".tool-execution-state")?.innerText.includes("Waiting for your application approval")'),
    'current task status truthfully reflects a pending app approval',
  );
  assert(
    await evaluate(`document.querySelector('.app-action-approval')?.innerText.includes('No files will be changed') &&
      [...document.querySelectorAll('.app-action-approval button')].some(button => button.innerText === 'Open app')`),
    'VS Code launch requires explicit review and approval',
  );
  await clickButton('Cancel');
  await waitFor(
    () => evaluate('document.querySelector(".app-action-approval") === null'),
    'rejecting the proposed VS Code launch',
  );
  assert(
    await evaluate('document.body.innerText.includes("Cancelled. No application was opened.")'),
    'rejecting an app action performs no launch',
  );
  assert(
    await evaluate(`Boolean(document.querySelector('.message-speak') &&
      document.querySelector('.message-speak').innerText.includes('Speak aloud'))`),
    'assistant replies offer explicit on-device speech output',
  );

  await evaluate('document.getElementById("prompt").focus()');
  await typeText('Open Chrome and search for Vyomara privacy');
  await pressKey('Enter', 'Enter', 13);
  await waitFor(
    () => evaluate('document.querySelector(".app-action-approval")?.innerText.includes("Vyomara privacy")'),
    'showing the exact external search query for approval',
  );
  assert(
    await evaluate(`document.querySelector('.app-action-approval')?.innerText.includes('send this search query to Google over the internet')`),
    'Chrome search discloses that the query leaves the device',
  );
  await clickButton('Cancel');
  await waitFor(
    () => evaluate('document.querySelector(".app-action-approval") === null'),
    'rejecting the proposed Chrome search',
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
    ['Permissions', 'permissions-panel'],
    ['Memory', 'memory-panel'],
    ['Project workspace', 'checks-panel'],
  ]) {
    await clickButton(label);
    await waitFor(() => evaluate(`document.getElementById(${JSON.stringify(panelId)}) !== null`), `opening ${label}`);
    assert(
      await evaluate(`      document.activeElement?.textContent.trim() === ${JSON.stringify(label)}`),
      `${label} opens with focus on its heading`,
    );
    assert(
      await evaluate(`(() => {
        const trigger = [...document.querySelectorAll('button')].find(button => button.innerText.trim().endsWith(${JSON.stringify(label)}));
        return trigger?.getAttribute('aria-expanded') === 'true' &&
          trigger.getAttribute('aria-controls') === ${JSON.stringify(panelId)};
      })()`),
      `${label} trigger exposes expanded state and panel relationship`,
    );
    if (label === 'Project workspace') {
      assert(
        await evaluate(`['Run pnpm test', 'Run pnpm typecheck', 'Run pnpm build:desktop', 'Run pnpm test:desktop-ui']
          .every(label => [...document.querySelectorAll('button')]
            .find(button => button.innerText.trim() === label)?.disabled)`),
        'fixed project checks stay disabled until a project folder is selected',
      );
      assert(
        await evaluate(`document.body.innerText.includes('Every full diff needs your explicit approval') &&
          [...document.querySelectorAll('#checks-panel button')].find(button => button.innerText.includes('Open selected project in VS Code'))?.disabled`),
        'project edits require explicit approval and VS Code stays disabled without a selected folder',
      );
      assert(
        await evaluate('document.querySelector("#checks-panel input, #checks-panel textarea") === null'),
        'project checks do not expose free-form shell input',
      );
    }
    await pressKey('Escape', 'Escape', 27);
    await waitFor(
      () => evaluate('document.querySelector(\'button[aria-expanded="true"]\') === null'),
      `closing ${label} with Escape`,
    );
    assert(
      (await evaluate('document.activeElement?.innerText.trim()')).endsWith(label),
      `${label} Escape restores focus to its toolbar trigger`,
    );
  }

  await clickButton('Settings');
  await waitFor(() => evaluate('document.getElementById("settings-panel") !== null'), 'reopening Settings');
  const voiceSettingsDisclosure = await evaluate(`({
    hasSection: document.querySelector('#settings-panel')?.innerText.includes('Offline voice'),
    hasKillSwitch: document.querySelector('#settings-panel')?.innerText.includes('Listening Off stops the microphone immediately'),
  })`);
  assert(
    voiceSettingsDisclosure.hasSection && voiceSettingsDisclosure.hasKillSwitch,
    'voice settings disclose local model status and the listening kill switch without starting the microphone',
  );
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
  await waitFor(
    () => evaluate('document.getElementById("memory-draft")?.disabled === false'),
    'waiting for the memory panel controls',
  );
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

  await clickButton('History');
  await waitFor(() => evaluate('document.getElementById("history-panel") !== null'), 'reopening History');
  await waitFor(
    () => evaluate(`(() => {
      const panel = document.getElementById('history-panel');
      const backupButton = [...document.querySelectorAll('button')]
        .find(button => button.textContent.trim() === 'Create local backup');
      return Boolean(panel?.innerText.includes('unencrypted') && backupButton);
    })()`),
    'loading backup action and disclosure',
  );
  assert(
    true,
    'History exposes manual backup with an unencrypted-data disclosure',
  );
  assert(
    await evaluate(`(() => {
      const panel = document.getElementById('history-panel');
      const selectButton = [...document.querySelectorAll('button')]
        .find(button => button.textContent.trim() === 'Select backup to review…');
      return Boolean(panel?.innerText.includes('Restore replaces all current local conversations') && selectButton);
    })()`),
    'History exposes the backup-selection restore flow with a replacement disclosure',
  );
  await tabUntil('history-delete-all-confirm');
  await typeText('DELETE');
  assert(
    await evaluate(`[...document.querySelectorAll('button')]
      .find(button => button.innerText.trim() === 'Delete all conversations and memories')?.disabled`),
    'delete-all stays disabled until the exact confirmation is entered',
  );
  await evaluate('document.getElementById("history-delete-all-confirm").select()');
  await typeText('DELETE ALL');
  await waitFor(
    () => evaluate(`[...document.querySelectorAll('button')]
      .find(button => button.innerText.trim() === 'Delete all conversations and memories')?.disabled === false`),
    'enabling confirmed delete-all',
  );
  await clickButton('Delete all conversations and memories');
  const deleteAllState = await waitFor(
    () => evaluate(`(() => {
      const notice = [...document.querySelectorAll('#history-panel [role="status"]')]
        .map(element => element.innerText)
        .find(text => text.includes('Deleted '));
      const error = [...document.querySelectorAll('#history-panel [role="alert"]')]
        .map(element => element.innerText)
        .find(Boolean);
      return notice ? { notice } : error ? { error } : undefined;
    })()`),
    'completing empty delete-all through IPC',
  );
  assert(
    deleteAllState.notice?.startsWith('Deleted 1 saved conversation(s) and 0 saved memories.') === true,
    `confirmed delete-all completes through the desktop IPC bridge: ${JSON.stringify(deleteAllState)}`,
  );

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

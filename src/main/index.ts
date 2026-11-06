import { app, BrowserWindow, dialog, ipcMain, session, shell, systemPreferences } from 'electron';
import type { SaveDialogOptions } from 'electron';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { AgentError } from '../agent/agent.ts';
import {
  deleteDesktopSession,
  exportDesktopSession,
  readDesktopSession,
  readDesktopSessions,
  readModelSettings,
  saveModelSettings,
  withSavedModelSettings,
  runRequest,
  saveSelectedModel,
} from '../app/application.ts';
import type { SavedModelSettings } from '../app/application.ts';
import { loadConfig, validateOllamaModel } from '../config/config.ts';
import { OllamaProvider } from '../providers/provider.ts';
import { PersistenceError } from '../storage/sqlite-store.ts';
import { ProviderError } from '../providers/provider.ts';
import { ToolExecutionError } from '../tools/executor.ts';
import type { Logger } from '../types.ts';
import type { AppConfig } from '../config/config.ts';
import type { DiagnosticEvent } from '../diagnostics/logger.ts';
import {
  DesktopValidationError,
  parseDesktopChatRequest,
  parseDesktopFileOperationApprovalRequest,
  parseDesktopSessionDeleteRequest,
  parseDesktopSessionId,
} from '../desktop/validation.ts';
import { exportToSelectedFile } from '../desktop/session-export.ts';
import {
  FileOperationApprovalError,
  FileOperationApprovalManager,
} from '../desktop/file-operation-approval.ts';
import { ActionApprovalError, ActionApprovalManager } from '../desktop/action-approval.ts';
import { MacApplicationLauncher } from '../desktop/mac-application-launcher.ts';
import { ShellCommandRunner } from '../tools/command-runner.ts';
import { HttpWebClient } from '../tools/web-client.ts';
import { ApprovalMemory } from '../tools/action-tools.ts';
import { MacSpeechError, MacSpeechRunner } from '../desktop/mac-speech.ts';
import { LocalSpeechError, LocalWhisperRunner, resolveWhisperBinary } from '../desktop/local-whisper.ts';
import type { LocalWhisperEvent } from '../desktop/local-whisper.ts';

let mainWindow: BrowserWindow | undefined;
let activeRequest: AbortController | undefined;
let activeFileOperationApproval: FileOperationApprovalManager | undefined;
let activeActionApproval: ActionApprovalManager | undefined;
let activeModelPull: AbortController | undefined;
const shellCommandRunner = new ShellCommandRunner();
/** Commands the user chose to always allow; cleared when the app quits. */
const approvalMemory = new ApprovalMemory();
const macSpeechRunner = new MacSpeechRunner();
const macApplicationLauncher = process.platform === 'darwin'
  ? new MacApplicationLauncher()
  : undefined;
let localWhisperRunner: LocalWhisperRunner | undefined;
let voiceListeningEnabled = false;
let config: AppConfig | undefined;
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (hasSingleInstanceLock) {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
} else {
  app.quit();
}

function publicErrorMessage(error: unknown): string {
  if (
    error instanceof AgentError ||
    error instanceof ProviderError ||
    error instanceof ToolExecutionError ||
    error instanceof PersistenceError ||
    error instanceof MacSpeechError ||
    error instanceof LocalSpeechError ||
    error instanceof FileOperationApprovalError ||
    error instanceof ActionApprovalError
  ) {
    return error.message;
  }
  return 'The request failed safely. No success is implied; review local configuration and retry.';
}

function createDesktopLogger(): Logger {
  const emit = (event: DiagnosticEvent): void => {
    console.error(JSON.stringify({ timestamp: new Date().toISOString(), ...event }));
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('vyomara:activity', event);
    }
  };
  return {
    emit,
    failure() {
      emit({ event: 'request.failed', code: 'request.failed' });
    },
  };
}

function getLocalWhisperRunner(): LocalWhisperRunner {
  const binaryPath = resolveWhisperBinary();
  localWhisperRunner ??= new LocalWhisperRunner({
    modelDirectory: join(app.getPath('userData'), 'speech-models'),
    ...(binaryPath === undefined ? {} : { binaryPath }),
  });
  return localWhisperRunner;
}

function emitSpeechEvent(event: LocalWhisperEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('vyomara:speech-recognition-event', event);
  }
}

function voicePreferencePath(): string {
  return join(app.getPath('userData'), 'voice-preferences.json');
}

async function saveVoiceListeningPreference(enabled: boolean): Promise<void> {
  const path = voicePreferencePath();
  await mkdir(join(app.getPath('userData')), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, JSON.stringify({ enabled }), { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryPath, path);
}

async function readVoiceListeningPreference(): Promise<boolean> {
  try {
    const text = await readFile(voicePreferencePath(), 'utf8');
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null || !('enabled' in value) || typeof value.enabled !== 'boolean') {
      throw new Error('Saved voice-listening preference is invalid.');
    }
    return value.enabled;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 760,
    minHeight: 600,
    title: 'Vyomara',
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  window.webContents.on('preload-error', () => {
    console.error(JSON.stringify({ event: 'desktop.preload-failed', code: 'secure-bridge-unavailable' }));
    dialog.showErrorBox(
      'Vyomara could not start',
      'The secure desktop bridge failed to load. Restart Vyomara after updating the application.',
    );
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = undefined;
      activeRequest?.abort();
    }
  });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  const loadRenderer = rendererUrl
    ? window.loadURL(rendererUrl)
    : window.loadFile(fileURLToPath(new URL('../renderer/index.html', import.meta.url)));
  void loadRenderer.catch(() => {
    dialog.showErrorBox(
      'Vyomara could not start',
      'The desktop interface could not be loaded. Restart Vyomara after updating the application.',
    );
  });
  return window;
}

function providerStatus(current: AppConfig) {
  return {
    provider: current.provider,
    model: current.ollamaModel,
    contextTokens: current.ollamaNumCtx,
  };
}

function ollamaProvider(current: AppConfig): OllamaProvider {
  return new OllamaProvider({ baseUrl: current.ollamaBaseUrl, model: current.ollamaModel });
}

ipcMain.handle('vyomara:provider-status', () => {
  if (!config) throw new Error('Application configuration is unavailable.');
  return providerStatus(config);
});

ipcMain.handle('vyomara:models-list', async () => {
  if (!config) throw new Error('Application configuration is unavailable.');
  const current = config;
  const settings = { numCtx: current.ollamaNumCtx, think: current.ollamaThink };
  const provider = ollamaProvider(current);
  try {
    const installed = await provider.listModels();
    const models = await Promise.all(installed.map(async model => ({ ...model, ...await provider.showModel(model.name) })));
    return { available: true, current: current.ollamaModel, models, settings };
  } catch (error) {
    if (error instanceof ProviderError && error.code === 'unavailable') {
      return { available: false, current: current.ollamaModel, models: [], settings };
    }
    throw new Error(publicErrorMessage(error));
  }
});

ipcMain.handle('vyomara:model-settings-set', (_event, input: unknown) => {
  if (!config) throw new Error('Application configuration is unavailable.');
  if (activeRequest) throw new Error('Wait for the current task to finish before changing model settings.');
  const request = typeof input === 'object' && input !== null && !Array.isArray(input)
    ? input as { readonly numCtx?: unknown; readonly think?: unknown }
    : {};
  const numCtx = request.numCtx;
  const think = request.think;
  if (numCtx !== undefined && (typeof numCtx !== 'number' || !Number.isSafeInteger(numCtx) || numCtx < 2_048 || numCtx > 262_144)) {
    throw new Error('Context window must be between 2,048 and 262,144 tokens.');
  }
  if (think !== undefined && typeof think !== 'boolean') throw new Error('Thinking must be on or off.');
  const settings = {
    ...(numCtx === undefined ? {} : { numCtx }),
    ...(think === undefined ? {} : { think }),
  };
  saveModelSettings(config, settings);
  config = withSavedModelSettings(config, settings);
  return providerStatus(config);
});

ipcMain.handle('vyomara:model-delete', async (_event, input: unknown) => {
  if (!config) throw new Error('Application configuration is unavailable.');
  if (activeRequest) throw new Error('Wait for the current task to finish before removing a model.');
  const request = typeof input === 'object' && input !== null && !Array.isArray(input)
    ? input as { readonly name?: unknown; readonly confirmation?: unknown }
    : {};
  if (typeof request.name !== 'string' || request.confirmation !== 'DELETE') {
    throw new Error('Type DELETE to confirm removing this model.');
  }
  const name = validateOllamaModel(request.name);
  if (name === config.ollamaModel) throw new Error('Switch to another model before removing the one in use.');
  try {
    await ollamaProvider(config).deleteModel(name);
  } catch (error) {
    throw new Error(publicErrorMessage(error));
  }
});

ipcMain.handle('vyomara:ollama-start', async () => {
  if (!config) throw new Error('Application configuration is unavailable.');
  if (process.platform !== 'darwin') throw new Error('Starting Ollama from Vyomara is supported on macOS only.');
  const opened = spawnSync('/usr/bin/open', ['-a', 'Ollama'], { stdio: 'ignore' });
  if (opened.status !== 0) {
    throw new Error('Ollama is not installed. Download it from ollama.com, then try again.');
  }
  const provider = ollamaProvider(config);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await provider.checkConnection();
      return;
    } catch {
      await new Promise(resolveDelay => setTimeout(resolveDelay, 500));
    }
  }
  throw new Error('Ollama was opened but is not responding yet. Try again in a moment.');
});

ipcMain.handle('vyomara:model-select', async (_event, input: unknown) => {
  if (!config) throw new Error('Application configuration is unavailable.');
  if (activeRequest) throw new Error('Wait for the current task to finish before switching models.');
  if (typeof input !== 'string') throw new Error('Choose a model by name.');
  let model: string;
  try {
    model = validateOllamaModel(input);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'The model name is invalid.');
  }
  const candidate: AppConfig = { ...config, provider: 'ollama', ollamaModel: model };
  try {
    if (await ollamaProvider(candidate).checkModelAvailability() !== 'installed') {
      throw new Error(`The model “${model}” is not installed. Pull it first.`);
    }
    saveSelectedModel(config, model);
  } catch (error) {
    throw new Error(error instanceof Error && !(error instanceof ProviderError) ? error.message : publicErrorMessage(error));
  }
  config = candidate;
  return providerStatus(config);
});

ipcMain.handle('vyomara:model-pull', async (_event, input: unknown) => {
  if (!config) throw new Error('Application configuration is unavailable.');
  if (activeModelPull) throw new Error('A model download is already in progress.');
  if (typeof input !== 'string') throw new Error('Enter a model name, for example qwen3:14b.');
  let model: string;
  try {
    model = validateOllamaModel(input);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'The model name is invalid.');
  }
  const controller = new AbortController();
  activeModelPull = controller;
  try {
    await ollamaProvider(config).pullModel(model, progress => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('vyomara:model-pull-progress', { model, ...progress });
      }
    }, controller.signal);
  } catch (error) {
    if (error instanceof ProviderError && error.code === 'model-not-found') {
      throw new Error(`Ollama could not download “${model}”. Check the name on ollama.com/library.`);
    }
    throw new Error(publicErrorMessage(error));
  } finally {
    activeModelPull = undefined;
  }
});

ipcMain.handle('vyomara:chat-send', async (_event, input: unknown) => {
  if (!config) throw new Error('Application configuration is unavailable.');
  const request = parseDesktopChatRequest(input, config.maxInputChars);
  if (activeRequest) throw new Error('A request is already in progress.');

  const controller = new AbortController();
  activeRequest = controller;
  const desktopConfig: AppConfig = {
    ...config,
    filesystemAllowedRoots: ['/'],
  };
  const approvals = new FileOperationApprovalManager({
    config: desktopConfig,
    onProposal(proposal) {
      if (!mainWindow || mainWindow.isDestroyed()) {
        throw new Error('The review window is unavailable; no file operation was performed.');
      }
      mainWindow.webContents.send('vyomara:file-operation-proposed', proposal);
    },
    moveToTrash: path => shell.trashItem(path),
  });
  activeFileOperationApproval = approvals;
  const actionApprovals = new ActionApprovalManager({
    onProposal(proposal) {
      if (!mainWindow || mainWindow.isDestroyed()) {
        throw new ActionApprovalError('The approval window is unavailable; nothing was run or opened.');
      }
      mainWindow.webContents.send('vyomara:action-proposed', proposal);
    },
  });
  activeActionApproval = actionApprovals;
  const send = (channel: string, payload: unknown): void => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
  };
  try {
    return await runRequest(
      request.prompt,
      controller.signal,
      desktopConfig,
      createDesktopLogger(),
      {
        ...(request.sessionId === undefined ? {} : { sessionId: request.sessionId }),
        onText: text => send('vyomara:chat-text', { requestId: request.requestId, text }),
        onToolActivity: activity => send('vyomara:tool-activity', { requestId: request.requestId, ...activity }),
        onPlan: steps => send('vyomara:plan', { requestId: request.requestId, steps }),
        includeFilesystemTools: true,
        fileOperationApproval: approvals,
        actions: {
          approval: actionApprovals,
          approvalMemory: approvalMemory,
          commandRunner: shellCommandRunner,
          ...(macApplicationLauncher ? { launcher: macApplicationLauncher } : {}),
          web: new HttpWebClient(desktopConfig.searxngUrl === undefined ? {} : { searxngUrl: desktopConfig.searxngUrl }),
        },
      },
    );
  } catch (error) {
    throw new Error(publicErrorMessage(error));
  } finally {
    activeRequest = undefined;
    activeFileOperationApproval = undefined;
    activeActionApproval = undefined;
  }
});

ipcMain.handle('vyomara:file-operation-approve', async (event, input: unknown) => {
  if (event.sender !== mainWindow?.webContents) throw new Error('File review request is invalid.');
  if (!activeRequest || !activeFileOperationApproval) {
    throw new Error('There is no active file operation to approve.');
  }
  try {
    const approval = parseDesktopFileOperationApprovalRequest(input);
    await activeFileOperationApproval.approve(approval.id, approval.confirmation);
  } catch (error) {
    throw new Error(publicErrorMessage(error));
  }
});

ipcMain.handle('vyomara:file-operation-reject', (event, input: unknown) => {
  if (event.sender !== mainWindow?.webContents) throw new Error('File review request is invalid.');
  if (!activeRequest || !activeFileOperationApproval) {
    throw new Error('There is no active file operation to reject.');
  }
  try {
    activeFileOperationApproval.reject(parseDesktopSessionId(input));
  } catch (error) {
    throw new Error(publicErrorMessage(error));
  }
});

ipcMain.handle('vyomara:action-approve', (event, input: unknown) => {
  if (event.sender !== mainWindow?.webContents) throw new Error('Approval request is invalid.');
  if (!activeRequest || !activeActionApproval) throw new Error('There is no pending action to approve.');
  try {
    const request = typeof input === 'object' && input !== null && !Array.isArray(input)
      ? input as { readonly id?: unknown; readonly always?: unknown }
      : { id: input };
    if (request.always !== undefined && typeof request.always !== 'boolean') {
      throw new ActionApprovalError('The approval request is invalid.');
    }
    activeActionApproval.approve(parseDesktopSessionId(request.id), request.always === true);
  } catch (error) {
    throw new Error(publicErrorMessage(error));
  }
});

ipcMain.handle('vyomara:action-reject', (event, input: unknown) => {
  if (event.sender !== mainWindow?.webContents) throw new Error('Approval request is invalid.');
  if (!activeRequest || !activeActionApproval) throw new Error('There is no pending action to reject.');
  try {
    activeActionApproval.reject(parseDesktopSessionId(input));
  } catch (error) {
    throw new Error(publicErrorMessage(error));
  }
});

ipcMain.handle('vyomara:chat-cancel', () => {
  if (!activeRequest) return false;
  activeRequest.abort();
  return true;
});

ipcMain.handle('vyomara:sessions-list', () => {
  if (!config) throw new Error('Application configuration is unavailable.');
  try {
    return readDesktopSessions(config);
  } catch (error) {
    throw new Error(publicErrorMessage(error));
  }
});

ipcMain.handle('vyomara:session-load', (_event, input: unknown) => {
  if (!config) throw new Error('Application configuration is unavailable.');
  try {
    const sessionId = parseDesktopSessionId(input);
    return readDesktopSession(config, sessionId);
  } catch (error) {
    throw new Error(publicErrorMessage(error));
  }
});

ipcMain.handle('vyomara:session-export', async (_event, input: unknown) => {
  if (!config) throw new Error('Application configuration is unavailable.');
  if (activeRequest) {
    throw new Error('Wait for the active operation to finish before exporting a conversation.');
  }

  try {
    const sessionId = parseDesktopSessionId(input);
    const contents = exportDesktopSession(config, sessionId);
    const options: SaveDialogOptions = {
      title: 'Export complete Vyomara conversation',
      buttonLabel: 'Export conversation',
      defaultPath: `vyomara-session-${sessionId}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    };
    const status = await exportToSelectedFile(contents, async () => {
      const result = mainWindow
        ? await dialog.showSaveDialog(mainWindow, options)
        : await dialog.showSaveDialog(options);
      return result.canceled ? undefined : result.filePath;
    });
    return { status };
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST') {
      throw new Error('That file already exists. Choose a new name; Vyomara will not overwrite exports.');
    }
    throw new Error(publicErrorMessage(error));
  }
});

ipcMain.handle('vyomara:session-delete', (_event, input: unknown) => {
  if (!config) throw new Error('Application configuration is unavailable.');
  if (activeRequest) {
    throw new Error('Wait for the active operation to finish before deleting a conversation.');
  }
  try {
    const request = parseDesktopSessionDeleteRequest(input);
    return deleteDesktopSession(config, request.id);
  } catch (error) {
    if (error instanceof DesktopValidationError) throw new Error(error.message);
    throw new Error(publicErrorMessage(error));
  }
});

ipcMain.handle('vyomara:speech-setup-status', async () => {
  const runner = getLocalWhisperRunner();
  return {
    modelReady: await runner.modelAvailable(),
    runtimeAvailable: resolveWhisperBinary() !== undefined,
    listeningEnabled: voiceListeningEnabled,
  };
});

ipcMain.handle('vyomara:speech-model-download', async () => {
  if (voiceListeningEnabled) throw new Error('Turn voice listening off before downloading the speech model.');
  try {
    await getLocalWhisperRunner().downloadModel(emitSpeechEvent);
  } catch (error) {
    console.error(JSON.stringify({
      event: 'speech.model-download-failed',
      message: error instanceof Error ? error.message : 'Unknown native speech startup error.',
    }));
    throw new Error(publicErrorMessage(error));
  }
});

ipcMain.handle('vyomara:speech-listening-set', async (_event, input: unknown) => {
  if (typeof input !== 'boolean') throw new Error('Voice listening must be explicitly enabled or disabled.');
  const runner = getLocalWhisperRunner();
  if (input) {
    if (!await runner.modelAvailable()) throw new LocalSpeechError('Download the local base speech model before enabling voice listening.');
    if (!resolveWhisperBinary()) throw new LocalSpeechError('Install the local whisper.cpp runtime with `brew install whisper.cpp`, then restart Vyomara.');
    try {
      const microphoneStatus = systemPreferences.getMediaAccessStatus('microphone');
      const microphoneGranted = microphoneStatus === 'granted' ||
        (microphoneStatus === 'not-determined' && await systemPreferences.askForMediaAccess('microphone'));
      if (!microphoneGranted) {
        throw new LocalSpeechError(
          microphoneStatus === 'denied' || microphoneStatus === 'restricted'
            ? 'Microphone access is blocked. Enable it for Vyomara in System Settings > Privacy & Security > Microphone, then restart Vyomara.'
            : 'Microphone access was not granted. Allow it in the macOS prompt to use voice listening.',
        );
      }
      runner.start(emitSpeechEvent);
      voiceListeningEnabled = true;
      await saveVoiceListeningPreference(true);
    } catch (error) {
      runner.stop();
      voiceListeningEnabled = false;
      throw new Error(publicErrorMessage(error));
    }
  } else {
    voiceListeningEnabled = false;
    await runner.stop();
    macSpeechRunner.stop();
    await saveVoiceListeningPreference(false);
    emitSpeechEvent({ type: 'stopped' });
  }
  return {
    modelReady: await runner.modelAvailable(),
    runtimeAvailable: resolveWhisperBinary() !== undefined,
    listeningEnabled: voiceListeningEnabled,
  };
});

ipcMain.handle('vyomara:speech-speak', async (_event, input: unknown) => {
  const runner = localWhisperRunner;
  const resumeListening = voiceListeningEnabled && runner?.isListening === true;
  let listeningPaused = false;
  try {
    if (resumeListening && runner) {
      listeningPaused = await runner.stop({ silent: true });
      if (!listeningPaused) {
        throw new Error('The microphone could not be paused safely before Vyom speaks.');
      }
    }
    return await macSpeechRunner.speak(input);
  } catch (error) {
    throw new Error(publicErrorMessage(error));
  } finally {
    if (listeningPaused && voiceListeningEnabled && runner && resolveWhisperBinary()) {
      try {
        runner.start(emitSpeechEvent);
      } catch (error) {
        voiceListeningEnabled = false;
        try {
          await saveVoiceListeningPreference(false);
        } catch (preferenceError) {
          console.error(JSON.stringify({
            event: 'speech.listening-preference-save-failed',
            message: publicErrorMessage(preferenceError),
          }));
        }
        emitSpeechEvent({
          type: 'error',
          message: `Local listening could not resume after speech output: ${publicErrorMessage(error)}`,
        });
      }
    }
  }
});

ipcMain.handle('vyomara:speech-stop', () => macSpeechRunner.stop());

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const audioOnlyRequest = 'mediaTypes' in details &&
      details.mediaTypes?.includes('audio') === true &&
      details.mediaTypes.every(mediaType => mediaType === 'audio');
    let trustedOrigin = false;
    if ('securityOrigin' in details && details.securityOrigin) {
      trustedOrigin = details.securityOrigin === 'file://';
      if (!trustedOrigin && process.env.ELECTRON_RENDERER_URL) {
        try {
          trustedOrigin = new URL(details.securityOrigin).origin === new URL(process.env.ELECTRON_RENDERER_URL).origin;
        } catch {
          trustedOrigin = false;
        }
      }
    }
    callback(
      webContents === mainWindow?.webContents &&
      permission === 'media' &&
      audioOnlyRequest &&
      trustedOrigin,
    );
  });
  try {
    const loaded = loadConfig(process.env);
    let saved: SavedModelSettings = {};
    try {
      saved = readModelSettings(loaded);
      if (saved.model) validateOllamaModel(saved.model);
    } catch {
      saved = {};
    }
    // Choices made in the app's Models panel take precedence over the environment.
    config = { ...withSavedModelSettings(loaded, saved), filesystemAllowedRoots: ['/'] };
    voiceListeningEnabled = await readVoiceListeningPreference();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Configuration is invalid.';
    dialog.showErrorBox('Vyomara configuration error', message);
    app.quit();
    return;
  }

  mainWindow = createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
  });
});

app.on('before-quit', () => {
  activeRequest?.abort();
  activeModelPull?.abort();
  macSpeechRunner.stop();
  void localWhisperRunner?.stop();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

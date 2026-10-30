import { app, BrowserWindow, dialog, ipcMain, session, systemPreferences } from 'electron';
import type { OpenDialogOptions, SaveDialogOptions } from 'electron';
import { fileURLToPath } from 'node:url';
import { AgentError } from '../agent/agent.ts';
import {
  grantDesktopFilesystemRoot,
  initializeDesktopFilesystemRoots,
  deleteAllDesktopSessionsAndMemories,
  deleteDesktopMemory,
  deleteDesktopSession,
  exportDesktopBackup,
  exportDesktopSession,
  exportDesktopMemory,
  inspectDesktopBackup,
  initializeDesktopProviderSettings,
  readDesktopSession,
  readDesktopMemories,
  readDesktopMemory,
  readDesktopSessions,
  resetDesktopProviderSettings,
  revokeDesktopFilesystemRoot,
  restoreDesktopBackup,
  saveDesktopMemory,
  saveDesktopProviderSettings,
  runRequest,
} from '../app/application.ts';
import { loadConfig } from '../config/config.ts';
import { PersistenceError } from '../storage/sqlite-store.ts';
import { OllamaProvider, ProviderError } from '../providers/provider.ts';
import { ToolExecutionError } from '../tools/executor.ts';
import type { Logger } from '../types.ts';
import type { AppConfig } from '../config/config.ts';
import type { DiagnosticEvent } from '../diagnostics/logger.ts';
import {
  DesktopValidationError,
  parseDesktopChatRequest,
  parseDesktopDeleteAllRequest,
  parseDesktopFilesystemRoot,
  parseDesktopOllamaModelName,
  parseDesktopMemoryDeleteRequest,
  parseDesktopMemoryId,
  parseDesktopMemorySaveRequest,
  parseDesktopProviderSettings,
  parseDesktopRestoreRequest,
  parseDesktopSessionDeleteRequest,
  parseDesktopSessionId,
} from '../desktop/validation.ts';
import { exportToSelectedFile } from '../desktop/session-export.ts';
import { runApprovedCheck, validateCheckDirectory } from '../desktop/check-runner.ts';
import { DesktopAppActionError, parseDesktopAppAction, runDesktopAppAction } from '../desktop/app-actions.ts';
import { MacSpeechError, MacSpeechRunner } from '../desktop/mac-speech.ts';
import { EditProposalError, EditProposalManager } from '../desktop/edit-proposals.ts';
import { isCodeEditRequest } from '../desktop/action-intent.ts';

let mainWindow: BrowserWindow | undefined;
let activeRequest: AbortController | undefined;
let activeCheck: AbortController | undefined;
let activeApplicationAction = false;
let pendingEditProposals: EditProposalManager | undefined;
const macSpeechRunner = new MacSpeechRunner();
let activePermissionChange = false;
let checkProjectDirectory: string | undefined;
let pendingRestoreBackupPath: string | undefined;
let config: AppConfig | undefined;
let environmentConfig: AppConfig | undefined;

function publicErrorMessage(error: unknown): string {
  if (
    error instanceof AgentError ||
    error instanceof ProviderError ||
    error instanceof ToolExecutionError ||
    error instanceof PersistenceError ||
    error instanceof DesktopAppActionError ||
    error instanceof MacSpeechError ||
    error instanceof EditProposalError
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
    if (mainWindow === window) mainWindow = undefined;
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

ipcMain.handle('vyomara:provider-status', () => {
  if (!config) throw new Error('Application configuration is unavailable.');
  return {
    provider: config.provider,
    model: config.ollamaModel,
    connection: 'not-checked' as const,
  };
});

ipcMain.handle('vyomara:provider-settings-save', (_event, input: unknown) => {
  if (!config) throw new Error('Application configuration is unavailable.');
  if (activeRequest || activeCheck || activePermissionChange) {
    throw new Error('Wait for the active operation to finish before changing provider settings.');
  }
  try {
    const settings = parseDesktopProviderSettings(input);
    const result = saveDesktopProviderSettings(config, settings);
    config = result.config;
    return result.status;
  } catch (error) {
    if (error instanceof DesktopValidationError) throw new Error(error.message);
    throw new Error(publicErrorMessage(error));
  }
});

ipcMain.handle('vyomara:provider-settings-reset', () => {
  if (!config || !environmentConfig) throw new Error('Application configuration is unavailable.');
  if (activeRequest || activeCheck || activePermissionChange) {
    throw new Error('Wait for the active operation to finish before resetting provider settings.');
  }
  try {
    const result = resetDesktopProviderSettings(config, environmentConfig);
    config = result.config;
    return result.status;
  } catch (error) {
    throw new Error(publicErrorMessage(error));
  }
});

ipcMain.handle('vyomara:provider-check', async () => {
  if (!config) throw new Error('Application configuration is unavailable.');
  if (config.provider !== 'ollama') {
    throw new Error('A connection check is only available for the Ollama provider.');
  }

  try {
    const provider = new OllamaProvider({
      baseUrl: config.ollamaBaseUrl,
      model: config.ollamaModel,
      maxResponseChars: config.maxResponseChars,
      maxToolCallArgumentsChars: config.maxToolOutputChars,
    });
    await provider.checkConnection();
    return { status: 'available' as const };
  } catch (error) {
    if (error instanceof ProviderError) {
      return { status: 'unavailable' as const, message: error.message };
    }
    throw new Error(publicErrorMessage(error));
  }
});

ipcMain.handle('vyomara:provider-model-check', async (_event, input: unknown) => {
  if (!config) throw new Error('Application configuration is unavailable.');
  try {
    const model = parseDesktopOllamaModelName(input);
    const provider = new OllamaProvider({
      baseUrl: config.ollamaBaseUrl,
      model,
      maxResponseChars: config.maxResponseChars,
      maxToolCallArgumentsChars: config.maxToolOutputChars,
    });
    const status = await provider.checkModelAvailability();
    return status === 'installed'
      ? { status }
      : { status, message: `Model "${model}" is not installed in local Ollama. Vyomara did not download it.` };
  } catch (error) {
    if (error instanceof DesktopValidationError) throw new Error(error.message);
    if (error instanceof ProviderError) {
      return { status: 'unavailable' as const, message: error.message };
    }
    throw new Error(publicErrorMessage(error));
  }
});

ipcMain.handle('vyomara:chat-send', async (_event, input: unknown) => {
  if (!config) throw new Error('Application configuration is unavailable.');
  const request = parseDesktopChatRequest(input, config.maxInputChars);
  const isProjectEdit = isCodeEditRequest(request.prompt);
  const selectedProjectDirectory = checkProjectDirectory;
  if (isProjectEdit && !selectedProjectDirectory) {
    throw new Error('Select a project folder in Project workspace before asking Vyom to edit code. No files were changed.');
  }
  if (pendingEditProposals) {
    throw new Error('Review, apply, or reject the pending project diff before starting another request.');
  }
  if (activePermissionChange) throw new Error('Wait for filesystem permissions to finish changing before starting a request.');
  if (activeRequest) throw new Error('A request is already in progress.');
  if (activeCheck) throw new Error('Wait for the approved project check to finish before starting a request.');
  if (activeApplicationAction) throw new Error('Wait for the application action to finish before starting a request.');

  const controller = new AbortController();
  const editProposals = isProjectEdit && selectedProjectDirectory
    ? new EditProposalManager(selectedProjectDirectory)
    : undefined;
  const requestConfig = editProposals && selectedProjectDirectory
    ? {
      ...config,
      filesystemAllowedRoots: [selectedProjectDirectory],
      maxToolOutputChars: Math.max(config.maxToolOutputChars, 20_000),
      maxAgentIterations: Math.max(config.maxAgentIterations, 10),
      maxToolCalls: Math.max(config.maxToolCalls, 10),
    }
    : config;
  activeRequest = controller;
  try {
    const result = await runRequest(
      request.prompt,
      controller.signal,
      requestConfig,
      createDesktopLogger(),
      request.sessionId,
      editProposals,
    );
    if (editProposals && editProposals.list().length > 0) pendingEditProposals = editProposals;
    return result;
  } catch (error) {
    throw new Error(publicErrorMessage(error));
  } finally {
    activeRequest = undefined;
  }
});

ipcMain.handle('vyomara:edit-apply', async (_event, input: unknown) => {
  if (activeRequest || activeCheck || activeApplicationAction || activePermissionChange) {
    throw new Error('Wait for the active operation to finish before applying a project edit.');
  }
  if (!pendingEditProposals) throw new Error('There is no pending project edit to apply.');
  try {
    const result = await pendingEditProposals.apply(input);
    if (pendingEditProposals.list().length === 0) pendingEditProposals = undefined;
    return result;
  } catch (error) {
    throw new Error(publicErrorMessage(error));
  }
});

ipcMain.handle('vyomara:edit-reject', (_event, input: unknown) => {
  if (activeRequest || activeCheck || activeApplicationAction || activePermissionChange) {
    throw new Error('Wait for the active operation to finish before rejecting a project edit.');
  }
  if (!pendingEditProposals) throw new Error('There is no pending project edit to reject.');
  const rejected = pendingEditProposals.reject(input);
  if (pendingEditProposals.list().length === 0) pendingEditProposals = undefined;
  return rejected;
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
  if (activeRequest || activeCheck || activePermissionChange) {
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
  if (activeRequest || activeCheck || activePermissionChange) {
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

ipcMain.handle('vyomara:data-delete-all', (_event, input: unknown) => {
  if (!config) throw new Error('Application configuration is unavailable.');
  if (activeRequest || activeCheck || activePermissionChange) {
    throw new Error('Wait for the active operation to finish before deleting saved data.');
  }
  try {
    parseDesktopDeleteAllRequest(input);
    return deleteAllDesktopSessionsAndMemories(config);
  } catch (error) {
    if (error instanceof DesktopValidationError) throw new Error(error.message);
    throw new Error(publicErrorMessage(error));
  }
});

ipcMain.handle('vyomara:data-backup', async () => {
  if (!config) throw new Error('Application configuration is unavailable.');
  if (activeRequest || activeCheck || activePermissionChange) {
    throw new Error('Wait for the active operation to finish before backing up saved data.');
  }
  const timestamp = new Date().toISOString().slice(0, 19).replaceAll(':', '-');
  const options: SaveDialogOptions = {
    title: 'Back up Vyomara local data',
    buttonLabel: 'Create backup',
    defaultPath: `vyomara-backup-${timestamp}.sqlite`,
    filters: [{ name: 'SQLite database', extensions: ['sqlite'] }],
  };
  try {
    const result = mainWindow
      ? await dialog.showSaveDialog(mainWindow, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled) return { status: 'cancelled' as const };
    exportDesktopBackup(config, result.filePath);
    return { status: 'exported' as const };
  } catch (error) {
    throw new Error(publicErrorMessage(error));
  }
});

ipcMain.handle('vyomara:data-restore-select', async () => {
  if (!config) throw new Error('Application configuration is unavailable.');
  if (activeRequest || activeCheck || activePermissionChange) {
    throw new Error('Wait for the active operation to finish before selecting a backup.');
  }
  pendingRestoreBackupPath = undefined;
  const options: OpenDialogOptions = {
    title: 'Select a Vyomara backup to restore',
    buttonLabel: 'Review backup',
    properties: ['openFile'],
    filters: [{ name: 'SQLite database', extensions: ['sqlite'] }],
  };
  try {
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return undefined;
    const backupPath = result.filePaths[0]!;
    const preview = inspectDesktopBackup(config, backupPath);
    pendingRestoreBackupPath = backupPath;
    return preview;
  } catch (error) {
    throw new Error(publicErrorMessage(error));
  }
});

ipcMain.handle('vyomara:data-restore', (_event, input: unknown) => {
  if (!config) throw new Error('Application configuration is unavailable.');
  if (activeRequest || activeCheck || activePermissionChange) {
    throw new Error('Wait for the active operation to finish before restoring saved data.');
  }
  try {
    parseDesktopRestoreRequest(input);
    if (!pendingRestoreBackupPath) {
      throw new DesktopValidationError('Select and review a backup before confirming restore.');
    }
    const result = restoreDesktopBackup(config, pendingRestoreBackupPath);
    pendingRestoreBackupPath = undefined;
    config = initializeDesktopFilesystemRoots(config);
    config = initializeDesktopProviderSettings(config);
    return result;
  } catch (error) {
    if (error instanceof DesktopValidationError) throw new Error(error.message);
    throw new Error(publicErrorMessage(error));
  }
});

ipcMain.handle('vyomara:checks-project-select', async () => {
  if (activeRequest || activeCheck || activePermissionChange || pendingEditProposals) {
    throw new Error('Wait for the active operation to finish before selecting a project.');
  }
  const options: OpenDialogOptions = {
    title: 'Choose a project for approved checks',
    buttonLabel: 'Select project',
    properties: ['openDirectory'],
  };
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || result.filePaths.length === 0) return undefined;
  try {
    checkProjectDirectory = await validateCheckDirectory(result.filePaths[0]);
    return checkProjectDirectory;
  } catch (error) {
    throw new Error(publicErrorMessage(error));
  }
});

ipcMain.handle('vyomara:checks-run', async (_event, checkId: unknown) => {
  if (!checkProjectDirectory) throw new Error('Choose a project directory before running a check.');
  if (activeRequest || activeCheck || activeApplicationAction || activePermissionChange || pendingEditProposals) {
    throw new Error('Wait for the active operation to finish before running a check.');
  }
  const controller = new AbortController();
  activeCheck = controller;
  try {
    return await runApprovedCheck(checkProjectDirectory, checkId, controller.signal);
  } catch (error) {
    throw new Error(publicErrorMessage(error));
  } finally {
    activeCheck = undefined;
  }
});

ipcMain.handle('vyomara:checks-cancel', () => {
  if (!activeCheck) return false;
  activeCheck.abort();
  return true;
});

ipcMain.handle('vyomara:app-action', async (_event, input: unknown) => {
  if (activeRequest || activeCheck || activeApplicationAction || activePermissionChange) {
    throw new Error('Wait for the active operation to finish before opening another application.');
  }
  activeApplicationAction = true;
  try {
    const action = parseDesktopAppAction(input);
    if (action.type === 'open-vscode' && action.projectDirectory !== undefined) {
      if (!checkProjectDirectory || await validateCheckDirectory(action.projectDirectory) !== checkProjectDirectory) {
        throw new Error('VS Code can only open the project folder currently selected in Project workspace.');
      }
    }
    return await runDesktopAppAction(action);
  } catch (error) {
    throw new Error(publicErrorMessage(error));
  } finally {
    activeApplicationAction = false;
  }
});

ipcMain.handle('vyomara:microphone-request', async () => {
  if (process.platform !== 'darwin') {
    throw new Error('On-device microphone input is currently supported only on macOS.');
  }
  try {
    return await systemPreferences.askForMediaAccess('microphone');
  } catch (error) {
    throw new Error(publicErrorMessage(error));
  }
});

ipcMain.handle('vyomara:speech-speak', async (_event, input: unknown) => {
  try {
    return await macSpeechRunner.speak(input);
  } catch (error) {
    throw new Error(publicErrorMessage(error));
  }
});

ipcMain.handle('vyomara:speech-stop', () => macSpeechRunner.stop());

ipcMain.handle('vyomara:filesystem-roots-list', () => {
  if (!config) throw new Error('Application configuration is unavailable.');
  return config.filesystemAllowedRoots;
});

ipcMain.handle('vyomara:filesystem-root-grant', async () => {
  if (!config) throw new Error('Application configuration is unavailable.');
  if (activeRequest || activeCheck || activePermissionChange) {
    throw new Error('Wait for the active operation to finish before changing filesystem access.');
  }
  activePermissionChange = true;
  try {
    const options: OpenDialogOptions = {
      title: 'Choose a folder for Vyomara read-only access',
      buttonLabel: 'Allow read-only access',
      properties: ['openDirectory'],
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) {
      return { status: 'cancelled' as const, roots: config.filesystemAllowedRoots };
    }
    config = await grantDesktopFilesystemRoot(config, result.filePaths[0]!);
    return { status: 'granted' as const, roots: config.filesystemAllowedRoots };
  } catch (error) {
    throw new Error(publicErrorMessage(error));
  } finally {
    activePermissionChange = false;
  }
});

ipcMain.handle('vyomara:filesystem-root-revoke', (_event, input: unknown) => {
  if (!config) throw new Error('Application configuration is unavailable.');
  if (activeRequest || activeCheck || activePermissionChange) {
    throw new Error('Wait for the active operation to finish before changing filesystem access.');
  }
  try {
    config = revokeDesktopFilesystemRoot(config, parseDesktopFilesystemRoot(input));
    return config.filesystemAllowedRoots;
  } catch (error) {
    throw new Error(publicErrorMessage(error));
  }
});

ipcMain.handle('vyomara:memories-list', () => {
  if (!config) throw new Error('Application configuration is unavailable.');
  try {
    return readDesktopMemories(config);
  } catch (error) {
    throw new Error(publicErrorMessage(error));
  }
});

ipcMain.handle('vyomara:memory-read', (_event, input: unknown) => {
  if (!config) throw new Error('Application configuration is unavailable.');
  try {
    return readDesktopMemory(config, parseDesktopMemoryId(input));
  } catch (error) {
    throw new Error(publicErrorMessage(error));
  }
});

ipcMain.handle('vyomara:memory-export', async (_event, input: unknown) => {
  if (!config) throw new Error('Application configuration is unavailable.');
  if (activeRequest || activeCheck || activePermissionChange) {
    throw new Error('Wait for the active operation to finish before exporting a memory.');
  }
  try {
    const memoryId = parseDesktopMemoryId(input);
    const contents = exportDesktopMemory(config, memoryId);
    const options: SaveDialogOptions = {
      title: 'Export saved Vyomara memory',
      buttonLabel: 'Export memory',
      defaultPath: `vyomara-memory-${memoryId}.json`,
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

ipcMain.handle('vyomara:memory-save', (_event, input: unknown) => {
  if (!config) throw new Error('Application configuration is unavailable.');
  if (activeRequest || activeCheck || activePermissionChange) {
    throw new Error('Wait for the active operation to finish before saving a memory.');
  }
  try {
    const request = parseDesktopMemorySaveRequest(input);
    return saveDesktopMemory(config, request.content);
  } catch (error) {
    if (error instanceof DesktopValidationError) throw new Error(error.message);
    throw new Error(publicErrorMessage(error));
  }
});

ipcMain.handle('vyomara:memory-delete', (_event, input: unknown) => {
  if (!config) throw new Error('Application configuration is unavailable.');
  if (activeRequest || activeCheck || activePermissionChange) {
    throw new Error('Wait for the active operation to finish before deleting a memory.');
  }
  try {
    const request = parseDesktopMemoryDeleteRequest(input);
    return deleteDesktopMemory(config, request.id);
  } catch (error) {
    if (error instanceof DesktopValidationError) throw new Error(error.message);
    throw new Error(publicErrorMessage(error));
  }
});

app.whenReady().then(() => {
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
    environmentConfig = loadConfig(process.env);
    config = initializeDesktopProviderSettings(initializeDesktopFilesystemRoots(environmentConfig));
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
  activeCheck?.abort();
  macSpeechRunner.stop();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

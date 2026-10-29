import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import type { OpenDialogOptions } from 'electron';
import { fileURLToPath } from 'node:url';
import { AgentError } from '../agent/agent.ts';
import {
  grantDesktopFilesystemRoot,
  initializeDesktopFilesystemRoots,
  deleteDesktopMemory,
  readDesktopSession,
  readDesktopMemories,
  readDesktopMemory,
  readDesktopSessions,
  revokeDesktopFilesystemRoot,
  saveDesktopMemory,
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
  parseDesktopFilesystemRoot,
  parseDesktopMemoryDeleteRequest,
  parseDesktopMemoryId,
  parseDesktopMemorySaveRequest,
  parseDesktopSessionId,
} from '../desktop/validation.ts';

let mainWindow: BrowserWindow | undefined;
let activeRequest: AbortController | undefined;
let activePermissionChange = false;
let config: AppConfig | undefined;

function publicErrorMessage(error: unknown): string {
  if (
    error instanceof AgentError ||
    error instanceof ProviderError ||
    error instanceof ToolExecutionError ||
    error instanceof PersistenceError
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

ipcMain.handle('vyomara:chat-send', async (_event, input: unknown) => {
  if (!config) throw new Error('Application configuration is unavailable.');
  const request = parseDesktopChatRequest(input, config.maxInputChars);
  if (activePermissionChange) throw new Error('Wait for filesystem permissions to finish changing before starting a request.');
  if (activeRequest) throw new Error('A request is already in progress.');

  const controller = new AbortController();
  activeRequest = controller;
  try {
    return await runRequest(
      request.prompt,
      controller.signal,
      config,
      createDesktopLogger(),
      request.sessionId,
    );
  } catch (error) {
    throw new Error(publicErrorMessage(error));
  } finally {
    activeRequest = undefined;
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

ipcMain.handle('vyomara:filesystem-roots-list', () => {
  if (!config) throw new Error('Application configuration is unavailable.');
  return config.filesystemAllowedRoots;
});

ipcMain.handle('vyomara:filesystem-root-grant', async () => {
  if (!config) throw new Error('Application configuration is unavailable.');
  if (activeRequest || activePermissionChange) {
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
  if (activeRequest || activePermissionChange) {
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

ipcMain.handle('vyomara:memory-save', (_event, input: unknown) => {
  if (!config) throw new Error('Application configuration is unavailable.');
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
  try {
    const request = parseDesktopMemoryDeleteRequest(input);
    return deleteDesktopMemory(config, request.id);
  } catch (error) {
    if (error instanceof DesktopValidationError) throw new Error(error.message);
    throw new Error(publicErrorMessage(error));
  }
});

app.whenReady().then(() => {
  try {
    config = initializeDesktopFilesystemRoots(loadConfig(process.env));
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

app.on('before-quit', () => activeRequest?.abort());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

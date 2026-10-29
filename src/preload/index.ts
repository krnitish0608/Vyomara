import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopChatRequest, VyomaraDesktopApi } from '../desktop/contracts.ts';
import type { DiagnosticEvent } from '../diagnostics/logger.ts';

const api: VyomaraDesktopApi = {
  getProviderStatus() {
    return ipcRenderer.invoke('vyomara:provider-status');
  },
  checkProviderConnection() {
    return ipcRenderer.invoke('vyomara:provider-check');
  },
  sendMessage(request: DesktopChatRequest) {
    return ipcRenderer.invoke('vyomara:chat-send', request);
  },
  cancelRequest() {
    return ipcRenderer.invoke('vyomara:chat-cancel');
  },
  listSessions() {
    return ipcRenderer.invoke('vyomara:sessions-list');
  },
  loadSession(sessionId: string) {
    return ipcRenderer.invoke('vyomara:session-load', sessionId);
  },
  listFilesystemRoots() {
    return ipcRenderer.invoke('vyomara:filesystem-roots-list');
  },
  grantFilesystemRoot() {
    return ipcRenderer.invoke('vyomara:filesystem-root-grant');
  },
  revokeFilesystemRoot(root: string) {
    return ipcRenderer.invoke('vyomara:filesystem-root-revoke', root);
  },
  onActivity(listener: (event: DiagnosticEvent) => void) {
    const handler = (_event: Electron.IpcRendererEvent, activity: DiagnosticEvent): void => {
      listener(activity);
    };
    ipcRenderer.on('vyomara:activity', handler);
    return () => ipcRenderer.removeListener('vyomara:activity', handler);
  },
};

contextBridge.exposeInMainWorld('vyomara', api);

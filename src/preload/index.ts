import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopAppAction, DesktopChatRequest, VyomaraDesktopApi } from '../desktop/contracts.ts';
import type { DiagnosticEvent } from '../diagnostics/logger.ts';

const api: VyomaraDesktopApi = {
  getProviderStatus() {
    return ipcRenderer.invoke('vyomara:provider-status');
  },
  saveProviderSettings(settings) {
    return ipcRenderer.invoke('vyomara:provider-settings-save', settings);
  },
  resetProviderSettings() {
    return ipcRenderer.invoke('vyomara:provider-settings-reset');
  },
  checkProviderConnection() {
    return ipcRenderer.invoke('vyomara:provider-check');
  },
  checkProviderModel(model: string) {
    return ipcRenderer.invoke('vyomara:provider-model-check', model);
  },
  sendMessage(request: DesktopChatRequest) {
    return ipcRenderer.invoke('vyomara:chat-send', request);
  },
  applyEditProposal(id: string) {
    return ipcRenderer.invoke('vyomara:edit-apply', id);
  },
  rejectEditProposal(id: string) {
    return ipcRenderer.invoke('vyomara:edit-reject', id);
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
  exportSession(sessionId: string) {
    return ipcRenderer.invoke('vyomara:session-export', sessionId);
  },
  deleteSession(sessionId: string, confirmation: string) {
    return ipcRenderer.invoke('vyomara:session-delete', { id: sessionId, confirmation });
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
  listMemories() {
    return ipcRenderer.invoke('vyomara:memories-list');
  },
  readMemory(id: string) {
    return ipcRenderer.invoke('vyomara:memory-read', id);
  },
  exportMemory(id: string) {
    return ipcRenderer.invoke('vyomara:memory-export', id);
  },
  saveMemory(content: string, confirmation: string) {
    return ipcRenderer.invoke('vyomara:memory-save', { content, confirmation });
  },
  deleteMemory(id: string, confirmation: string) {
    return ipcRenderer.invoke('vyomara:memory-delete', { id, confirmation });
  },
  deleteAllHistoryAndMemories(confirmation: string) {
    return ipcRenderer.invoke('vyomara:data-delete-all', { confirmation });
  },
  backupLocalData() {
    return ipcRenderer.invoke('vyomara:data-backup');
  },
  selectBackupForRestore() {
    return ipcRenderer.invoke('vyomara:data-restore-select');
  },
  restoreLocalData(confirmation: string) {
    return ipcRenderer.invoke('vyomara:data-restore', { confirmation });
  },
  selectCheckProject() {
    return ipcRenderer.invoke('vyomara:checks-project-select');
  },
  runApprovedCheck(checkId) {
    return ipcRenderer.invoke('vyomara:checks-run', checkId);
  },
  cancelApprovedCheck() {
    return ipcRenderer.invoke('vyomara:checks-cancel');
  },
  runDesktopAppAction(action: DesktopAppAction) {
    return ipcRenderer.invoke('vyomara:app-action', action);
  },
  requestMicrophoneAccess() {
    return ipcRenderer.invoke('vyomara:microphone-request');
  },
  speakText(text: string) {
    return ipcRenderer.invoke('vyomara:speech-speak', text);
  },
  stopSpeaking() {
    return ipcRenderer.invoke('vyomara:speech-stop');
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

import { contextBridge, ipcRenderer } from 'electron';
import type {
  DesktopActionProposal,
  DesktopChatRequest,
  DesktopFileOperationProposal,
  DesktopModelPullProgress,
  DesktopPlan,
  DesktopSpeechRecognitionEvent,
  DesktopToolActivity,
  VyomaraDesktopApi,
} from '../desktop/contracts.ts';

function subscribe<T>(channel: string, listener: (value: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, value: T): void => listener(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}
import type { DiagnosticEvent } from '../diagnostics/logger.ts';

const api: VyomaraDesktopApi = {
  getProviderStatus() {
    return ipcRenderer.invoke('vyomara:provider-status');
  },
  sendMessage(request: DesktopChatRequest) {
    return ipcRenderer.invoke('vyomara:chat-send', request);
  },
  onChatText(listener) {
    const handler = (_event: Electron.IpcRendererEvent, chunk: { requestId: string; text: string }): void => {
      listener(chunk);
    };
    ipcRenderer.on('vyomara:chat-text', handler);
    return () => ipcRenderer.removeListener('vyomara:chat-text', handler);
  },
  onFileOperationProposal(listener) {
    const handler = (_event: Electron.IpcRendererEvent, proposal: DesktopFileOperationProposal): void => {
      listener(proposal);
    };
    ipcRenderer.on('vyomara:file-operation-proposed', handler);
    return () => ipcRenderer.removeListener('vyomara:file-operation-proposed', handler);
  },
  approveFileOperation(id: string, confirmation?: string) {
    return ipcRenderer.invoke('vyomara:file-operation-approve', {
      id,
      ...(confirmation === undefined ? {} : { confirmation }),
    });
  },
  rejectFileOperation(id: string) {
    return ipcRenderer.invoke('vyomara:file-operation-reject', id);
  },
  onActionProposal(listener: (proposal: DesktopActionProposal) => void) {
    return subscribe('vyomara:action-proposed', listener);
  },
  approveAction(id: string, always = false) {
    return ipcRenderer.invoke('vyomara:action-approve', { id, always });
  },
  rejectAction(id: string) {
    return ipcRenderer.invoke('vyomara:action-reject', id);
  },
  onToolActivity(listener: (activity: DesktopToolActivity) => void) {
    return subscribe('vyomara:tool-activity', listener);
  },
  onPlan(listener: (plan: DesktopPlan) => void) {
    return subscribe('vyomara:plan', listener);
  },
  listModels() {
    return ipcRenderer.invoke('vyomara:models-list');
  },
  selectModel(model: string) {
    return ipcRenderer.invoke('vyomara:model-select', model);
  },
  pullModel(model: string) {
    return ipcRenderer.invoke('vyomara:model-pull', model);
  },
  onModelPullProgress(listener: (progress: DesktopModelPullProgress) => void) {
    return subscribe('vyomara:model-pull-progress', listener);
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
  getSpeechSetupStatus() {
    return ipcRenderer.invoke('vyomara:speech-setup-status');
  },
  downloadSpeechModel() {
    return ipcRenderer.invoke('vyomara:speech-model-download');
  },
  setSpeechListening(enabled: boolean) {
    return ipcRenderer.invoke('vyomara:speech-listening-set', enabled);
  },
  onSpeechRecognition(listener: (event: DesktopSpeechRecognitionEvent) => void) {
    const handler = (_event: Electron.IpcRendererEvent, recognitionEvent: DesktopSpeechRecognitionEvent): void => {
      listener(recognitionEvent);
    };
    ipcRenderer.on('vyomara:speech-recognition-event', handler);
    return () => ipcRenderer.removeListener('vyomara:speech-recognition-event', handler);
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

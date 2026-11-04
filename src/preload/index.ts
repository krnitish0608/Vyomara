import { contextBridge, ipcRenderer } from 'electron';
import type {
  DesktopChatRequest,
  DesktopFileOperationProposal,
  DesktopSpeechRecognitionEvent,
  VyomaraDesktopApi,
} from '../desktop/contracts.ts';
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

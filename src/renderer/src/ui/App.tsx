import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { DiagnosticEvent } from '../../../diagnostics/logger.ts';
import type {
  DesktopAppAction,
  DesktopAppActionResult,
  DesktopApprovedCheckId,
  DesktopApprovedCheckResult,
  DesktopBackupRestorePreview,
  DesktopEditProposal,
  DesktopProviderConnectionResult,
  DesktopProviderModelCheckResult,
  DesktopProviderSettings,
  DesktopProviderStatus,
  DesktopSpeechSetupStatus,
  DesktopSessionHistory,
  DesktopMemorySummary,
  DesktopSessionSummary,
} from '../../../desktop/contracts.ts';
import { detectDesktopAppAction, isCodeEditRequest, requestsVSCode } from '../../../desktop/action-intent.ts';
import vyomaraWordmark from './assets/vyomara-wordmark.png';

interface ChatMessage {
  readonly id: number;
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly failed?: boolean;
}

function VyomaraMark({ tile = true }: { readonly tile?: boolean }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      {tile && <rect x="4" y="4" width="56" height="56" rx="18" fill="#101746" stroke="#315cff" strokeWidth="1.5" />}
      <ellipse cx="32" cy="32" rx="25" ry="10" transform="rotate(-27 32 32)" fill="none" stroke="#27d9ff" strokeWidth="2.5" />
      <ellipse cx="32" cy="32" rx="24" ry="9" transform="rotate(-27 32 32)" fill="none" stroke="#9c50ff" strokeWidth="1.5" strokeDasharray="28 100" />
      <circle cx="32" cy="32" r="17" fill="#2426a8" stroke="#695bff" strokeWidth="1.5" />
      <rect className="mark-wave-bar mark-wave-bar-1" x="21" y="29" width="3" height="6" rx="1.5" fill="#e9f4ff" />
      <rect className="mark-wave-bar mark-wave-bar-2" x="26" y="24" width="3" height="16" rx="1.5" fill="#e9f4ff" />
      <rect className="mark-wave-bar mark-wave-bar-3" x="31" y="20" width="3" height="24" rx="1.5" fill="#e9f4ff" />
      <rect className="mark-wave-bar mark-wave-bar-4" x="36" y="25" width="3" height="14" rx="1.5" fill="#e9f4ff" />
      <rect className="mark-wave-bar mark-wave-bar-5" x="41" y="28" width="3" height="8" rx="1.5" fill="#e9f4ff" />
    </svg>
  );
}

function VoiceWave({ side }: { readonly side: 'left' | 'right' }) {
  return (
    <span className={`voice-waveform voice-waveform-${side}`} aria-hidden="true">
      {Array.from({ length: 9 }, (_, index) => <i key={index} />)}
    </span>
  );
}

function activityLabel(event: DiagnosticEvent): string | undefined {
  switch (event.event) {
    case 'task.created':
      return 'Task accepted';
    case 'task.state-changed':
      if (['completed', 'failed', 'cancelled'].includes(event.to)) return undefined;
      return `Task ${event.to.replaceAll('_', ' ')}`;
    case 'task.completed':
      return 'Task completed';
    case 'task.needs-attention':
      return 'Task needs attention';
    case 'task.failed':
    case 'request.failed':
      return `Task failed (${event.code})`;
    case 'task.cancelled':
    case 'request.cancelled':
      return 'Task cancelled';
    case 'tool.requested':
      return `Requested ${event.toolId}`;
    case 'tool.invoked':
      return `Invoking ${event.toolId}`;
    case 'tool.execution-started':
      return `Running ${event.toolId}`;
    case 'tool.completed':
      return `Completed ${event.toolId}`;
    case 'tool.failed':
      return `Failed ${event.toolId} (${event.code})`;
    case 'tool.retry-scheduled':
      return `Correcting ${event.toolId}`;
    case 'tool.denied':
      return `Denied ${event.toolId}`;
    case 'request.completed':
      return 'Response ready';
  }
}

export function App() {
  const [provider, setProvider] = useState<DesktopProviderStatus>();
  const [providerError, setProviderError] = useState<string>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [providerDraft, setProviderDraft] = useState<DesktopProviderSettings['provider']>('ollama');
  const [modelDraft, setModelDraft] = useState('llama3.2');
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsError, setSettingsError] = useState<string>();
  const [settingsNotice, setSettingsNotice] = useState<string>();
  const [modelCheck, setModelCheck] = useState<DesktopProviderModelCheckResult>();
  const [modelCheckLoading, setModelCheckLoading] = useState(false);
  const [connectionCheck, setConnectionCheck] = useState<'not-checked' | 'checking' | 'available' | 'unavailable'>('not-checked');
  const [connectionMessage, setConnectionMessage] = useState<string>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activity, setActivity] = useState<string[]>([]);
  const [sessionId, setSessionId] = useState<string>();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sessions, setSessions] = useState<readonly DesktopSessionSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string>();
  const [selectedHistorySession, setSelectedHistorySession] = useState<DesktopSessionHistory>();
  const [historyDeleteConfirmation, setHistoryDeleteConfirmation] = useState('');
  const [historyDeleteAllConfirmation, setHistoryDeleteAllConfirmation] = useState('');
  const [backupRestorePreview, setBackupRestorePreview] = useState<DesktopBackupRestorePreview>();
  const [backupRestoreConfirmation, setBackupRestoreConfirmation] = useState('');
  const [historyNotice, setHistoryNotice] = useState<string>();
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [allowedRoots, setAllowedRoots] = useState<readonly string[]>([]);
  const [permissionsLoading, setPermissionsLoading] = useState(false);
  const [permissionsError, setPermissionsError] = useState<string>();
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [memories, setMemories] = useState<readonly DesktopMemorySummary[]>([]);
  const [memoryDraft, setMemoryDraft] = useState('');
  const [memoryPreviewOpen, setMemoryPreviewOpen] = useState(false);
  const [memoryConfirmation, setMemoryConfirmation] = useState('');
  const [selectedMemory, setSelectedMemory] = useState<{ readonly id: string; readonly content: string }>();
  const [memoryDeleteConfirmation, setMemoryDeleteConfirmation] = useState('');
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memoryError, setMemoryError] = useState<string>();
  const [memoryNotice, setMemoryNotice] = useState<string>();
  const [checksOpen, setChecksOpen] = useState(false);
  const [checkProjectDirectory, setCheckProjectDirectory] = useState<string>();
  const [checkLoading, setCheckLoading] = useState(false);
  const [checkResult, setCheckResult] = useState<DesktopApprovedCheckResult>();
  const [checkError, setCheckError] = useState<string>();
  const [editProposals, setEditProposals] = useState<readonly DesktopEditProposal[]>([]);
  const [editProposalBusy, setEditProposalBusy] = useState<string>();
  const [editProposalErrors, setEditProposalErrors] = useState<Record<string, string>>({});
  const [editProposalNotice, setEditProposalNotice] = useState<string>();
  const [prompt, setPrompt] = useState('');
  const [composerFocusRequest, setComposerFocusRequest] = useState(0);
  const [requestPending, setRequestPending] = useState(false);
  const [requestError, setRequestError] = useState<string>();
  const [appActionProposal, setAppActionProposal] = useState<DesktopAppAction>();
  const [appActionRunning, setAppActionRunning] = useState(false);
  const [appActionError, setAppActionError] = useState<string>();
  const [appActionResult, setAppActionResult] = useState<DesktopAppActionResult>();
  const [speechSetup, setSpeechSetup] = useState<DesktopSpeechSetupStatus>();
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceStarting, setVoiceStarting] = useState(false);
  const [voiceDownloading, setVoiceDownloading] = useState(false);
  const [voiceDownloadProgress, setVoiceDownloadProgress] = useState<number>();
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [voiceError, setVoiceError] = useState<string>();
  const [speakingMessageId, setSpeakingMessageId] = useState<number>();
  const [speechError, setSpeechError] = useState<string>();
  const queuedVoiceCommands = useRef<string[]>([]);
  const currentRequestPending = useRef(requestPending);
  currentRequestPending.current = requestPending;
  const submitVoicePrompt = useRef<((value: string, speakResponse?: boolean) => Promise<void>) | undefined>(undefined);
  const messageList = useRef<HTMLDivElement>(null);
  const promptInput = useRef<HTMLTextAreaElement>(null);
  const shouldRestoreComposerFocus = useRef(false);
  const settingsTrigger = useRef<HTMLButtonElement>(null);
  const historyTrigger = useRef<HTMLButtonElement>(null);
  const permissionsTrigger = useRef<HTMLButtonElement>(null);
  const memoryTrigger = useRef<HTMLButtonElement>(null);
  const checksTrigger = useRef<HTMLButtonElement>(null);
  const activityHeading = useRef<HTMLHeadingElement>(null);
  const settingsHeading = useRef<HTMLHeadingElement>(null);
  const historyHeading = useRef<HTMLHeadingElement>(null);
  const permissionsHeading = useRef<HTMLHeadingElement>(null);
  const memoryHeading = useRef<HTMLHeadingElement>(null);
  const checksHeading = useRef<HTMLHeadingElement>(null);

  function recordActivity(label: string): void {
    setActivity(current => [...current, label].slice(-12));
  }

  useEffect(() => {
    let mounted = true;
    void window.vyomara.getProviderStatus().then(status => {
      if (mounted) setProvider(status);
    }).catch(() => {
      if (mounted) setProviderError('Provider settings could not be loaded.');
    });
    const unsubscribe = window.vyomara.onActivity(event => {
      const label = activityLabel(event);
      if (label) setActivity(current => [...current, label].slice(-12));
    });
    const unsubscribeSpeech = window.vyomara.onSpeechRecognition(event => {
      if (event.type === 'partial') setVoiceTranscript(event.transcript);
      if (event.type === 'model-progress' && event.total > 0) {
        setVoiceDownloadProgress(Math.min(100, Math.round(event.received / event.total * 100)));
      }
      if (event.type === 'model-ready') {
        setSpeechSetup(current => current ? { ...current, modelReady: true } : current);
        setVoiceDownloading(false);
        setVoiceDownloadProgress(undefined);
      }
      if (event.type === 'listening') {
        setVoiceStarting(false);
        setVoiceListening(true);
      }
      if (event.type === 'stopped') {
        setVoiceStarting(false);
        setVoiceListening(false);
      }
      if (event.type === 'error') {
        setVoiceStarting(false);
        setVoiceListening(false);
        setVoiceDownloading(false);
        setVoiceError(event.message);
      }
      if (event.type === 'command') {
        setVoiceTranscript(event.transcript);
        if (currentRequestPending.current) {
          queuedVoiceCommands.current.push(event.transcript);
        } else {
          void submitVoicePrompt.current?.(event.transcript, true);
        }
      }
    });
    void window.vyomara.getSpeechSetupStatus().then(status => {
      if (!mounted) return;
      setSpeechSetup(status);
      if (status.listeningEnabled && status.modelReady && status.runtimeAvailable) {
        setVoiceStarting(true);
        void window.vyomara.setSpeechListening(true).then(setSpeechSetup).catch(error => {
          setVoiceStarting(false);
          setVoiceError(error instanceof Error ? error.message : 'Voice listening could not start.');
        });
      }
    }).catch(error => {
      if (mounted) setVoiceError(error instanceof Error ? error.message : 'Voice setup could not be loaded.');
    });
    return () => {
      mounted = false;
      unsubscribe();
      unsubscribeSpeech();
    };
  }, []);

  useEffect(() => {
    const list = messageList.current;
    if (!list) return;
    list.scrollTo({
      top: list.scrollHeight,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
  }, [messages, requestPending]);

  useEffect(() => {
    if (
      requestPending ||
      checkLoading ||
      appActionRunning ||
      appActionProposal ||
      editProposals.length > 0 ||
      queuedVoiceCommands.current.length === 0
    ) return;
    const transcript = queuedVoiceCommands.current.shift();
    if (!transcript) return;
    void submitPrompt(transcript, true);
  }, [appActionProposal, appActionRunning, checkLoading, editProposals.length, requestPending]);

  useEffect(() => {
    if (requestPending || !shouldRestoreComposerFocus.current) return;
    shouldRestoreComposerFocus.current = false;
    promptInput.current?.focus();
  }, [composerFocusRequest, requestPending]);

  useEffect(() => {
    if (settingsOpen) settingsHeading.current?.focus();
    else if (historyOpen) historyHeading.current?.focus();
    else if (permissionsOpen) permissionsHeading.current?.focus();
    else if (memoryOpen) memoryHeading.current?.focus();
    else if (checksOpen) checksHeading.current?.focus();
  }, [checksOpen, historyOpen, memoryOpen, permissionsOpen, settingsOpen]);

  useEffect(() => {
    function handleEscape(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      if (settingsOpen) {
        setSettingsOpen(false);
        settingsTrigger.current?.focus();
      } else if (historyOpen) {
        setHistoryOpen(false);
        historyTrigger.current?.focus();
      } else if (permissionsOpen) {
        setPermissionsOpen(false);
        permissionsTrigger.current?.focus();
      } else if (memoryOpen) {
        setMemoryOpen(false);
        memoryTrigger.current?.focus();
      } else if (checksOpen) {
        setChecksOpen(false);
        checksTrigger.current?.focus();
      }
    }

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [checksOpen, historyOpen, memoryOpen, permissionsOpen, settingsOpen]);

  async function applyEditProposal(proposal: DesktopEditProposal): Promise<void> {
    if (editProposalBusy) return;
    setEditProposalBusy(proposal.id);
    recordActivity(`Applying approved diff: ${proposal.path}`);
    setEditProposalErrors(current => ({ ...current, [proposal.id]: '' }));
    setEditProposalNotice(undefined);
    try {
      const result = await window.vyomara.applyEditProposal(proposal.id);
      setEditProposals(current => current.filter(item => item.id !== proposal.id));
      setEditProposalNotice(`Applied the approved edit to ${result.path}.`);
      recordActivity(`Applied approved diff: ${result.path}`);
    } catch (error) {
      recordActivity(`Edit failed: ${proposal.path}`);
      setEditProposalErrors(current => ({
        ...current,
        [proposal.id]: error instanceof Error ? error.message : 'The approved edit could not be applied.',
      }));
    } finally {
      setEditProposalBusy(undefined);
    }
  }

  async function rejectEditProposal(proposal: DesktopEditProposal): Promise<void> {
    if (editProposalBusy) return;
    setEditProposalBusy(proposal.id);
    recordActivity(`Rejecting diff: ${proposal.path}`);
    setEditProposalErrors(current => ({ ...current, [proposal.id]: '' }));
    setEditProposalNotice(undefined);
    try {
      const rejected = await window.vyomara.rejectEditProposal(proposal.id);
      if (!rejected) throw new Error('This project diff is no longer pending.');
      setEditProposals(current => current.filter(item => item.id !== proposal.id));
      setEditProposalNotice(`Rejected the diff for ${proposal.path}. No file was changed.`);
      recordActivity(`Rejected diff: ${proposal.path}; file unchanged`);
    } catch (error) {
      setEditProposalErrors(current => ({
        ...current,
        [proposal.id]: error instanceof Error ? error.message : 'The project diff could not be rejected.',
      }));
    } finally {
      setEditProposalBusy(undefined);
    }
  }

  async function submitPrompt(value: string, speakResponse = false): Promise<void> {
    const trimmed = value.trim();
    if (!trimmed || requestPending || checkLoading || appActionRunning || appActionProposal || editProposals.length > 0) return;
    setPrompt('');
    setRequestError(undefined);
    setAppActionProposal(undefined);
    setAppActionError(undefined);
    setAppActionResult(undefined);
    setMessages(current => [...current, {
      id: Date.now(),
      role: 'user',
      content: trimmed,
    }]);

    const appAction = detectDesktopAppAction(trimmed);
    if (appAction) {
      setAppActionProposal(appAction);
      setAppActionError(undefined);
      setAppActionResult(undefined);
      return;
    }

    if (isCodeEditRequest(trimmed) && !checkProjectDirectory) {
      const message = 'Choose a project folder in Project workspace before asking Vyom to edit code. No files were changed.';
      setRequestError(message);
      setMessages(current => [...current, {
        id: Date.now() + 1,
        role: 'assistant',
        content: message,
        failed: true,
      }]);
      return;
    }

    setRequestPending(true);
    setEditProposalNotice(undefined);
    try {
      const result = await window.vyomara.sendMessage({
        prompt: trimmed,
        ...(sessionId ? { sessionId } : {}),
      });
      setSessionId(result.sessionId);
      setMessages(current => [...current, {
        id: Date.now() + 1,
        role: 'assistant',
        content: result.response,
      }]);
      if (speakResponse) {
        void window.vyomara.speakText(result.response).catch(error => {
          setSpeechError(error instanceof Error ? error.message : 'Local speech output failed.');
        });
      }
      setEditProposals(result.editProposals ?? []);
      setEditProposalErrors({});
      if (result.editProposals?.length) {
        recordActivity(`Diff awaiting approval: ${result.editProposals.map(proposal => proposal.path).join(', ')}`);
      }
      if (requestsVSCode(trimmed) && checkProjectDirectory) {
        setAppActionProposal({
          type: 'open-vscode',
          projectDirectory: checkProjectDirectory,
        });
      }
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : 'Request failed safely. No success is implied.';
      setRequestError(message);
      setMessages(current => [...current, {
        id: Date.now() + 1,
        role: 'assistant',
        content: message,
        failed: true,
      }]);
    } finally {
      setRequestPending(false);
    }

  }

  submitVoicePrompt.current = submitPrompt;

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const trimmed = prompt.trim();
    const restoreFocus = Boolean(trimmed) && !detectDesktopAppAction(trimmed) &&
      !(isCodeEditRequest(trimmed) && !checkProjectDirectory);
    shouldRestoreComposerFocus.current = restoreFocus;
    setComposerFocusRequest(current => current + 1);
    await submitPrompt(prompt);
    if (restoreFocus) {
      shouldRestoreComposerFocus.current = false;
      window.requestAnimationFrame(() => promptInput.current?.focus());
    }
  }

  async function downloadVoiceModel(): Promise<void> {
    if (voiceDownloading || voiceListening) return;
    setVoiceDownloading(true);
    setVoiceDownloadProgress(0);
    setVoiceError(undefined);
    try {
      await window.vyomara.downloadSpeechModel();
      const status = await window.vyomara.getSpeechSetupStatus();
      setSpeechSetup(status);
      setVoiceStarting(true);
      setSpeechSetup(await window.vyomara.setSpeechListening(true));
    } catch (error) {
      setVoiceDownloading(false);
      setVoiceStarting(false);
      setVoiceError(error instanceof Error ? error.message : 'The offline speech model could not be installed.');
    }
  }

  async function toggleVoiceListening(): Promise<void> {
    if (!speechSetup || voiceStarting) return;
    setVoiceError(undefined);
    setVoiceTranscript('');
    if (!voiceListening && !speechSetup.modelReady) return;
    setVoiceStarting(!voiceListening);
    try {
      const status = await window.vyomara.setSpeechListening(!voiceListening);
      setSpeechSetup(status);
      if (!status.listeningEnabled) {
        setVoiceStarting(false);
        setVoiceListening(false);
      }
    } catch (error) {
      setVoiceStarting(false);
      setVoiceError(error instanceof Error ? error.message : 'Voice listening could not be changed.');
    }
  }

  async function speakMessage(message: ChatMessage): Promise<void> {
    if (speakingMessageId === message.id) {
      await stopSpeaking();
      return;
    }
    if (speakingMessageId !== undefined || message.failed) return;
    setSpeechError(undefined);
    setSpeakingMessageId(message.id);
    try {
      const result = await window.vyomara.speakText(message.content);
      if (result.status === 'cancelled') setSpeechError('Speech stopped.');
    } catch (error) {
      setSpeechError(error instanceof Error ? error.message : 'Local speech output failed.');
    } finally {
      setSpeakingMessageId(undefined);
    }
  }

  async function stopSpeaking(): Promise<void> {
    try {
      const stopped = await window.vyomara.stopSpeaking();
      if (!stopped) setSpeechError('There is no active speech to stop.');
    } catch (error) {
      setSpeechError(error instanceof Error ? error.message : 'Local speech could not be stopped.');
    }
  }

  async function cancel(): Promise<void> {
    await window.vyomara.cancelRequest();
  }

  async function approveAppAction(): Promise<void> {
    if (!appActionProposal || appActionRunning || requestPending) return;
    const action = appActionProposal;
    setAppActionRunning(true);
    recordActivity(action.type === 'search-chrome'
      ? 'Opening approved Chrome search'
      : `Opening ${action.type === 'open-vscode' ? 'VS Code' : 'Chrome'}`);
    setAppActionError(undefined);
    setAppActionResult(undefined);
    try {
      const result = await window.vyomara.runDesktopAppAction(action);
      setAppActionResult(result);
      recordActivity(result.action === 'search-opened'
        ? 'Chrome opened the approved search'
        : `${result.application} opened`);
      setAppActionProposal(undefined);
      const response = result.action === 'search-opened'
        ? `Opened Google Chrome with the requested Google search: “${action.type === 'search-chrome' ? action.query : ''}”.`
        : `Opened ${result.application}. No files were changed.`;
      setMessages(current => [...current, {
        id: Date.now(),
        role: 'assistant',
        content: response,
      }]);
    } catch (error) {
      recordActivity('Application action failed');
      setAppActionError(error instanceof Error ? error.message : 'The application could not be opened.');
    } finally {
      setAppActionRunning(false);
    }
  }

  function rejectAppAction(): void {
    if (appActionRunning) return;
    setAppActionProposal(undefined);
    setAppActionError(undefined);
    setMessages(current => [...current, {
      id: Date.now(),
      role: 'assistant',
      content: 'Cancelled. No application was opened.',
    }]);
    recordActivity('Application action rejected; nothing opened');
  }

  async function selectCheckProject(): Promise<void> {
    setCheckError(undefined);
    setCheckResult(undefined);
    try {
      const directory = await window.vyomara.selectCheckProject();
      if (directory) setCheckProjectDirectory(directory);
    } catch (error) {
      setCheckError(error instanceof Error ? error.message : 'The project folder could not be selected.');
    }
  }

  function requestOpenProjectInVSCode(): void {
    if (!checkProjectDirectory || appActionRunning || requestPending || editProposals.length > 0) return;
    setAppActionProposal({ type: 'open-vscode', projectDirectory: checkProjectDirectory });
    setAppActionError(undefined);
    setAppActionResult(undefined);
  }

  async function runCheck(checkId: DesktopApprovedCheckId): Promise<void> {
    if (!checkProjectDirectory || checkLoading || requestPending) return;
    setCheckLoading(true);
    recordActivity(`Running ${checkId} in ${checkProjectDirectory}`);
    setCheckError(undefined);
    setCheckResult(undefined);
    try {
      const result = await window.vyomara.runApprovedCheck(checkId);
      setCheckResult(result);
      recordActivity(`${result.command}: ${result.status}`);
    } catch (error) {
      recordActivity(`Project check failed: ${checkId}`);
      setCheckError(error instanceof Error ? error.message : 'The approved check failed safely.');
    } finally {
      setCheckLoading(false);
    }
  }

  async function cancelCheck(): Promise<void> {
    try {
      await window.vyomara.cancelApprovedCheck();
    } catch (error) {
      setCheckError(error instanceof Error ? error.message : 'The project check could not be cancelled.');
    }
  }

  function toggleChecks(): void {
    if (checksOpen) {
      closePanel('checks');
      return;
    }
    setSettingsOpen(false);
    setHistoryOpen(false);
    setPermissionsOpen(false);
    setMemoryOpen(false);
    setChecksOpen(true);
    setCheckError(undefined);
  }

  async function checkProviderConnection(): Promise<void> {
    if (
      connectionCheck === 'checking' ||
      settingsLoading ||
      requestPending ||
      provider?.provider !== 'ollama'
    ) return;
    setConnectionCheck('checking');
    setConnectionMessage(undefined);
    try {
      const result: DesktopProviderConnectionResult = await window.vyomara.checkProviderConnection();
      setConnectionCheck(result.status);
      if (result.status === 'unavailable') setConnectionMessage(result.message);
    } catch (error) {
      setConnectionCheck('unavailable');
      setConnectionMessage(error instanceof Error ? error.message : 'The local provider check failed.');
    }
  }

  function toggleSettings(): void {
    if (settingsOpen) {
      closePanel('settings');
      return;
    }
    setHistoryOpen(false);
    setPermissionsOpen(false);
    setMemoryOpen(false);
    setChecksOpen(false);
    setProviderDraft(provider?.provider ?? 'ollama');
    setModelDraft(provider?.model ?? 'llama3.2');
    setSettingsError(undefined);
    setSettingsNotice(undefined);
    setModelCheck(undefined);
    setSettingsOpen(true);
  }

  function closePanel(panel: 'checks' | 'history' | 'memory' | 'permissions' | 'settings'): void {
    if (panel === 'settings') {
      setSettingsOpen(false);
      settingsTrigger.current?.focus();
    } else if (panel === 'history') {
      setHistoryOpen(false);
      historyTrigger.current?.focus();
    } else if (panel === 'permissions') {
      setPermissionsOpen(false);
      permissionsTrigger.current?.focus();
    } else if (panel === 'checks') {
      setChecksOpen(false);
      checksTrigger.current?.focus();
    } else {
      setMemoryOpen(false);
      memoryTrigger.current?.focus();
    }
  }

  async function checkModelAvailability(): Promise<void> {
    if (
      modelCheckLoading ||
      settingsLoading ||
      requestPending ||
      providerDraft !== 'ollama' ||
      provider?.provider !== 'ollama'
    ) return;
    setModelCheckLoading(true);
    setModelCheck(undefined);
    setSettingsError(undefined);
    try {
      setModelCheck(await window.vyomara.checkProviderModel(modelDraft));
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : 'The local model check failed.');
    } finally {
      setModelCheckLoading(false);
    }
  }

  async function saveSettings(): Promise<void> {
    if (settingsLoading || modelCheckLoading || connectionCheck === 'checking' || requestPending) return;
    setSettingsLoading(true);
    setSettingsError(undefined);
    setSettingsNotice(undefined);
    try {
      const saved = await window.vyomara.saveProviderSettings({
        provider: providerDraft,
        model: modelDraft,
      });
      setProvider(saved);
      setConnectionCheck('not-checked');
      setConnectionMessage(undefined);
      setModelCheck(undefined);
      setSettingsNotice('Provider settings saved locally. New requests use this provider.');
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : 'Provider settings could not be saved.');
    } finally {
      setSettingsLoading(false);
    }
  }

  async function resetSettings(): Promise<void> {
    if (settingsLoading || modelCheckLoading || connectionCheck === 'checking' || requestPending) return;
    setSettingsLoading(true);
    setSettingsError(undefined);
    setSettingsNotice(undefined);
    try {
      const restored = await window.vyomara.resetProviderSettings();
      setProvider(restored);
      setProviderDraft(restored.provider);
      setModelDraft(restored.model);
      setConnectionCheck('not-checked');
      setConnectionMessage(undefined);
      setModelCheck(undefined);
      setSettingsNotice('Saved provider overrides were removed. Environment defaults are active.');
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : 'Provider settings could not be reset.');
    } finally {
      setSettingsLoading(false);
    }
  }

  function startNewChat(): void {
    if (requestPending || editProposals.length > 0) return;
    setSessionId(undefined);
    setMessages([]);
    setPrompt('');
    setActivity([]);
    setRequestError(undefined);
    setHistoryOpen(false);
    setSettingsOpen(false);
    setChecksOpen(false);
    setSelectedHistorySession(undefined);
    setHistoryDeleteConfirmation('');
  }

  async function toggleHistory(): Promise<void> {
    if (historyOpen) {
      setHistoryOpen(false);
      return;
    }

    setPermissionsOpen(false);
    setMemoryOpen(false);
    setSettingsOpen(false);
    setChecksOpen(false);
    setHistoryOpen(true);
    setHistoryLoading(true);
    setHistoryError(undefined);
    setHistoryNotice(undefined);
    setSelectedHistorySession(undefined);
    setHistoryDeleteConfirmation('');
    try {
      setSessions(await window.vyomara.listSessions());
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : 'Saved sessions could not be loaded.');
    } finally {
      setHistoryLoading(false);
    }
  }

  async function openSession(id: string): Promise<void> {
    if (editProposals.length > 0) return;
    setHistoryLoading(true);
    setHistoryError(undefined);
    try {
      const saved = await window.vyomara.loadSession(id);
      setSessionId(saved.sessionId);
      setMessages(saved.messages.map((message, index) => ({
        id: index,
        role: message.role,
        content: message.content,
      })));
      setActivity([]);
      setRequestError(undefined);
      setHistoryOpen(false);
      setSelectedHistorySession(undefined);
      setHistoryDeleteConfirmation('');
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : 'The saved session could not be opened.');
    } finally {
      setHistoryLoading(false);
    }
  }

  async function reviewSessionForDeletion(id: string): Promise<void> {
    setHistoryLoading(true);
    setHistoryError(undefined);
    setHistoryNotice(undefined);
    setHistoryDeleteConfirmation('');
    setSelectedHistorySession(undefined);
    try {
      setSelectedHistorySession(await window.vyomara.loadSession(id));
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : 'The selected conversation could not be reviewed.');
    } finally {
      setHistoryLoading(false);
    }
  }

  async function exportReviewedSession(): Promise<void> {
    if (!selectedHistorySession || historyLoading || requestPending) return;
    setHistoryLoading(true);
    setHistoryError(undefined);
    setHistoryNotice(undefined);
    try {
      const result = await window.vyomara.exportSession(selectedHistorySession.sessionId);
      if (result.status === 'exported') setHistoryNotice('Conversation exported. The JSON file includes complete raw history.');
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : 'The conversation could not be exported.');
    } finally {
      setHistoryLoading(false);
    }
  }

  async function deleteReviewedSession(): Promise<void> {
    const selected = selectedHistorySession;
    if (!selected || historyDeleteConfirmation !== 'DELETE' || historyLoading || requestPending) return;
    setHistoryLoading(true);
    setHistoryError(undefined);
    setHistoryNotice(undefined);
    try {
      const deleted = await window.vyomara.deleteSession(selected.sessionId, historyDeleteConfirmation);
      if (!deleted) throw new Error('The selected conversation no longer exists.');
      setSessions(await window.vyomara.listSessions());
      setSelectedHistorySession(undefined);
      setHistoryDeleteConfirmation('');
      if (sessionId === selected.sessionId) {
        setSessionId(undefined);
        setMessages([]);
        setActivity([]);
        setRequestError(undefined);
      }
      setHistoryNotice('Conversation deleted from this Mac.');
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : 'The conversation could not be deleted.');
    } finally {
      setHistoryLoading(false);
    }
  }

  async function deleteAllSavedHistoryAndMemories(): Promise<void> {
    if (historyDeleteAllConfirmation !== 'DELETE ALL' || historyLoading || requestPending) return;
    setHistoryLoading(true);
    setHistoryError(undefined);
    setHistoryNotice(undefined);
    try {
      const result = await window.vyomara.deleteAllHistoryAndMemories(historyDeleteAllConfirmation);
      setSessions([]);
      setSelectedHistorySession(undefined);
      setHistoryDeleteConfirmation('');
      setHistoryDeleteAllConfirmation('');
      setSessionId(undefined);
      setMessages([]);
      setActivity([]);
      setRequestError(undefined);
      setHistoryNotice(
        `Deleted ${result.sessionsDeleted} saved conversation(s) and ${result.memoriesDeleted} saved memor${result.memoriesDeleted === 1 ? 'y' : 'ies'}. Provider settings and folder permissions were kept.`,
      );
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : 'Saved conversations and memories could not be deleted.');
    } finally {
      setHistoryLoading(false);
    }
  }

  async function createLocalBackup(): Promise<void> {
    if (historyLoading || requestPending) return;
    setHistoryLoading(true);
    setHistoryError(undefined);
    setHistoryNotice(undefined);
    try {
      const result = await window.vyomara.backupLocalData();
      if (result.status === 'exported') {
        setHistoryNotice('Local backup created. It is unencrypted; keep the file somewhere protected.');
      }
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : 'The local backup could not be created.');
    } finally {
      setHistoryLoading(false);
    }
  }

  async function selectBackupForRestore(): Promise<void> {
    if (historyLoading || requestPending) return;
    setHistoryLoading(true);
    setHistoryError(undefined);
    setHistoryNotice(undefined);
    setBackupRestorePreview(undefined);
    setBackupRestoreConfirmation('');
    try {
      const preview = await window.vyomara.selectBackupForRestore();
      if (preview) setBackupRestorePreview(preview);
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : 'The selected backup could not be reviewed.');
    } finally {
      setHistoryLoading(false);
    }
  }

  async function restoreLocalData(): Promise<void> {
    if (backupRestoreConfirmation !== 'RESTORE' || historyLoading || requestPending) return;
    setHistoryLoading(true);
    setHistoryError(undefined);
    setHistoryNotice(undefined);
    try {
      const result = await window.vyomara.restoreLocalData(backupRestoreConfirmation);
      setBackupRestorePreview(undefined);
      setBackupRestoreConfirmation('');
      setSessions(await window.vyomara.listSessions());
      setMemories(await window.vyomara.listMemories());
      setAllowedRoots(await window.vyomara.listFilesystemRoots());
      setProvider(await window.vyomara.getProviderStatus());
      setSelectedHistorySession(undefined);
      setSelectedMemory(undefined);
      setSessionId(undefined);
      setMessages([]);
      setActivity([]);
      setRequestError(undefined);
      setHistoryNotice(
        `Restored ${result.sessions} conversation(s) and ${result.memories} memory item(s) from ${result.fileName}. A pre-restore safety copy was saved as ${result.safetyBackupName}.`,
      );
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : 'The selected backup could not be restored.');
    } finally {
      setHistoryLoading(false);
    }
  }

  async function togglePermissions(): Promise<void> {
    if (permissionsOpen) {
      setPermissionsOpen(false);
      return;
    }

    setHistoryOpen(false);
    setMemoryOpen(false);
    setSettingsOpen(false);
    setChecksOpen(false);
    setPermissionsOpen(true);
    setPermissionsLoading(true);
    setPermissionsError(undefined);
    try {
      setAllowedRoots(await window.vyomara.listFilesystemRoots());
    } catch (error) {
      setPermissionsError(error instanceof Error ? error.message : 'Filesystem permissions could not be loaded.');
    } finally {
      setPermissionsLoading(false);
    }
  }

  async function grantFolderAccess(): Promise<void> {
    setPermissionsLoading(true);
    setPermissionsError(undefined);
    try {
      const result = await window.vyomara.grantFilesystemRoot();
      setAllowedRoots(result.roots);
    } catch (error) {
      setPermissionsError(error instanceof Error ? error.message : 'Folder access could not be granted.');
    } finally {
      setPermissionsLoading(false);
    }
  }

  async function revokeFolderAccess(root: string): Promise<void> {
    setPermissionsLoading(true);
    setPermissionsError(undefined);
    try {
      setAllowedRoots(await window.vyomara.revokeFilesystemRoot(root));
    } catch (error) {
      setPermissionsError(error instanceof Error ? error.message : 'Folder access could not be revoked.');
    } finally {
      setPermissionsLoading(false);
    }
  }

  async function toggleMemory(): Promise<void> {
    if (memoryOpen) {
      setMemoryOpen(false);
      return;
    }

    setHistoryOpen(false);
    setPermissionsOpen(false);
    setSettingsOpen(false);
    setChecksOpen(false);
    setMemoryOpen(true);
    setMemoryLoading(true);
    setMemoryError(undefined);
    setMemoryNotice(undefined);
    try {
      setMemories(await window.vyomara.listMemories());
    } catch (error) {
      setMemoryError(error instanceof Error ? error.message : 'Saved memory could not be loaded.');
    } finally {
      setMemoryLoading(false);
    }
  }

  async function openMemory(id: string): Promise<void> {
    setMemoryLoading(true);
    setMemoryError(undefined);
    setMemoryNotice(undefined);
    setMemoryDeleteConfirmation('');
    try {
      setSelectedMemory({ id, content: await window.vyomara.readMemory(id) });
    } catch (error) {
      setMemoryError(error instanceof Error ? error.message : 'The selected memory could not be read.');
    } finally {
      setMemoryLoading(false);
    }
  }

  async function saveReviewedMemory(): Promise<void> {
    if (memoryConfirmation !== 'SAVE' || memoryDraft.trim() === '' || memoryLoading) return;
    setMemoryLoading(true);
    setMemoryError(undefined);
    try {
      await window.vyomara.saveMemory(memoryDraft, memoryConfirmation);
      setMemories(await window.vyomara.listMemories());
      setMemoryDraft('');
      setMemoryConfirmation('');
      setMemoryPreviewOpen(false);
      setMemoryNotice('Memory saved locally.');
    } catch (error) {
      setMemoryError(error instanceof Error ? error.message : 'Memory could not be saved.');
    } finally {
      setMemoryLoading(false);
    }
  }

  async function deleteReviewedMemory(): Promise<void> {
    if (!selectedMemory || memoryDeleteConfirmation !== 'DELETE' || memoryLoading) return;
    setMemoryLoading(true);
    setMemoryError(undefined);
    try {
      const deleted = await window.vyomara.deleteMemory(selectedMemory.id, memoryDeleteConfirmation);
      if (!deleted) throw new Error('The selected memory no longer exists.');
      setMemories(await window.vyomara.listMemories());
      setSelectedMemory(undefined);
      setMemoryDeleteConfirmation('');
      setMemoryNotice('Memory deleted.');
    } catch (error) {
      setMemoryError(error instanceof Error ? error.message : 'Memory could not be deleted.');
    } finally {
      setMemoryLoading(false);
    }
  }

  async function exportReviewedMemory(): Promise<void> {
    if (!selectedMemory || memoryLoading) return;
    setMemoryLoading(true);
    setMemoryError(undefined);
    setMemoryNotice(undefined);
    try {
      const result = await window.vyomara.exportMemory(selectedMemory.id);
      if (result.status === 'exported') {
        setMemoryNotice('Memory exported. The JSON file contains its complete content.');
      }
    } catch (error) {
      setMemoryError(error instanceof Error ? error.message : 'The selected memory could not be exported.');
    } finally {
      setMemoryLoading(false);
    }
  }

  const providerTitle = provider
    ? provider.provider === 'ollama'
      ? `Local Ollama · ${provider.model}`
      : 'Deterministic placeholder'
    : 'Loading provider…';
  const taskIsRunning = requestPending || checkLoading || appActionRunning || editProposalBusy !== undefined;
  const currentTaskState = requestPending
    ? 'Vyom is working on your request'
    : checkLoading
      ? 'A project check is running'
      : appActionRunning
        ? 'Opening the approved application'
        : editProposalBusy
          ? 'Resolving the approved project diff'
          : editProposals.length > 0
            ? 'Waiting for your project diff approval'
            : appActionProposal
              ? 'Waiting for your application approval'
              : 'No task running';
  const currentTaskDetail = taskIsRunning
    ? 'Progress updates appear above. Stop is available for cancellable tasks.'
    : editProposals.length > 0
      ? 'Review the complete diff, then apply or reject it. No file has changed yet.'
      : appActionProposal
        ? 'Review the exact application action before Vyom continues.'
        : 'When a task starts, its actual progress and results will appear here.';
  const voiceOrbAction = speechSetup?.modelReady ? toggleVoiceListening : downloadVoiceModel;
  const voiceOrbLabel = voiceListening
    ? 'Turn voice listening off'
    : speechSetup?.modelReady
      ? 'Start offline voice listening'
      : 'Download offline voice model and start listening';
  const voiceOrbDisabled = !speechSetup?.runtimeAvailable || voiceStarting || voiceDownloading;

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand topbar-brand" href="#" aria-label="Vyomara home">
          <span className="brand-mark"><VyomaraMark /></span>
          <span className="topbar-brand-copy">
            <img className="topbar-wordmark" src={vyomaraWordmark} alt="Vyomara" />
            <small>AI Twins. One Orbit. Your Control.</small>
          </span>
        </a>
        <div className="provider-status" title="Only a local Ollama endpoint is checked">
          <span className={`status-dot ${providerError || connectionCheck === 'unavailable' ? 'status-dot-error' : connectionCheck === 'available' ? 'status-dot-available' : ''}`} />
          <span>{providerError ?? providerTitle}</span>
          {provider?.provider === 'ollama' && (
            <span className="status-note" role={connectionMessage ? 'alert' : 'status'}>
              {connectionMessage ?? (connectionCheck === 'available'
                ? 'local service reachable'
                : connectionCheck === 'checking'
                  ? 'checking local service…'
                  : connectionCheck === 'unavailable'
                    ? 'local check failed'
                    : 'connection not checked')}
            </span>
          )}
        </div>
      </header>

      <div className="workspace">
        <nav className="side-nav" aria-label="Main navigation">
          <div className="side-nav-group">
            <p className="side-nav-label">ASSISTANT</p>
            <button className="side-nav-item side-nav-item-active" type="button" aria-current="page">
              <span aria-hidden="true">♩</span> Assistant
            </button>
            <button className="side-nav-item" type="button" onClick={() => activityHeading.current?.focus()}>
              <span aria-hidden="true">▤</span> Tasks &amp; Activity
              {requestPending && <span className="nav-indicator" aria-label="Task running">●</span>}
            </button>
            <button className="side-nav-item side-nav-item-disabled" type="button" disabled title="Approvals are not implemented yet">
              <span aria-hidden="true">◇</span> Approvals
              <span className="planned-label">Planned</span>
            </button>
          </div>
          <div className="side-nav-group">
            <p className="side-nav-label">YOUR DATA</p>
            <button
              ref={historyTrigger}
              className="side-nav-item"
              type="button"
              onClick={() => void toggleHistory()}
              disabled={requestPending}
              aria-expanded={historyOpen}
              aria-controls={historyOpen ? 'history-panel' : undefined}
            >
              <span aria-hidden="true">◷</span> History
            </button>
            <button
              ref={memoryTrigger}
              className="side-nav-item"
              type="button"
              onClick={() => void toggleMemory()}
              disabled={requestPending}
              aria-expanded={memoryOpen}
              aria-controls={memoryOpen ? 'memory-panel' : undefined}
            >
              <span aria-hidden="true">◇</span> Memory
            </button>
            <button
              ref={permissionsTrigger}
              className="side-nav-item"
              type="button"
              onClick={() => void togglePermissions()}
              disabled={requestPending}
              aria-expanded={permissionsOpen}
              aria-controls={permissionsOpen ? 'permissions-panel' : undefined}
            >
              <span aria-hidden="true">⬡</span> Permissions
            </button>
            <button
              ref={checksTrigger}
              className="side-nav-item"
              type="button"
              onClick={toggleChecks}
              disabled={requestPending}
              aria-expanded={checksOpen}
              aria-controls={checksOpen ? 'checks-panel' : undefined}
            >
              <span aria-hidden="true">✓</span> Project workspace
            </button>
            <button
              ref={settingsTrigger}
              className="side-nav-item"
              type="button"
              onClick={toggleSettings}
              disabled={requestPending}
              aria-expanded={settingsOpen}
              aria-controls={settingsOpen ? 'settings-panel' : undefined}
            >
              <span aria-hidden="true">⚙</span> Settings
            </button>
          </div>
          <button className="new-chat-button side-nav-new-chat" type="button" onClick={startNewChat} disabled={requestPending || editProposals.length > 0}>
            <span aria-hidden="true">＋</span> New conversation
          </button>
          <div className="sidebar-provider" aria-label="Configured model">
            <span className="sidebar-provider-icon" aria-hidden="true">✧</span>
            <span>
              <strong>{provider?.provider === 'ollama' ? `Ollama · ${provider.model}` : provider?.provider === 'placeholder' ? 'Placeholder model' : 'Loading model…'}</strong>
              <small><i /> Local configuration</small>
            </span>
            <span className="sidebar-provider-menu" aria-hidden="true">⋮</span>
          </div>
        </nav>

        <section className="conversation" aria-label="Conversation">
          <div className="conversation-heading">
            <div>
              <p className="eyebrow">VYOMARA · LOCAL AI COMPANION</p>
              <h1>Your voice. Your orbit.</h1>
              <p className="intro">I&apos;m Vyom, ready when you are.</p>
            </div>
            {sessionId && <span className="session-badge">Session saved locally</span>}
          </div>

          <div className="message-list" ref={messageList} aria-live="polite">
            {messages.length === 0 ? (
              <div className="welcome-card">
                <p className="welcome-kicker">A PERSONAL AI, RIGHT HERE ON YOUR MAC</p>
                <h2>What&apos;s on your mind?</h2>
                <p className="welcome-copy">Start with your voice or type below. Your voice stays on this Mac.</p>
                <div className={`voice-orbit${voiceListening ? ' voice-orbit-listening' : ''}`} aria-label="Offline voice input">
                  <VoiceWave side="left" />
                  <button
                    className="voice-orb-button"
                    type="button"
                    onClick={() => void voiceOrbAction()}
                    disabled={voiceOrbDisabled}
                    aria-label={voiceOrbLabel}
                    aria-pressed={voiceListening || voiceStarting}
                    title={speechSetup?.runtimeAvailable === false
                      ? 'Install whisper.cpp to enable offline voice'
                      : voiceOrbLabel}
                  >
                    <span className="voice-orb-current" aria-hidden="true" />
                    <span className="voice-orb-mark" aria-hidden="true">
                      <VyomaraMark tile={false} />
                    </span>
                  </button>
                  <VoiceWave side="right" />
                </div>
                <p
                  className={`voice-orbit-status${voiceError ? ' voice-orbit-error' : ''}`}
                  role={voiceError ? 'alert' : 'status'}
                  aria-live="polite"
                >
                  {voiceError
                    ? voiceError
                    : voiceDownloading
                      ? `Preparing offline voice… ${voiceDownloadProgress ?? 0}%`
                      : voiceStarting
                        ? 'Starting local microphone…'
                        : voiceListening
                          ? voiceTranscript || 'Listening… speak naturally'
                          : speechSetup?.runtimeAvailable === false
                            ? 'Offline voice engine unavailable'
                            : speechSetup?.modelReady
                              ? 'Tap the orb to speak'
                              : 'Tap the orb to set up offline voice'}
                </p>
              </div>
            ) : messages.map(message => (
              <article
                className={`message message-${message.role}${message.failed ? ' message-failed' : ''}`}
                key={message.id}
              >
                <div className="message-avatar" aria-hidden="true">
                  {message.role === 'user' ? 'Y' : 'V'}
                </div>
                <div className="message-content">
                  <p className="message-text">{message.content}</p>
                  {message.role === 'assistant' && !message.failed && (
                    <button
                      className="message-speak"
                      type="button"
                      onClick={() => void speakMessage(message)}
                      disabled={speakingMessageId !== undefined && speakingMessageId !== message.id}
                    >
                      {speakingMessageId === message.id ? '■ Stop speaking' : '♩ Speak aloud'}
                    </button>
                  )}
                </div>
              </article>
            ))}
            {appActionProposal && (
              <section className="app-action-approval" aria-label="Review application action">
                <p className="eyebrow">CONFIRM BEFORE CONTINUING</p>
                <h2>Open {appActionProposal.type === 'open-vscode' ? 'Visual Studio Code' : 'Google Chrome'}?</h2>
                {appActionProposal.type === 'search-chrome' ? (
                  <p>
                    This will open Chrome and send this search query to Google over the internet:
                    <strong className="app-action-query"> {appActionProposal.query}</strong>
                  </p>
                ) : (
                  <p>
                    This will open or focus the existing {appActionProposal.type === 'open-vscode' ? 'VS Code' : 'Chrome'} app.
                    {appActionProposal.type === 'open-vscode' && appActionProposal.projectDirectory
                      ? <> It will open the selected project: <strong className="app-action-query">{appActionProposal.projectDirectory}</strong>. No files will be changed.</>
                      : ' No files will be changed.'}
                  </p>
                )}
                {appActionError && <p className="history-error" role="alert">{appActionError}</p>}
                <div className="app-action-buttons">
                  <button
                    className="app-action-confirm"
                    type="button"
                    onClick={() => void approveAppAction()}
                    disabled={appActionRunning}
                  >
                    {appActionRunning
                      ? 'Opening…'
                      : appActionProposal.type === 'search-chrome'
                        ? 'Search in Chrome'
                        : 'Open app'}
                  </button>
                  <button
                    className="history-close"
                    type="button"
                    onClick={rejectAppAction}
                    disabled={appActionRunning}
                  >
                    Cancel
                  </button>
                </div>
              </section>
            )}
            {editProposals.map(proposal => (
              <section className="edit-proposal-card" key={proposal.id} aria-label={`Review code edit for ${proposal.path}`}>
                <p className="eyebrow">PROJECT DIFF · AWAITING YOUR APPROVAL</p>
                <h2>{proposal.path}</h2>
                <p className="history-privacy">
                  Vyom has not changed this file. Review the complete before/after diff. Applying it replaces only this
                  existing file, and only after you approve this exact proposal.
                </p>
                <pre className="edit-proposal-diff">{proposal.diff}</pre>
                {editProposalErrors[proposal.id] && (
                  <p className="history-message history-error" role="alert">{editProposalErrors[proposal.id]}</p>
                )}
                <div className="app-action-buttons">
                  <button
                    className="app-action-confirm"
                    type="button"
                    onClick={() => void applyEditProposal(proposal)}
                    disabled={editProposalBusy !== undefined}
                  >
                    {editProposalBusy === proposal.id ? 'Applying approved diff…' : 'Apply this diff'}
                  </button>
                  <button
                    className="history-close"
                    type="button"
                    onClick={() => void rejectEditProposal(proposal)}
                    disabled={editProposalBusy !== undefined}
                  >
                    {editProposalBusy === proposal.id ? 'Please wait…' : 'Reject diff'}
                  </button>
                </div>
              </section>
            ))}
            {editProposalNotice && <p className="app-action-result" role="status">{editProposalNotice}</p>}
            {appActionResult && (
              <p className="app-action-result" role="status">
                {appActionResult.action === 'search-opened'
                  ? 'Chrome opened with the approved Google search.'
                  : `${appActionResult.application} opened successfully.`}
              </p>
            )}
            {requestPending && (
              <div className="pending-state" role="status">
                <span className="thinking-indicator"><i /><i /><i /></span>
                <span>Vyom is typing…</span>
                <button type="button" onClick={() => void cancel()}>Cancel</button>
              </div>
            )}
          </div>

          <form className="composer" onSubmit={event => void submit(event)}>
            <label className="visually-hidden" htmlFor="prompt">Message Vyom</label>
            <textarea
              ref={promptInput}
              id="prompt"
              value={prompt}
              onChange={event => {
                setPrompt(event.target.value);
              }}
              placeholder="Message Vyom…"
              rows={2}
              maxLength={8000}
              disabled={requestPending || editProposals.length > 0}
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <div className="composer-footer">
              <span>Enter to send · Shift + Enter for a new line</span>
              <div className="composer-actions">
                <button
                  className={`voice-input-button${voiceListening ? ' voice-input-active' : ''}`}
                  type="button"
                  onClick={() => speechSetup?.modelReady ? void toggleVoiceListening() : void downloadVoiceModel()}
                  disabled={
                    !speechSetup?.runtimeAvailable ||
                    voiceStarting ||
                    voiceDownloading ||
                    requestPending ||
                    editProposals.length > 0
                  }
                  aria-label={
                    voiceListening
                      ? 'Turn voice listening off'
                      : speechSetup?.modelReady
                        ? 'Start voice input'
                        : 'Download offline voice model and start voice input'
                  }
                  aria-pressed={voiceListening || voiceStarting}
                  title={
                    speechSetup?.runtimeAvailable === false
                      ? 'Install whisper.cpp to enable offline voice input'
                      : voiceListening
                        ? 'Listening · click to turn off'
                        : speechSetup?.modelReady
                          ? 'Start offline voice input'
                          : 'Download the offline voice model and start listening'
                  }
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="9" y="2.5" width="6" height="12" rx="3" />
                    <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3.5M9 21.5h6" />
                  </svg>
                </button>
                <button
                  className="send-button"
                  type="submit"
                  disabled={requestPending || prompt.trim() === '' || editProposals.length > 0}
                  aria-label="Send message"
                >
                  <span aria-hidden="true">↑</span>
                </button>
              </div>
            </div>
            {(voiceError || voiceDownloading || voiceStarting || voiceListening) && (
              <p className={`composer-voice-status${voiceError ? ' composer-voice-error' : ''}`} role={voiceError ? 'alert' : 'status'}>
                {voiceError
                  ? voiceError
                  : voiceDownloading
                    ? `Downloading offline voice model… ${voiceDownloadProgress ?? 0}%`
                    : voiceStarting
                      ? 'Starting local microphone…'
                      : voiceListening
                        ? voiceTranscript || 'Listening—speak your message.'
                        : ''}
              </p>
            )}
          </form>
          <p className="privacy-note" role={requestError || speechError ? 'alert' : 'status'}>
            {requestError
              ? 'Request failed; no success is implied.'
              : speechError ?? 'Your conversation is stored locally on this Mac. Speech output uses the on-device macOS voice.'}
          </p>
        </section>

        {checksOpen ? (
        <aside id="checks-panel" className="activity-panel history-panel checks-panel" aria-label="Project workspace and approved checks">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">PROJECT SCOPE &amp; CHECKS</p>
              <h2 ref={checksHeading} tabIndex={-1}>Project workspace</h2>
            </div>
            <button className="history-close" type="button" onClick={() => closePanel('checks')}>
              Close
            </button>
          </div>
          <p className="permissions-disclosure">
            Choose a project you trust. Code requests can read only this selected folder and stage changes to existing
            UTF-8 files up to 16 KB. Every full diff needs your explicit approval; files are never created or deleted.
            Listed pnpm checks may execute project-defined scripts and are bounded to five minutes. Checks receive a
            limited environment but are not sandboxed and may access your user files or network.
          </p>
          <button
            className="permission-add"
            type="button"
            onClick={() => void selectCheckProject()}
            disabled={checkLoading || requestPending}
          >
            Choose project folder…
          </button>
          {checkProjectDirectory && <p className="permission-path">Project: {checkProjectDirectory}</p>}
          <button
            className="history-close"
            type="button"
            onClick={requestOpenProjectInVSCode}
            disabled={!checkProjectDirectory || checkLoading || requestPending || editProposals.length > 0}
          >
            Open selected project in VS Code…
          </button>
          <p className="history-privacy">
            Code proposals use read-only inspection tools and cannot run commands. Apply or reject each diff in the conversation.
            Open this exact workspace in your existing VS Code app when you choose.
          </p>
          <h3 className="memory-review-title">Approved project checks</h3>
          <div className="check-actions" aria-label="Available project checks">
            {([
              ['test', 'Run pnpm test'],
              ['typecheck', 'Run pnpm typecheck'],
              ['build:desktop', 'Run pnpm build:desktop'],
              ['test:desktop-ui', 'Run pnpm test:desktop-ui'],
            ] as const).map(([checkId, label]) => (
              <button
                className="permission-add"
                key={checkId}
                type="button"
                onClick={() => void runCheck(checkId)}
                disabled={!checkProjectDirectory || checkLoading || requestPending}
              >
                {label}
              </button>
            ))}
          </div>
          {checkLoading && (
            <div className="check-running" role="status">
              <span>Project check is running…</span>
              <button className="permission-revoke" type="button" onClick={() => void cancelCheck()}>
                Cancel check
              </button>
            </div>
          )}
          {checkError && <p className="history-message history-error" role="alert">{checkError}</p>}
          {checkResult && (
            <section className="session-review" aria-label="Project check result">
              <p className="memory-review-title">
                {checkResult.command} · {checkResult.status} · exit {checkResult.exitCode ?? 'unavailable'}
              </p>
              <p className="history-privacy">Completed in {checkResult.durationMs} ms. Output is capped at 64,000 characters.</p>
              <pre className="check-output">{checkResult.output || 'No output.'}</pre>
            </section>
          )}
        </aside>
        ) : memoryOpen ? (
        <aside id="memory-panel" className="activity-panel history-panel memory-panel" aria-label="Explicit memory">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">USER CONTROLLED</p>
              <h2 ref={memoryHeading} tabIndex={-1}>Memory</h2>
            </div>
            <button className="history-close" type="button" onClick={() => closePanel('memory')}>
              Close
            </button>
          </div>
          <p className="memory-disclosure">
            Memory is separate from chat history and is never created from conversation automatically.
            Saved memories are local and are not currently added to Vyom&apos;s context.
          </p>
          <div className="memory-create">
            <label className="memory-label" htmlFor="memory-draft">Save a memory</label>
            <textarea
              id="memory-draft"
              className="memory-draft"
              value={memoryDraft}
              onChange={event => {
                setMemoryDraft(event.target.value);
                setMemoryPreviewOpen(false);
                setMemoryConfirmation('');
              }}
              maxLength={32000}
              rows={3}
              placeholder="Write only what you want saved…"
              disabled={memoryPreviewOpen || memoryLoading}
            />
            <button
              className="permission-add"
              type="button"
              onClick={() => {
                setMemoryError(undefined);
                setMemoryConfirmation('');
                setMemoryPreviewOpen(true);
              }}
              disabled={memoryDraft.trim() === '' || memoryLoading || memoryPreviewOpen}
            >
              Review before saving
            </button>
          </div>
          {memoryPreviewOpen && (
            <div className="memory-review" aria-label="Review memory before saving">
              <p className="memory-review-title">Review the exact content to save</p>
              <pre className="memory-content">{memoryDraft}</pre>
              <label className="memory-label" htmlFor="memory-save-confirm">Type SAVE to confirm</label>
              <input
                id="memory-save-confirm"
                className="memory-confirm-input"
                value={memoryConfirmation}
                onChange={event => setMemoryConfirmation(event.target.value)}
                autoComplete="off"
                disabled={memoryLoading}
              />
              <div className="memory-actions">
                <button
                  className="history-close"
                  type="button"
                  onClick={() => {
                    setMemoryPreviewOpen(false);
                    setMemoryConfirmation('');
                  }}
                  disabled={memoryLoading}
                >
                  Back
                </button>
                <button
                  className="permission-add"
                  type="button"
                  onClick={() => void saveReviewedMemory()}
                  disabled={memoryConfirmation !== 'SAVE' || memoryLoading}
                >
                  Save memory
                </button>
              </div>
            </div>
          )}
          {selectedMemory && (
            <div className="memory-review" aria-label="Selected saved memory">
              <p className="memory-review-title">Saved content</p>
              <pre className="memory-content">{selectedMemory.content}</pre>
              <p className="history-privacy">
                Export creates a new, unencrypted JSON file containing this memory. It uses owner-only file permissions and will not overwrite an existing file.
              </p>
              <button
                className="permission-add"
                type="button"
                onClick={() => void exportReviewedMemory()}
                disabled={memoryLoading}
              >
                {memoryLoading ? 'Preparing export…' : 'Export this memory as JSON'}
              </button>
              <label className="memory-label" htmlFor="memory-delete-confirm">
                Review the content, then type DELETE to remove it
              </label>
              <input
                id="memory-delete-confirm"
                className="memory-confirm-input"
                value={memoryDeleteConfirmation}
                onChange={event => setMemoryDeleteConfirmation(event.target.value)}
                autoComplete="off"
                disabled={memoryLoading}
              />
              <button
                className="permission-revoke"
                type="button"
                onClick={() => void deleteReviewedMemory()}
                disabled={memoryDeleteConfirmation !== 'DELETE' || memoryLoading}
              >
                Delete this memory
              </button>
            </div>
          )}
          {memoryNotice && <p className="memory-notice" role="status">{memoryNotice}</p>}
          {memoryError && <p className="history-message history-error" role="alert">{memoryError}</p>}
          <div className="history-content" aria-live="polite">
            {memoryLoading ? (
              <p className="history-message" role="status">Loading saved memories…</p>
            ) : memories.length === 0 ? (
              <p className="history-message">No explicit memories saved.</p>
            ) : (
              <ol className="history-list">
                {memories.map(memory => (
                  <li key={memory.id}>
                    <button
                      className={`history-item${memory.id === selectedMemory?.id ? ' history-item-current' : ''}`}
                      type="button"
                      onClick={() => void openMemory(memory.id)}
                      disabled={memoryLoading}
                    >
                      <span>{new Date(memory.updatedAt).toLocaleString()}</span>
                      <span>Review saved memory</span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </div>
          <p className="history-privacy">Only the exact content you review and confirm is saved. Deletion requires reviewing the target and typing DELETE.</p>
        </aside>
        ) : permissionsOpen ? (
        <aside id="permissions-panel" className="activity-panel history-panel" aria-label="Filesystem permissions">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">READ ONLY</p>
              <h2 ref={permissionsHeading} tabIndex={-1}>Permissions</h2>
            </div>
            <button className="history-close" type="button" onClick={() => closePanel('permissions')}>
              Close
            </button>
          </div>
          <p className="permissions-disclosure">
            Vyom can read files only inside folders listed here. File contents may be sent to your configured
            provider when you ask about them. Access is stored locally on this Mac.
          </p>
          <button
            className="permission-add"
            type="button"
            onClick={() => void grantFolderAccess()}
            disabled={permissionsLoading || requestPending}
          >
            Choose folder…
          </button>
          <div className="history-content" aria-live="polite">
            {permissionsLoading ? (
              <p className="history-message" role="status">Updating folder access…</p>
            ) : permissionsError ? (
              <p className="history-message history-error" role="alert">{permissionsError}</p>
            ) : allowedRoots.length === 0 ? (
              <p className="history-message">No folders are allowed. Filesystem tools cannot access any files.</p>
            ) : (
              <ol className="history-list">
                {allowedRoots.map(root => (
                  <li className="permission-item" key={root}>
                    <span className="permission-path">{root}</span>
                    <button
                      className="permission-revoke"
                      type="button"
                      onClick={() => void revokeFolderAccess(root)}
                      disabled={permissionsLoading || requestPending}
                    >
                      Revoke
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </div>
          <p className="history-privacy">Revoking access applies to the next request. Current requests cannot change permissions.</p>
        </aside>
        ) : historyOpen ? (
        <aside id="history-panel" className="activity-panel history-panel" aria-label="Saved conversations">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">ON THIS MAC</p>
              <h2 ref={historyHeading} tabIndex={-1}>History</h2>
            </div>
            <button className="history-close" type="button" onClick={() => closePanel('history')}>
              Close
            </button>
          </div>
          <div className="history-content" aria-live="polite">
            {historyLoading ? (
              <p className="history-message" role="status">Loading saved conversations…</p>
            ) : historyError ? (
              <p className="history-message history-error" role="alert">{historyError}</p>
            ) : sessions.length === 0 ? (
              <p className="history-message">No saved conversations yet.</p>
            ) : (
              <ol className="history-list">
                {sessions.map(session => (
                  <li key={session.id}>
                    <div className="history-row">
                      <button
                        className={`history-item${session.id === sessionId ? ' history-item-current' : ''}`}
                        type="button"
                        onClick={() => void openSession(session.id)}
                        disabled={historyLoading || requestPending}
                      >
                        <span>{new Date(session.updatedAt).toLocaleString()}</span>
                        <span>{session.messageCount} messages · Open conversation</span>
                      </button>
                      <button
                        className="history-delete"
                        type="button"
                        onClick={() => void reviewSessionForDeletion(session.id)}
                        disabled={historyLoading || requestPending}
                      >
                        Review options
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            )}
            <section className="session-review" aria-label="Create a local data backup">
              <p className="memory-review-title">Back up local data</p>
              <p className="history-privacy">
                The SQLite backup includes complete conversations (including raw tool calls and results),
                explicit memories, provider settings, and allowed folder paths. It is unencrypted, saved
                with owner-only permissions, and will not overwrite an existing file.
              </p>
              <button
                className="permission-add"
                type="button"
                onClick={() => void createLocalBackup()}
                disabled={historyLoading || requestPending}
              >
                {historyLoading ? 'Creating backup…' : 'Create local backup'}
              </button>
            </section>
            <section className="session-review" aria-label="Restore a local data backup">
              <p className="memory-review-title">Restore a local backup</p>
              <p className="history-privacy">
                Restore replaces all current local conversations, memories, provider settings, and folder permissions.
                Vyomara first creates a safety backup in its local data folder. Backup contents are unencrypted.
              </p>
              <button
                className="permission-add"
                type="button"
                onClick={() => void selectBackupForRestore()}
                disabled={historyLoading || requestPending}
              >
                Select backup to review…
              </button>
              {backupRestorePreview && (
                <div className="session-review" aria-label="Review selected backup">
                  <p className="memory-review-title">Selected backup: {backupRestorePreview.fileName}</p>
                  <p className="history-privacy">
                    Contains {backupRestorePreview.sessions} conversation(s) and {backupRestorePreview.memories} memory item(s).
                    Current saved data will be replaced after you confirm.
                  </p>
                  <label className="memory-label" htmlFor="backup-restore-confirm">
                    Type RESTORE to replace current local data
                  </label>
                  <input
                    id="backup-restore-confirm"
                    className="memory-confirm-input"
                    value={backupRestoreConfirmation}
                    onChange={event => setBackupRestoreConfirmation(event.target.value)}
                    autoComplete="off"
                    disabled={historyLoading || requestPending}
                  />
                  <button
                    className="permission-revoke"
                    type="button"
                    onClick={() => void restoreLocalData()}
                    disabled={backupRestoreConfirmation !== 'RESTORE' || historyLoading || requestPending}
                  >
                    {historyLoading ? 'Restoring local data…' : 'Restore this backup'}
                  </button>
                </div>
              )}
            </section>
            {selectedHistorySession && (
              <section className="session-review" aria-label="Review saved conversation">
                <p className="memory-review-title">Review conversation</p>
                <ol className="session-review-messages">
                  {selectedHistorySession.messages.length === 0 ? (
                    <li>No user or assistant messages are available to review.</li>
                  ) : selectedHistorySession.messages.map((message, index) => (
                    <li key={`${index}-${message.role}`}>
                      <strong>{message.role === 'user' ? 'You' : 'Vyom'}</strong>
                      <pre className="memory-content">{message.content}</pre>
                    </li>
                  ))}
                </ol>
                <p className="history-privacy">
                  Export includes all stored messages, including raw tool calls and results that may contain private file content.
                  The JSON export is not encrypted; Vyomara will create a new file with owner-only permissions and will not overwrite an existing file.
                </p>
                <button
                  className="permission-add"
                  type="button"
                  onClick={() => void exportReviewedSession()}
                  disabled={historyLoading || requestPending}
                >
                  {historyLoading ? 'Preparing export…' : 'Export complete conversation as JSON'}
                </button>
                <label className="memory-label" htmlFor="history-delete-confirm">
                  Type DELETE to permanently remove this conversation
                </label>
                <input
                  id="history-delete-confirm"
                  className="memory-confirm-input"
                  value={historyDeleteConfirmation}
                  onChange={event => setHistoryDeleteConfirmation(event.target.value)}
                  autoComplete="off"
                  disabled={historyLoading || requestPending}
                />
                <button
                  className="permission-revoke"
                  type="button"
                  onClick={() => void deleteReviewedSession()}
                  disabled={historyDeleteConfirmation !== 'DELETE' || historyLoading || requestPending}
                >
                  Delete this conversation
                </button>
              </section>
            )}
            <section className="session-review" aria-label="Delete all saved conversations and memories">
              <p className="memory-review-title">Delete all saved data</p>
              <p className="history-privacy">
                This permanently deletes every saved conversation and explicit memory from this Mac.
                Provider settings and allowed folders are kept.
              </p>
              <label className="memory-label" htmlFor="history-delete-all-confirm">
                Type DELETE ALL to confirm
              </label>
              <input
                id="history-delete-all-confirm"
                className="memory-confirm-input"
                value={historyDeleteAllConfirmation}
                onChange={event => setHistoryDeleteAllConfirmation(event.target.value)}
                autoComplete="off"
                disabled={historyLoading || requestPending}
              />
              <button
                className="permission-revoke"
                type="button"
                onClick={() => void deleteAllSavedHistoryAndMemories()}
                disabled={historyDeleteAllConfirmation !== 'DELETE ALL' || historyLoading || requestPending}
              >
                {historyLoading ? 'Deleting saved data…' : 'Delete all conversations and memories'}
              </button>
            </section>
            {historyNotice && <p className="memory-notice" role="status">{historyNotice}</p>}
          </div>
          <p className="history-privacy">
            Saved locally until deleted. Review shows user and final assistant messages; raw tool calls and results are also stored and removed with the session.
          </p>
        </aside>
        ) : settingsOpen ? (
        <aside id="settings-panel" className="activity-panel history-panel settings-panel" aria-label="Provider settings">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">LOCAL CONFIGURATION</p>
              <h2 ref={settingsHeading} tabIndex={-1}>Settings</h2>
            </div>
            <button className="history-close" type="button" onClick={() => closePanel('settings')}>
              Close
            </button>
          </div>
          <p className="permissions-disclosure">
            Vyomara supports local Ollama or a deterministic placeholder. There is no cloud provider or silent fallback.
            Ollama connections are limited to the configured loopback endpoint.
          </p>
          <section className="settings-status" aria-label="On-device voice input">
            <p className="memory-review-title">Offline voice</p>
            <div className="settings-status-row">
              <span>Base multilingual model</span>
              <span role={voiceError ? 'alert' : 'status'}>
                {speechSetup?.modelReady ? 'Downloaded and verified' : voiceDownloading ? `Downloading ${voiceDownloadProgress ?? 0}%` : 'Not installed'}
              </span>
            </div>
            <button
              className="history-close"
              type="button"
              onClick={() => speechSetup?.modelReady ? void toggleVoiceListening() : void downloadVoiceModel()}
              disabled={!speechSetup?.runtimeAvailable || voiceStarting || voiceDownloading}
            >
              {voiceListening ? 'Turn listening off' : voiceStarting ? 'Starting…' : speechSetup?.modelReady ? 'Turn listening on' : voiceDownloading ? 'Downloading…' : 'Download model · 142 MB'}
            </button>
            {speechSetup?.runtimeAvailable === false && <p className="history-message history-error">Install whisper.cpp with <code>brew install whisper.cpp</code>, then restart Vyomara.</p>}
            {voiceError && <p className="history-message history-error" role="alert">{voiceError}</p>}
            <p className="history-privacy">
              The multilingual Whisper model is downloaded only when you choose. Recognition runs locally through whisper.cpp; microphone audio is never sent to an online service. Listening Off stops the microphone immediately.
            </p>
          </section>
          <section className="settings-status" aria-label="Current provider status">
            <p className="memory-review-title">Current provider</p>
            <strong>{providerError ?? providerTitle}</strong>
            {provider?.provider === 'ollama' ? (
              <>
                <div className="settings-status-row">
                  <span>Local Ollama service</span>
                  <span role={connectionCheck === 'unavailable' ? 'alert' : 'status'}>
                    {connectionCheck === 'available'
                      ? 'Reachable'
                      : connectionCheck === 'checking'
                        ? 'Checking…'
                        : connectionCheck === 'unavailable'
                          ? 'Unavailable'
                          : 'Not checked'}
                  </span>
                </div>
                {connectionCheck === 'unavailable' && connectionMessage && (
                  <p className="history-message history-error" role="alert">{connectionMessage}</p>
                )}
                <button
                  className="history-close"
                  type="button"
                  onClick={() => void checkProviderConnection()}
                  disabled={connectionCheck === 'checking' || settingsLoading || requestPending}
                >
                  {connectionCheck === 'checking' ? 'Checking local service…' : 'Check local Ollama connection'}
                </button>
                <div className="settings-status-row">
                  <span>Model availability · {modelDraft}</span>
                  <span role={modelCheck?.status === 'unavailable' ? 'alert' : 'status'}>
                    {modelCheckLoading
                      ? 'Checking…'
                      : modelCheck?.status === 'installed'
                        ? 'Installed'
                        : modelCheck?.status === 'not-installed'
                          ? 'Not installed'
                          : modelCheck?.status === 'unavailable'
                            ? 'Check unavailable'
                            : 'Not checked'}
                  </span>
                </div>
                {modelCheck?.status === 'not-installed' && (
                  <p className="history-message" role="status">{modelCheck.message}</p>
                )}
                {modelCheck?.status === 'unavailable' && (
                  <p className="history-message history-error" role="alert">{modelCheck.message}</p>
                )}
                <p className="history-privacy">
                  Connection reachability and model installation are checked separately. Both checks use local Ollama only.
                </p>
              </>
            ) : provider?.provider === 'placeholder' ? (
              <p className="history-privacy">The deterministic placeholder uses no model or Ollama connection.</p>
            ) : (
              <p className="history-message history-error" role="alert">Provider status could not be loaded.</p>
            )}
          </section>
          <label className="memory-label" htmlFor="provider-select">Provider</label>
          <select
            id="provider-select"
            className="settings-input"
            value={providerDraft}
            onChange={event => {
              setProviderDraft(event.target.value === 'placeholder' ? 'placeholder' : 'ollama');
              setModelCheck(undefined);
            }}
            disabled={settingsLoading || requestPending}
          >
            <option value="ollama">Local Ollama</option>
            <option value="placeholder">Deterministic placeholder</option>
          </select>
          <label className="memory-label" htmlFor="model-name">Ollama model name</label>
          <input
            id="model-name"
            className="settings-input"
            value={modelDraft}
            onChange={event => {
              setModelDraft(event.target.value);
              setModelCheck(undefined);
            }}
            maxLength={128}
            autoComplete="off"
            disabled={settingsLoading || requestPending}
          />
          <p className="history-privacy">
            Model names must use letters, numbers, `.`, `_`, `:`, `/`, or `-`. The model is not downloaded or checked when settings are saved.
            {providerDraft === 'placeholder' ? ' The placeholder does not use a model.' : ''}
          </p>
          {providerDraft === 'ollama' && (
            <>
              <button
                className="history-close"
                type="button"
                onClick={() => void checkModelAvailability()}
                disabled={modelCheckLoading || settingsLoading || requestPending || provider?.provider !== 'ollama' || modelDraft.trim() === ''}
              >
                {modelCheckLoading ? 'Checking local model…' : 'Check model availability'}
              </button>
              {provider?.provider !== 'ollama' && (
                <p className="history-privacy">Save Local Ollama as the current provider before checking model availability.</p>
              )}
            </>
          )}
          <button
            className="permission-add"
            type="button"
            onClick={() => void saveSettings()}
            disabled={settingsLoading || modelCheckLoading || connectionCheck === 'checking' || requestPending || modelDraft.trim() === ''}
          >
            {settingsLoading ? 'Saving…' : 'Save settings'}
          </button>
          <button
            className="history-close"
            type="button"
            onClick={() => void resetSettings()}
            disabled={settingsLoading || modelCheckLoading || connectionCheck === 'checking' || requestPending}
          >
            Reset to environment defaults
          </button>
          {settingsError && <p className="history-message history-error" role="alert">{settingsError}</p>}
          {settingsNotice && <p className="memory-notice" role="status">{settingsNotice}</p>}
        </aside>
        ) : (
        <aside className="activity-panel" aria-label="Task activity">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">TASK STATUS</p>
              <h2 ref={activityHeading} tabIndex={-1}>Recent Activity</h2>
            </div>
            <span className={`activity-state${taskIsRunning ? ' activity-running' : editProposals.length > 0 || appActionProposal ? ' activity-waiting' : ''}`}>
              {taskIsRunning ? 'Working' : editProposals.length > 0 || appActionProposal ? 'Approval' : 'Ready'}
            </span>
          </div>
          <div className="activity-content" aria-live="polite">
            {activity.length === 0 ? (
              <div className="activity-empty">
                <span aria-hidden="true">◷</span>
                <p>Task updates appear here while Vyom works.</p>
              </div>
            ) : (
              <ol className="activity-list">
                {activity.map((item, index) => (
                  <li key={`${index}-${item}`}>
                    <span className="activity-check" aria-hidden="true">·</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
          <section className="tool-execution-card" aria-label="Current task status">
            <div className="tool-execution-heading">
              <span aria-hidden="true">▣</span>
              <h3>Current Task</h3>
            </div>
            <p className="tool-execution-state">{currentTaskState}</p>
            <p className="tool-execution-detail">{currentTaskDetail}</p>
            {requestPending && <button className="activity-cancel" type="button" onClick={() => void cancel()}>Stop task</button>}
          </section>
          <div className="privacy-card">
            <span className="privacy-icon" aria-hidden="true">⌂</span>
            <div>
              <h3>Local-first</h3>
              <p>{provider?.provider === 'ollama'
                  ? 'Ollama is configured on this device. Connection checks are user-triggered and stay on this Mac.'
                : 'No cloud provider is used by this placeholder.'}</p>
            </div>
          </div>
          <div className="voice-status-card" aria-label="Voice status">
            <span aria-hidden="true">♩</span>
            <div>
              <strong>{voiceStarting ? 'Starting local voice' : voiceListening ? 'Listening for your message' : speechSetup?.modelReady ? 'Offline voice ready' : 'Voice setup required'}</strong>
              <small>{voiceListening ? 'Microphone active · Listening Off disables it' : speechSetup?.runtimeAvailable === false ? 'Install whisper.cpp to enable local recognition' : speechSetup?.modelReady ? 'Local multilingual model · on-device audio' : 'Download the offline model in Settings'}</small>
              {voiceTranscript && <small className="voice-live-transcript" aria-live="polite">Heard: {voiceTranscript}</small>}
            </div>
          </div>
          <p className="planned-note">Speech recognition stays on this Mac. Sensitive project edits still require your review and approval.</p>
        </aside>
        )}
      </div>
    </main>
  );
}

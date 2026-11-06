import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type {
  DesktopActionProposal,
  DesktopProviderStatus,
  DesktopFileOperationProposal,
  DesktopSpeechSetupStatus,
  DesktopSessionHistory,
  DesktopSessionSummary,
  DesktopPlan,
  DesktopToolActivity,
} from '../../../desktop/contracts.ts';
import { activityIcon, activityLabel } from './activity.ts';
import { ActionApprovalCard, FileOperationCard } from './approvals.tsx';
import { VoiceOrb, VyomaraMark } from './brand.tsx';
import { MessageContent } from './markdown.tsx';
import { ModelsPanel } from './models-panel.tsx';
import { appendVoiceDraft, resolveVoiceTranscriptAction } from './voice-dictation.ts';
import vyomaraWordmark from './assets/vyomara-wordmark.png';

interface ChatMessage {
  readonly id: number | string;
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly failed?: boolean;
}

export function App() {
  const [provider, setProvider] = useState<DesktopProviderStatus>();
  const [providerError, setProviderError] = useState<string>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [fileOperationProposals, setFileOperationProposals] = useState<DesktopFileOperationProposal[]>([]);
  const [actionProposals, setActionProposals] = useState<DesktopActionProposal[]>([]);
  const [toolActivities, setToolActivities] = useState<DesktopToolActivity[]>([]);
  const [plan, setPlan] = useState<DesktopPlan['steps']>([]);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [fileOperationConfirmations, setFileOperationConfirmations] = useState<Record<string, string>>({});
  const [fileOperationActionPending, setFileOperationActionPending] = useState<string>();
  const [actionPendingId, setActionPendingId] = useState<string>();
  const [activity, setActivity] = useState<string[]>([]);
  const [sessionId, setSessionId] = useState<string>();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sessions, setSessions] = useState<readonly DesktopSessionSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string>();
  const [selectedHistorySession, setSelectedHistorySession] = useState<DesktopSessionHistory>();
  const [historyDeleteConfirmation, setHistoryDeleteConfirmation] = useState('');
  const [historyNotice, setHistoryNotice] = useState<string>();
  const [prompt, setPrompt] = useState('');
  const [composerFocusRequest, setComposerFocusRequest] = useState(0);
  const [requestPending, setRequestPending] = useState(false);
  const [requestError, setRequestError] = useState<string>();
  const [speechSetup, setSpeechSetup] = useState<DesktopSpeechSetupStatus>();
  const [voiceListening, setVoiceListening] = useState(false);
  const [composerDictation, setComposerDictation] = useState(false);
  const [voiceStarting, setVoiceStarting] = useState(false);
  const [voiceDownloading, setVoiceDownloading] = useState(false);
  const [voiceDownloadProgress, setVoiceDownloadProgress] = useState<number>();
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [voiceError, setVoiceError] = useState<string>();
  const [speechError, setSpeechError] = useState<string>();
  const [orbRailGeometry, setOrbRailGeometry] = useState<{ readonly width: number; readonly center: number; readonly span: number }>();
  const queuedVoiceCommands = useRef<string[]>([]);
  const composerDictationRef = useRef(false);
  const composerDictationBase = useRef('');
  const currentRequestPending = useRef(requestPending);
  currentRequestPending.current = requestPending;
  const activeChatRequestId = useRef<string | undefined>(undefined);
  const submitVoicePrompt = useRef<((value: string, speakResponse?: boolean) => Promise<void>) | undefined>(undefined);
  const messageList = useRef<HTMLDivElement>(null);
  const promptInput = useRef<HTMLTextAreaElement>(null);
  const topbar = useRef<HTMLElement>(null);
  const conversation = useRef<HTMLElement>(null);
  const orbitalHeaderRails = useRef<SVGSVGElement>(null);
  const shouldRestoreComposerFocus = useRef(false);
  const historyTrigger = useRef<HTMLButtonElement>(null);
  const activityHeading = useRef<HTMLHeadingElement>(null);
  const historyHeading = useRef<HTMLHeadingElement>(null);
  const fileOperationReview = useRef<HTMLElement>(null);
  const actionReview = useRef<HTMLElement>(null);
  const modelsTrigger = useRef<HTMLButtonElement>(null);
  const modelsHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let mounted = true;
    void window.vyomara.getProviderStatus().then(status => {
      if (mounted) setProvider(status);
    }).catch(() => {
      if (mounted) setProviderError('Assistant configuration could not be loaded.');
    });
    const unsubscribe = window.vyomara.onActivity(event => {
      const label = activityLabel(event);
      if (label) setActivity(current => [...current, label].slice(-12));
    });
    const unsubscribeFileOperations = window.vyomara.onFileOperationProposal(proposal => {
      setFileOperationProposals(current =>
        current.some(item => item.id === proposal.id) ? current : [...current, proposal]);
      requestAnimationFrame(() => fileOperationReview.current?.scrollIntoView({ block: 'nearest' }));
    });
    const unsubscribeActions = window.vyomara.onActionProposal(proposal => {
      setActionProposals(current =>
        current.some(item => item.id === proposal.id) ? current : [...current, proposal]);
      requestAnimationFrame(() => actionReview.current?.scrollIntoView({ block: 'nearest' }));
    });
    const unsubscribePlan = window.vyomara.onPlan(update => {
      if (activeChatRequestId.current === update.requestId) setPlan(update.steps);
    });
    const unsubscribeToolActivity = window.vyomara.onToolActivity(activity => {
      if (activity.toolId === 'update_plan') return;
      if (activeChatRequestId.current !== activity.requestId) return;
      setToolActivities(current => {
        const index = current.findIndex(item => item.id === activity.id);
        if (index === -1) return [...current, activity].slice(-60);
        const next = [...current];
        next[index] = activity;
        return next;
      });
    });
    const unsubscribeSpeech = window.vyomara.onSpeechRecognition(event => {
      if (event.type === 'partial') {
        setVoiceTranscript(event.transcript);
        const action = resolveVoiceTranscriptAction('partial', composerDictationRef.current, event.transcript);
        if (action.type === 'draft') setPrompt(appendVoiceDraft(composerDictationBase.current, action.transcript));
      }
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
        composerDictationRef.current = false;
        setComposerDictation(false);
      }
      if (event.type === 'error') {
        setVoiceStarting(false);
        setVoiceListening(false);
        setVoiceDownloading(false);
        composerDictationRef.current = false;
        setComposerDictation(false);
        setVoiceError(event.message);
      }
      if (event.type === 'command') {
        setVoiceTranscript(event.transcript);
        const action = resolveVoiceTranscriptAction('command', composerDictationRef.current, event.transcript);
        if (action.type === 'draft') {
          composerDictationBase.current = appendVoiceDraft(composerDictationBase.current, action.transcript);
          setPrompt(composerDictationBase.current);
        } else if (currentRequestPending.current) {
          queuedVoiceCommands.current.push(event.transcript);
        } else if (action.type === 'submit') void submitVoicePrompt.current?.(action.transcript, true);
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
      unsubscribeFileOperations();
      unsubscribeActions();
      unsubscribeToolActivity();
      unsubscribePlan();
      unsubscribeSpeech();
    };
  }, []);

  useEffect(() => {
    const list = messageList.current;
    if (!list) return;
    list.scrollTo({
      top: list.scrollHeight,
      behavior: requestPending || window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
    });
  }, [messages, requestPending]);

  useEffect(() => window.vyomara.onChatText(({ requestId, text }) => {
    if (activeChatRequestId.current !== requestId) return;
    setMessages(current => {
      const existing = current.some(message => message.id === requestId);
      return existing
        ? current.map(message => message.id === requestId
          ? { ...message, content: message.content + text }
          : message)
        : [...current, { id: requestId, role: 'assistant', content: text }];
    });
  }), []);

  useEffect(() => {
    if (messages.length === 0) {
      setOrbRailGeometry(undefined);
      return;
    }

    const header = topbar.current;
    const conversationSection = conversation.current;
    const rails = orbitalHeaderRails.current;
    if (!header || !conversationSection || !rails) return;

    let frame = 0;
    const updateGeometry = (): void => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const bounds = rails.getBoundingClientRect();
        const conversationBounds = conversationSection.getBoundingClientRect();
        const width = bounds.width;
        const center = conversationBounds.left + conversationBounds.width / 2 - bounds.left;
        const span = Math.min(108, center - 8, width - center - 8);
        if (width <= 0 || span <= 0) return;

        const next = {
          width: Math.round(width * 100) / 100,
          center: Math.round(center * 100) / 100,
          span: Math.round(span * 100) / 100,
        };
        setOrbRailGeometry(current =>
          current?.width === next.width && current.center === next.center && current.span === next.span
            ? current
            : next,
        );
      });
    };

    const observer = new ResizeObserver(updateGeometry);
    observer.observe(header);
    observer.observe(conversationSection);
    window.addEventListener('resize', updateGeometry);
    updateGeometry();
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', updateGeometry);
    };
  }, [messages.length]);

  useEffect(() => {
    if (
      requestPending ||
      queuedVoiceCommands.current.length === 0
    ) return;
    const transcript = queuedVoiceCommands.current.shift();
    if (!transcript) return;
    void submitPrompt(transcript, true);
  }, [requestPending]);

  useEffect(() => {
    const input = promptInput.current;
    if (!input) return;
    const maxHeight = Math.round(window.innerHeight * 0.28);
    input.style.height = '36px';
    const contentHeight = input.scrollHeight;
    input.style.height = `${Math.min(Math.max(contentHeight, 36), maxHeight)}px`;
    input.style.overflowY = contentHeight > maxHeight ? 'auto' : 'hidden';
  }, [prompt]);

  useEffect(() => {
    if (requestPending || !shouldRestoreComposerFocus.current) return;
    shouldRestoreComposerFocus.current = false;
    promptInput.current?.focus();
  }, [composerFocusRequest, requestPending]);

  useEffect(() => {
    if (historyOpen) historyHeading.current?.focus();
  }, [historyOpen]);

  useEffect(() => {
    if (modelsOpen) modelsHeading.current?.focus();
  }, [modelsOpen]);

  useEffect(() => {
    function handleEscape(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      if (historyOpen) {
        setHistoryOpen(false);
        historyTrigger.current?.focus();
      }
      if (modelsOpen) {
        setModelsOpen(false);
        modelsTrigger.current?.focus();
      }
    }

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [historyOpen, modelsOpen]);

  async function submitPrompt(value: string, speakResponse = false): Promise<void> {
    const trimmed = value.trim();
    if (!trimmed || requestPending) return;
    setPrompt('');
    setRequestError(undefined);
    setMessages(current => [...current, {
      id: Date.now(),
      role: 'user',
      content: trimmed,
    }]);

    setRequestPending(true);
    setToolActivities([]);
    setPlan([]);
    const requestId = crypto.randomUUID();
    activeChatRequestId.current = requestId;
    try {
      const result = await window.vyomara.sendMessage({
        prompt: trimmed,
        requestId,
        ...(sessionId ? { sessionId } : {}),
      });
      setSessionId(result.sessionId);
      setMessages(current => current.some(message => message.id === requestId)
        ? current.map(message => message.id === requestId
          ? { ...message, content: result.response }
          : message)
        : [...current, {
          id: requestId,
          role: 'assistant',
          content: result.response,
        }]);
      if (speakResponse) {
        void window.vyomara.speakText(result.response).catch(error => {
          setSpeechError(error instanceof Error ? error.message : 'Local speech output failed.');
        });
      }
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : 'Request failed safely. No success is implied.';
      setRequestError(message);
      setMessages(current => current.some(item => item.id === requestId)
        ? current.map(item => item.id === requestId
          ? { ...item, content: message, failed: true }
          : item)
        : [...current, {
          id: requestId,
          role: 'assistant',
          content: message,
          failed: true,
        }]);
      setFileOperationProposals([]);
      setFileOperationConfirmations({});
    } finally {
      if (activeChatRequestId.current === requestId) activeChatRequestId.current = undefined;
      setActionProposals([]);
      setActionPendingId(undefined);
      setRequestPending(false);
    }

  }

  submitVoicePrompt.current = submitPrompt;

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (composerDictationRef.current) return;
    const trimmed = prompt.trim();
    const restoreFocus = Boolean(trimmed);
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
      if (composerDictationRef.current) {
        composerDictationRef.current = false;
        setComposerDictation(false);
      }
      setVoiceError(error instanceof Error ? error.message : 'The offline speech model could not be installed.');
    }
  }

  async function toggleVoiceListening(): Promise<void> {
    if (!speechSetup || voiceStarting) return;
    setVoiceError(undefined);
    setVoiceTranscript('');
    if (!voiceListening && !speechSetup.modelReady) return;
    setVoiceStarting(true);
    try {
      const status = await window.vyomara.setSpeechListening(!voiceListening);
      setSpeechSetup(status);
      if (!status.listeningEnabled) {
        setVoiceStarting(false);
        setVoiceListening(false);
      }
    } catch (error) {
      setVoiceStarting(false);
      if (composerDictationRef.current) {
        composerDictationRef.current = false;
        setComposerDictation(false);
      }
      setVoiceError(error instanceof Error ? error.message : 'Voice listening could not be changed.');
    }
  }

  function toggleComposerDictation(): void {
    if (composerDictation) {
      void toggleVoiceListening();
      return;
    }
    composerDictationBase.current = prompt.trimEnd();
    composerDictationRef.current = true;
    setComposerDictation(true);
    if (speechSetup?.modelReady) void toggleVoiceListening();
    else void downloadVoiceModel();
  }

  async function cancel(): Promise<void> {
    await window.vyomara.cancelRequest();
  }

  function closePanel(): void {
    setHistoryOpen(false);
    historyTrigger.current?.focus();
  }

  function startNewChat(): void {
    if (requestPending) return;
    setSessionId(undefined);
    setMessages([]);
    setPrompt('');
    setActivity([]);
    setRequestError(undefined);
    setFileOperationProposals([]);
    setActionProposals([]);
    setToolActivities([]);
    setPlan([]);
    setFileOperationConfirmations({});
    setActionPendingId(undefined);
    setHistoryOpen(false);
    setSelectedHistorySession(undefined);
    setHistoryDeleteConfirmation('');
  }

  async function approveFileOperation(proposal: DesktopFileOperationProposal): Promise<void> {
    if (
      fileOperationActionPending ||
      (proposal.operation === 'delete' && fileOperationConfirmations[proposal.id] !== 'DELETE')
    ) return;
    setFileOperationActionPending(proposal.id);
    setRequestError(undefined);
    try {
      await window.vyomara.approveFileOperation(
        proposal.id,
        proposal.operation === 'delete' ? fileOperationConfirmations[proposal.id] : undefined,
      );
      setFileOperationProposals(current => current.filter(item => item.id !== proposal.id));
      setFileOperationConfirmations(current => {
        const next = { ...current };
        delete next[proposal.id];
        return next;
      });
    } catch (error) {
      setFileOperationProposals(current => current.filter(item => item.id !== proposal.id));
      setRequestError(error instanceof Error ? error.message : 'The reviewed file operation failed safely.');
    } finally {
      setFileOperationActionPending(undefined);
    }
  }

  async function rejectFileOperation(proposal: DesktopFileOperationProposal): Promise<void> {
    if (fileOperationActionPending) return;
    setFileOperationActionPending(proposal.id);
    try {
      await window.vyomara.rejectFileOperation(proposal.id);
      setFileOperationProposals(current => current.filter(item => item.id !== proposal.id));
      setFileOperationConfirmations(current => {
        const next = { ...current };
        delete next[proposal.id];
        return next;
      });
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : 'The file review could not be dismissed.');
    } finally {
      setFileOperationActionPending(undefined);
    }
  }

  async function decideAction(proposal: DesktopActionProposal, approve: boolean, always = false): Promise<void> {
    if (actionPendingId) return;
    setActionPendingId(proposal.id);
    setRequestError(undefined);
    try {
      if (approve) await window.vyomara.approveAction(proposal.id, always);
      else await window.vyomara.rejectAction(proposal.id);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : 'The approval could not be recorded.');
    } finally {
      setActionProposals(current => current.filter(item => item.id !== proposal.id));
      setActionPendingId(undefined);
    }
  }

  async function toggleModels(): Promise<void> {
    if (modelsOpen) {
      setModelsOpen(false);
      return;
    }
    setHistoryOpen(false);
    setModelsOpen(true);
  }

  async function toggleHistory(): Promise<void> {
    if (historyOpen) {
      setHistoryOpen(false);
      return;
    }

    setModelsOpen(false);
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

  const providerTitle = provider
    ? provider.provider === 'ollama'
      ? `Local Ollama · ${provider.model}`
      : 'Deterministic placeholder'
    : 'Loading provider…';
  const taskIsRunning = requestPending;
  const runningActivity = [...toolActivities].reverse().find(item => item.status === 'running');
  const currentTaskState = requestPending
    ? actionProposals.length + fileOperationProposals.length > 0
      ? 'Waiting for your approval'
      : runningActivity?.label ?? 'Thinking…'
    : 'No task running';
  const currentTaskDetail = taskIsRunning
    ? `${toolActivities.length} step${toolActivities.length === 1 ? '' : 's'} so far. Stop cancels the task safely.`
    : 'When a task starts, every step it takes appears here.';
  const pendingApprovals = fileOperationProposals.length + actionProposals.length;
  const voiceOrbAction = speechSetup?.modelReady ? toggleVoiceListening : downloadVoiceModel;
  const voiceOrbLabel = voiceListening
    ? 'Turn voice listening off'
    : speechSetup?.modelReady
      ? 'Start offline voice listening'
      : 'Download offline voice model and start listening';
  const voiceOrbDisabled = !speechSetup?.runtimeAvailable || voiceStarting || voiceDownloading;
  const voiceOrbTitle = speechSetup?.runtimeAvailable === false
    ? 'Install whisper.cpp to enable offline voice'
    : voiceOrbLabel;

  return (
    <main className={`app-shell${messages.length > 0 ? ' app-shell-chat-active' : ' app-shell-welcome'}`}>
      <header className="topbar" ref={topbar}>
        <a className="brand topbar-brand" href="#" aria-label="Vyomara home">
          <span className="brand-mark"><VyomaraMark /></span>
          <span className="topbar-brand-copy">
            <img className="topbar-wordmark" src={vyomaraWordmark} alt="Vyomara" />
            <small>AI Twins. One Orbit. Your Control.</small>
          </span>
        </a>
        {messages.length > 0 && (
          <svg
            ref={orbitalHeaderRails}
            className={`orbital-header-rails${orbRailGeometry ? '' : ' orbital-header-rails-pending'}`}
            viewBox={`0 0 ${orbRailGeometry?.width ?? 1000} 40`}
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="orbital-header-gradient">
                <stop offset="0%" stopColor="#278bff" stopOpacity=".78" />
                <stop offset="50%" stopColor="#6476ff" stopOpacity=".52" />
                <stop offset="100%" stopColor="#b84aff" stopOpacity=".78" />
              </linearGradient>
            </defs>
            {orbRailGeometry && (
              <path
                className="orbital-header-rail"
                d={`M0 5 H${orbRailGeometry.center - orbRailGeometry.span} C${orbRailGeometry.center - orbRailGeometry.span / 2} 5 ${orbRailGeometry.center - orbRailGeometry.span / 2} 32 ${orbRailGeometry.center} 32 C${orbRailGeometry.center + orbRailGeometry.span / 2} 32 ${orbRailGeometry.center + orbRailGeometry.span / 2} 5 ${orbRailGeometry.center + orbRailGeometry.span} 5 H${orbRailGeometry.width}`}
              />
            )}
          </svg>
        )}
        {messages.length > 0 && (
          <div className="topbar-orbit">
            <VoiceOrb
              listening={voiceListening}
              pressed={voiceListening || voiceStarting}
              disabled={voiceOrbDisabled}
              label={voiceOrbLabel}
              title={voiceOrbTitle}
              compact
              onActivate={() => void voiceOrbAction()}
            />
          </div>
        )}
        <button
          ref={modelsTrigger}
          className="provider-status provider-status-button"
          type="button"
          title="Choose the local model"
          onClick={() => void toggleModels()}
          disabled={requestPending}
          aria-expanded={modelsOpen}
          aria-controls={modelsOpen ? 'models-panel' : undefined}
        >
          <span className={`status-dot ${providerError ? 'status-dot-error' : ''}`} />
          <span>{providerError ?? providerTitle}</span>
          <span aria-hidden="true">▾</span>
        </button>
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
            <button
              className={`side-nav-item${pendingApprovals > 0 ? ' side-nav-item-review' : ''}`}
              type="button"
              onClick={() => {
                const review = fileOperationProposals.length > 0
                  ? fileOperationReview.current
                  : actionReview.current;
                review?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }}
              disabled={pendingApprovals === 0}
              aria-label={pendingApprovals > 0
                ? `Review ${pendingApprovals} pending approval${pendingApprovals === 1 ? '' : 's'}`
                : 'No pending approvals'}
            >
              <span aria-hidden="true">◇</span> Approvals
              {pendingApprovals > 0 &&
                <span className="nav-indicator" aria-label={`${pendingApprovals} pending`}>●</span>}
            </button>
          </div>
          <div className="side-nav-group">
            <p className="side-nav-label">YOUR DATA</p>
            <button
              className="side-nav-item"
              type="button"
              onClick={() => void toggleModels()}
              disabled={requestPending}
              aria-expanded={modelsOpen}
            >
              <span aria-hidden="true">◎</span> Models
            </button>
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
          </div>
          <button className="new-chat-button side-nav-new-chat" type="button" onClick={startNewChat} disabled={requestPending}>
            <span aria-hidden="true">＋</span> New conversation
          </button>
        </nav>

        <section className="conversation" aria-label="Conversation" ref={conversation}>
          <div className="message-list" ref={messageList} aria-live="polite">
            <div className="message-list-content">
            {messages.length === 0 ? (
              <div className="welcome-card" aria-label="Vyomara voice orb">
                <div className="welcome-intro">
                  <p className="welcome-kicker">YOUR PERSONAL AI ASSISTANT</p>
                  <h2>Tell Vyom what you need.</h2>
                  <p className="welcome-copy">
                    Ask a question, plan your next move, or get help with a task—by voice or text. Vyom keeps you in control and shows its work.
                  </p>
                  <p className="welcome-brand-line">AI Twins. One Orbit. Your Control.</p>
                </div>
                <VoiceOrb
                  listening={voiceListening}
                  pressed={voiceListening || voiceStarting}
                  disabled={voiceOrbDisabled}
                  label={voiceOrbLabel}
                  title={voiceOrbTitle}
                  onActivate={() => void voiceOrbAction()}
                />
                <p
                  className={`${voiceError || voiceDownloading || voiceStarting || voiceListening ? '' : 'visually-hidden '}voice-orbit-status${voiceError ? ' voice-orbit-error' : ''}`}
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
                            ? 'Offline voice unavailable—type below.'
                            : ''}
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
                  {message.role === 'assistant' && !message.failed
                    ? <MessageContent text={message.content} />
                    : <p className="message-text">{message.content}</p>}
                </div>
              </article>
            ))}
            {requestPending && (
              <div className="pending-state" role="status" aria-live="polite">
                <span className="thinking-indicator" aria-hidden="true"><i /><i /><i /></span>
                <span>{pendingApprovals > 0
                  ? 'Waiting for your approval…'
                  : runningActivity ? `${runningActivity.label}…` : 'Vyom is thinking…'}</span>
                <button type="button" onClick={() => void cancel()}>Stop</button>
              </div>
            )}
            {fileOperationProposals.map((proposal, index) => (
              <FileOperationCard
                key={proposal.id}
                proposal={proposal}
                confirmation={fileOperationConfirmations[proposal.id] ?? ''}
                busy={fileOperationActionPending === proposal.id}
                anyBusy={fileOperationActionPending !== undefined}
                cardRef={index === 0 ? fileOperationReview : undefined}
                onConfirmationChange={value => setFileOperationConfirmations(current => ({ ...current, [proposal.id]: value }))}
                onApprove={() => void approveFileOperation(proposal)}
                onReject={() => void rejectFileOperation(proposal)}
              />
            ))}
            {actionProposals.map((proposal, index) => (
              <ActionApprovalCard
                key={proposal.id}
                proposal={proposal}
                busy={actionPendingId !== undefined}
                cardRef={index === 0 ? actionReview : undefined}
                onDecide={(approve, always) => void decideAction(proposal, approve, always)}
              />
            ))}
            </div>
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
              rows={1}
              maxLength={32000}
              disabled={requestPending}
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  if (composerDictationRef.current) {
                    toggleComposerDictation();
                    return;
                  }
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <div className="composer-footer">
              <div className="composer-actions">
                {prompt.trim() && !composerDictation ? (
                  <button
                    className="send-button"
                    type="submit"
                    disabled={requestPending}
                    aria-label="Send message"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 19V5m-7 7 7-7 7 7" />
                    </svg>
                  </button>
                ) : (
                  <button
                    className={`voice-input-button${voiceListening ? ' voice-input-active' : ''}${composerDictation ? ' voice-input-dictating' : ''}`}
                    type="button"
                    onClick={toggleComposerDictation}
                    disabled={
                      !speechSetup?.runtimeAvailable ||
                      voiceStarting ||
                      voiceDownloading ||
                      requestPending
                    }
                    aria-label={
                      composerDictation
                        ? voiceListening
                          ? 'Stop voice dictation'
                          : voiceDownloading
                            ? 'Preparing voice dictation'
                            : 'Starting voice dictation'
                        : voiceListening
                          ? 'Turn voice listening off'
                          : speechSetup?.modelReady
                            ? 'Start voice dictation'
                            : 'Download offline voice model and start dictation'
                    }
                    aria-pressed={voiceListening || voiceStarting}
                    title={
                      speechSetup?.runtimeAvailable === false
                        ? 'Install whisper.cpp to enable offline voice input'
                        : composerDictation
                          ? 'Stop dictation and review the transcript before sending'
                          : voiceListening
                            ? 'Listening · click to turn off'
                            : speechSetup?.modelReady
                              ? 'Start dictation into the message box'
                              : 'Download the offline voice model and start dictation'
                    }
                  >
                    {composerDictation && voiceListening ? (
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <rect x="8" y="8" width="8" height="8" rx="1.5" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <rect x="9" y="2.5" width="6" height="12" rx="3" />
                        <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3.5M9 21.5h6" />
                      </svg>
                    )}
                  </button>
                )}
              </div>
            </div>
            {(voiceError || voiceDownloading || voiceStarting || voiceListening) && (
              <p className={`composer-voice-status${voiceError ? ' composer-voice-error' : ''}${(messages.length === 0 || (composerDictation && voiceListening)) && !voiceError ? ' visually-hidden' : ''}`} role={voiceError ? 'alert' : 'status'}>
                {voiceError
                  ? voiceError
                  : voiceDownloading
                    ? `Downloading offline voice model… ${voiceDownloadProgress ?? 0}%`
                    : voiceStarting
                      ? 'Starting local microphone…'
                      : voiceListening
                        ? composerDictation ? 'Listening for a draft…' : voiceTranscript || 'Listening—speak your message.'
                        : ''}
              </p>
            )}
          </form>
          <p className={`privacy-note${messages.length === 0 && !requestError && !speechError ? ' visually-hidden' : ''}`} role={requestError || speechError ? 'alert' : 'status'}>
            {requestError
              ? requestError
              : speechError ?? 'Your conversation is stored locally on this Mac. Speech output uses the on-device macOS voice.'}
          </p>
        </section>

        {modelsOpen ? (
          <ModelsPanel
            headingRef={modelsHeading}
            disabled={requestPending}
            onSelected={setProvider}
            onClose={() => { setModelsOpen(false); modelsTrigger.current?.focus(); }}
          />
        ) : historyOpen ? (
        <aside id="history-panel" className="activity-panel history-panel" aria-label="Saved conversations">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">ON THIS MAC</p>
              <h2 ref={historyHeading} tabIndex={-1}>History</h2>
            </div>
            <button className="history-close" type="button" onClick={() => closePanel()}>
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
            {selectedHistorySession && (
              <section className="session-review" aria-label="Review saved conversation">
                <p className="history-review-title">Review conversation</p>
                <ol className="session-review-messages">
                  {selectedHistorySession.messages.length === 0 ? (
                    <li>No user or assistant messages are available to review.</li>
                  ) : selectedHistorySession.messages.map((message, index) => (
                    <li key={`${index}-${message.role}`}>
                      <strong>{message.role === 'user' ? 'You' : 'Vyom'}</strong>
                      <pre className="history-reviewed-message">{message.content}</pre>
                    </li>
                  ))}
                </ol>
                <p className="history-privacy">
                  Export includes all stored messages, including raw tool calls and results that may contain private file content.
                  The JSON export is not encrypted; Vyomara will create a new file with owner-only permissions and will not overwrite an existing file.
                </p>
                <button
                  className="history-action"
                  type="button"
                  onClick={() => void exportReviewedSession()}
                  disabled={historyLoading || requestPending}
                >
                  {historyLoading ? 'Preparing export…' : 'Export complete conversation as JSON'}
                </button>
                <label className="history-confirm-label" htmlFor="history-delete-confirm">
                  Type DELETE to permanently remove this conversation
                </label>
                <input
                  id="history-delete-confirm"
                  className="history-confirm-input"
                  value={historyDeleteConfirmation}
                  onChange={event => setHistoryDeleteConfirmation(event.target.value)}
                  autoComplete="off"
                  disabled={historyLoading || requestPending}
                />
                <button
                  className="history-danger"
                  type="button"
                  onClick={() => void deleteReviewedSession()}
                  disabled={historyDeleteConfirmation !== 'DELETE' || historyLoading || requestPending}
                >
                  Delete this conversation
                </button>
              </section>
            )}
            {historyNotice && <p className="history-notice" role="status">{historyNotice}</p>}
          </div>
          <p className="history-privacy">
            Saved locally until deleted. Review shows user and final assistant messages; raw tool calls and results are also stored and removed with the session.
          </p>
        </aside>
        ) : (
        <aside className="activity-panel" aria-label="Task activity">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">TASK STATUS</p>
              <h2 ref={activityHeading} tabIndex={-1}>Recent Activity</h2>
            </div>
            <span className={`activity-state${taskIsRunning ? ' activity-running' : ''}`}>
              {taskIsRunning ? 'Working' : 'Ready'}
            </span>
          </div>
          {plan.length > 0 && (
            <section className="plan-card" aria-label="Vyom's plan">
              <h3>Plan · {plan.filter(step => step.status === 'done').length}/{plan.length}</h3>
              <ol className="plan-list">
                {plan.map((step, index) => (
                  <li key={`${index}-${step.text}`} className={`plan-step plan-step-${step.status}`}>
                    <span aria-hidden="true">{step.status === 'done' ? '✓' : step.status === 'in_progress' ? '▸' : '○'}</span>
                    <span>{step.text}<span className="visually-hidden"> ({step.status.replace('_', ' ')})</span></span>
                  </li>
                ))}
              </ol>
            </section>
          )}
          <div className="activity-content" aria-live="polite">
            {activity.length === 0 && toolActivities.length === 0 ? (
              <div className="activity-empty">
                <span aria-hidden="true">◷</span>
                <p>Every step Vyom takes appears here while it works.</p>
              </div>
            ) : (
              <ol className="activity-list">
                {toolActivities.map(item => (
                  <li key={item.id} className={`tool-activity tool-activity-${item.status}`}>
                    <span className="activity-check" aria-hidden="true">{activityIcon(item.status)}</span>
                    <span>
                      {item.label}
                      {item.detail && item.status !== 'done' && <small>{item.detail}</small>}
                    </span>
                  </li>
                ))}
                {activity.slice(-4).map((item, index) => (
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
                  ? 'Ollama is configured on this device. Requests stay on this Mac.'
                : 'No cloud provider is used by this placeholder.'}</p>
            </div>
          </div>
          <div className="voice-status-card" aria-label="Voice status">
            <span aria-hidden="true">♩</span>
            <div>
              <strong>{voiceStarting ? 'Starting local voice' : voiceListening ? 'Listening for your message' : speechSetup?.modelReady ? 'Offline voice ready' : 'Voice setup required'}</strong>
              <small>{voiceListening ? 'Microphone active · Listening Off disables it' : speechSetup?.runtimeAvailable === false ? 'Install whisper.cpp to enable local recognition' : speechSetup?.modelReady ? 'Local multilingual model · on-device audio' : 'Select the voice orb to download the local model'}</small>
              {voiceTranscript && <small className="voice-live-transcript" aria-live="polite">Heard: {voiceTranscript}</small>}
            </div>
          </div>
          <p className="planned-note">Speech recognition stays on this Mac.</p>
        </aside>
        )}
      </div>
    </main>
  );
}

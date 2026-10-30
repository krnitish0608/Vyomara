import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { DiagnosticEvent } from '../../../diagnostics/logger.ts';
import type {
  DesktopProviderConnectionResult,
  DesktopProviderModelCheckResult,
  DesktopProviderSettings,
  DesktopProviderStatus,
  DesktopSessionHistory,
  DesktopMemorySummary,
  DesktopSessionSummary,
} from '../../../desktop/contracts.ts';

interface ChatMessage {
  readonly id: number;
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly failed?: boolean;
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
  const [prompt, setPrompt] = useState('');
  const [requestPending, setRequestPending] = useState(false);
  const [requestError, setRequestError] = useState<string>();
  const endOfMessages = useRef<HTMLDivElement>(null);
  const settingsTrigger = useRef<HTMLButtonElement>(null);
  const historyTrigger = useRef<HTMLButtonElement>(null);
  const permissionsTrigger = useRef<HTMLButtonElement>(null);
  const memoryTrigger = useRef<HTMLButtonElement>(null);
  const settingsHeading = useRef<HTMLHeadingElement>(null);
  const historyHeading = useRef<HTMLHeadingElement>(null);
  const permissionsHeading = useRef<HTMLHeadingElement>(null);
  const memoryHeading = useRef<HTMLHeadingElement>(null);

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
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    endOfMessages.current?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      block: 'end',
    });
  }, [messages, requestPending]);

  useEffect(() => {
    if (settingsOpen) settingsHeading.current?.focus();
    else if (historyOpen) historyHeading.current?.focus();
    else if (permissionsOpen) permissionsHeading.current?.focus();
    else if (memoryOpen) memoryHeading.current?.focus();
  }, [historyOpen, memoryOpen, permissionsOpen, settingsOpen]);

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
      }
    }

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [historyOpen, memoryOpen, permissionsOpen, settingsOpen]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const value = prompt.trim();
    if (!value || requestPending) return;

    setPrompt('');
    setRequestError(undefined);
    setRequestPending(true);
    setMessages(current => [...current, {
      id: Date.now(),
      role: 'user',
      content: value,
    }]);

    try {
      const result = await window.vyomara.sendMessage({
        prompt: value,
        ...(sessionId ? { sessionId } : {}),
      });
      setSessionId(result.sessionId);
      setMessages(current => [...current, {
        id: Date.now() + 1,
        role: 'assistant',
        content: result.response,
      }]);
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

  async function cancel(): Promise<void> {
    await window.vyomara.cancelRequest();
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
    setProviderDraft(provider?.provider ?? 'ollama');
    setModelDraft(provider?.model ?? 'llama3.2');
    setSettingsError(undefined);
    setSettingsNotice(undefined);
    setModelCheck(undefined);
    setSettingsOpen(true);
  }

  function closePanel(panel: 'history' | 'memory' | 'permissions' | 'settings'): void {
    if (panel === 'settings') {
      setSettingsOpen(false);
      settingsTrigger.current?.focus();
    } else if (panel === 'history') {
      setHistoryOpen(false);
      historyTrigger.current?.focus();
    } else if (panel === 'permissions') {
      setPermissionsOpen(false);
      permissionsTrigger.current?.focus();
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
    if (requestPending) return;
    setSessionId(undefined);
    setMessages([]);
    setActivity([]);
    setRequestError(undefined);
    setHistoryOpen(false);
    setSettingsOpen(false);
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

  async function togglePermissions(): Promise<void> {
    if (permissionsOpen) {
      setPermissionsOpen(false);
      return;
    }

    setHistoryOpen(false);
    setMemoryOpen(false);
    setSettingsOpen(false);
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

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="Vyomara home">
          <span className="brand-mark" aria-hidden="true">V</span>
          <span>Vyomara</span>
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
        <button
          ref={settingsTrigger}
          className="new-chat-button"
          type="button"
          onClick={toggleSettings}
          disabled={requestPending}
          aria-expanded={settingsOpen}
          aria-controls={settingsOpen ? 'settings-panel' : undefined}
        >
          Settings
        </button>
        <button
          ref={historyTrigger}
          className="new-chat-button"
          type="button"
          onClick={() => void toggleHistory()}
          disabled={requestPending}
          aria-expanded={historyOpen}
          aria-controls={historyOpen ? 'history-panel' : undefined}
        >
          History
        </button>
        <button
          ref={permissionsTrigger}
          className="new-chat-button"
          type="button"
          onClick={() => void togglePermissions()}
          disabled={requestPending}
          aria-expanded={permissionsOpen}
          aria-controls={permissionsOpen ? 'permissions-panel' : undefined}
        >
          Folders
        </button>
        <button
          ref={memoryTrigger}
          className="new-chat-button"
          type="button"
          onClick={() => void toggleMemory()}
          disabled={requestPending}
          aria-expanded={memoryOpen}
          aria-controls={memoryOpen ? 'memory-panel' : undefined}
        >
          Memory
        </button>
        <button className="new-chat-button" type="button" onClick={startNewChat} disabled={requestPending}>
          <span aria-hidden="true">＋</span> New chat
        </button>
      </header>

      <div className="workspace">
        <section className="conversation" aria-label="Conversation">
          <div className="conversation-heading">
            <div>
              <p className="eyebrow">PERSONAL AI ASSISTANT</p>
              <h1>What can I help with?</h1>
              <p className="intro">Ask Vyom about your project or request a read-only workspace check.</p>
            </div>
            {sessionId && <span className="session-badge">Session saved locally</span>}
          </div>

          <div className="message-list" aria-live="polite">
            {messages.length === 0 ? (
              <div className="welcome-card">
                <div className="welcome-icon" aria-hidden="true">✦</div>
                <h2>Start with a question</h2>
                <p>Vyom can answer and use configured read-only filesystem tools. Unsupported actions stay unavailable.</p>
                <div className="suggestions" aria-label="Example prompts">
                  <button type="button" onClick={() => setPrompt('Explain what Vyomara can do.')}>
                    What can Vyom do?
                  </button>
                  <button type="button" onClick={() => setPrompt('Help me understand this project.')}>
                    Understand my project
                  </button>
                </div>
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
                  <p className="message-author">{message.role === 'user' ? 'You' : 'Vyom'}</p>
                  <p className="message-text">{message.content}</p>
                </div>
              </article>
            ))}
            {requestPending && (
              <div className="pending-state" role="status">
                <span className="thinking-indicator"><i /><i /><i /></span>
                <span>Vyom is working…</span>
                <button type="button" onClick={() => void cancel()}>Cancel</button>
              </div>
            )}
            <div ref={endOfMessages} />
          </div>

          <form className="composer" onSubmit={event => void submit(event)}>
            <label className="visually-hidden" htmlFor="prompt">Message Vyom</label>
            <textarea
              id="prompt"
              value={prompt}
              onChange={event => setPrompt(event.target.value)}
              placeholder="Message Vyom…"
              rows={2}
              maxLength={8000}
              disabled={requestPending}
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <div className="composer-footer">
              <span>Enter to send · Shift + Enter for a new line</span>
              <button
                className="send-button"
                type="submit"
                disabled={requestPending || prompt.trim() === ''}
                aria-label="Send message"
              >
                <span aria-hidden="true">↑</span>
              </button>
            </div>
          </form>
          <p className="privacy-note">
            {requestError ? 'Request failed; no success is implied.' : 'Your conversation is stored locally on this Mac.'}
          </p>
        </section>

        {memoryOpen ? (
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
              <h2 ref={permissionsHeading} tabIndex={-1}>Folders</h2>
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
              <p className="eyebrow">LIVE</p>
              <h2>Activity</h2>
            </div>
            <span className={requestPending ? 'activity-state activity-running' : 'activity-state'}>
              {requestPending ? 'Working' : 'Ready'}
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
          <div className="privacy-card">
            <span className="privacy-icon" aria-hidden="true">⌂</span>
            <div>
              <h3>Local-first</h3>
              <p>{provider?.provider === 'ollama'
                  ? 'Ollama is configured on this device. Connection checks are user-triggered and stay on this Mac.'
                : 'No cloud provider is used by this placeholder.'}</p>
            </div>
          </div>
          <p className="planned-note">Project, files, Git, web research, and voice views are planned and not available yet.</p>
        </aside>
        )}
      </div>
    </main>
  );
}

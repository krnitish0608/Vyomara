import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { DiagnosticEvent } from '../../../diagnostics/logger.ts';
import type {
  DesktopProviderConnectionResult,
  DesktopProviderStatus,
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
  const [connectionCheck, setConnectionCheck] = useState<'not-checked' | 'checking' | 'available' | 'unavailable'>('not-checked');
  const [connectionMessage, setConnectionMessage] = useState<string>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activity, setActivity] = useState<string[]>([]);
  const [sessionId, setSessionId] = useState<string>();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sessions, setSessions] = useState<readonly DesktopSessionSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string>();
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
    endOfMessages.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, requestPending]);

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

  function startNewChat(): void {
    if (requestPending) return;
    setSessionId(undefined);
    setMessages([]);
    setActivity([]);
    setRequestError(undefined);
    setHistoryOpen(false);
  }

  async function toggleHistory(): Promise<void> {
    if (historyOpen) {
      setHistoryOpen(false);
      return;
    }

    setPermissionsOpen(false);
    setMemoryOpen(false);
    setHistoryOpen(true);
    setHistoryLoading(true);
    setHistoryError(undefined);
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
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : 'The saved session could not be opened.');
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
        {provider?.provider === 'ollama' && (
          <button
            className="new-chat-button"
            type="button"
            onClick={() => void checkProviderConnection()}
            disabled={connectionCheck === 'checking' || requestPending}
          >
            {connectionCheck === 'checking' ? 'Checking…' : 'Check Ollama'}
          </button>
        )}
        <button
          className="new-chat-button"
          type="button"
          onClick={() => void toggleHistory()}
          disabled={requestPending}
          aria-expanded={historyOpen}
        >
          History
        </button>
        <button
          className="new-chat-button"
          type="button"
          onClick={() => void togglePermissions()}
          disabled={requestPending}
          aria-expanded={permissionsOpen}
        >
          Folders
        </button>
        <button
          className="new-chat-button"
          type="button"
          onClick={() => void toggleMemory()}
          disabled={requestPending}
          aria-expanded={memoryOpen}
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
        <aside className="activity-panel history-panel memory-panel" aria-label="Explicit memory">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">USER CONTROLLED</p>
              <h2>Memory</h2>
            </div>
            <button className="history-close" type="button" onClick={() => setMemoryOpen(false)}>
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
        <aside className="activity-panel history-panel" aria-label="Filesystem permissions">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">READ ONLY</p>
              <h2>Folders</h2>
            </div>
            <button className="history-close" type="button" onClick={() => setPermissionsOpen(false)}>
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
        <aside className="activity-panel history-panel" aria-label="Saved conversations">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">ON THIS MAC</p>
              <h2>History</h2>
            </div>
            <button className="history-close" type="button" onClick={() => setHistoryOpen(false)}>
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
                    <button
                      className={`history-item${session.id === sessionId ? ' history-item-current' : ''}`}
                      type="button"
                      onClick={() => void openSession(session.id)}
                      disabled={historyLoading}
                    >
                      <span>{new Date(session.updatedAt).toLocaleString()}</span>
                      <span>{session.messageCount} messages</span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </div>
          <p className="history-privacy">Saved locally. Tool results are not shown in this history view.</p>
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

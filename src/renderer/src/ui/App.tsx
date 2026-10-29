import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { DiagnosticEvent } from '../../../diagnostics/logger.ts';
import type {
  DesktopProviderConnectionResult,
  DesktopProviderStatus,
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

        {permissionsOpen ? (
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

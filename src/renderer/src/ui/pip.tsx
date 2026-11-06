import { useEffect, useRef, useState } from 'react';
import type { DesktopPipCommand, DesktopPipState } from '../../../desktop/contracts.ts';
import { VoiceOrb } from './brand.tsx';

function send(command: DesktopPipCommand): void {
  window.vyomara.sendPipCommand(command);
}

function MiniWave() {
  return (
    <span className="pip-wave" aria-hidden="true">
      {Array.from({ length: 5 }, (_, index) => <i key={index} />)}
    </span>
  );
}

/**
 * The mini controller shown over other apps (VS Code, Chrome, …): the live
 * orb, what Vyom heard or is doing, and the approval question with
 * Haan/Nahi. It holds no conversation state; the main window publishes it.
 */
export function PipView() {
  const [state, setState] = useState<DesktopPipState>();
  const [draft, setDraft] = useState('');
  /** Text typed before recording started; dictated words are added after it. */
  const draftBase = useRef('');
  const lastSeq = useRef(-1);

  useEffect(() => {
    document.body.classList.add('pip-body');
    return window.vyomara.onPipState(setState);
  }, []);

  useEffect(() => {
    const dictation = state?.dictation;
    if (!dictation || dictation.seq === lastSeq.current) return;
    lastSeq.current = dictation.seq;
    if (dictation.text) setDraft(`${draftBase.current}${draftBase.current && dictation.text ? ' ' : ''}${dictation.text}`);
  }, [state?.dictation]);

  const recording = state?.dictation.recording === true;

  function toggleRecording(): void {
    if (recording) {
      send({ type: 'dictation', recording: false });
    } else {
      draftBase.current = draft.trimEnd();
      send({ type: 'dictation', recording: true });
    }
  }

  function submit(): void {
    const text = draft.trim();
    if (!text || state?.busy) return;
    send({ type: 'submit', text });
    setDraft('');
    draftBase.current = '';
  }

  const approval = state?.approval;
  const listening = state?.listening === true;
  const detail = approval?.question ?? (state?.heard ? `“${state.heard}”` : state?.reply);
  const mood = approval ? 'approval' : state?.busy ? 'busy' : listening ? 'listening' : 'idle';

  return (
    <main className={`pip pip-${mood}`}>
      <div className="pip-orb-slot">
        <VoiceOrb
          mini
          listening={listening || state?.busy === true}
          pressed={listening}
          disabled={!state?.voiceReady}
          label={listening ? 'Turn listening off' : 'Turn listening on'}
          title={state?.voiceReady ? 'Listening on/off (⌥Space)' : 'Set up voice in the Vyomara window'}
          onActivate={() => send({ type: 'toggle-listening' })}
        />
      </div>
      <section className="pip-text" aria-live="polite">
        <p className="pip-status">
          {listening && !approval && !state?.busy && <MiniWave />}
          {state?.busy && !approval && <span className="pip-dots" aria-hidden="true"><i /><i /><i /></span>}
          <span className="pip-status-text">{state ? state.status : 'Connecting…'}</span>
          {state?.plan ? <span className="pip-plan">{state.plan.done}/{state.plan.total}</span> : null}
        </p>
        {detail && <p className="pip-detail">{detail}</p>}
        {state && !state.voiceReady && !approval && (
          <button type="button" className="pip-link" onClick={() => send({ type: 'open-main' })}>Set up voice →</button>
        )}
        {approval && (
          <div className="pip-actions">
            {approval.needsMainWindow ? (
              <button type="button" className="pip-yes" onClick={() => send({ type: 'open-main' })}>Review in Vyomara</button>
            ) : (
              <>
                <button type="button" className="pip-yes" onClick={() => send({ type: 'approve', id: approval.id })}>Haan</button>
                <button type="button" className="pip-no" onClick={() => send({ type: 'reject', id: approval.id })}>Nahi</button>
              </>
            )}
          </div>
        )}
        {!approval && state?.busy && (
          <div className="pip-actions">
            <button type="button" className="pip-no" onClick={() => send({ type: 'stop' })}>Stop</button>
          </div>
        )}
      </section>
      <form className="pip-composer" onSubmit={event => { event.preventDefault(); submit(); }}>
        <input
          className="pip-input"
          value={draft}
          onChange={event => setDraft(event.target.value)}
          placeholder={recording ? 'Listening… tap ■ to stop' : 'Type or tap the mic…'}
          maxLength={32000}
          aria-label="Message Vyom"
        />
        <button
          type="button"
          className={`pip-mic${recording ? ' pip-mic-recording' : ''}`}
          onClick={toggleRecording}
          disabled={!state?.voiceReady}
          aria-pressed={recording}
          aria-label={recording ? 'Stop recording' : 'Record a message'}
          title={recording ? 'Stop recording' : 'Record: tap to start, tap again to stop'}
        >
          {recording
            ? <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="8" height="8" rx="1.5" /></svg>
            : <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="2.5" width="6" height="12" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3.5" /></svg>}
        </button>
        <button type="submit" className="pip-send" disabled={!draft.trim() || state?.busy === true} aria-label="Send message">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5m-7 7 7-7 7 7" /></svg>
        </button>
      </form>
      <div className="pip-corner">
        <button type="button" onClick={() => send({ type: 'open-main' })} aria-label="Open Vyomara" title="Open Vyomara">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3h7v7M13 3 4 12" /></svg>
        </button>
        <button type="button" onClick={() => send({ type: 'hide-pip' })} aria-label="Hide mini window" title="Hide">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
        </button>
      </div>
    </main>
  );
}

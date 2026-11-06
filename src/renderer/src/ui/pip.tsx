import { useEffect, useState } from 'react';
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

  useEffect(() => {
    document.body.classList.add('pip-body');
    return window.vyomara.onPipState(setState);
  }, []);

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

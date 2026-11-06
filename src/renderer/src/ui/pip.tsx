import { useEffect, useState } from 'react';
import type { DesktopPipCommand, DesktopPipState } from '../../../desktop/contracts.ts';
import { VyomaraMark } from './brand.tsx';

function send(command: DesktopPipCommand): void {
  window.vyomara.sendPipCommand(command);
}

/**
 * The mini controller shown over other apps (VS Code, Chrome, …): voice
 * state, what Vyom is doing, and the approval question with Yes/No.
 * It holds no conversation state of its own; the main window publishes it.
 */
export function PipView() {
  const [state, setState] = useState<DesktopPipState>();

  useEffect(() => {
    document.body.classList.add('pip-body');
    return window.vyomara.onPipState(setState);
  }, []);

  const approval = state?.approval;
  const detail = approval?.question ?? (state?.heard ? `“${state.heard}”` : state?.reply);

  return (
    <main className={`pip${state?.listening ? ' pip-listening' : ''}${state?.busy ? ' pip-busy' : ''}${approval ? ' pip-approval' : ''}`}>
      <button
        className="pip-orb"
        type="button"
        onClick={() => send({ type: 'toggle-listening' })}
        disabled={!state?.voiceReady}
        aria-pressed={state?.listening === true}
        aria-label={state?.listening ? 'Turn listening off' : 'Turn listening on'}
        title={state?.voiceReady ? 'Listening on/off (⌥Space)' : 'Set up voice in the Vyomara window'}
      >
        <VyomaraMark tile={false} />
      </button>
      <section className="pip-text" aria-live="polite">
        <p className="pip-status">
          {state ? state.status : 'Connecting…'}
          {state?.plan ? <span className="pip-plan"> · {state.plan.done}/{state.plan.total}</span> : null}
        </p>
        {detail && <p className="pip-detail">{detail}</p>}
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
      <button className="pip-expand" type="button" onClick={() => send({ type: 'open-main' })} aria-label="Open Vyomara" title="Open Vyomara">↗</button>
    </main>
  );
}

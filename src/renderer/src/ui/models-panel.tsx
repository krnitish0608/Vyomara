import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import type {
  DesktopModelList,
  DesktopModelPullProgress,
  DesktopProviderStatus,
} from '../../../desktop/contracts.ts';

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return '';
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.round(bytes / 1e3)} KB`;
}

/** Lists installed Ollama models, switches the active one, and downloads new ones. */
export function ModelsPanel({
  headingRef,
  disabled,
  onSelected,
  onClose,
}: {
  readonly headingRef: RefObject<HTMLHeadingElement | null>;
  readonly disabled: boolean;
  readonly onSelected: (status: DesktopProviderStatus) => void;
  readonly onClose: () => void;
}) {
  const [modelList, setModelList] = useState<DesktopModelList>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [modelToPull, setModelToPull] = useState('');
  const [pull, setPull] = useState<DesktopModelPullProgress & { readonly done?: boolean }>();
  const pulling = pull !== undefined && pull.done !== true;

  async function refresh(): Promise<void> {
    setLoading(true);
    setError(undefined);
    try {
      setModelList(await window.vyomara.listModels());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Installed models could not be loaded.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    headingRef.current?.focus();
    void refresh();
    return window.vyomara.onModelPullProgress(progress => setPull(progress));
  }, []);

  async function choose(name: string): Promise<void> {
    setError(undefined);
    try {
      onSelected(await window.vyomara.selectModel(name));
      setModelList(current => current ? { ...current, current: name } : current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The model could not be selected.');
    }
  }

  async function download(): Promise<void> {
    const name = modelToPull.trim();
    if (!name || pulling) return;
    setError(undefined);
    setPull({ model: name, status: 'starting' });
    try {
      await window.vyomara.pullModel(name);
      setPull({ model: name, status: 'downloaded', done: true });
      setModelToPull('');
      await refresh();
    } catch (cause) {
      setPull(undefined);
      setError(cause instanceof Error ? cause.message : 'The model could not be downloaded.');
    }
  }

  return (
    <aside id="models-panel" className="activity-panel models-panel" aria-label="Local models">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">RUNS ON THIS MAC</p>
          <h2 ref={headingRef} tabIndex={-1}>Models</h2>
        </div>
        <button className="history-close" type="button" onClick={onClose}>Close</button>
      </div>
      <div className="history-content" aria-live="polite">
        {loading ? (
          <p className="history-message" role="status">Loading installed models…</p>
        ) : modelList && modelList.models.length > 0 ? (
          <ol className="history-list">
            {modelList.models.map(model => {
              const current = model.name === modelList.current || model.name === `${modelList.current}:latest`;
              return (
                <li key={model.name}>
                  <button
                    className={`history-item${current ? ' history-item-current' : ''}`}
                    type="button"
                    onClick={() => void choose(model.name)}
                    disabled={current || disabled}
                    aria-pressed={current}
                  >
                    <span>{model.name}{current ? ' · in use' : ''}</span>
                    <span>{[model.parameterSize, formatBytes(model.sizeBytes)].filter(Boolean).join(' · ')}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        ) : !error ? (
          <p className="history-message">No models are installed in Ollama yet.</p>
        ) : null}
        {error && <p className="history-message history-error" role="alert">{error}</p>}
        <form className="model-pull" onSubmit={event => { event.preventDefault(); void download(); }}>
          <label className="history-confirm-label" htmlFor="model-pull-name">Download another model</label>
          <input
            id="model-pull-name"
            className="history-confirm-input"
            value={modelToPull}
            onChange={event => setModelToPull(event.target.value)}
            placeholder="e.g. qwen2.5-coder:14b"
            autoComplete="off"
            disabled={pulling}
          />
          <button className="history-action" type="submit" disabled={!modelToPull.trim() || pulling}>
            {pulling ? 'Downloading…' : 'Download with Ollama'}
          </button>
          {pull && (
            <p className="history-notice" role="status">
              {pull.model}: {pull.status}
              {pull.total ? ` · ${Math.round(((pull.completed ?? 0) / pull.total) * 100)}%` : ''}
            </p>
          )}
        </form>
      </div>
      <p className="history-privacy">
        Models run locally in Ollama; downloads come from the Ollama library. For coding, larger models with tool support (qwen3, qwen2.5-coder) work best.
      </p>
    </aside>
  );
}

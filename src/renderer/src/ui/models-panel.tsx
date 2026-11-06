import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import type {
  DesktopModelInfo,
  DesktopModelList,
  DesktopModelPullProgress,
  DesktopProviderStatus,
} from '../../../desktop/contracts.ts';

const CONTEXT_OPTIONS = [4_096, 8_192, 16_384, 32_768, 65_536, 131_072, 262_144];

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return '';
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.round(bytes / 1e3)} KB`;
}

function formatTokens(tokens: number): string {
  return tokens >= 1_024 ? `${Math.round(tokens / 1_024)}K` : String(tokens);
}

function isCurrent(model: DesktopModelInfo, current: string): boolean {
  return model.name === current || model.name === `${current}:latest`;
}

function CapabilityBadges({ model }: { readonly model: DesktopModelInfo }) {
  const tools = model.capabilities.includes('tools');
  const known = model.capabilities.length > 0;
  return (
    <span className="model-badges">
      {known && !tools && <span className="model-badge model-badge-warn" title="Cannot read files, run commands, or open apps in Vyomara">Chat only</span>}
      {tools && <span className="model-badge" title="Can use Vyomara's coding and app tools">Tools</span>}
      {model.capabilities.includes('thinking') && <span className="model-badge">Thinking</span>}
      {model.capabilities.includes('vision') && <span className="model-badge">Vision</span>}
    </span>
  );
}

/**
 * Run any local Ollama model from the app: list installed models with their
 * capabilities, switch, tune context and thinking, download, and remove.
 */
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [modelToPull, setModelToPull] = useState('');
  const [pull, setPull] = useState<DesktopModelPullProgress & { readonly done?: boolean }>();
  const [removing, setRemoving] = useState<string>();
  const [removeConfirmation, setRemoveConfirmation] = useState('');
  const pulling = pull !== undefined && pull.done !== true;
  const locked = disabled || busy || pulling;

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

  async function act(work: () => Promise<void>, failure: string): Promise<void> {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : failure);
    } finally {
      setBusy(false);
    }
  }

  const choose = (model: DesktopModelInfo) => act(async () => {
    onSelected(await window.vyomara.selectModel(model.name));
    const limit = model.contextLength;
    if (limit !== undefined && modelList && modelList.settings.numCtx > limit) {
      onSelected(await window.vyomara.setModelSettings({ numCtx: limit }));
    }
    if (!model.capabilities.includes('tools') && model.capabilities.length > 0) {
      setNotice(`${model.name} is chat-only: it cannot read files, run commands, or open apps.`);
    }
    await refresh();
  }, 'The model could not be selected.');

  const updateSettings = (settings: { numCtx?: number; think?: boolean }) => act(async () => {
    onSelected(await window.vyomara.setModelSettings(settings));
    setModelList(current => current ? { ...current, settings: { ...current.settings, ...settings } } : current);
  }, 'The setting could not be saved.');

  const remove = (name: string) => act(async () => {
    await window.vyomara.deleteModel(name, removeConfirmation);
    setRemoving(undefined);
    setRemoveConfirmation('');
    setNotice(`${name} was removed from Ollama.`);
    await refresh();
  }, 'The model could not be removed.');

  const startOllama = () => act(async () => {
    await window.vyomara.startOllama();
    await refresh();
  }, 'Ollama could not be started.');

  async function download(): Promise<void> {
    const name = modelToPull.trim();
    if (!name || pulling) return;
    setError(undefined);
    setNotice(undefined);
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

  const current = modelList?.models.find(model => isCurrent(model, modelList.current));
  const contextLimit = current?.contextLength ?? 262_144;
  const contextOptions = CONTEXT_OPTIONS.filter(option => option <= contextLimit);
  const supportsThinking = current?.capabilities.includes('thinking') === true;

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
        ) : modelList && !modelList.available ? (
          <div className="model-section">
            <p className="history-message history-error" role="alert">Ollama is not running, so no local model can answer.</p>
            <button className="history-action" type="button" onClick={() => void startOllama()} disabled={locked}>
              {busy ? 'Starting Ollama…' : 'Start Ollama'}
            </button>
          </div>
        ) : modelList && modelList.models.length > 0 ? (
          <ol className="history-list">
            {modelList.models.map(model => {
              const inUse = isCurrent(model, modelList.current);
              return (
                <li key={model.name} className="model-row">
                  <button
                    className={`history-item${inUse ? ' history-item-current' : ''}`}
                    type="button"
                    onClick={() => void choose(model)}
                    disabled={inUse || locked}
                    aria-pressed={inUse}
                  >
                    <span>{model.name}{inUse ? ' · in use' : ''}</span>
                    <span>
                      {[model.parameterSize, formatBytes(model.sizeBytes), model.contextLength ? `${formatTokens(model.contextLength)} context max` : undefined]
                        .filter(Boolean).join(' · ')}
                    </span>
                    <CapabilityBadges model={model} />
                  </button>
                  {!inUse && (removing === model.name ? (
                    <div className="model-remove">
                      <label className="history-confirm-label" htmlFor={`remove-${model.name}`}>Type DELETE to remove {model.name}</label>
                      <input
                        id={`remove-${model.name}`}
                        className="history-confirm-input"
                        value={removeConfirmation}
                        onChange={event => setRemoveConfirmation(event.target.value)}
                        autoComplete="off"
                      />
                      <div className="file-operation-actions">
                        <button className="history-danger" type="button" disabled={removeConfirmation !== 'DELETE' || locked} onClick={() => void remove(model.name)}>Remove</button>
                        <button className="file-operation-reject" type="button" onClick={() => { setRemoving(undefined); setRemoveConfirmation(''); }}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <button className="history-delete" type="button" disabled={locked} onClick={() => { setRemoving(model.name); setRemoveConfirmation(''); }}>
                      Remove…
                    </button>
                  ))}
                </li>
              );
            })}
          </ol>
        ) : !error ? (
          <p className="history-message">No models are installed in Ollama yet. Download one below.</p>
        ) : null}

        {modelList?.available && current && (
          <section className="model-section" aria-label="Settings for the model in use">
            <p className="history-review-title">Settings for {current.name}</p>
            <label className="history-confirm-label" htmlFor="model-context">Context window (memory for files and conversation)</label>
            <select
              id="model-context"
              className="history-confirm-input"
              value={contextOptions.includes(modelList.settings.numCtx) ? modelList.settings.numCtx : ''}
              onChange={event => void updateSettings({ numCtx: Number(event.target.value) })}
              disabled={locked}
            >
              {!contextOptions.includes(modelList.settings.numCtx) && <option value="">{formatTokens(modelList.settings.numCtx)} tokens (custom)</option>}
              {contextOptions.map(option => <option key={option} value={option}>{formatTokens(option)} tokens</option>)}
            </select>
            <p className="history-privacy">Larger windows remember more but use more RAM and run slower. 32K suits coding on a 24 GB Mac.</p>
            <label className="model-toggle">
              <input
                type="checkbox"
                checked={supportsThinking && modelList.settings.think}
                onChange={event => void updateSettings({ think: event.target.checked })}
                disabled={locked || !supportsThinking}
              />
              Let the model think before answering {supportsThinking ? '(slower)' : '(not supported by this model)'}
            </label>
          </section>
        )}

        {error && <p className="history-message history-error" role="alert">{error}</p>}
        {notice && <p className="history-notice" role="status">{notice}</p>}

        {modelList?.available !== false && (
          <form className="model-pull" onSubmit={event => { event.preventDefault(); void download(); }}>
            <label className="history-confirm-label" htmlFor="model-pull-name">Download another model</label>
            <input
              id="model-pull-name"
              className="history-confirm-input"
              value={modelToPull}
              onChange={event => setModelToPull(event.target.value)}
              placeholder="e.g. deepseek-r1:14b or hf.co/user/repo:Q4_K_M"
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
            <p className="history-privacy">
              Use any name from ollama.com/library, or a GGUF model from Hugging Face as hf.co/&lt;user&gt;/&lt;repo&gt;:&lt;quantization&gt;.
              For coding, pick a model marked “Tools”; 24 GB of RAM fits models up to about 14B.
            </p>
          </form>
        )}
      </div>
    </aside>
  );
}

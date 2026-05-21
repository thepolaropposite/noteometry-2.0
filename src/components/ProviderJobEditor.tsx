/**
 * ProviderJobEditor — one row in the AI settings panel for one job
 * (Math Read / Math Solve / General).
 *
 * Provider dropdown, model input (with optional /models dropdown next to
 * it), Base URL, API key (type=password — never echoed to console),
 * Test Provider, Refresh Models. The fetched model list, if any, is
 * cached per editor so picking different jobs doesn't clobber each
 * other.
 */
import { useCallback, useState } from 'react';
import type { JobConfig, ProviderId } from '../lib/aiTypes';
import { PROVIDERS, listModels, testProvider, chatEndpointFor } from '../lib/aiProviders';

// SECURITY NOTE: the hosted product should use one OpenAI key from a
// Vercel environment variable and route calls through server functions.
// This editor remains as a local-dev escape hatch until that backend is
// wired, but it is not the production credential path.

interface Props {
  jobLabel: string;
  jobDescription: string;
  config: JobConfig;
  onChange: (next: JobConfig) => void;
}

export default function ProviderJobEditor({ jobLabel, jobDescription, config, onChange }: Props) {
  const spec = PROVIDERS[config.provider];
  const [busy, setBusy] = useState<null | 'test' | 'refresh'>(null);
  const [result, setResult] = useState<null | { ok: boolean; text: string }>(null);
  const [modelOptions, setModelOptions] = useState<string[] | null>(null);
  const [keyVisible, setKeyVisible] = useState<boolean>(false);

  const setProvider = useCallback((next: ProviderId) => {
    const nextSpec = PROVIDERS[next];
    onChange({
      ...config,
      provider: next,
      baseUrl: nextSpec.defaultBaseUrl,
    });
    setModelOptions(null);
    setResult(null);
  }, [config, onChange]);

  const refreshModels = useCallback(async () => {
    setBusy('refresh');
    try {
      const res = await listModels(config);
      if (res.error) {
        setResult({ ok: false, text: `Refresh failed: ${res.error}` });
        return;
      }
      setModelOptions(res.models);
      setResult({ ok: true, text: `${res.models.length} model${res.models.length === 1 ? '' : 's'} loaded from ${res.endpoint}` });
    } finally {
      setBusy(null);
    }
  }, [config]);

  const onTest = useCallback(async () => {
    setBusy('test');
    try {
      const res = await testProvider(config);
      setResult({
        ok: res.ok,
        text: res.ok
          ? `${res.message} (${res.endpoint}${res.httpStatus ? ` · HTTP ${res.httpStatus}` : ''})`
          : `${res.message}${res.endpoint ? ` (${res.endpoint})` : ''}`,
      });
    } finally {
      setBusy(null);
    }
  }, [config]);

  return (
    <section className="noteometry-mm-job">
      <header className="noteometry-mm-job-head">
        <span className="noteometry-mm-job-label">{jobLabel}</span>
        <span className="noteometry-mm-hint">{jobDescription}</span>
      </header>

      <label className="noteometry-mm-field">
        <span>Provider</span>
        <select value={config.provider} onChange={(e) => setProvider(e.target.value as ProviderId)}>
          {Object.values(PROVIDERS).map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}{p.implemented ? '' : ' (not implemented)'}
            </option>
          ))}
        </select>
        {spec.note && <span className="noteometry-mm-hint">{spec.note}</span>}
      </label>

      {!spec.implemented && (
        <div className="noteometry-mm-diag is-error">
          Provider adapter not implemented yet. Use LM Studio or Custom OpenAI-compatible for now.
        </div>
      )}

      <label className="noteometry-mm-field">
        <span>Base URL</span>
        <input
          type="text"
          value={config.baseUrl}
          onChange={(e) => onChange({ ...config, baseUrl: e.target.value })}
          placeholder={spec.defaultBaseUrl}
          spellCheck={false}
        />
        <span className="noteometry-mm-hint">Will call: {chatEndpointFor(config)}</span>
      </label>

      <label className="noteometry-mm-field">
        <span>Model</span>
        <div className="noteometry-mm-model-row">
          <input
            type="text"
            value={config.model}
            onChange={(e) => onChange({ ...config, model: e.target.value })}
            spellCheck={false}
            list={modelOptions ? `models-${config.provider}-${jobLabel}` : undefined}
          />
          {modelOptions && (
            <datalist id={`models-${config.provider}-${jobLabel}`}>
              {modelOptions.map((m) => <option key={m} value={m} />)}
            </datalist>
          )}
          {spec.modelsPath && (
            <button
              type="button"
              className="noteometry-mm-secondary noteometry-mm-secondary-quiet"
              disabled={busy !== null}
              onClick={() => void refreshModels()}
            >
              {busy === 'refresh' ? '…' : 'Refresh Models'}
            </button>
          )}
        </div>
      </label>

      {spec.needsApiKey && (
        <label className="noteometry-mm-field">
          <span>API key</span>
          <div className="noteometry-mm-key-row">
            <input
              type={keyVisible ? 'text' : 'password'}
              value={config.apiKey}
              onChange={(e) => onChange({ ...config, apiKey: e.target.value })}
              spellCheck={false}
              autoComplete="off"
              placeholder={config.provider === 'openai' ? 'sk-…' : config.provider === 'anthropic' ? 'sk-ant-…' : 'API key'}
            />
            <button
              type="button"
              className="noteometry-mm-secondary noteometry-mm-secondary-quiet"
              onClick={() => setKeyVisible((v) => !v)}
              aria-pressed={keyVisible}
              aria-label={keyVisible ? 'Hide API key' : 'Show API key'}
              title={keyVisible ? 'Hide' : 'Show'}
            >
              {keyVisible ? 'Hide' : 'Show'}
            </button>
          </div>
          <span className="noteometry-mm-hint">Local-dev only. Hosted Noteometry uses Vercel env vars.</span>
        </label>
      )}

      <div className="noteometry-mm-test-row">
        <button
          type="button"
          className="noteometry-mm-secondary"
          disabled={busy !== null || !spec.implemented}
          onClick={() => void onTest()}
        >
          {busy === 'test' ? 'Testing…' : 'Test Provider'}
        </button>
        {modelOptions && modelOptions.length > 0 && (
          <span className="noteometry-mm-hint">{modelOptions.length} model{modelOptions.length === 1 ? '' : 's'} cached</span>
        )}
      </div>

      {result && (
        <div className={`noteometry-mm-diag${result.ok ? ' is-ok' : ' is-error'}`}>
          {result.text}
        </div>
      )}
    </section>
  );
}

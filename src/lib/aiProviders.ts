/**
 * Provider catalog + the current OpenAI-compatible adapter. The product
 * direction is one remote OpenAI backend through Vercel; alternate
 * providers remain here only as local-dev/past-experiment scaffolding
 * until the hosted path is fully wired.
 *
 * Hosted credentials must live in Vercel env vars, not localStorage.
 * This local fetch path is retained for development and never logs keys.
 */
import type {
  ProviderId,
  ProviderSpec,
  JobConfig,
  SendChatArgs,
  SendChatResult,
  ListModelsResult,
  ChatMessage,
} from './aiTypes';

export const PROVIDERS: Record<ProviderId, ProviderSpec> = {
  lmstudio: {
    id: 'lmstudio',
    label: 'LM Studio / Local',
    defaultBaseUrl: '/lmstudio/v1',
    needsApiKey: false,
    openAICompatible: true,
    implemented: true,
    modelsPath: '/models',
    note: 'Routed through Vite proxy (/lmstudio → http://127.0.0.1:1234).',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI / Vercel',
    defaultBaseUrl: '/api',
    needsApiKey: false,
    openAICompatible: true,
    implemented: true,
    modelsPath: '/models',
    note: 'Hosted route. The browser never sees OPENAI_API_KEY.',
  },
  anthropic: {
    id: 'anthropic',
    label: 'Claude / Anthropic',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    needsApiKey: true,
    openAICompatible: false,
    implemented: false,
    note: 'Different request schema (x-api-key + /messages). Adapter coming next.',
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    needsApiKey: true,
    openAICompatible: false,
    implemented: false,
    note: 'Different request schema (?key= + generateContent). Adapter coming next.',
  },
  perplexity: {
    id: 'perplexity',
    label: 'Perplexity',
    defaultBaseUrl: 'https://api.perplexity.ai',
    needsApiKey: true,
    openAICompatible: true,
    implemented: true,
    note: 'OpenAI-compatible /chat/completions. /models endpoint may not exist.',
  },
  xai: {
    id: 'xai',
    label: 'Grok / xAI',
    defaultBaseUrl: 'https://api.x.ai/v1',
    needsApiKey: true,
    openAICompatible: true,
    implemented: true,
    modelsPath: '/models',
    note: 'OpenAI-compatible.',
  },
  custom: {
    id: 'custom',
    label: 'Custom OpenAI-compatible',
    defaultBaseUrl: '',
    needsApiKey: false,
    openAICompatible: true,
    implemented: true,
    modelsPath: '/models',
    note: 'Bring your own /chat/completions endpoint.',
  },
};

/** Normalize an OpenAI-compatible base URL.
 *
 *  For lmstudio, swap localhost:1234 / 127.0.0.1:1234 / [::1]:1234 for
 *  the /lmstudio Vite proxy prefix (LM Studio omits CORS headers and
 *  the browser would otherwise fail with "Failed to fetch"). Always
 *  guarantee /v1 exactly once at the tail.
 *
 *  For other providers, just strip trailing slashes. */
export function normalizeBaseUrl(input: string, providerId: ProviderId): string {
  const spec = PROVIDERS[providerId];
  let url = (input || '').trim().replace(/\/+$/, '');
  if (!url) url = spec.defaultBaseUrl.replace(/\/+$/, '');

  if (providerId === 'lmstudio') {
    url = url.replace(
      /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:1234)?(?=\/|$)/i,
      '/lmstudio'
    );
    if (/^https?:\/\//i.test(url)) url = '/lmstudio';
    if (!url.startsWith('/')) url = '/' + url;
    url = url.replace(/\/{2,}/g, '/');
    url = url.replace(/(?:\/v1)+$/i, '/v1');
    if (!/\/v1$/i.test(url)) url += '/v1';
  }
  return url;
}

/** Public helper used by the diagnostics strip / "WILL CALL" UI. */
export function chatEndpointFor(job: JobConfig): string {
  if (job.provider === 'openai') return '/api/chat';
  const base = normalizeBaseUrl(job.baseUrl || PROVIDERS[job.provider].defaultBaseUrl, job.provider);
  return `${base.replace(/\/+$/, '')}/chat/completions`;
}

export function modelsEndpointFor(job: JobConfig): string | null {
  const spec = PROVIDERS[job.provider];
  if (!spec.modelsPath) return null;
  if (job.provider === 'openai') return '/api/models';
  const base = normalizeBaseUrl(job.baseUrl || spec.defaultBaseUrl, job.provider);
  return `${base.replace(/\/+$/, '')}${spec.modelsPath}`;
}

function authHeaders(job: JobConfig): Record<string, string> {
  const spec = PROVIDERS[job.provider];
  const out: Record<string, string> = { 'content-type': 'application/json' };
  if (spec.needsApiKey && job.apiKey) {
    out.authorization = `Bearer ${job.apiKey}`;
  }
  return out;
}

/** Provider-aware chat call. Today every implemented provider speaks the
 *  OpenAI /chat/completions schema so we use a single fetch path. When
 *  Anthropic/Gemini adapters land, they'll branch here. */
export async function sendChat({ job, messages, temperature }: SendChatArgs): Promise<SendChatResult> {
  const spec = PROVIDERS[job.provider];
  if (!spec.implemented) {
    throw new Error(
      'Provider adapter not implemented yet. Use LM Studio or Custom OpenAI-compatible for now.'
    );
  }
  const endpoint = chatEndpointFor(job);
  const body = {
    model: job.model,
    messages: messages as ChatMessage[],
    ...(temperature !== undefined ? { temperature } : {}),
  };
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: authHeaders(job),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`HTTP ${res.status}: ${errBody.slice(0, 400)}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };
  if (json.error?.message) throw new Error(json.error.message);
  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('No assistant content in response.');
  return { content, httpStatus: res.status, endpoint, model: job.model };
}

/** GET /models. Returns at least `{endpoint,status,models}`; on failure
 *  fills `error`. Used by the "Refresh Models" button and as the cheap
 *  "Test Provider" call when /models is available. */
export async function listModels(job: JobConfig): Promise<ListModelsResult> {
  const spec = PROVIDERS[job.provider];
  if (!spec.implemented) {
    return { endpoint: '', status: 0, models: [], error: 'Provider adapter not implemented yet.' };
  }
  const endpoint = modelsEndpointFor(job);
  if (!endpoint) {
    return {
      endpoint: '',
      status: 0,
      models: [],
      error: 'This provider does not expose a /models endpoint. Use Test Provider instead.',
    };
  }
  try {
    const res = await fetch(endpoint, { headers: authHeaders(job) });
    const txt = await res.text();
    if (!res.ok) {
      return { endpoint, status: res.status, models: [], error: `HTTP ${res.status}: ${txt.slice(0, 240)}` };
    }
    try {
      const json = JSON.parse(txt) as { data?: Array<{ id?: string }> };
      const ids = (json.data ?? [])
        .map((m) => m.id)
        .filter((id): id is string => typeof id === 'string');
      return { endpoint, status: res.status, models: ids };
    } catch (e) {
      return { endpoint, status: res.status, models: [], error: `Parse error: ${(e as Error).message}` };
    }
  } catch (e) {
    return { endpoint, status: 0, models: [], error: (e as Error).message };
  }
}

/** Cheap end-to-end check that works even when /models is unavailable.
 *  Sends a single-token "ping" through sendChat. */
export async function testProvider(job: JobConfig): Promise<{ ok: boolean; endpoint: string; httpStatus?: number; message: string }> {
  const spec = PROVIDERS[job.provider];
  if (!spec.implemented) {
    return {
      ok: false,
      endpoint: '',
      message: 'Provider adapter not implemented yet. Use LM Studio or Custom OpenAI-compatible for now.',
    };
  }
  // Prefer /models when it exists — it's lighter and won't burn quota.
  if (spec.modelsPath) {
    const res = await listModels(job);
    if (res.error) {
      return { ok: false, endpoint: res.endpoint, httpStatus: res.status, message: res.error };
    }
    return {
      ok: true,
      endpoint: res.endpoint,
      httpStatus: res.status,
      message: `OK — ${res.models.length} model${res.models.length === 1 ? '' : 's'}.`,
    };
  }
  // Fall back to a tiny chat call.
  try {
    const result = await sendChat({
      job,
      messages: [
        { role: 'system', content: 'ping' },
        { role: 'user', content: 'ping' },
      ],
      temperature: 0,
    });
    return { ok: true, endpoint: result.endpoint, httpStatus: result.httpStatus, message: 'OK — chat reachable.' };
  } catch (e) {
    return { ok: false, endpoint: chatEndpointFor(job), message: (e as Error).message };
  }
}

export function defaultJobConfig(): JobConfig {
  return {
    provider: 'openai',
    baseUrl: PROVIDERS.openai.defaultBaseUrl,
    apiKey: '',
    model: 'gpt-4o',
  };
}

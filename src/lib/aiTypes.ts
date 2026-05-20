/**
 * Provider/model layer types.
 *
 * One active AI profile drives every workflow (Read Math, Solve, Ask).
 * Per-task model routing was tried earlier but added too much surface
 * area for a single-user product — collapsed to one active profile,
 * configured behind the gear. If/when advanced routing is needed it
 * goes behind an "Advanced" disclosure, not in the main pane.
 *
 * SECURITY NOTE: API keys are persisted in localStorage on the device
 * (acceptable for local dev). Before public/hosted deployment the keys
 * must move to a server-side proxy or env-var backend — never ship them
 * to a browser. See `aiProviders.ts` for the call path that reads them.
 */

export type ProviderId =
  | 'lmstudio'
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'perplexity'
  | 'xai'
  | 'custom';

export interface ProviderSpec {
  id: ProviderId;
  label: string;
  defaultBaseUrl: string;
  /** Whether this provider needs an API key in the Authorization header. */
  needsApiKey: boolean;
  /** Does the /chat/completions OpenAI schema work as-is? */
  openAICompatible: boolean;
  /** Is the adapter implemented in aiProviders.ts? If false, sendChat
   *  throws with the "Provider adapter not implemented yet…" hint. */
  implemented: boolean;
  /** /models suffix (absent ⇒ Refresh Models is hidden). */
  modelsPath?: string;
  /** Short note shown in the UI describing real-world status. */
  note?: string;
}

/** The one active AI profile. Used for vision (Read Math, General) and
 *  text (Solve) calls alike — the user accepts a single model for now. */
export interface JobConfig {
  provider: ProviderId;
  baseUrl: string;
  /** Stored in localStorage, never logged. */
  apiKey: string;
  model: string;
}

export type AiConfig = JobConfig;

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

export interface SendChatArgs {
  job: JobConfig;
  messages: ChatMessage[];
  temperature?: number;
}

export interface SendChatResult {
  content: string;
  httpStatus: number;
  endpoint: string;
  model: string;
}

export interface ListModelsResult {
  endpoint: string;
  status: number;
  models: string[];
  error?: string;
}

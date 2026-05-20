/**
 * MathMessagePane — Noteometry OS right-side AI control surface.
 *
 * Architecture (ported from noteometry-obsidian v1.6.6, commit 79cfb74):
 *
 *   MATH pipeline
 *     1. lasso math on canvas
 *     2. Read Math: vision call with mathRead.ts prompt (transcribe only)
 *     3. result lands in editable "Verified Input" textarea
 *     4. Preview renders the input live via KaTeX
 *     5. Dan corrects any recognition errors
 *     6. Solve: TEXT-ONLY call with mathV12.ts system + injected input
 *     7. Answer joins the chat log with Copy-for-Word / Copy-LaTeX / Copy-plain
 *
 *   GENERAL pipeline
 *     1. lasso anything
 *     2. Capture General: vision call with generalVision.ts prompt + user text
 *     3. Answer joins the general chat log
 *
 * Each pipeline has its own provider + model (see ProviderJobEditor).
 * Defaults: all three jobs → LM Studio @ /lmstudio/v1 with
 * google/gemma-4-26b-a4b. The screenshot path is exclusively
 * editor.toImageDataUrl — no OCR, no shape JSON, no object parsing.
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Editor } from 'tldraw';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import ProviderJobEditor from './ProviderJobEditor';
import type { AiConfig, ChatMessage, JobConfig } from '../lib/aiTypes';
import { chatEndpointFor, defaultJobConfig, sendChat } from '../lib/aiProviders';
import {
  MATH_READ_PROMPT,
  MATH_READ_PROMPT_VERSION,
  MATH_V12_SYSTEM,
  MATH_V12_PROMPT_VERSION,
  GENERAL_VISION_PROMPT,
  GENERAL_VISION_PROMPT_VERSION,
  buildMathV12UserMessage,
} from '../prompts';
import { copyForWord, renderAsMathML } from '../lib/mathml';
import { markError, markSaved, markSaving } from '../lib/saveStatus';

const STORAGE_KEY = 'noteometry-os:math-message-pane:v4';
const LEGACY_STORAGE_KEY = 'noteometry-os:math-message-pane:v3';
const PANE_WIDTH_MIN = 320;
const PANE_WIDTH_DEFAULT = 380;
const PANE_WIDTH_MAX_HARD = 720;

type Mode = 'math' | 'general';
type Role = 'user' | 'assistant' | 'system' | 'error';

interface CapturedImage {
  dataUrl: string;
  width: number;
  height: number;
  capturedAt: number;
  shapeCount: number;
}

interface LogEntry {
  id: string;
  role: Role;
  text: string;
  imageDataUrl?: string;
  /** Which prompt version produced this entry, for traceability. */
  promptVersion?: string;
  ts: number;
}

interface Persisted {
  paneOpen: boolean;
  paneWidth: number;
  mode: Mode;
  showSettings: boolean;
  /** Single active AI profile. Drives every workflow (Read Math, Solve,
   *  Ask). Per-task routing was removed — see aiTypes.ts. */
  ai: AiConfig;
  verifiedInput: string;
  mathLog: LogEntry[];
  generalDraft: string;
  generalLog: LogEntry[];
}

interface Diag {
  mode: Mode;
  step: string;
  endpoint: string;
  model: string;
  promptVersion?: string;
  captured: boolean;
  previewReady: boolean;
  httpStatus: number | null;
  excerpt: string;
  ok: boolean;
  at: number;
}

function defaultPersisted(): Persisted {
  return {
    paneOpen: true,
    paneWidth: PANE_WIDTH_DEFAULT,
    mode: 'math',
    showSettings: false,
    ai: defaultJobConfig(),
    verifiedInput: '',
    mathLog: [],
    generalDraft: '',
    generalLog: [],
  };
}

/** v3→v4 migration: the old shape stored three jobs (mathRead /
 *  mathSolve / general). Collapse to one — prefer mathSolve (the most
 *  customized in practice), fall back to mathRead, then to defaults. */
interface LegacyV3 {
  paneOpen?: boolean;
  mode?: Mode;
  showSettings?: boolean;
  ai?: { mathRead?: JobConfig; mathSolve?: JobConfig; general?: JobConfig };
  verifiedInput?: string;
  mathLog?: LogEntry[];
  generalDraft?: string;
  generalLog?: LogEntry[];
}

function readActiveFromLegacy(legacy: LegacyV3): JobConfig {
  return legacy.ai?.mathSolve ?? legacy.ai?.mathRead ?? legacy.ai?.general ?? defaultJobConfig();
}

function loadPersisted(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Persisted>;
      return {
        paneOpen: parsed.paneOpen ?? true,
        paneWidth: clampWidth(parsed.paneWidth ?? PANE_WIDTH_DEFAULT),
        mode: parsed.mode === 'general' ? 'general' : 'math',
        showSettings: parsed.showSettings ?? false,
        ai: { ...defaultJobConfig(), ...(parsed.ai ?? {}) },
        verifiedInput: parsed.verifiedInput ?? '',
        mathLog: Array.isArray(parsed.mathLog) ? parsed.mathLog : [],
        generalDraft: parsed.generalDraft ?? '',
        generalLog: Array.isArray(parsed.generalLog) ? parsed.generalLog : [],
      };
    }
    // Try v3 migration before falling back to defaults.
    const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw) as LegacyV3;
      return {
        paneOpen: legacy.paneOpen ?? true,
        paneWidth: PANE_WIDTH_DEFAULT,
        mode: legacy.mode === 'general' ? 'general' : 'math',
        showSettings: legacy.showSettings ?? false,
        ai: readActiveFromLegacy(legacy),
        verifiedInput: legacy.verifiedInput ?? '',
        mathLog: Array.isArray(legacy.mathLog) ? legacy.mathLog : [],
        generalDraft: legacy.generalDraft ?? '',
        generalLog: Array.isArray(legacy.generalLog) ? legacy.generalLog : [],
      };
    }
  } catch {
    /* fall through */
  }
  return defaultPersisted();
}

function clampWidth(w: number): number {
  const cap = Math.min(PANE_WIDTH_MAX_HARD, Math.floor(window.innerWidth * 0.5));
  return Math.max(PANE_WIDTH_MIN, Math.min(cap, w));
}

function savePersisted(state: Persisted) {
  markSaving();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    markSaved();
  } catch (e) {
    markError('ai-pane', e);
  }
}

/* ─── transcription JSON parsing ─────────────────────────────────── */

interface ReadResult { plainText: string; latex: string; notes: string }

function parseTranscription(raw: string): ReadResult {
  const cleaned = raw.trim();
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced ? fenced[1] : cleaned;
  const objMatch = candidate.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      const parsed = JSON.parse(objMatch[0]) as Partial<ReadResult>;
      return {
        plainText: typeof parsed.plainText === 'string' ? parsed.plainText : '',
        latex: typeof parsed.latex === 'string' ? parsed.latex : '',
        notes: typeof parsed.notes === 'string' ? parsed.notes : '',
      };
    } catch { /* */ }
  }
  return { plainText: cleaned, latex: '', notes: 'Model did not return valid JSON; raw text shown.' };
}

/** Compose a single human-readable string for the "Verified Input"
 *  textarea from a parsed transcription. Dan can then edit freely. */
function compositeVerifiedInput(r: ReadResult): string {
  const parts: string[] = [];
  if (r.plainText.trim()) parts.push(r.plainText.trim());
  if (r.latex.trim()) {
    const latex = r.latex.trim();
    const wrapped = /\$/.test(latex) ? latex : `$${latex}$`;
    parts.push(wrapped);
  }
  if (r.notes.trim()) parts.push(`Notes: ${r.notes.trim()}`);
  return parts.join('\n\n');
}

/* ─── LaTeX preview render (live) ────────────────────────────────── */

function splitForLatex(src: string): Array<{ kind: 'text' | 'inline' | 'block'; value: string }> {
  const out: Array<{ kind: 'text' | 'inline' | 'block'; value: string }> = [];
  const re = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m.index > lastIdx) out.push({ kind: 'text', value: src.slice(lastIdx, m.index) });
    if (m[1] !== undefined) out.push({ kind: 'block', value: m[1] });
    else if (m[2] !== undefined) out.push({ kind: 'inline', value: m[2] });
    lastIdx = re.lastIndex;
  }
  if (lastIdx < src.length) out.push({ kind: 'text', value: src.slice(lastIdx) });
  return out;
}

function renderLatexSafe(src: string, displayMode: boolean): { html: string } | { error: string } {
  try {
    const html = katex.renderToString(src, { displayMode, throwOnError: true, strict: 'ignore' });
    return { html };
  } catch (e) { return { error: (e as Error).message }; }
}

function RichText({ value }: { value: string }): ReactNode {
  const segments = useMemo(() => splitForLatex(value), [value]);
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.kind === 'text') {
          return <span key={i} style={{ whiteSpace: 'pre-wrap' }}>{seg.value}</span>;
        }
        const result = renderLatexSafe(seg.value, seg.kind === 'block');
        if ('error' in result) {
          return (
            <span key={i} className="nm-mm-latex-error" title={result.error}>
              {seg.kind === 'block' ? `$$${seg.value}$$` : `$${seg.value}$`}
            </span>
          );
        }
        return <span key={i} dangerouslySetInnerHTML={{ __html: result.html }} />;
      })}
    </>
  );
}

/* ─── handle exposed to App.tsx for the right-click menu ─────────── */

export interface MathMessagePaneHandle {
  setMode: (mode: Mode) => void;
  readMath: () => Promise<void>;
  solveVerifiedMath: () => Promise<void>;
  captureGeneral: () => Promise<void>;
  focusAskAI: () => void;
}

export interface MathMessagePaneProps {
  editor: Editor | null;
  onPaneOpenChange?: (open: boolean) => void;
  onToast?: (msg: string) => void;
}

const MathMessagePane = forwardRef<MathMessagePaneHandle, MathMessagePaneProps>(function MathMessagePane(
  { editor, onPaneOpenChange, onToast },
  ref
) {
  const initial = useMemo(loadPersisted, []);

  const [paneOpen, setPaneOpen] = useState(initial.paneOpen);
  const [paneWidth, setPaneWidth] = useState<number>(initial.paneWidth);
  const [mode, setMode] = useState<Mode>(initial.mode);
  const [showSettings, setShowSettings] = useState(initial.showSettings);
  const [recentlySaved, setRecentlySaved] = useState(false);
  const recentlySavedTimer = useRef<number | null>(null);
  const [ai, setAi] = useState<AiConfig>(initial.ai);

  const [captured, setCaptured] = useState<CapturedImage | null>(null);

  const [verifiedInput, setVerifiedInput] = useState(initial.verifiedInput);
  const [reading, setReading] = useState(false);
  const [solving, setSolving] = useState(false);
  const [mathLog, setMathLog] = useState<LogEntry[]>(initial.mathLog);

  const [generalDraft, setGeneralDraft] = useState(initial.generalDraft);
  const [generalLog, setGeneralLog] = useState<LogEntry[]>(initial.generalLog);
  const [generalSending, setGeneralSending] = useState(false);

  const [diag, setDiag] = useState<Diag | null>(null);

  const generalPromptRef = useRef<HTMLTextAreaElement | null>(null);
  const mathLogRef = useRef<HTMLDivElement | null>(null);
  const generalLogRef = useRef<HTMLDivElement | null>(null);

  // Push pane open + measured width to the page as a CSS variable so the
  // canvas-shell, page rail, and zoom control inset by the *actual*
  // current width. When collapsed the variable is 0 — the canvas claims
  // the whole window per spec ("collapsed pane reserves 0px width").
  useEffect(() => {
    document.documentElement.style.setProperty(
      '--nm-mm-pane-width',
      paneOpen ? `${paneWidth}px` : '0px'
    );
  }, [paneOpen, paneWidth]);

  useEffect(() => { onPaneOpenChange?.(paneOpen); }, [paneOpen, onPaneOpenChange]);

  useEffect(() => {
    savePersisted({
      paneOpen, paneWidth, mode, showSettings, ai,
      verifiedInput, mathLog,
      generalDraft, generalLog,
    });
  }, [paneOpen, paneWidth, mode, showSettings, ai, verifiedInput, mathLog, generalDraft, generalLog]);

  useEffect(() => {
    const el = mode === 'math' ? mathLogRef.current : generalLogRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [mode, mathLog.length, generalLog.length]);

  /* ─── horizontal resize handle ───────────────────────────────── */

  const resizeStateRef = useRef<null | { pointerId: number; startX: number; startW: number }>(null);
  const onResizePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    resizeStateRef.current = { pointerId: e.pointerId, startX: e.clientX, startW: paneWidth };
  }, [paneWidth]);
  const onResizePointerMove = useCallback((e: React.PointerEvent) => {
    const r = resizeStateRef.current;
    if (!r || e.pointerId !== r.pointerId) return;
    // Drag the left edge: moving LEFT increases width.
    const next = clampWidth(r.startW + (r.startX - e.clientX));
    setPaneWidth(next);
  }, []);
  const onResizePointerUp = useCallback((e: React.PointerEvent) => {
    const r = resizeStateRef.current;
    if (!r || e.pointerId !== r.pointerId) return;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    resizeStateRef.current = null;
  }, []);

  /* ─── capture ────────────────────────────────────────────────── */

  const captureSelection = useCallback(async (): Promise<CapturedImage | null> => {
    if (!editor) { onToast?.('Canvas not ready yet.'); return null; }
    const ids = editor.getSelectedShapeIds();
    if (ids.length === 0) {
      onToast?.('Select shapes with the Lasso / Select tool first, then Capture.');
      return null;
    }
    try {
      const result = await editor.toImageDataUrl(ids, {
        format: 'png', scale: 2, background: true, padding: 12,
      } as Parameters<Editor['toImageDataUrl']>[1]);
      if (!result?.url) throw new Error('Export returned no image');
      const shot: CapturedImage = {
        dataUrl: result.url,
        width: result.width,
        height: result.height,
        capturedAt: Date.now(),
        shapeCount: ids.length,
      };
      setCaptured(shot);
      onToast?.(`Captured ${ids.length} shape${ids.length === 1 ? '' : 's'}.`);
      return shot;
    } catch (e) {
      onToast?.(`Capture failed: ${(e as Error).message}`);
      return null;
    }
  }, [editor, onToast]);

  /* ─── HTTP wrapper that fills the diagnostics strip ──────────── */

  const runChat = useCallback(async (
    job: JobConfig,
    messages: ChatMessage[],
    temperature: number,
    label: { mode: Mode; step: string; promptVersion: string; captured: boolean; previewReady: boolean }
  ): Promise<string> => {
    try {
      const res = await sendChat({ job, messages, temperature });
      setDiag({
        ...label,
        endpoint: res.endpoint,
        model: res.model,
        httpStatus: res.httpStatus,
        excerpt: res.content.slice(0, 240),
        ok: true,
        at: Date.now(),
      });
      return res.content;
    } catch (e) {
      const reason = (e as Error).message;
      const isFetchFailure = /failed to fetch|networkerror|load failed/i.test(reason);
      const proxyHint = isFetchFailure
        ? ' Browser could not reach LM Studio through the Vite proxy. Restart Noteometry dev server after editing vite.config.ts.'
        : '';
      setDiag({
        ...label,
        endpoint: chatEndpointFor(job),
        model: job.model,
        httpStatus: null,
        excerpt: `${reason}${proxyHint}`,
        ok: false,
        at: Date.now(),
      });
      throw new Error(`${reason}${proxyHint}`);
    }
  }, []);

  /* ─── MATH: Read ─────────────────────────────────────────────── */

  const readMath = useCallback(async () => {
    if (reading) return;
    setReading(true);
    try {
      const shot = await captureSelection();
      if (!shot) return;
      const messages: ChatMessage[] = [
        { role: 'system', content: MATH_READ_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Transcribe the math/problem in this image. Return JSON only.' },
            { type: 'image_url', image_url: { url: shot.dataUrl } },
          ],
        },
      ];
      const content = await runChat(ai, messages, 0.1, {
        mode: 'math', step: 'read', promptVersion: MATH_READ_PROMPT_VERSION,
        captured: true, previewReady: false,
      });
      const parsed = parseTranscription(content);
      setVerifiedInput(compositeVerifiedInput(parsed));
      onToast?.('Transcription ready — verify in the input below before Solve.');
    } catch (e) {
      setMathLog((prev) => [...prev, {
        id: `e-${Date.now()}`,
        role: 'error',
        text: `Read Math failed — ${(e as Error).message}`,
        ts: Date.now(),
      }]);
    } finally {
      setReading(false);
    }
  }, [reading, captureSelection, ai, runChat, onToast]);

  /* ─── MATH: Solve (text-only, full v12) ──────────────────────── */

  const solveVerifiedMath = useCallback(async () => {
    if (solving) return;
    const verified = verifiedInput.trim();
    if (!verified) {
      onToast?.('Verified Input is empty. Read Math first, then edit if needed.');
      return;
    }
    setSolving(true);
    const userMsg = buildMathV12UserMessage(verified);
    const messages: ChatMessage[] = [
      { role: 'system', content: MATH_V12_SYSTEM },
      { role: 'user', content: userMsg },
    ];
    setMathLog((prev) => [...prev, {
      id: `u-${Date.now()}`,
      role: 'user',
      text: userMsg,
      promptVersion: MATH_V12_PROMPT_VERSION,
      ts: Date.now(),
    }]);
    try {
      const content = await runChat(ai, messages, 0.2, {
        mode: 'math', step: 'solve', promptVersion: MATH_V12_PROMPT_VERSION,
        captured: false, previewReady: true,
      });
      setMathLog((prev) => [...prev, {
        id: `a-${Date.now()}`,
        role: 'assistant',
        text: content,
        promptVersion: MATH_V12_PROMPT_VERSION,
        ts: Date.now(),
      }]);
    } catch (e) {
      setMathLog((prev) => [...prev, {
        id: `e-${Date.now()}`,
        role: 'error',
        text: `Solve failed — ${(e as Error).message}`,
        ts: Date.now(),
      }]);
    } finally {
      setSolving(false);
    }
  }, [solving, verifiedInput, ai, runChat, onToast]);

  /* ─── GENERAL ────────────────────────────────────────────────── */

  const captureGeneral = useCallback(async () => { await captureSelection(); }, [captureSelection]);

  const sendGeneral = useCallback(async () => {
    if (generalSending) return;
    if (!captured) { onToast?.('Capture a region first — General is vision-based.'); return; }
    const prompt = generalDraft.trim();
    setGeneralLog((prev) => [...prev, {
      id: `u-${Date.now()}`,
      role: 'user',
      text: prompt || '(describe what you see)',
      imageDataUrl: captured.dataUrl,
      promptVersion: GENERAL_VISION_PROMPT_VERSION,
      ts: Date.now(),
    }]);
    setGeneralSending(true);
    try {
      const messages: ChatMessage[] = [
        { role: 'system', content: GENERAL_VISION_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt || 'Describe and explain what you see in the image.' },
            { type: 'image_url', image_url: { url: captured.dataUrl } },
          ],
        },
      ];
      const content = await runChat(ai, messages, 0.2, {
        mode: 'general', step: 'ask', promptVersion: GENERAL_VISION_PROMPT_VERSION,
        captured: true, previewReady: false,
      });
      setGeneralLog((prev) => [...prev, {
        id: `a-${Date.now()}`,
        role: 'assistant',
        text: content,
        promptVersion: GENERAL_VISION_PROMPT_VERSION,
        ts: Date.now(),
      }]);
      setGeneralDraft('');
    } catch (e) {
      setGeneralLog((prev) => [...prev, {
        id: `e-${Date.now()}`,
        role: 'error',
        text: `Ask AI failed — ${(e as Error).message}`,
        ts: Date.now(),
      }]);
    } finally {
      setGeneralSending(false);
    }
  }, [generalSending, captured, generalDraft, ai, runChat, onToast]);

  const focusAskAI = useCallback(() => {
    setPaneOpen(true); setMode('general');
    setTimeout(() => generalPromptRef.current?.focus(), 0);
  }, []);

  /* ─── explicit Save (settings drawer) ─────────────────────────── */

  /** AI Settings auto-save on every edit through the useEffect persist
   *  pipeline. The explicit Save button is preserved per spec: it gives
   *  Dan a visible commit affordance + a confirmation toast that the
   *  current Provider / Base URL / API Key / Model are durable on this
   *  device. We force the persist call here so the save flushes even if
   *  React happened to batch a pending state update. We never log the
   *  API key. */
  const onSaveSettings = useCallback(() => {
    savePersisted({
      paneOpen, paneWidth, mode, showSettings, ai,
      verifiedInput, mathLog,
      generalDraft, generalLog,
    });
    setRecentlySaved(true);
    onToast?.('AI settings saved on this device.');
    if (recentlySavedTimer.current !== null) {
      window.clearTimeout(recentlySavedTimer.current);
    }
    recentlySavedTimer.current = window.setTimeout(() => {
      setRecentlySaved(false);
    }, 1500);
  }, [paneOpen, paneWidth, mode, showSettings, ai, verifiedInput, mathLog, generalDraft, generalLog, onToast]);

  /* ─── copy actions ───────────────────────────────────────────── */

  const onCopyForWord = useCallback(async (text: string) => {
    try { await copyForWord(text); onToast?.('Sent to Word clipboard (MathML).'); }
    catch (e) { onToast?.(`Send to Word failed: ${(e as Error).message}`); }
  }, [onToast]);


  /* ─── imperative API ─────────────────────────────────────────── */

  useImperativeHandle(ref, () => ({
    setMode: (m) => { setPaneOpen(true); setMode(m); },
    readMath: async () => { setPaneOpen(true); setMode('math'); await readMath(); },
    solveVerifiedMath: async () => { setPaneOpen(true); setMode('math'); await solveVerifiedMath(); },
    captureGeneral: async () => { setPaneOpen(true); setMode('general'); await captureGeneral(); },
    focusAskAI,
  }), [readMath, solveVerifiedMath, captureGeneral, focusAskAI]);

  /* ─── render ─────────────────────────────────────────────────── */

  if (!paneOpen) {
    return (
      <button
        type="button"
        className="noteometry-mm-handle"
        title="Open Math / Message pane"
        aria-label="Open Math / Message pane"
        onClick={() => setPaneOpen(true)}
      >
        Math / Message
      </button>
    );
  }

  const previewSegments = splitForLatex(verifiedInput);

  return (
    <aside className="noteometry-mm-pane" aria-label="Math / Message">
      <header className="noteometry-mm-header">
        <div className="noteometry-mm-title">Math / Message</div>
        <div className="noteometry-mm-header-actions">
          <button type="button" className="noteometry-mm-iconbtn" title="Provider settings" aria-label="Provider settings" onClick={() => setShowSettings((s) => !s)}>⚙</button>
          <button type="button" className="noteometry-mm-iconbtn" title="Collapse pane" aria-label="Collapse pane" onClick={() => setPaneOpen(false)}>›</button>
        </div>
      </header>

      <div className="noteometry-mm-modetabs" role="tablist" aria-label="Pipeline">
        <button type="button" role="tab" aria-selected={mode === 'math'} className={`noteometry-mm-modetab${mode === 'math' ? ' is-active' : ''}`} onClick={() => setMode('math')}>Math</button>
        <button type="button" role="tab" aria-selected={mode === 'general'} className={`noteometry-mm-modetab${mode === 'general' ? ' is-active' : ''}`} onClick={() => setMode('general')}>General</button>
      </div>

      {showSettings && (
        <section className="noteometry-mm-settings" aria-label="AI Settings">
          <header className="noteometry-mm-settings-head">
            <div>
              <div className="noteometry-mm-settings-title">AI Settings</div>
              <div className="noteometry-mm-settings-sub">One active provider drives Read Math, Solve, and Ask.</div>
            </div>
            <button
              type="button"
              className="noteometry-mm-secondary noteometry-mm-secondary-quiet"
              onClick={() => setShowSettings(false)}
              aria-label="Close settings"
            >
              Close
            </button>
          </header>
          <ProviderJobEditor
            jobLabel="Active model"
            jobDescription="Used for every AI call (vision + text)."
            config={ai}
            onChange={(c) => setAi(c)}
          />
          {/* TODO(server-proxy): API keys persist in localStorage on this
              device — acceptable for local dev. Move to a server-side
              proxy or env-var backend before public/hosted deployment so
              we are not shipping secrets to the browser. */}
          <p className="noteometry-mm-settings-note">
            API keys are stored locally on this device. For shared/hosted
            deployments, route calls through a server proxy instead.
          </p>
          <footer className="noteometry-mm-settings-footer">
            <button
              type="button"
              className={`noteometry-mm-secondary noteometry-mm-secondary-primary${recentlySaved ? ' is-confirmed' : ''}`}
              onClick={onSaveSettings}
              title="Save AI settings on this device"
            >
              {recentlySaved ? 'Saved ✓' : 'Save'}
            </button>
          </footer>
        </section>
      )}

      <section className={`noteometry-mm-diag-strip${diag?.ok === false ? ' is-error' : diag?.ok ? ' is-ok' : ''}`}>
        <div><strong>Mode:</strong> {mode}{diag ? ` · ${diag.step}` : ''}</div>
        <div><strong>Model:</strong> {diag?.model ?? ai.model}</div>
        <div><strong>Captured:</strong> {captured ? 'yes' : 'no'}</div>
        <div><strong>Verified Input:</strong> {verifiedInput.trim() ? 'ready' : 'empty'}</div>
        <div><strong>Last HTTP:</strong> {diag?.httpStatus ?? '—'}</div>
        {diag && !diag.ok && diag.excerpt && (
          <div className="noteometry-mm-diag-err"><strong>Error:</strong> {diag.excerpt}</div>
        )}
      </section>

      {mode === 'math' ? (
        <MathPanel
          captured={captured}
          reading={reading}
          solving={solving}
          verifiedInput={verifiedInput}
          previewSegments={previewSegments}
          mathLog={mathLog}
          onReadMath={() => void readMath()}
          onSolve={() => void solveVerifiedMath()}
          onClearInput={() => setVerifiedInput('')}
          onInputChange={setVerifiedInput}
          onCopyForWord={onCopyForWord}
          scrollRef={mathLogRef}
        />
      ) : (
        <GeneralPanel
          captured={captured}
          generalDraft={generalDraft}
          generalLog={generalLog}
          generalSending={generalSending}
          onCapture={() => void captureGeneral()}
          onClearCapture={() => setCaptured(null)}
          onClearDraft={() => setGeneralDraft('')}
          onDraftChange={setGeneralDraft}
          onSend={() => void sendGeneral()}
          onCopyForWord={onCopyForWord}
          promptRef={generalPromptRef}
          scrollRef={generalLogRef}
        />
      )}

      {/* Left-edge horizontal resize handle for the pane. */}
      <div
        className="noteometry-mm-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize AI pane"
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
      />
    </aside>
  );
});

export default MathMessagePane;

/* ─── MATH panel (Preview + Input + Solve + Chat) ─────────────── */

function MathPanel(props: {
  captured: CapturedImage | null;
  reading: boolean;
  solving: boolean;
  verifiedInput: string;
  previewSegments: ReturnType<typeof splitForLatex>;
  mathLog: LogEntry[];
  onReadMath: () => void;
  onSolve: () => void;
  onClearInput: () => void;
  onInputChange: (next: string) => void;
  onCopyForWord: (text: string) => void;
  scrollRef: React.MutableRefObject<HTMLDivElement | null>;
}) {
  const {
    captured, reading, solving, verifiedInput, previewSegments, mathLog,
    onReadMath, onSolve, onClearInput, onInputChange,
    onCopyForWord, scrollRef,
  } = props;

  const canSolve = verifiedInput.trim().length > 0 && !solving;

  return (
    <>
      <section className="noteometry-mm-capture">
        <div className="noteometry-mm-capture-head">
          <span>Math Capture</span>
          <div className="noteometry-mm-capture-actions">
            <button type="button" onClick={onReadMath} disabled={reading} className="noteometry-mm-secondary">
              {reading ? 'Reading…' : 'Read Math'}
            </button>
          </div>
        </div>
        {captured ? (
          <figure className="noteometry-mm-thumb">
            <img src={captured.dataUrl} alt="Math capture preview" />
            <figcaption>{captured.width}×{captured.height} · {captured.shapeCount} shape{captured.shapeCount === 1 ? '' : 's'}</figcaption>
          </figure>
        ) : (
          <div className="noteometry-mm-empty-capture">
            Lasso math, then Read Math.
          </div>
        )}
      </section>

      <section className="noteometry-mm-preview-panel">
        <div className="noteometry-mm-capture-head">
          <span>Preview</span>
        </div>
        <div className="noteometry-mm-preview-render">
          {previewSegments.length === 0 || (previewSegments.length === 1 && !previewSegments[0]!.value.trim())
            ? <span className="noteometry-mm-preview-empty">(transcription will render here)</span>
            : previewSegments.map((seg, i) => {
                if (seg.kind === 'text') return <span key={i} style={{ whiteSpace: 'pre-wrap' }}>{seg.value}</span>;
                const r = renderLatexSafe(seg.value, seg.kind === 'block');
                if ('error' in r) return <span key={i} className="nm-mm-latex-error" title={r.error}>{seg.kind === 'block' ? `$$${seg.value}$$` : `$${seg.value}$`}</span>;
                return <span key={i} dangerouslySetInnerHTML={{ __html: r.html }} />;
              })}
        </div>

        <div className="noteometry-mm-capture-head">
          <span>Verified Input</span>
          <div className="noteometry-mm-capture-actions">
            <button
              type="button"
              onClick={onClearInput}
              className="noteometry-mm-secondary noteometry-mm-secondary-quiet"
              disabled={!verifiedInput}
              title="Clear input"
            >
              Clear Input
            </button>
          </div>
        </div>
        <textarea
          rows={5}
          value={verifiedInput}
          onChange={(e) => onInputChange(e.target.value)}
          spellCheck={false}
        />
        <button type="button" onClick={onSolve} disabled={!canSolve} className="noteometry-mm-send">
          {solving ? 'Solving…' : 'Solve'}
        </button>
      </section>

      <section className="noteometry-mm-log" ref={scrollRef} aria-live="polite">
        {mathLog.map((entry) => (
          <ChatMessageRow key={entry.id} entry={entry} onCopyForWord={onCopyForWord} />
        ))}
        {solving && <div className="noteometry-mm-msg noteometry-mm-msg-pending">Solving…</div>}
      </section>
    </>
  );
}

/* ─── GENERAL panel ────────────────────────────────────────────── */

function GeneralPanel(props: {
  captured: CapturedImage | null;
  generalDraft: string;
  generalLog: LogEntry[];
  generalSending: boolean;
  onCapture: () => void;
  onClearCapture: () => void;
  onClearDraft: () => void;
  onDraftChange: (next: string) => void;
  onSend: () => void;
  onCopyForWord: (text: string) => void;
  promptRef: React.MutableRefObject<HTMLTextAreaElement | null>;
  scrollRef: React.MutableRefObject<HTMLDivElement | null>;
}) {
  const { captured, generalDraft, generalLog, generalSending, onCapture, onClearCapture, onClearDraft, onDraftChange, onSend, onCopyForWord, promptRef, scrollRef } = props;

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!generalSending) onSend();
      }
    },
    [onSend, generalSending]
  );

  return (
    <>
      <section className="noteometry-mm-capture">
        <div className="noteometry-mm-capture-head">
          <span>General Capture</span>
          <div className="noteometry-mm-capture-actions">
            <button type="button" onClick={onCapture} className="noteometry-mm-secondary">Capture</button>
            {captured && (
              <button type="button" onClick={onClearCapture} className="noteometry-mm-secondary noteometry-mm-secondary-quiet">Clear</button>
            )}
          </div>
        </div>
        {captured ? (
          <figure className="noteometry-mm-thumb">
            <img src={captured.dataUrl} alt="General capture preview" />
            <figcaption>{captured.width}×{captured.height} · {captured.shapeCount} shape{captured.shapeCount === 1 ? '' : 's'}</figcaption>
          </figure>
        ) : (
          <div className="noteometry-mm-empty-capture">
            Lasso, then Capture.
          </div>
        )}
      </section>

      <section className="noteometry-mm-log" ref={scrollRef} aria-live="polite">
        {generalLog.map((entry) => (
          <ChatMessageRow key={entry.id} entry={entry} onCopyForWord={onCopyForWord} />
        ))}
        {generalSending && <div className="noteometry-mm-msg noteometry-mm-msg-pending">Thinking…</div>}
      </section>

      <section className="noteometry-mm-composer">
        <div className="noteometry-mm-composer-input">
          <textarea
            ref={promptRef}
            value={generalDraft}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={onKeyDown}
            rows={3}
          />
          <button
            type="button"
            className="noteometry-mm-composer-clear"
            onClick={onClearDraft}
            disabled={!generalDraft}
            aria-label="Clear input"
            title="Clear input"
          >
            ×
          </button>
        </div>
        <button type="button" onClick={onSend} disabled={generalSending} className="noteometry-mm-send">
          {generalSending ? '…' : 'Ask'}
        </button>
      </section>
    </>
  );
}

/* ─── Chat row with Copy actions ───────────────────────────────── */

function ChatMessageRow({ entry, onCopyForWord }: {
  entry: LogEntry;
  onCopyForWord: (text: string) => void;
}) {
  const isAssistant = entry.role === 'assistant';
  return (
    <div className={`noteometry-mm-msg noteometry-mm-msg-${entry.role}`}>
      {entry.imageDataUrl && <img className="noteometry-mm-msg-img" src={entry.imageDataUrl} alt="Captured region" />}
      {isAssistant ? (
        <div className="noteometry-mm-msg-text">
          <div dangerouslySetInnerHTML={{ __html: renderAsMathML(entry.text) }} />
        </div>
      ) : (
        <div className="noteometry-mm-msg-text"><RichText value={entry.text} /></div>
      )}
      {isAssistant && (
        <div className="noteometry-mm-msg-actions">
          <button
            type="button"
            className="noteometry-mm-action noteometry-mm-action-primary"
            onClick={() => onCopyForWord(entry.text)}
            title="Copy MathML to clipboard (paste into Word)"
          >
            <span aria-hidden="true" className="noteometry-mm-action-glyph">W</span>
            Copy for Word
          </button>
        </div>
      )}
    </div>
  );
}

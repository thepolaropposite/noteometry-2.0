/**
 * MathMessagePane — Noteometry OS right-side AI control surface.
 *
 * Architecture (ported from noteometry-obsidian v1.6.6, commit 79cfb74):
 *
 *   MATH pipeline
 *     1. lasso math on canvas
 *     2. Read Math: vision call with mathRead.ts prompt (transcribe only)
 *     3. result lands in editable "Verified Input" textarea
 *     4. Verified Input renders mixed prose + LaTeX as MathML live
 *     5. Dan corrects any recognition errors
 *     6. Solve: TEXT-ONLY call with mathV12.ts system + injected input
 *     7. Answer joins the chat log with Copy-for-Word / Copy-LaTeX / Copy-plain
 *
 *   GENERAL pipeline
 *     1. lasso anything
 *     2. Capture General: vision call with generalVision.ts prompt + user text
 *     3. Answer joins the general chat log
 *
 * One active AI profile drives all remote reasoning. The production
 * direction is OpenAI through Vercel server functions so the browser
 * never holds a secret. The screenshot path is exclusively a rendered
 * canvas-region image — no OCR, no shape JSON, no object parsing.
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
import {
  EyeIcon, SolveIcon, CameraIcon, AskIcon, TrashIcon, WordIcon,
} from './Icons';

const STORAGE_KEY = 'noteometry-os:math-message-pane:v4';
const LEGACY_STORAGE_KEY = 'noteometry-os:math-message-pane:v3';
const PANE_WIDTH_MIN = 320;
const PANE_WIDTH_DEFAULT = 380;
const PANE_WIDTH_MAX_HARD = 720;

type Mode = 'math' | 'general' | 'voice';
type Role = 'user' | 'assistant' | 'system' | 'error';

interface CapturedImage {
  dataUrl: string;
  width: number;
  height: number;
  capturedAt: number;
  shapeCount: number;
}

interface LegacyCanvasEditor {
  getSelectedShapeIds: () => string[];
  getCurrentPageShapeIds: () => Set<string>;
  toImageDataUrl: (
    ids: string[],
    options: { format: 'png'; scale: number; background: boolean; padding: number }
  ) => Promise<{ url: string; width: number; height: number } | null>;
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
  voiceLog: LogEntry[];
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
    voiceLog: [],
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

function hostedAiConfig(config?: Partial<AiConfig>): AiConfig {
  if (config?.provider === 'openai') {
    return { ...defaultJobConfig(), ...config, apiKey: '' };
  }
  return defaultJobConfig();
}

function loadPersisted(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Persisted>;
      return {
        paneOpen: parsed.paneOpen ?? true,
        paneWidth: clampWidth(parsed.paneWidth ?? PANE_WIDTH_DEFAULT),
        mode: parsed.mode === 'general' || parsed.mode === 'voice' ? parsed.mode : 'math',
        showSettings: parsed.showSettings ?? false,
        ai: hostedAiConfig(parsed.ai),
        verifiedInput: parsed.verifiedInput ?? '',
        mathLog: Array.isArray(parsed.mathLog) ? parsed.mathLog : [],
        generalDraft: parsed.generalDraft ?? '',
        generalLog: Array.isArray(parsed.generalLog) ? parsed.generalLog : [],
        voiceLog: Array.isArray(parsed.voiceLog) ? parsed.voiceLog : [],
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
        ai: hostedAiConfig(readActiveFromLegacy(legacy)),
        verifiedInput: legacy.verifiedInput ?? '',
        mathLog: Array.isArray(legacy.mathLog) ? legacy.mathLog : [],
        generalDraft: legacy.generalDraft ?? '',
        generalLog: Array.isArray(legacy.generalLog) ? legacy.generalLog : [],
        voiceLog: [],
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

/* RichText was the prior user-message renderer. Removed in the GUI
 * overhaul; ResultRender handles assistant rendering and there is no
 * user-message surface now. */

/* ─── handle exposed to App.tsx for the right-click menu ─────────── */

export interface MathMessagePaneHandle {
  setMode: (mode: Mode) => void;
  readMath: () => Promise<void>;
  solveVerifiedMath: () => Promise<void>;
  captureGeneral: () => Promise<void>;
  focusAskAI: () => void;
}

export interface MathMessagePaneProps {
  editor: LegacyCanvasEditor | null;
  captureMixedSelection?: () => Promise<CapturedImage | null>;
  onPaneOpenChange?: (open: boolean) => void;
  onToast?: (msg: string) => void;
}

const MathMessagePane = forwardRef<MathMessagePaneHandle, MathMessagePaneProps>(function MathMessagePane(
  { editor, captureMixedSelection, onPaneOpenChange, onToast },
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

  const [voiceLog, setVoiceLog] = useState<LogEntry[]>(initial.voiceLog);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const [diag, setDiag] = useState<Diag | null>(null);

  const generalPromptRef = useRef<HTMLTextAreaElement | null>(null);

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
      generalDraft, generalLog, voiceLog,
    });
  }, [paneOpen, paneWidth, mode, showSettings, ai, verifiedInput, mathLog, generalDraft, generalLog, voiceLog]);


  /* ─── horizontal resize handle ───────────────────────────────── */

  const resizeStateRef = useRef<null | { pointerId: number; startX: number; startW: number }>(null);
  const onResizePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    resizeStateRef.current = { pointerId: e.pointerId, startX: e.clientX, startW: paneWidth };
  }, [paneWidth]);

  const applyResizePointerMove = useCallback((pointerId: number, clientX: number) => {
    const r = resizeStateRef.current;
    if (!r || pointerId !== r.pointerId) return;
    // Drag the left edge: moving LEFT increases width.
    const next = clampWidth(r.startW + (r.startX - clientX));
    setPaneWidth(next);
  }, []);

  const finishResizePointer = useCallback((pointerId: number) => {
    const r = resizeStateRef.current;
    if (!r || pointerId !== r.pointerId) return;
    resizeStateRef.current = null;
  }, []);

  const onResizePointerMove = useCallback((e: React.PointerEvent) => {
    applyResizePointerMove(e.pointerId, e.clientX);
  }, [applyResizePointerMove]);

  const onResizePointerUp = useCallback((e: React.PointerEvent) => {
    const r = resizeStateRef.current;
    if (!r || e.pointerId !== r.pointerId) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* pointer capture may already be released */
    }
    finishResizePointer(e.pointerId);
  }, [finishResizePointer]);

  useEffect(() => {
    const onWindowPointerMove = (e: PointerEvent) => {
      applyResizePointerMove(e.pointerId, e.clientX);
    };
    const onWindowPointerEnd = (e: PointerEvent) => {
      finishResizePointer(e.pointerId);
    };
    window.addEventListener('pointermove', onWindowPointerMove);
    window.addEventListener('pointerup', onWindowPointerEnd);
    window.addEventListener('pointercancel', onWindowPointerEnd);
    return () => {
      window.removeEventListener('pointermove', onWindowPointerMove);
      window.removeEventListener('pointerup', onWindowPointerEnd);
      window.removeEventListener('pointercancel', onWindowPointerEnd);
    };
  }, [applyResizePointerMove, finishResizePointer]);

  /* ─── capture ────────────────────────────────────────────────── */

  const captureSelection = useCallback(async (): Promise<CapturedImage | null> => {
    if (captureMixedSelection) {
      const mixed = await captureMixedSelection();
      if (mixed) {
        setCaptured(mixed);
        onToast?.(mixed.shapeCount > 0
          ? `Captured screenshot region with ${mixed.shapeCount} item${mixed.shapeCount === 1 ? '' : 's'}.`
          : 'Captured screenshot region.');
        return mixed;
      }
    }
    if (!editor) { onToast?.('Canvas not ready yet.'); return null; }
    let ids = editor.getSelectedShapeIds();
    let usedFallback = false;
    if (ids.length === 0) {
      ids = Array.from(editor.getCurrentPageShapeIds());
      usedFallback = ids.length > 0;
    }
    if (ids.length === 0) {
      onToast?.('Nothing to read yet. Add ink or select shapes first.');
      return null;
    }
    if (captureMixedSelection) {
      const mixed = await captureMixedSelection();
      if (mixed) {
        setCaptured(mixed);
        onToast?.(usedFallback
          ? `No lasso selection; captured page region with ${ids.length} shape${ids.length === 1 ? '' : 's'}.`
          : `Captured screenshot region with ${ids.length} shape${ids.length === 1 ? '' : 's'}.`);
        return mixed;
      }
    }
    try {
      const result = await editor.toImageDataUrl(ids, {
        format: 'png', scale: 2, background: true, padding: 12,
      });
      if (!result?.url) throw new Error('Export returned no image');
      const shot: CapturedImage = {
        dataUrl: result.url,
        width: result.width,
        height: result.height,
        capturedAt: Date.now(),
        shapeCount: ids.length,
      };
      setCaptured(shot);
      onToast?.(usedFallback
        ? `No lasso selection; captured ${ids.length} page shape${ids.length === 1 ? '' : 's'}.`
        : `Captured ${ids.length} shape${ids.length === 1 ? '' : 's'}.`);
      return shot;
    } catch (e) {
      onToast?.(`Capture failed: ${(e as Error).message}`);
      return null;
    }
  }, [editor, captureMixedSelection, onToast]);

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
      throw new Error(`${reason}${proxyHint}`, { cause: e });
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

  const transcribeVoice = useCallback(async (blob: Blob) => {
    setTranscribing(true);
    try {
      const res = await fetch('/api/transcribe', {
        method: 'POST',
        headers: {
          'content-type': blob.type || 'audio/webm',
          'x-noteometry-filename': `noteometry-${Date.now()}.webm`,
        },
        body: blob,
      });
      const json = await res.json() as { transcript?: string; notes?: string; error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      const transcript = json.transcript?.trim() ?? '';
      const notes = json.notes?.trim() ?? transcript;
      setVoiceLog((prev) => [...prev, {
        id: `v-${Date.now()}`,
        role: 'assistant',
        text: notes,
        promptVersion: 'voice-transcribe-cleanup-v1',
        ts: Date.now(),
      }]);
      if (transcript) {
        setVoiceLog((prev) => [...prev, {
          id: `vt-${Date.now()}`,
          role: 'system',
          text: `Raw transcript:\n${transcript}`,
          promptVersion: 'gpt-4o-transcribe',
          ts: Date.now(),
        }]);
      }
      onToast?.('Voice notes transcribed.');
    } catch (e) {
      setVoiceLog((prev) => [...prev, {
        id: `ve-${Date.now()}`,
        role: 'error',
        text: `Voice transcription failed — ${(e as Error).message}`,
        ts: Date.now(),
      }]);
    } finally {
      setTranscribing(false);
    }
  }, [onToast]);

  const startRecording = useCallback(async () => {
    if (recording || transcribing) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      onToast?.('This browser does not support microphone recording.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      audioChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        audioChunksRef.current = [];
        if (blob.size > 0) void transcribeVoice(blob);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      onToast?.('Recording voice note.');
    } catch (e) {
      onToast?.(`Could not start recording: ${(e as Error).message}`);
    }
  }, [recording, transcribing, transcribeVoice, onToast]);

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    recorder.stop();
    mediaRecorderRef.current = null;
    setRecording(false);
  }, []);

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
      generalDraft, generalLog, voiceLog,
    });
    setRecentlySaved(true);
    onToast?.('AI settings saved on this device.');
    if (recentlySavedTimer.current !== null) {
      window.clearTimeout(recentlySavedTimer.current);
    }
    recentlySavedTimer.current = window.setTimeout(() => {
      setRecentlySaved(false);
    }, 1500);
  }, [paneOpen, paneWidth, mode, showSettings, ai, verifiedInput, mathLog, generalDraft, generalLog, voiceLog, onToast]);

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

  return (
    <aside className="noteometry-mm-pane" aria-label="Math / Message">
      <header className="noteometry-mm-header">
        <div className="noteometry-mm-title">Math / Message</div>
        <div className="noteometry-mm-header-actions">
          <button type="button" className="noteometry-mm-iconbtn" title="Provider settings" aria-label="Provider settings" onClick={() => setShowSettings((s) => !s)}>⚙</button>
          <button type="button" className="noteometry-mm-iconbtn" title="Collapse pane" aria-label="Collapse pane" onClick={() => setPaneOpen(false)}>›</button>
        </div>
      </header>

      <div className="noteometry-mm-scroll">
        <div className="noteometry-mm-modetabs" role="tablist" aria-label="Pipeline">
          <button type="button" role="tab" aria-selected={mode === 'math'} className={`noteometry-mm-modetab${mode === 'math' ? ' is-active' : ''}`} onClick={() => setMode('math')}>Math</button>
          <button type="button" role="tab" aria-selected={mode === 'general'} className={`noteometry-mm-modetab${mode === 'general' ? ' is-active' : ''}`} onClick={() => setMode('general')}>General</button>
          <button type="button" role="tab" aria-selected={mode === 'voice'} className={`noteometry-mm-modetab${mode === 'voice' ? ' is-active' : ''}`} onClick={() => setMode('voice')}>Voice</button>
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
            <p className="noteometry-mm-settings-note">
              Hosted Noteometry should run one OpenAI key on Vercel. Browser
              keys are local-dev only; production calls must go through server
              functions so every device can use the same model access safely.
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

        <StatusChips
          mode={mode}
          diag={diag}
          captured={!!captured}
          verifiedReady={verifiedInput.trim().length > 0}
          modelName={ai.model}
        />

        {mode === 'math' ? (
          <MathPanel
            captured={captured}
            reading={reading}
            solving={solving}
            verifiedInput={verifiedInput}
            mathLog={mathLog}
            diag={diag}
            onReadMath={() => void readMath()}
            onSolve={() => void solveVerifiedMath()}
            onClearInput={() => setVerifiedInput('')}
            onInputChange={setVerifiedInput}
            onCopyForWord={onCopyForWord}
          />
        ) : mode === 'general' ? (
          <GeneralPanel
            captured={captured}
            generalDraft={generalDraft}
            generalLog={generalLog}
            generalSending={generalSending}
            diag={diag}
            onCapture={() => void captureGeneral()}
            onClearCapture={() => setCaptured(null)}
            onClearDraft={() => setGeneralDraft('')}
            onDraftChange={setGeneralDraft}
            onSend={() => void sendGeneral()}
            onCopyForWord={onCopyForWord}
            promptRef={generalPromptRef}
          />
        ) : (
          <VoicePanel
            recording={recording}
            transcribing={transcribing}
            voiceLog={voiceLog}
            onStart={startRecording}
            onStop={stopRecording}
            onClear={() => setVoiceLog([])}
            onCopyForWord={onCopyForWord}
          />
        )}
      </div>

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

/* ─── Shared pane primitives ──────────────────────────────────── */

/** Top-of-pane status chips. Replaces the old debug-console diag line
 *  ("Mode: math · Model: … · Captured: no · Verified Input: ready · Last
 *  HTTP: —") with a row of compact pills. The model name and the last
 *  HTTP/error live inside the per-panel Details disclosure now, not
 *  in the user's primary view. */
function StatusChips({ mode, diag, captured, verifiedReady, modelName }: {
  mode: Mode;
  diag: Diag | null;
  captured: boolean;
  verifiedReady: boolean;
  modelName: string;
}) {
  const connState = diag?.ok === false ? 'error' : 'ok';
  return (
    <section className="noteometry-mm-chips" aria-label="Status">
      <span className={`noteometry-mm-chip is-${mode}`}>{mode === 'math' ? 'Math' : mode === 'general' ? 'General' : 'Voice'}</span>
      <span className={`noteometry-mm-chip is-${connState}`} title={diag?.ok === false ? 'Last call failed — see Details' : 'Provider OK'}>
        {connState === 'error' ? 'Issue' : 'Connected'}
      </span>
      <span className={`noteometry-mm-chip ${captured ? 'is-on' : 'is-muted'}`}>
        {captured ? 'Captured' : 'No Capture'}
      </span>
      {mode === 'math' && (
        <span className={`noteometry-mm-chip ${verifiedReady ? 'is-on' : 'is-warn'}`}>
          {verifiedReady ? 'Ready' : 'Needs Input'}
        </span>
      )}
      <span className="noteometry-mm-chip is-model" title={`Model: ${modelName}`}>
        {modelName.split('/').pop() ?? modelName}
      </span>
    </section>
  );
}

/** Large app-like action button used in the per-panel action row. */
function ActionTile({ label, icon, onClick, disabled = false, accent, variant = 'primary' }: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  accent: string;
  variant?: 'primary' | 'secondary';
}) {
  const style = variant === 'primary'
    ? ({ ['--nm-action-accent' as 'color']: accent } as React.CSSProperties)
    : undefined;
  return (
    <button
      type="button"
      className={`noteometry-mm-tile noteometry-mm-tile-${variant}`}
      onClick={onClick}
      disabled={disabled}
      style={style}
      title={label}
    >
      <span className="noteometry-mm-tile-icon" aria-hidden="true">{icon}</span>
      <span className="noteometry-mm-tile-label">{label}</span>
    </button>
  );
}

/** Section card with a colored accent dot and a quiet title. Matches the
 *  right-click menu's section-header treatment so the AI pane reads as
 *  the menu pane's sibling. */
function Card({ title, accent, children, action }: {
  title: string;
  accent: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="noteometry-mm-card">
      <header className="noteometry-mm-card-head">
        <span className="noteometry-mm-card-dot" style={{ background: accent }} aria-hidden="true" />
        <h3 className="noteometry-mm-card-title">{title}</h3>
        {action && <div className="noteometry-mm-card-action">{action}</div>}
      </header>
      <div className="noteometry-mm-card-body">{children}</div>
    </section>
  );
}

/** Quiet empty-state placeholder for cards with no content yet. */
function CardPlaceholder({ icon, label }: { icon?: ReactNode; label: string }) {
  return (
    <div className="noteometry-mm-card-empty">
      {icon && <span className="noteometry-mm-card-empty-icon" aria-hidden="true">{icon}</span>}
      <span>{label}</span>
    </div>
  );
}

/* ─── Result rendering with v12 section detection ─────────────── */

const V12_SECTION_RE = /^(Problem(?:\s+\d+(?:\s+Week\s+\d+)?)?|Given|Equations|Where|Solution|Answer)\s*$/i;

interface ResultSection { kind: 'heading' | 'body'; value: string; isAnswer?: boolean }

function splitV12Sections(text: string): ResultSection[] {
  const out: ResultSection[] = [];
  const lines = text.split(/\r?\n/);
  let buf: string[] = [];
  const flush = () => {
    if (buf.length) {
      out.push({ kind: 'body', value: buf.join('\n').trim() });
      buf = [];
    }
  };
  for (const line of lines) {
    const trimmed = line.trim();
    if (V12_SECTION_RE.test(trimmed)) {
      flush();
      out.push({ kind: 'heading', value: trimmed, isAnswer: /^Answer$/i.test(trimmed) });
    } else {
      buf.push(line);
    }
  }
  flush();
  return out.filter((s) => s.kind === 'heading' || s.value.length > 0);
}

/** Render an assistant result. Math (v12 or otherwise) renders via
 *  KaTeX → MathML through renderAsMathML so equations are real, not
 *  raw escaped LaTeX. Section headers (Problem / Given / … / Answer)
 *  become visually distinct h4 rows; the final Answer block is
 *  highlighted. A "Show source" disclosure exposes the raw text. */
function ResultRender({ text }: { text: string }) {
  const [showSource, setShowSource] = useState(false);
  const sections = useMemo(() => splitV12Sections(text), [text]);
  const looksV12 = sections.some((s) => s.kind === 'heading');
  return (
    <div className="noteometry-mm-result">
      {looksV12 ? (
        <div className="noteometry-mm-result-v12">
          {sections.map((s, i) => {
            if (s.kind === 'heading') {
              return (
                <h4
                  key={`h-${i}`}
                  className={`noteometry-mm-result-heading${s.isAnswer ? ' is-answer' : ''}`}
                >
                  {s.value}
                </h4>
              );
            }
            return (
              <div
                key={`b-${i}`}
                className="noteometry-mm-result-body"
                dangerouslySetInnerHTML={{ __html: renderAsMathML(s.value) }}
              />
            );
          })}
        </div>
      ) : (
        <div
          className="noteometry-mm-result-body"
          dangerouslySetInnerHTML={{ __html: renderAsMathML(text) }}
        />
      )}
      <button
        type="button"
        className="noteometry-mm-result-source-toggle"
        onClick={() => setShowSource((v) => !v)}
        aria-expanded={showSource}
      >
        {showSource ? 'Hide source' : 'Show source'}
      </button>
      {showSource && <pre className="noteometry-mm-result-source">{text}</pre>}
    </div>
  );
}

/** Quiet disclosure for HTTP status / error excerpts / prompt versions /
 *  recent history — anything that would otherwise clutter the calm
 *  primary view. Default state: closed. */
function DetailsDisclosure({ diag, history }: {
  diag: Diag | null;
  history?: LogEntry[];
}) {
  if (!diag && !history?.length) return null;
  return (
    <details className="noteometry-mm-details">
      <summary>Details</summary>
      <div className="noteometry-mm-details-body">
        {diag && (
          <dl className="noteometry-mm-details-list">
            <dt>Step</dt><dd>{diag.step}</dd>
            <dt>Endpoint</dt><dd>{diag.endpoint}</dd>
            <dt>Model</dt><dd>{diag.model}</dd>
            <dt>Captured</dt><dd>{diag.captured ? 'yes' : 'no'}</dd>
            <dt>Preview ready</dt><dd>{diag.previewReady ? 'yes' : 'no'}</dd>
            <dt>Prompt</dt><dd>{diag.promptVersion ?? '—'}</dd>
            <dt>Last HTTP</dt><dd>{diag.httpStatus ?? '—'}</dd>
            {!diag.ok && diag.excerpt && (<><dt>Error</dt><dd className="noteometry-mm-details-err">{diag.excerpt}</dd></>)}
          </dl>
        )}
        {history && history.length > 1 && (
          <div className="noteometry-mm-details-history">
            <div className="noteometry-mm-details-history-head">Previous turns</div>
            {history.slice(0, -1).reverse().map((e) => (
              <div key={e.id} className={`noteometry-mm-details-history-item is-${e.role}`}>
                <span className="noteometry-mm-details-history-role">{e.role}</span>
                <span className="noteometry-mm-details-history-text">{e.text.slice(0, 220)}{e.text.length > 220 ? '…' : ''}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}

/* ─── MATH panel (Preview + Input + Solve + Chat) ─────────────── */

const ACCENT_CARD_CAPTURE = '#5aa0e8';   // blue — input from canvas
const ACCENT_CARD_VERIFIED = '#f3ba5b';  // amber — human verification
const ACCENT_CARD_RESULT = '#6ed18c';    // green — final answer
const ACCENT_CARD_QUESTION = '#8b95a5';  // slate — user prompt

const ACTION_ACCENT_WORD = '#a78bfa';
const ACTION_ACCENT_CAPTURE = '#5aa0e8';
const ACTION_ACCENT_ASK = '#6ed18c';
const ACTION_NEUTRAL = '#8b95a5';

function MathFlowBar({ captured, verifiedReady, computing, hasResult }: {
  captured: boolean;
  verifiedReady: boolean;
  computing: boolean;
  hasResult: boolean;
}) {
  const stages = [
    { label: 'Evidence', active: !captured, done: captured },
    { label: 'Interpret', active: captured && !verifiedReady, done: verifiedReady },
    { label: 'Verify', active: verifiedReady && !hasResult && !computing, done: hasResult },
    { label: 'Compute', active: computing, done: hasResult },
  ];
  return (
    <section className="noteometry-mm-flow" aria-label="Math processor flow">
      {stages.map((stage, index) => (
        <div
          key={stage.label}
          className={`noteometry-mm-flow-step${stage.active ? ' is-active' : ''}${stage.done ? ' is-done' : ''}`}
        >
          <span className="noteometry-mm-flow-index">{index + 1}</span>
          <span>{stage.label}</span>
        </div>
      ))}
    </section>
  );
}

function EngineButton({ label, icon, onClick, disabled = false, tone = 'blue' }: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'blue' | 'green' | 'purple' | 'neutral';
}) {
  return (
    <button
      type="button"
      className={`noteometry-mm-engine-btn is-${tone}`}
      onClick={onClick}
      disabled={disabled}
      title={label}
    >
      <span className="noteometry-mm-engine-btn-icon" aria-hidden="true">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function MathPanel(props: {
  captured: CapturedImage | null;
  reading: boolean;
  solving: boolean;
  verifiedInput: string;
  mathLog: LogEntry[];
  diag: Diag | null;
  onReadMath: () => void;
  onSolve: () => void;
  onClearInput: () => void;
  onInputChange: (next: string) => void;
  onCopyForWord: (text: string) => void;
}) {
  const {
    captured, reading, solving, verifiedInput, mathLog, diag,
    onReadMath, onSolve, onClearInput, onInputChange, onCopyForWord,
  } = props;

  const canSolve = verifiedInput.trim().length > 0 && !solving;
  const verifiedPreviewHtml = useMemo(() => renderAsMathML(verifiedInput), [verifiedInput]);
  const latestResult = useMemo(
    () => [...mathLog].reverse().find((e) => e.role === 'assistant') ?? null,
    [mathLog],
  );
  const hasResult = !!latestResult;

  return (
    <>
      <MathFlowBar
        captured={!!captured}
        verifiedReady={verifiedInput.trim().length > 0}
        computing={solving}
        hasResult={hasResult}
      />

      <section className="noteometry-mm-engine" aria-label="Math engine">
        <div className="noteometry-mm-engine-head">
          <div>
            <div className="noteometry-mm-engine-kicker">Noteometry v3</div>
            <h3 className="noteometry-mm-engine-title">Math Processor</h3>
          </div>
          <div className="noteometry-mm-engine-model">
            Vision → MathML → Compute
          </div>
        </div>
        <div className="noteometry-mm-engine-actions">
          <EngineButton
            label={reading ? 'Interpreting…' : 'Interpret Selection'}
            icon={<EyeIcon />}
            onClick={onReadMath}
            disabled={reading}
            tone="blue"
          />
          <EngineButton
            label={solving ? 'Computing…' : 'Compute'}
            icon={<SolveIcon />}
            onClick={onSolve}
            disabled={!canSolve}
            tone="green"
          />
          <EngineButton
            label="Copy MathML"
            icon={<WordIcon />}
            onClick={() => onCopyForWord(verifiedInput)}
            disabled={!verifiedInput.trim()}
            tone="purple"
          />
        </div>
      </section>

      <Card title="Evidence Capture" accent={ACCENT_CARD_CAPTURE}>
        {captured ? (
          <figure className="noteometry-mm-thumb">
            <img src={captured.dataUrl} alt="Math capture preview" />
            <figcaption>{captured.width}×{captured.height} · {captured.shapeCount} shape{captured.shapeCount === 1 ? '' : 's'}</figcaption>
          </figure>
        ) : (
          <CardPlaceholder icon={<CameraIcon />} label="No capture" />
        )}
      </Card>

      <Card
        title="MathML Editor"
        accent={ACCENT_CARD_VERIFIED}
        action={(
          <button
            type="button"
            className="noteometry-mm-card-action-btn"
            onClick={onClearInput}
            disabled={!verifiedInput}
          >
            Clear
          </button>
        )}
      >
        {/* The wrapper is intentionally a <section> with the legacy
            .noteometry-mm-preview-panel class so the e2e selector
            `section.noteometry-mm-preview-panel textarea` resolves. */}
        <section className="noteometry-mm-preview-panel">
          <div className="noteometry-mm-textarea-wrap">
            <textarea
              rows={5}
              value={verifiedInput}
              onChange={(e) => onInputChange(e.target.value)}
              placeholder="Edit the transcription, then Solve."
              spellCheck={false}
            />
            <button
              type="button"
              className="noteometry-mm-composer-clear"
              onClick={onClearInput}
              disabled={!verifiedInput}
              aria-label="Empty verified input"
              title="Empty field"
            >
              ×
            </button>
          </div>
          <div className="noteometry-mm-input-preview" aria-label="Verified input MathML preview">
            {verifiedInput.trim() ? (
              <div dangerouslySetInnerHTML={{ __html: verifiedPreviewHtml }} />
            ) : (
              <span className="noteometry-mm-preview-empty">Text and $LaTeX$ preview as MathML here.</span>
            )}
          </div>
        </section>
      </Card>

      <Card
        title="Computed Result"
        accent={ACCENT_CARD_RESULT}
        action={latestResult ? (
          <button
            type="button"
            className="noteometry-mm-card-action-btn"
            onClick={() => onCopyForWord(latestResult.text)}
          >
            Copy result
          </button>
        ) : undefined}
      >
        {latestResult ? (
          <ResultRender text={latestResult.text} />
        ) : solving ? (
          <CardPlaceholder label="Solving…" />
        ) : (
          <CardPlaceholder label="No result yet" />
        )}
      </Card>

      <DetailsDisclosure diag={diag} history={mathLog} />
    </>
  );
}

/* ─── GENERAL panel ────────────────────────────────────────────── */

function GeneralPanel(props: {
  captured: CapturedImage | null;
  generalDraft: string;
  generalLog: LogEntry[];
  generalSending: boolean;
  diag: Diag | null;
  onCapture: () => void;
  onClearCapture: () => void;
  onClearDraft: () => void;
  onDraftChange: (next: string) => void;
  onSend: () => void;
  onCopyForWord: (text: string) => void;
  promptRef: React.MutableRefObject<HTMLTextAreaElement | null>;
}) {
  const {
    captured, generalDraft, generalLog, generalSending, diag,
    onCapture, onClearCapture, onClearDraft, onDraftChange, onSend, onCopyForWord, promptRef,
  } = props;

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!generalSending) onSend();
      }
    },
    [onSend, generalSending]
  );

  const latestResult = useMemo(
    () => [...generalLog].reverse().find((e) => e.role === 'assistant') ?? null,
    [generalLog],
  );
  const hasResult = !!latestResult;

  return (
    <>
      <section className="noteometry-mm-actions" aria-label="General actions">
        <ActionTile
          label="Capture"
          icon={<CameraIcon />}
          onClick={onCapture}
          accent={ACTION_ACCENT_CAPTURE}
        />
        <ActionTile
          label={generalSending ? 'Asking…' : 'Ask'}
          icon={<AskIcon />}
          onClick={onSend}
          disabled={generalSending}
          accent={ACTION_ACCENT_ASK}
        />
        <ActionTile
          label="Copy for Word"
          icon={<WordIcon />}
          onClick={() => latestResult && onCopyForWord(latestResult.text)}
          disabled={!hasResult}
          accent={ACTION_ACCENT_WORD}
        />
        <ActionTile
          label="Clear Input"
          icon={<TrashIcon />}
          onClick={onClearDraft}
          disabled={!generalDraft}
          accent={ACTION_NEUTRAL}
          variant="secondary"
        />
      </section>

      <Card
        title="Capture"
        accent={ACCENT_CARD_CAPTURE}
        action={captured ? (
          <button type="button" onClick={onClearCapture} className="noteometry-mm-card-action-btn">Clear</button>
        ) : undefined}
      >
        {captured ? (
          <figure className="noteometry-mm-thumb">
            <img src={captured.dataUrl} alt="General capture preview" />
            <figcaption>{captured.width}×{captured.height} · {captured.shapeCount} shape{captured.shapeCount === 1 ? '' : 's'}</figcaption>
          </figure>
        ) : (
          <CardPlaceholder icon={<CameraIcon />} label="No capture" />
        )}
      </Card>

      <Card title="Question" accent={ACCENT_CARD_QUESTION}>
        <div className="noteometry-mm-composer">
          <div className="noteometry-mm-composer-input">
            <textarea
              ref={promptRef}
              value={generalDraft}
              onChange={(e) => onDraftChange(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Ask anything about the capture…"
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
        </div>
      </Card>

      <Card title="Result" accent={ACCENT_CARD_RESULT}>
        {latestResult ? (
          <ResultRender text={latestResult.text} />
        ) : generalSending ? (
          <CardPlaceholder label="Thinking…" />
        ) : (
          <CardPlaceholder label="No result yet" />
        )}
      </Card>

      <DetailsDisclosure diag={diag} history={generalLog} />
    </>
  );
}

/* ─── VOICE panel ──────────────────────────────────────────────── */

function VoicePanel(props: {
  recording: boolean;
  transcribing: boolean;
  voiceLog: LogEntry[];
  onStart: () => void;
  onStop: () => void;
  onClear: () => void;
  onCopyForWord: (text: string) => void;
}) {
  const { recording, transcribing, voiceLog, onStart, onStop, onClear, onCopyForWord } = props;
  const latestResult = useMemo(
    () => [...voiceLog].reverse().find((e) => e.role === 'assistant') ?? null,
    [voiceLog],
  );

  return (
    <>
      <section className="noteometry-mm-actions" aria-label="Voice actions">
        <ActionTile
          label={recording ? 'Stop' : transcribing ? 'Transcribing…' : 'Record'}
          icon={<span className="noteometry-mm-record-dot" />}
          onClick={recording ? onStop : onStart}
          disabled={transcribing}
          accent={recording ? '#e2554f' : ACTION_ACCENT_ASK}
        />
        <ActionTile
          label="Copy for Word"
          icon={<WordIcon />}
          onClick={() => latestResult && onCopyForWord(latestResult.text)}
          disabled={!latestResult}
          accent={ACTION_ACCENT_WORD}
        />
        <ActionTile
          label="Clear"
          icon={<TrashIcon />}
          onClick={onClear}
          disabled={voiceLog.length === 0 || recording || transcribing}
          accent={ACTION_NEUTRAL}
          variant="secondary"
        />
      </section>

      <Card title="Recorder" accent={recording ? '#e2554f' : ACCENT_CARD_CAPTURE}>
        <div className={`noteometry-mm-voice-state${recording ? ' is-recording' : ''}`}>
          <span className="noteometry-mm-record-dot" aria-hidden="true" />
          <span>{recording ? 'Recording… speak naturally.' : transcribing ? 'Turning voice into study notes…' : 'Ready to record a voice note.'}</span>
        </div>
      </Card>

      <Card title="Voice Notes" accent={ACCENT_CARD_RESULT}>
        {latestResult ? (
          <ResultRender text={latestResult.text} />
        ) : (
          <CardPlaceholder label="No voice notes yet" />
        )}
      </Card>

      <DetailsDisclosure diag={null} history={voiceLog} />
    </>
  );
}

/* ChatMessageRow / RichText removed in the GUI overhaul — the new
 * Result card uses ResultRender for assistant output, and there is no
 * separate user-message rendering surface. */

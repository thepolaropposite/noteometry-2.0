/**
 * Drop-In™ store — per-page collection, persisted to localStorage.
 *
 * Vanilla external store + useSyncExternalStore so any component can
 * subscribe with no provider/context boilerplate. Storage is keyed by
 * page id (the same id that drives tldraw's persistenceKey), so
 * Drop-Ins™ follow the active notebook page just like canvas content.
 *
 * Schema version is encoded in the storage key per Law 12. Bumping the
 * suffix means we either migrate or start fresh — we never mutate an
 * older key in place.
 */
import { useSyncExternalStore } from 'react';
import { markError, markSaved, markSaving } from '../lib/saveStatus';
import type {
  ChatMessage,
  ChatState,
  DropIn,
  DropInType,
  DropInsByPage,
  ImageState,
  MathState,
  PdfState,
  TableState,
  TextState,
} from './types';

const STORAGE_KEY = 'noteometry-os:dropins:v1';
const EMPTY_LIST: DropIn[] = Object.freeze([]) as unknown as DropIn[];

interface State {
  byPage: DropInsByPage;
}

function load(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { byPage: {} };
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') {
      return { byPage: parsed as DropInsByPage };
    }
  } catch {
    /* swallow */
  }
  return { byPage: {} };
}

function persist(byPage: DropInsByPage) {
  markSaving();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(byPage));
    markSaved();
  } catch (e) {
    markError('dropins', e);
  }
}

let state: State = load();
const listeners = new Set<() => void>();

function emit() {
  persist(state.byPage);
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function freshId(): string {
  return `di-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function defaultsFor(type: DropInType): {
  title: string;
  width: number;
  height: number;
  state: TextState | TableState | MathState | ChatState | ImageState | PdfState;
} {
  switch (type) {
    case 'text':
      return { title: 'Text Drop-In™', width: 260, height: 160, state: { text: '' } };
    case 'table':
      return {
        title: 'Table Drop-In™',
        width: 320,
        height: 180,
        state: { rows: [['', '', ''], ['', '', ''], ['', '', '']] },
      };
    case 'math':
      return { title: 'Math Drop-In™', width: 320, height: 220, state: { latex: '' } };
    case 'chat':
      return { title: 'Chat Drop-In™', width: 320, height: 280, state: { messages: [], draft: '' } };
    case 'image':
      return { title: 'Image Drop-In™', width: 280, height: 200, state: { src: '', alt: '' } };
    case 'pdf':
      return { title: 'PDF Drop-In™', width: 360, height: 260, state: { src: '', page: 1 } };
  }
}

/** Snap to the 12 px engineering-paper minor grid so Drop-Ins™ feel like
 *  they belong on the same paper as the ink. */
function snap(n: number, step = 12): number {
  return Math.round(n / step) * step;
}

export function addDropIn(pageId: string, type: DropInType, x: number, y: number): string {
  const d = defaultsFor(type);
  const dropIn = {
    id: freshId(),
    type,
    x: Math.max(8, snap(x - d.width / 2)),
    y: Math.max(8, snap(y - 18)),
    width: d.width,
    height: d.height,
    title: d.title,
    state: d.state,
  } as DropIn;
  const existing = state.byPage[pageId] ?? [];
  state = { byPage: { ...state.byPage, [pageId]: [...existing, dropIn] } };
  emit();
  return dropIn.id;
}

export function addImageDropIn(pageId: string, src: string, alt: string, x: number, y: number): string {
  const d = defaultsFor('image');
  const dropIn: DropIn = {
    id: freshId(),
    type: 'image',
    x: Math.max(8, snap(x - d.width / 2)),
    y: Math.max(8, snap(y - 18)),
    width: d.width,
    height: d.height,
    title: 'Pasted Image',
    state: { src, alt },
  };
  const existing = state.byPage[pageId] ?? [];
  state = { byPage: { ...state.byPage, [pageId]: [...existing, dropIn] } };
  emit();
  return dropIn.id;
}

export function deleteDropIn(pageId: string, id: string): void {
  const list = state.byPage[pageId];
  if (!list) return;
  state = { byPage: { ...state.byPage, [pageId]: list.filter((d) => d.id !== id) } };
  emit();
}

interface FrameUpdate {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  title?: string;
}

export function updateDropInFrame(pageId: string, id: string, patch: FrameUpdate): void {
  const list = state.byPage[pageId];
  if (!list) return;
  const next = list.map((d) => (d.id === id ? ({ ...d, ...patch } as DropIn) : d));
  state = { byPage: { ...state.byPage, [pageId]: next } };
  emit();
}

/** Type-narrowed state update. Each call gets the partial that matches
 *  the Drop-In™'s declared `type`. */
export function updateTextState(pageId: string, id: string, patch: Partial<TextState>) {
  const list = state.byPage[pageId];
  if (!list) return;
  const next = list.map((d) => {
    if (d.id !== id || d.type !== 'text') return d;
    return { ...d, state: { ...d.state, ...patch } };
  });
  state = { byPage: { ...state.byPage, [pageId]: next } };
  emit();
}

export function updateTableState(pageId: string, id: string, patch: Partial<TableState>) {
  const list = state.byPage[pageId];
  if (!list) return;
  const next = list.map((d) => {
    if (d.id !== id || d.type !== 'table') return d;
    return { ...d, state: { ...d.state, ...patch } };
  });
  state = { byPage: { ...state.byPage, [pageId]: next } };
  emit();
}

export function updateMathState(pageId: string, id: string, patch: Partial<MathState>) {
  const list = state.byPage[pageId];
  if (!list) return;
  const next = list.map((d) => {
    if (d.id !== id || d.type !== 'math') return d;
    return { ...d, state: { ...d.state, ...patch } };
  });
  state = { byPage: { ...state.byPage, [pageId]: next } };
  emit();
}

export function updateChatState(pageId: string, id: string, patch: Partial<ChatState>) {
  const list = state.byPage[pageId];
  if (!list) return;
  const next = list.map((d) => {
    if (d.id !== id || d.type !== 'chat') return d;
    return { ...d, state: { ...d.state, ...patch } };
  });
  state = { byPage: { ...state.byPage, [pageId]: next } };
  emit();
}

export function updateImageState(pageId: string, id: string, patch: Partial<ImageState>) {
  const list = state.byPage[pageId];
  if (!list) return;
  const next = list.map((d) => {
    if (d.id !== id || d.type !== 'image') return d;
    return { ...d, state: { ...d.state, ...patch } };
  });
  state = { byPage: { ...state.byPage, [pageId]: next } };
  emit();
}

export function updatePdfState(pageId: string, id: string, patch: Partial<PdfState>) {
  const list = state.byPage[pageId];
  if (!list) return;
  const next = list.map((d) => {
    if (d.id !== id || d.type !== 'pdf') return d;
    return { ...d, state: { ...d.state, ...patch } };
  });
  state = { byPage: { ...state.byPage, [pageId]: next } };
  emit();
}

export function appendChatMessage(pageId: string, id: string, msg: Omit<ChatMessage, 'id' | 'ts'>) {
  const list = state.byPage[pageId];
  if (!list) return;
  const next = list.map((d) => {
    if (d.id !== id || d.type !== 'chat') return d;
    const full: ChatMessage = {
      id: `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      ts: Date.now(),
      ...msg,
    };
    return { ...d, state: { ...d.state, messages: [...d.state.messages, full] } };
  });
  state = { byPage: { ...state.byPage, [pageId]: next } };
  emit();
}

/** Reorder the given Drop-In™ to the end of the list so it renders on
 *  top (used when a frame is clicked). */
export function bringToFront(pageId: string, id: string): void {
  const list = state.byPage[pageId];
  if (!list) return;
  const idx = list.findIndex((d) => d.id === id);
  if (idx < 0 || idx === list.length - 1) return;
  const target = list[idx]!;
  const next = [...list.slice(0, idx), ...list.slice(idx + 1), target];
  state = { byPage: { ...state.byPage, [pageId]: next } };
  emit();
}

export function useDropInsForPage(pageId: string): DropIn[] {
  return useSyncExternalStore(
    subscribe,
    () => state.byPage[pageId] ?? EMPTY_LIST,
    () => EMPTY_LIST,
  );
}

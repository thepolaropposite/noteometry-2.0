/**
 * saveStatus — tiny pub/sub for the persistence indicator.
 *
 * Every place that writes to localStorage calls `withSave(label, fn)`.
 * The helper marks `saving`, runs the write, and marks `saved` on
 * success or `error` on failure. The status dot in the section bar
 * reflects this so Dan never has to wonder whether his work is captured.
 *
 * Errors carry a short label so the dot's tooltip is specific
 * ("dropins", "ai-pane", …) instead of generic.
 */
import { useSyncExternalStore } from 'react';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface State {
  status: SaveStatus;
  lastSavedAt: number | null;
  lastError: { label: string; message: string } | null;
}

let state: State = { status: 'idle', lastSavedAt: null, lastError: null };
const listeners = new Set<() => void>();
let savedClearTimer: number | null = null;

function emit() { for (const l of listeners) l(); }

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function markSaving() {
  state = { ...state, status: 'saving' };
  emit();
}

export function markSaved() {
  state = { status: 'saved', lastSavedAt: Date.now(), lastError: null };
  emit();
  // Drop back to idle after a moment so the dot relaxes to its
  // resting green-on-grey state instead of pulsing forever.
  if (savedClearTimer !== null) window.clearTimeout(savedClearTimer);
  savedClearTimer = window.setTimeout(() => {
    state = { ...state, status: 'idle' };
    emit();
  }, 1200);
}

export function markError(label: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  state = { status: 'error', lastSavedAt: state.lastSavedAt, lastError: { label, message } };
  emit();
}

/** Wrap a synchronous persistence write. The label is shown in error
 *  tooltips so the indicator can name the failing surface. */
export function withSave<T>(label: string, fn: () => T): T {
  markSaving();
  try {
    const result = fn();
    markSaved();
    return result;
  } catch (e) {
    markError(label, e);
    throw e;
  }
}

export function useSaveStatus(): State {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

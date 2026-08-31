/**
 * Drop-In™ types — Phase 1.
 *
 * Per Law 2 (Canvas Law) and Law 3 (Drop-In™ Law) of the Feature
 * Contract: the canvas itself only holds ink + Math Palette glyphs.
 * Text, Table, Math, Chat, Image, and PDF
 * are Drop-Ins™ — self-contained mini-apps anchored to the canvas with
 * their own identity, title, position, size, state, UI, and lifecycle.
 *
 * Phase 1 ships six Drop-In™ types. Position/size (x, y, width,
 * height) are world-space units — the same coordinate space as ink
 * strokes — not raw screen pixels. DropInHost is mounted inside
 * .noteometry-canvas-content (see App.tsx), so CSS transform
 * inheritance makes frames pan/zoom with the canvas automatically;
 * DropInHost's drag/resize handlers convert screen-pixel pointer
 * deltas back into these units via the current zoom.
 */

export type DropInType = 'text' | 'table' | 'math' | 'chat' | 'image' | 'pdf';

export interface DropInBase {
  id: string;
  type: DropInType;
  /** Shell-relative CSS pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
}

export interface TextState {
  text: string;
}

export interface TableState {
  /** Row-major editable grid. Rows/columns can grow from the UI. */
  rows: string[][];
}

export interface MathState {
  latex: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'note';
  text: string;
  ts: number;
}

export interface ChatState {
  messages: ChatMessage[];
  draft: string;
}

export interface ImageState {
  /** Either a data: URL or an http(s) URL. */
  src: string;
  alt: string;
}

export interface PdfState {
  /** Either a data: URL or an http(s) URL. */
  src: string;
  page: number;
}

export type DropIn =
  | (DropInBase & { type: 'text'; state: TextState })
  | (DropInBase & { type: 'table'; state: TableState })
  | (DropInBase & { type: 'math'; state: MathState })
  | (DropInBase & { type: 'chat'; state: ChatState })
  | (DropInBase & { type: 'image'; state: ImageState })
  | (DropInBase & { type: 'pdf'; state: PdfState });

/** Storage schema for the per-page Drop-In™ collection. */
export type DropInsByPage = Record<string, DropIn[]>;

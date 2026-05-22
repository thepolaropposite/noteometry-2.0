/**
 * Drop-In™ types — Phase 1.
 *
 * Per Law 2 (Canvas Law) and Law 3 (Drop-In™ Law) of the Feature
 * Contract: the canvas itself only holds ink + Math Palette glyphs.
 * Text, Table, Math, Chat, Image, and PDF
 * are Drop-Ins™ — self-contained mini-apps anchored to the canvas with
 * their own identity, title, position, size, state, UI, and lifecycle.
 *
 * Phase 1 ships four Drop-In™ types. Position is shell-relative CSS
 * pixels for now — tying it to canvas-space (so Drop-Ins™ pan/zoom with
 * tldraw) is a Phase 2 concern and is intentionally deferred.
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

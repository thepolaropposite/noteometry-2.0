/**
 * DropInHost — overlay above the ink canvas that renders every
 * Drop-In™ for the active page.
 *
 * Pointer semantics (Law 2): the host itself is `pointer-events: none`
 * so ink/select/eraser pass through outside any Drop-In™. Individual
 * Drop-In™ frames flip to `pointer-events: auto`, so typing and editing
 * inside them works, and drag/resize captures the pointer via
 * setPointerCapture so the canvas never starts an unintended stroke
 * mid-drag.
 *
 * Canvas anchoring: this host is mounted inside .noteometry-canvas-content
 * (see App.tsx), which carries the `transform: scale(canvasZoom)` that
 * also scales the ink layer, and that content div's ancestor
 * .noteometry-canvas-world is what actually scrolls inside the shell.
 * Because of that DOM nesting, frame position/size — stored in the same
 * un-scaled world-space units as ink strokes — already pans and zooms
 * with the canvas for free; no separate pageToScreen sync is needed.
 * The one thing CSS inheritance does NOT do for us is drag/resize input:
 * pointer deltas arrive in real screen pixels, so they must be divided
 * by `zoom` before being added to world-space x/y/width/height, or
 * dragging/resizing drifts at any zoom level other than 100%.
 *
 * Right-click on a Drop-In™ deliberately bubbles up to the canvas-shell
 * so the flat right-click menu (Law 7) stays the canonical command
 * surface even when the cursor is over a card.
 */
import { useCallback, useRef, useState, type ReactNode } from 'react';
import type { DropIn } from './types';
import {
  bringToFront,
  deleteDropIn,
  updateDropInFrame,
  useDropInsForPage,
} from './dropInStore';
import TextDropIn from './TextDropIn';
import TableDropIn from './TableDropIn';
import MathDropIn from './MathDropIn';
import ChatDropIn from './ChatDropIn';
import ImageDropIn from './ImageDropIn';
import PdfDropIn from './PdfDropIn';

interface HostProps {
  pageId: string;
  /** Current canvas zoom (see App.tsx canvasZoom). Drag/resize deltas
   *  arrive in screen pixels and must be converted to world-space. */
  zoom: number;
}

export default function DropInHost({ pageId, zoom }: HostProps) {
  const items = useDropInsForPage(pageId);
  return (
    <div className="noteometry-dropin-host" aria-label="Drop-Ins">
      {items.map((d) => (
        <DropInFrame key={d.id} pageId={pageId} dropIn={d} zoom={zoom} />
      ))}
    </div>
  );
}

const MIN_W = 160;
const MIN_H = 96;

interface FrameProps {
  pageId: string;
  dropIn: DropIn;
  zoom: number;
}

function DropInFrame({ pageId, dropIn, zoom }: FrameProps) {
  // Local drag/resize state. We only commit to the store on pointerup so
  // every keystroke during a drag doesn't trigger localStorage writes.
  const [draft, setDraft] = useState<null | { x: number; y: number; width: number; height: number }>(null);
  const dragRef = useRef<null | { kind: 'move' | 'resize'; pointerId: number; startX: number; startY: number; baseX: number; baseY: number; baseW: number; baseH: number }>(null);

  const onHeaderPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      kind: 'move',
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      baseX: dropIn.x,
      baseY: dropIn.y,
      baseW: dropIn.width,
      baseH: dropIn.height,
    };
    setDraft({ x: dropIn.x, y: dropIn.y, width: dropIn.width, height: dropIn.height });
    bringToFront(pageId, dropIn.id);
  }, [pageId, dropIn]);

  const onResizePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      kind: 'resize',
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      baseX: dropIn.x,
      baseY: dropIn.y,
      baseW: dropIn.width,
      baseH: dropIn.height,
    };
    setDraft({ x: dropIn.x, y: dropIn.y, width: dropIn.width, height: dropIn.height });
    bringToFront(pageId, dropIn.id);
  }, [pageId, dropIn]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    // Pointer deltas are real screen pixels; dropIn.x/y/width/height are
    // world-space (same units as ink), so convert through the current
    // zoom before applying — otherwise drag/resize drift off-cursor at
    // any zoom level other than 100%.
    const z = zoom || 1;
    const dx = (e.clientX - d.startX) / z;
    const dy = (e.clientY - d.startY) / z;
    if (d.kind === 'move') {
      setDraft({
        x: Math.max(0, d.baseX + dx),
        y: Math.max(0, d.baseY + dy),
        width: d.baseW,
        height: d.baseH,
      });
    } else {
      setDraft({
        x: d.baseX,
        y: d.baseY,
        width: Math.max(MIN_W, d.baseW + dx),
        height: Math.max(MIN_H, d.baseH + dy),
      });
    }
  }, [zoom]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    if (draft) {
      updateDropInFrame(pageId, dropIn.id, draft);
    }
    dragRef.current = null;
    setDraft(null);
  }, [draft, pageId, dropIn.id]);

  const rect = draft ?? { x: dropIn.x, y: dropIn.y, width: dropIn.width, height: dropIn.height };

  const onTitleDblClick = useCallback(() => {
    const next = window.prompt('Rename Drop-In™:', dropIn.title);
    if (next && next.trim()) updateDropInFrame(pageId, dropIn.id, { title: next.trim() });
  }, [pageId, dropIn]);

  // Stop pointerdown inside the editing area from triggering a tldraw
  // stroke if the user clicks the body (frame already captures the
  // initial down event because pointer-events:auto on the frame, but
  // we also stop propagation defensively).
  const onBodyPointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    bringToFront(pageId, dropIn.id);
  }, [pageId, dropIn.id]);

  return (
    <div
      className={`noteometry-dropin-frame is-${dropIn.type}`}
      style={{
        left: `${rect.x}px`,
        top: `${rect.y}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      }}
      onPointerDown={onBodyPointerDown}
    >
      <header
        className="noteometry-dropin-header"
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onTitleDblClick}
        title="Drag to move · double-click to rename"
      >
        <span className="noteometry-dropin-type-badge" aria-hidden="true">
          {badgeFor(dropIn.type)}
        </span>
        <span className="noteometry-dropin-title">{dropIn.title}</span>
        <button
          type="button"
          className="noteometry-dropin-close"
          aria-label="Delete Drop-In"
          title="Delete Drop-In"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            if (window.confirm(`Delete "${dropIn.title}"?`)) deleteDropIn(pageId, dropIn.id);
          }}
        >
          ×
        </button>
      </header>

      <div className="noteometry-dropin-body">
        <Body dropIn={dropIn} pageId={pageId} />
      </div>

      <div
        className="noteometry-dropin-resize"
        onPointerDown={onResizePointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        aria-hidden="true"
      />
    </div>
  );
}

function badgeFor(type: DropIn['type']): string {
  switch (type) {
    case 'text': return 'T';
    case 'table': return '⊞';
    case 'math': return '∑';
    case 'chat': return '✉';
    case 'image': return '▣';
    case 'pdf': return '▤';
  }
}

function Body({ dropIn, pageId }: { dropIn: DropIn; pageId: string }): ReactNode {
  switch (dropIn.type) {
    case 'text':
      return <TextDropIn pageId={pageId} dropInId={dropIn.id} state={dropIn.state} />;
    case 'table':
      return <TableDropIn pageId={pageId} dropInId={dropIn.id} state={dropIn.state} />;
    case 'math':
      return <MathDropIn pageId={pageId} dropInId={dropIn.id} state={dropIn.state} />;
    case 'chat':
      return <ChatDropIn pageId={pageId} dropInId={dropIn.id} state={dropIn.state} />;
    case 'image':
      return <ImageDropIn pageId={pageId} dropInId={dropIn.id} state={dropIn.state} />;
    case 'pdf':
      return <PdfDropIn pageId={pageId} dropInId={dropIn.id} state={dropIn.state} />;
  }
}


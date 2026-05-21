import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toPng } from 'html-to-image';
import MathMessagePane, { type MathMessagePaneHandle } from './components/MathMessagePane';
import ContextMenu, { type ContextMenuItem } from './components/ContextMenu';
import SectionTabs from './components/SectionTabs';
import PageRail from './components/PageRail';
import MathPalette, { type PaletteStamp } from './components/MathPalette';
import {
  PenIcon, EraserIcon, CursorIcon, TextIcon, TableIcon, ImageIcon, PdfIcon,
  MathPaletteIcon, MathIcon, SolveIcon,
} from './components/Icons';
import { useNoteometryNav } from './lib/useNoteometryNav';
import DropInHost from './dropins/DropInHost';
import { addDropIn, addImageDropIn } from './dropins/dropInStore';
import type { DropInType } from './dropins/types';

const CANVAS_ITEMS_PREFIX = 'noteometry-os:canvas-items:v1:';

type ToolMode = 'draw' | 'eraser' | 'select';

interface CanvasPoint {
  x: number;
  y: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface StrokeItem {
  id: string;
  type: 'stroke';
  points: CanvasPoint[];
  color: string;
  size: number;
}

interface TextItem {
  id: string;
  type: 'text';
  x: number;
  y: number;
  text: string;
  size: 'small' | 'large';
  color: string;
}

type CanvasItem = StrokeItem | TextItem;

interface MixedCapture {
  dataUrl: string;
  width: number;
  height: number;
  capturedAt: number;
  shapeCount: number;
}

interface CanvasDocument {
  items: CanvasItem[];
  savedAt: number;
}

function freshItemId(): string {
  return `ci-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function readCanvasItems(pageId: string): CanvasItem[] {
  try {
    const raw = localStorage.getItem(`${CANVAS_ITEMS_PREFIX}${pageId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<CanvasDocument>;
    return Array.isArray(parsed.items) ? parsed.items : [];
  } catch {
    return [];
  }
}

function writeCanvasItems(pageId: string, items: CanvasItem[]) {
  try {
    const doc: CanvasDocument = { items, savedAt: Date.now() };
    localStorage.setItem(`${CANVAS_ITEMS_PREFIX}${pageId}`, JSON.stringify(doc));
  } catch (err) {
    console.warn('[Noteometry] canvas save failed', err);
  }
}

function normalizeRect(a: CanvasPoint, b: CanvasPoint): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

function inflateRect(rect: Rect, pad: number): Rect {
  return { x: rect.x - pad, y: rect.y - pad, w: rect.w + pad * 2, h: rect.h + pad * 2 };
}

function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
}

function boundsForItem(item: CanvasItem): Rect {
  if (item.type === 'text') {
    const fontSize = item.size === 'large' ? 34 : 22;
    return { x: item.x, y: item.y - fontSize, w: Math.max(24, item.text.length * fontSize * 0.62), h: fontSize * 1.25 };
  }
  const xs = item.points.map((p) => p.x);
  const ys = item.points.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return inflateRect({ x: minX, y: minY, w: maxX - minX, h: maxY - minY }, item.size + 2);
}

function boundsForItems(items: CanvasItem[]): Rect | null {
  if (items.length === 0) return null;
  const rects = items.map(boundsForItem);
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.w));
  const maxY = Math.max(...rects.map((r) => r.y + r.h));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function pathFromPoints(points: CanvasPoint[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  if (points.length === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const current = points[i];
    const next = points[i + 1];
    d += ` Q ${current.x} ${current.y} ${(current.x + next.x) / 2} ${(current.y + next.y) / 2}`;
  }
  const last = points[points.length - 1];
  return `${d} L ${last.x} ${last.y}`;
}

function distanceToSegment(p: CanvasPoint, a: CanvasPoint, b: CanvasPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function itemHitTest(item: CanvasItem, point: CanvasPoint, tolerance = 12): boolean {
  const bounds = inflateRect(boundsForItem(item), tolerance);
  if (!rectsIntersect(bounds, { x: point.x, y: point.y, w: 1, h: 1 })) return false;
  if (item.type === 'text') return true;
  for (let i = 0; i < item.points.length - 1; i += 1) {
    if (distanceToSegment(point, item.points[i], item.points[i + 1]) <= tolerance + item.size) return true;
  }
  return false;
}

export default function App() {
  const [currentTool, setCurrentTool] = useState<ToolMode>('select');
  const [toast, setToast] = useState<string | null>(null);
  const [mmPaneOpen, setMmPaneOpen] = useState<boolean>(true);
  const [pageRailOpen, setPageRailOpen] = useState<boolean>(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const toastTimer = useRef<number | null>(null);
  const paneRef = useRef<MathMessagePaneHandle>(null);
  const canvasShellRef = useRef<HTMLDivElement | null>(null);
  const lastCanvasPointRef = useRef<{ x: number; y: number } | null>(null);
  const [mathPaletteOpen, setMathPaletteOpen] = useState<boolean>(false);
  const [paletteStamp, setPaletteStamp] = useState<PaletteStamp | null>(null);
  const nav = useNoteometryNav();
  const activePageId = nav.activePage.id;
  const [itemsByPage, setItemsByPage] = useState<Record<string, CanvasItem[]>>(() => ({
    [activePageId]: readCanvasItems(activePageId),
  }));
  const [selectedIdsByPage, setSelectedIdsByPage] = useState<Record<string, string[]>>({});
  const [isCapturingCanvas, setIsCapturingCanvas] = useState(false);
  const canvasItems = itemsByPage[activePageId] ?? readCanvasItems(activePageId);
  const selectedItemIds = useMemo(
    () => new Set(selectedIdsByPage[activePageId] ?? []),
    [activePageId, selectedIdsByPage]
  );

  const selectedItems = useMemo(
    () => canvasItems.filter((item) => selectedItemIds.has(item.id)),
    [canvasItems, selectedItemIds]
  );

  const selectedBounds = useMemo(() => boundsForItems(selectedItems), [selectedItems]);

  const showToast = useCallback((msg: string, ms = 2400) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), ms);
  }, []);

  useEffect(() => {
    const items = itemsByPage[activePageId];
    if (items) writeCanvasItems(activePageId, items);
  }, [activePageId, itemsByPage]);

  const setActiveCanvasItems = useCallback((update: React.SetStateAction<CanvasItem[]>) => {
    setItemsByPage((prev) => {
      const current = prev[activePageId] ?? readCanvasItems(activePageId);
      const next = typeof update === 'function'
        ? (update as (prev: CanvasItem[]) => CanvasItem[])(current)
        : update;
      return { ...prev, [activePageId]: next };
    });
  }, [activePageId]);

  const setActiveSelectedItemIds = useCallback((ids: Set<string>) => {
    setSelectedIdsByPage((prev) => ({ ...prev, [activePageId]: [...ids] }));
  }, [activePageId]);

  const setCanvasTool = useCallback((id: ToolMode) => {
    setCurrentTool(id);
  }, []);

  const shellPointFromClient = useCallback((clientX: number, clientY: number) => {
    const shell = canvasShellRef.current;
    if (!shell) return null;
    const rect = shell.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, []);

  const spawnDropIn = useCallback((type: Exclude<DropInType, 'math' | 'chat'>, point: { x: number; y: number } | null) => {
    const shell = canvasShellRef.current;
    const target = point ?? (shell
      ? { x: shell.clientWidth / 2, y: shell.clientHeight / 2 }
      : { x: 260, y: 180 });
    addDropIn(activePageId, type, target.x, target.y);
    const label = type === 'pdf' ? 'PDF' : `${type[0].toUpperCase()}${type.slice(1)}`;
    showToast(`${label} Drop-In added.`);
  }, [activePageId, showToast]);

  const pasteImageFile = useCallback((file: File, point?: { x: number; y: number } | null) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') return;
      const shell = canvasShellRef.current;
      const target = point ?? (shell
        ? { x: shell.clientWidth / 2, y: shell.clientHeight / 2 }
        : { x: 260, y: 180 });
      addImageDropIn(activePageId, result, file.name || 'Pasted image', target.x, target.y);
      showToast('Image pasted onto the canvas.');
    };
    reader.readAsDataURL(file);
  }, [activePageId, showToast]);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      const file = Array.from(e.clipboardData?.items ?? [])
        .find((item) => item.kind === 'file' && item.type.startsWith('image/'))
        ?.getAsFile();
      if (!file) return;
      e.preventDefault();
      pasteImageFile(file, lastCanvasPointRef.current);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [pasteImageFile]);

  const dropPaletteStamp = useCallback((clientX: number, clientY: number) => {
    if (!paletteStamp) return;
    const point = shellPointFromClient(clientX, clientY);
    if (!point) return;
    setActiveCanvasItems((prev) => [...prev, {
      id: freshItemId(),
      type: 'text',
      x: point.x,
      y: point.y,
      text: paletteStamp.symbol,
      size: paletteStamp.size,
      color: '#f7f1dc',
    }]);
    showToast(`Stamped "${paletteStamp.symbol}" (${paletteStamp.size}).`);
  }, [paletteStamp, setActiveCanvasItems, shellPointFromClient, showToast]);

  const captureMixedSelection = useCallback(async (): Promise<MixedCapture | null> => {
    if (!canvasShellRef.current) return null;
    const shell = canvasShellRef.current;
    const targetItems = selectedItems.length > 0 ? selectedItems : canvasItems;
    if (targetItems.length === 0) return null;
    const bounds = boundsForItems(targetItems);
    if (!bounds) return null;
    const shellRect = shell.getBoundingClientRect();
    const pad = 16;
    const crop = {
      x: Math.max(0, bounds.x - pad),
      y: Math.max(0, bounds.y - pad),
      width: Math.min(shellRect.width, bounds.w + pad * 2),
      height: Math.min(shellRect.height, bounds.h + pad * 2),
    };
    setIsCapturingCanvas(true);
    try {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const fullDataUrl = await toPng(shell, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: '#6f7479',
        filter: (node) => {
          if (!(node instanceof Element)) return true;
          return !node.classList.contains('noteometry-stamp-overlay')
            && !node.classList.contains('noteometry-selection-overlay');
        },
      });
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = fullDataUrl;
      });
      const scaleX = img.width / shellRect.width;
      const scaleY = img.height / shellRect.height;
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(crop.width * scaleX));
      canvas.height = Math.max(1, Math.round(crop.height * scaleY));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not create capture canvas.');
      ctx.drawImage(
        img,
        crop.x * scaleX,
        crop.y * scaleY,
        crop.width * scaleX,
        crop.height * scaleY,
        0,
        0,
        canvas.width,
        canvas.height
      );
      return {
        dataUrl: canvas.toDataURL('image/png'),
        width: canvas.width,
        height: canvas.height,
        capturedAt: Date.now(),
        shapeCount: targetItems.length,
      };
    } catch (err) {
      console.warn('[Noteometry] mixed capture failed', err);
      return null;
    } finally {
      setIsCapturingCanvas(false);
    }
  }, [canvasItems, selectedItems]);

  const handleCanvasContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const point = shellPointFromClient(e.clientX, e.clientY);
    if (point) lastCanvasPointRef.current = point;

    const items: ContextMenuItem[] = [
      { label: 'Tools', header: true, accent: '#8ea2ff' },
      {
        label: currentTool === 'draw' ? 'Ink selected' : 'Ink',
        iconNode: <PenIcon />,
        accent: '#8ea2ff',
        onClick: () => setCanvasTool('draw'),
      },
      {
        label: currentTool === 'eraser' ? 'Eraser selected' : 'Eraser',
        iconNode: <EraserIcon />,
        accent: '#f08686',
        onClick: () => setCanvasTool('eraser'),
      },
      {
        label: currentTool === 'select' ? 'Lasso selected' : 'Lasso',
        iconNode: <CursorIcon />,
        accent: '#73d7b1',
        onClick: () => setCanvasTool('select'),
      },
      { separator: true, label: '' },
      { label: 'AI', header: true, accent: '#f3ba5b' },
      {
        label: 'Read Math',
        iconNode: <MathIcon />,
        accent: '#f3ba5b',
        onClick: () => { void paneRef.current?.readMath(); },
      },
      {
        label: 'Solve',
        iconNode: <SolveIcon />,
        accent: '#f3ba5b',
        onClick: () => { void paneRef.current?.solveVerifiedMath(); },
      },
      { separator: true, label: '' },
      { label: 'Drop-Ins', header: true, accent: '#b58cff' },
      {
        label: 'Text Drop-In',
        iconNode: <TextIcon />,
        accent: '#b58cff',
        onClick: () => spawnDropIn('text', point),
      },
      {
        label: 'Table Drop-In',
        iconNode: <TableIcon />,
        accent: '#b58cff',
        onClick: () => spawnDropIn('table', point),
      },
      {
        label: 'Image Drop-In',
        iconNode: <ImageIcon />,
        accent: '#b58cff',
        onClick: () => spawnDropIn('image', point),
      },
      {
        label: 'PDF Drop-In',
        iconNode: <PdfIcon />,
        accent: '#b58cff',
        onClick: () => spawnDropIn('pdf', point),
      },
      { separator: true, label: '' },
      { label: 'Math Marks', header: true, accent: '#73d7b1' },
      {
        label: 'Math Palette',
        iconNode: <MathPaletteIcon />,
        accent: '#73d7b1',
        onClick: () => setMathPaletteOpen(true),
      },
    ];

    setCtxMenu({ x: e.clientX, y: e.clientY, items });
  }, [currentTool, setCanvasTool, shellPointFromClient, spawnDropIn]);

  return (
    <div className={`noteometry-os has-nav${pageRailOpen ? ' has-page-rail' : ''}${mmPaneOpen ? ' has-mm-pane' : ''}`}>
      <SectionTabs nav={nav} />

      <div
        ref={canvasShellRef}
        className="noteometry-canvas-shell"
        onContextMenu={handleCanvasContextMenu}
        onPointerMove={(e) => {
          lastCanvasPointRef.current = shellPointFromClient(e.clientX, e.clientY);
        }}
      >
        <InkCanvas
          items={canvasItems}
          onItemsChange={setActiveCanvasItems}
          tool={currentTool}
          selectedItemIds={selectedItemIds}
          selectedBounds={selectedBounds}
          onSelectionChange={setActiveSelectedItemIds}
          onPointerPosition={(point) => { lastCanvasPointRef.current = point; }}
          hideSelection={isCapturingCanvas}
        />
        <DropInHost pageId={activePageId} />
        {paletteStamp && (
          <div
            className="noteometry-stamp-overlay"
            role="presentation"
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.preventDefault();
              dropPaletteStamp(e.clientX, e.clientY);
            }}
            title={`Click to stamp "${paletteStamp.symbol}" (${paletteStamp.size}). Esc cancels.`}
          >
            <div className="noteometry-stamp-cue">
              <span className="noteometry-stamp-cue-glyph">{paletteStamp.symbol}</span>
              <span>Click canvas to place</span>
            </div>
          </div>
        )}
      </div>

      <PageRail nav={nav} onCollapsedChange={(collapsed) => setPageRailOpen(!collapsed)} />

      <MathMessagePane
        ref={paneRef}
        editor={null}
        captureMixedSelection={captureMixedSelection}
        onPaneOpenChange={setMmPaneOpen}
        onToast={showToast}
      />

      {toast && <div className="noteometry-toast" role="status">{toast}</div>}

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxMenu.items}
          onClose={() => setCtxMenu(null)}
        />
      )}

      <MathPalette
        open={mathPaletteOpen}
        armed={paletteStamp}
        onArm={setPaletteStamp}
        onClose={() => { setMathPaletteOpen(false); setPaletteStamp(null); }}
      />
    </div>
  );
}

function InkCanvas({
  items,
  onItemsChange,
  tool,
  selectedItemIds,
  selectedBounds,
  onSelectionChange,
  onPointerPosition,
  hideSelection,
}: {
  items: CanvasItem[];
  onItemsChange: React.Dispatch<React.SetStateAction<CanvasItem[]>>;
  tool: ToolMode;
  selectedItemIds: Set<string>;
  selectedBounds: Rect | null;
  onSelectionChange: (ids: Set<string>) => void;
  onPointerPosition: (point: CanvasPoint) => void;
  hideSelection: boolean;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [draftStroke, setDraftStroke] = useState<StrokeItem | null>(null);
  const [draftSelection, setDraftSelection] = useState<{ start: CanvasPoint; current: CanvasPoint } | null>(null);

  const pointFromEvent = useCallback((e: React.PointerEvent<SVGSVGElement>): CanvasPoint => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const eraseAt = useCallback((point: CanvasPoint) => {
    onItemsChange((prev) => {
      const hit = [...prev].reverse().find((item) => itemHitTest(item, point));
      if (!hit) return prev;
      return prev.filter((item) => item.id !== hit.id);
    });
    onSelectionChange(new Set());
  }, [onItemsChange, onSelectionChange]);

  const onPointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const point = pointFromEvent(e);
    onPointerPosition(point);
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
    if (tool === 'draw') {
      setDraftStroke({
        id: freshItemId(),
        type: 'stroke',
        points: [point],
        color: '#f2f2f2',
        size: e.pointerType === 'pen' ? 3.5 : 4.25,
      });
      onSelectionChange(new Set());
    } else if (tool === 'select') {
      setDraftSelection({ start: point, current: point });
    } else {
      eraseAt(point);
    }
  }, [eraseAt, onPointerPosition, onSelectionChange, pointFromEvent, tool]);

  const onPointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    const point = pointFromEvent(e);
    onPointerPosition(point);
    if (tool === 'draw' && draftStroke) {
      setDraftStroke((prev) => {
        if (!prev) return prev;
        const last = prev.points[prev.points.length - 1];
        if (Math.hypot(point.x - last.x, point.y - last.y) < 1.2) return prev;
        return { ...prev, points: [...prev.points, point] };
      });
    } else if (tool === 'select' && draftSelection) {
      setDraftSelection((prev) => (prev ? { ...prev, current: point } : prev));
    } else if (tool === 'eraser' && e.buttons === 1) {
      eraseAt(point);
    }
  }, [draftSelection, draftStroke, eraseAt, onPointerPosition, pointFromEvent, tool]);

  const finishPointer = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    const point = pointFromEvent(e);
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      /* pointer capture may already be released */
    }
    if (tool === 'draw' && draftStroke) {
      const finalStroke = { ...draftStroke, points: [...draftStroke.points, point] };
      if (finalStroke.points.length > 2) onItemsChange((prev) => [...prev, finalStroke]);
      setDraftStroke(null);
    } else if (tool === 'select' && draftSelection) {
      const rect = normalizeRect(draftSelection.start, point);
      const next = new Set<string>();
      for (const item of items) {
        if (rectsIntersect(boundsForItem(item), rect)) next.add(item.id);
      }
      onSelectionChange(next);
      setDraftSelection(null);
    }
  }, [draftSelection, draftStroke, items, onItemsChange, onSelectionChange, pointFromEvent, tool]);

  const selectionRect = draftSelection ? normalizeRect(draftSelection.start, draftSelection.current) : selectedBounds;

  return (
    <svg
      ref={svgRef}
      className="noteometry-ink-canvas"
      data-tool={tool}
      aria-label="Noteometry ink canvas"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishPointer}
      onPointerCancel={finishPointer}
    >
      {items.map((item) => (
        item.type === 'stroke' ? (
          <path
            key={item.id}
            className={`noteometry-ink-stroke${selectedItemIds.has(item.id) ? ' is-selected' : ''}`}
            d={pathFromPoints(item.points)}
            stroke={item.color}
            strokeWidth={item.size}
          />
        ) : (
          <text
            key={item.id}
            className={`noteometry-ink-text${selectedItemIds.has(item.id) ? ' is-selected' : ''}`}
            x={item.x}
            y={item.y}
            fill={item.color}
            fontSize={item.size === 'large' ? 34 : 22}
          >
            {item.text}
          </text>
        )
      ))}
      {draftStroke && (
        <path
          className="noteometry-ink-stroke is-draft"
          d={pathFromPoints(draftStroke.points)}
          stroke={draftStroke.color}
          strokeWidth={draftStroke.size}
        />
      )}
      {selectionRect && !hideSelection && (
        <rect
          className="noteometry-selection-overlay"
          x={selectionRect.x}
          y={selectionRect.y}
          width={selectionRect.w}
          height={selectionRect.h}
        />
      )}
    </svg>
  );
}

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Tldraw, Editor, createShapeId, toRichText, type TLEditorSnapshot } from 'tldraw';
import { toPng } from 'html-to-image';
import 'tldraw/tldraw.css';
import ContextMenu, { type ContextMenuItem } from './components/ContextMenu';
import MathMessagePane, { type MathMessagePaneHandle } from './components/MathMessagePane';
import SectionTabs from './components/SectionTabs';
import PageRail from './components/PageRail';
import MathPalette, { type PaletteStamp } from './components/MathPalette';
import {
  PenIcon, EraserIcon, CursorIcon, TextIcon, TableIcon, MathIcon,
  ImageIcon, PdfIcon, MathPaletteIcon, ExportIcon,
} from './components/Icons';
import { useNoteometryNav } from './lib/useNoteometryNav';
import DropInHost from './dropins/DropInHost';
import { addDropIn, addImageDropIn } from './dropins/dropInStore';
import type { DropInType } from './dropins/types';

const ACCENT_DRAWING = '#5aa0e8';
const ACCENT_SELECT = '#c08fff';
const ACCENT_DROPINS = '#6ed18c';
const ACCENT_MATH = '#f3ba5b';
const ACCENT_EXPORT = '#8b95a5';
const CANVAS_BACKUP_PREFIX = 'noteometry-os:canvas-backup:v1:';

interface CanvasBackup {
  shapeCount: number;
  snapshot: TLEditorSnapshot;
  savedAt: number;
}

interface MixedCapture {
  dataUrl: string;
  width: number;
  height: number;
  capturedAt: number;
  shapeCount: number;
}

class OSBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, color: '#ff4444', background: '#121212', height: '100vh', width: '100vw', boxSizing: 'border-box', fontFamily: 'monospace' }}>
          <h2 style={{ borderBottom: '1px solid #ff4444', paddingBottom: '10px' }}>FATAL OS CRASH</h2>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: '14px' }}>{String(this.state.error.stack || this.state.error)}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

function typeLabel(type: DropInType): string {
  switch (type) {
    case 'text': return 'Text Drop-In™';
    case 'table': return 'Table Drop-In™';
    case 'math': return 'Math Drop-In™';
    case 'chat': return 'Chat Drop-In™';
    case 'image': return 'Image Drop-In™';
    case 'pdf': return 'PDF Drop-In™';
  }
}

function readCanvasBackup(pageId: string): CanvasBackup | null {
  try {
    const raw = localStorage.getItem(`${CANVAS_BACKUP_PREFIX}${pageId}`);
    return raw ? JSON.parse(raw) as CanvasBackup : null;
  } catch {
    return null;
  }
}

export default function App() {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [currentTool, setCurrentTool] = useState<string>('select');
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [mmPaneOpen, setMmPaneOpen] = useState<boolean>(true);
  const [pageRailOpen, setPageRailOpen] = useState<boolean>(false);
  const toastTimer = useRef<number | null>(null);
  const paneRef = useRef<MathMessagePaneHandle>(null);
  const canvasShellRef = useRef<HTMLDivElement | null>(null);
  const lastCanvasPointRef = useRef<{ x: number; y: number } | null>(null);
  const [mathPaletteOpen, setMathPaletteOpen] = useState<boolean>(false);
  const [paletteStamp, setPaletteStamp] = useState<PaletteStamp | null>(null);
  const nav = useNoteometryNav();
  const canvasSnapshot = readCanvasBackup(nav.activePage.id)?.snapshot;

  const showToast = useCallback((msg: string, ms = 2400) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), ms);
  }, []);

  // Track current tool so right-click menu can show ✓ next to the active tool.
  useEffect(() => {
    if (!editor) return;
    const unsubscribe = editor.store.listen(() => {
      const next = editor.getCurrentToolId();
      setCurrentTool((prev) => (prev === next ? prev : next));
    });
    return () => { unsubscribe(); };
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    const clearPenMode = () => {
      if (editor.getInstanceState().isPenMode) {
        editor.updateInstanceState({ isPenMode: false });
      }
    };
    const onPointerUp = () => window.setTimeout(clearPenMode, 0);
    const onPointerCancel = () => window.setTimeout(clearPenMode, 0);
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('pointercancel', onPointerCancel, true);
    return () => {
      window.removeEventListener('pointerup', onPointerUp, true);
      window.removeEventListener('pointercancel', onPointerCancel, true);
    };
  }, [editor]);

  const handleMount = useCallback((e: Editor) => {
    setEditor(e);
    // tldraw's internal grid is disabled — Noteometry paints its own
    // engineering-paper grid on the canvas-shell via CSS gradients, and
    // doubling the two looks chaotic.
    e.updateInstanceState({ isGridMode: false });
    e.user.updateUserPreferences({ colorScheme: 'dark' });
    setCurrentTool(e.getCurrentToolId());
  }, []);

  useEffect(() => {
    if (!editor) return;
    const key = `${CANVAS_BACKUP_PREFIX}${nav.activePage.id}`;
    const readBackup = () => readCanvasBackup(nav.activePage.id);
    const currentShapeCount = () => editor.getCurrentPageShapeIds().size;
    const saveBackup = () => {
      const shapeCount = currentShapeCount();
      const previous = readBackup();
      if (shapeCount === 0 && previous && previous.shapeCount > 0) return;
      try {
        const backup: CanvasBackup = {
          shapeCount,
          snapshot: editor.getSnapshot(),
          savedAt: Date.now(),
        };
        localStorage.setItem(key, JSON.stringify(backup));
      } catch (err) {
        console.warn('[Noteometry] canvas backup failed', err);
      }
    };
    const restoreIfBlank = () => {
      const backup = readBackup();
      if (!backup || backup.shapeCount === 0) return;
      if (currentShapeCount() > 0) return;
      try {
        editor.loadSnapshot(backup.snapshot);
        showToast('Restored canvas from Noteometry backup.');
      } catch (err) {
        console.warn('[Noteometry] canvas restore failed', err);
      }
    };

    const restoreTimers = [
      window.setTimeout(restoreIfBlank, 1200),
      window.setTimeout(restoreIfBlank, 4200),
      window.setTimeout(restoreIfBlank, 7000),
    ];
    let saveTimer: number | null = null;
    const unsubscribe = editor.store.listen(() => {
      if (saveTimer !== null) window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(saveBackup, 350);
    });
    saveBackup();
    return () => {
      restoreTimers.forEach((t) => window.clearTimeout(t));
      if (saveTimer !== null) window.clearTimeout(saveTimer);
      unsubscribe();
    };
  }, [editor, nav.activePage.id, showToast]);

  const setCanvasTool = useCallback((id: 'draw' | 'eraser' | 'select') => {
    if (!editor) return;
    editor.complete();
    editor.setCurrentTool(id);
    editor.updateInstanceState({
      isPenMode: false,
      isToolLocked: id === 'draw' || id === 'eraser',
    });
    setCurrentTool(id);
  }, [editor]);

  /** Spawn a Drop-In™ at a shell-relative coordinate. Per Law 2 the canvas
   *  never gets a raw tldraw shape for Text / Table / Math / Chat — those
   *  are Drop-Ins™ rendered above the canvas by `DropInHost`. */
  const spawnDropIn = useCallback((type: DropInType, clientX: number, clientY: number) => {
    const shell = canvasShellRef.current;
    if (!shell) return;
    const rect = shell.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    addDropIn(nav.activePage.id, type, x, y);
    showToast(`${typeLabel(type)} inserted.`);
  }, [nav.activePage.id, showToast]);

  const shellPointFromClient = useCallback((clientX: number, clientY: number) => {
    const shell = canvasShellRef.current;
    if (!shell) return null;
    const rect = shell.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, []);

  const pasteImageFile = useCallback((file: File, point?: { x: number; y: number } | null) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') return;
      const shell = canvasShellRef.current;
      const target = point ?? (shell
        ? { x: shell.clientWidth / 2, y: shell.clientHeight / 2 }
        : { x: 260, y: 180 });
      addImageDropIn(nav.activePage.id, result, file.name || 'Pasted image', target.x, target.y);
      showToast('Image pasted onto the canvas.');
    };
    reader.readAsDataURL(file);
  }, [nav.activePage.id, showToast]);

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

  /** Drop a Math Palette stamp onto the raw canvas. This is the ONE
   *  permitted path that creates a tldraw text shape (Law 2 exception
   *  for Math Palette marks). Glyph + size mode chosen in the palette;
   *  position chosen by the click. */
  const dropPaletteStamp = useCallback((clientX: number, clientY: number) => {
    if (!editor || !paletteStamp) return;
    const id = createShapeId();
    const page = editor.screenToPage({ x: clientX, y: clientY });
    const scale = paletteStamp.size === 'large' ? 1.0 : 0.55;
    editor.markHistoryStoppingPoint('math palette stamp');
    editor.createShape({
      id,
      type: 'text',
      x: page.x,
      y: page.y,
      props: {
        richText: toRichText(paletteStamp.symbol),
        autoSize: true,
        scale,
        textAlign: 'middle',
      },
    });
    showToast(`Stamped "${paletteStamp.symbol}" (${paletteStamp.size}).`);
  }, [editor, paletteStamp, showToast]);

  /** Export current page as a PNG download. If shapes are selected, only
   *  those export; otherwise everything on the page. */
  const exportPng = useCallback(async () => {
    if (!editor) return;
    const selected = editor.getSelectedShapeIds();
    const idArray = selected.length > 0
      ? selected
      : Array.from(editor.getCurrentPageShapeIds());
    if (idArray.length === 0) {
      showToast('Nothing to export.');
      return;
    }
    try {
      const result = await editor.toImageDataUrl(idArray, { format: 'png', scale: 2, padding: 16, background: true } as Parameters<Editor['toImageDataUrl']>[1]);
      if (!result?.url) throw new Error('Empty export');
      const a = document.createElement('a');
      a.href = result.url;
      a.download = `${nav.activePage.title.replace(/[^\w-]+/g, '_')}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      showToast('Exported PNG.');
    } catch (err) {
      console.error('[Noteometry] PNG export failed:', err);
      showToast(`Export failed: ${(err as Error).message}`);
    }
  }, [editor, nav.activePage.title, showToast]);

  const captureMixedSelection = useCallback(async (): Promise<MixedCapture | null> => {
    if (!editor || !canvasShellRef.current) return null;
    const shell = canvasShellRef.current;
    let ids = editor.getSelectedShapeIds();
    if (ids.length === 0) ids = Array.from(editor.getCurrentPageShapeIds());
    if (ids.length === 0) return null;
    const bounds = editor.getSelectionScreenBounds()
      ?? editor.getSelectionPageBounds()
      ?? null;
    if (!bounds) return null;
    const shellRect = shell.getBoundingClientRect();
    const pad = 16;
    const crop = {
      x: Math.max(0, bounds.x - shellRect.left - pad),
      y: Math.max(0, bounds.y - shellRect.top - pad),
      width: Math.min(shellRect.width, bounds.w + pad * 2),
      height: Math.min(shellRect.height, bounds.h + pad * 2),
    };
    const selected = editor.getSelectedShapeIds();
    editor.selectNone();
    try {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const fullDataUrl = await toPng(shell, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: '#6f7479',
        filter: (node) => {
          if (!(node instanceof HTMLElement)) return true;
          return !node.classList.contains('noteometry-stamp-overlay');
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
        shapeCount: ids.length,
      };
    } catch (err) {
      console.warn('[Noteometry] mixed capture failed; falling back to tldraw export', err);
      return null;
    } finally {
      if (selected.length > 0) editor.setSelectedShapes(selected);
    }
  }, [editor]);

  /** Build the FLAT right-click context menu. Per Dan's ADHD rule: every
   *  command is visible at once — no submenus, no flyouts, no hover-reveal.
   *  Section headers are visual group labels only. This is the entire tool
   *  surface of the app; there is no toolbar, HUD, or launcher anywhere
   *  else on screen. */
  const handleCanvasContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!editor) return;

    const tick = (id: string) => currentTool === id ? '✓' : '';
    // Snapshot the right-click coords; menu items fire after the synthetic
    // event has been pooled.
    const spawnX = e.clientX;
    const spawnY = e.clientY;

    const items: ContextMenuItem[] = [
      { label: 'Drawing', header: true, accent: ACCENT_DRAWING },
      { label: 'Pen', iconNode: <PenIcon />, accent: ACCENT_DRAWING, shortcut: tick('draw'), onClick: () => setCanvasTool('draw') },
      { label: 'Eraser', iconNode: <EraserIcon />, accent: ACCENT_DRAWING, shortcut: tick('eraser'), onClick: () => setCanvasTool('eraser') },

      { label: 'Select', header: true, accent: ACCENT_SELECT },
      { label: 'Select / Lasso', iconNode: <CursorIcon />, accent: ACCENT_SELECT, shortcut: tick('select'), onClick: () => setCanvasTool('select') },

      { label: 'Drop-Ins', header: true, accent: ACCENT_DROPINS },
      { label: 'Text', iconNode: <TextIcon />, accent: ACCENT_DROPINS, onClick: () => spawnDropIn('text', spawnX, spawnY) },
      { label: 'Table', iconNode: <TableIcon />, accent: ACCENT_DROPINS, onClick: () => spawnDropIn('table', spawnX, spawnY) },
      { label: 'Math', iconNode: <MathIcon />, accent: ACCENT_DROPINS, onClick: () => spawnDropIn('math', spawnX, spawnY) },
      { label: 'Image', iconNode: <ImageIcon />, accent: ACCENT_DROPINS, onClick: () => spawnDropIn('image', spawnX, spawnY) },
      { label: 'PDF', iconNode: <PdfIcon />, accent: ACCENT_DROPINS, onClick: () => spawnDropIn('pdf', spawnX, spawnY) },

      { label: 'Math', header: true, accent: ACCENT_MATH },
      { label: 'Math Palette', iconNode: <MathPaletteIcon />, accent: ACCENT_MATH, onClick: () => setMathPaletteOpen(true) },

      { label: 'Export', header: true, accent: ACCENT_EXPORT },
      { label: 'Export PNG', iconNode: <ExportIcon />, accent: ACCENT_EXPORT, onClick: () => { void exportPng(); } },
    ];

    setCtxMenu({ x: e.clientX, y: e.clientY, items });
  }, [editor, currentTool, setCanvasTool, spawnDropIn, exportPng]);

  // The React key forces a clean remount when the active page changes.
  // Noteometry owns the page snapshot now; tldraw's IndexedDB persistence
  // loaded late enough to overwrite fresh ink after reload.
  const persistenceKey = `nm-page-${nav.activePage.id}`;

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
        <OSBoundary>
          <Tldraw
            key={persistenceKey}
            snapshot={canvasSnapshot}
            hideUi
            onMount={handleMount}
          />
        </OSBoundary>
        <DropInHost pageId={nav.activePage.id} />
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

      <div className="noteometry-tool-strip" aria-label="Core tools">
        <button
          type="button"
          className={`noteometry-tool-strip-btn${currentTool === 'draw' ? ' is-active' : ''}`}
          onClick={() => setCanvasTool('draw')}
          title="Ink"
          aria-label="Ink"
        >
          <PenIcon />
          <span>Ink</span>
        </button>
        <button
          type="button"
          className={`noteometry-tool-strip-btn${currentTool === 'select' ? ' is-active' : ''}`}
          onClick={() => setCanvasTool('select')}
          title="Lasso"
          aria-label="Lasso"
        >
          <CursorIcon />
          <span>Lasso</span>
        </button>
        <button
          type="button"
          className="noteometry-tool-strip-btn noteometry-tool-strip-read"
          onClick={() => { void paneRef.current?.readMath(); }}
          title="Read Math"
          aria-label="Read Math"
        >
          <MathIcon />
          <span>Read</span>
        </button>
      </div>

      <PageRail nav={nav} onCollapsedChange={(collapsed) => setPageRailOpen(!collapsed)} />

      <MathMessagePane
        ref={paneRef}
        editor={editor}
        captureMixedSelection={captureMixedSelection}
        onPaneOpenChange={setMmPaneOpen}
        onToast={showToast}
      />

      {toast && <div className="noteometry-toast" role="status">{toast}</div>}

      {ctxMenu && (
        <OSBoundary>
          <ContextMenu
            x={ctxMenu.x}
            y={ctxMenu.y}
            items={ctxMenu.items}
            onClose={() => setCtxMenu(null)}
          />
        </OSBoundary>
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

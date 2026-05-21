import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Tldraw, Editor, createShapeId, toRichText, type TLEditorSnapshot } from 'tldraw';
import { toPng } from 'html-to-image';
import 'tldraw/tldraw.css';
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
  const canvasSnapshot = useMemo(
    () => readCanvasBackup(nav.activePage.id)?.snapshot,
    [nav.activePage.id]
  );

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
    let saveTimer: number | null = null;
    const unsubscribe = editor.store.listen(() => {
      if (saveTimer !== null) window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(saveBackup, 350);
    });
    saveBackup();
    return () => {
      if (saveTimer !== null) window.clearTimeout(saveTimer);
      unsubscribe();
    };
  }, [editor, nav.activePage.id]);

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
    addDropIn(nav.activePage.id, type, target.x, target.y);
    const label = type === 'pdf' ? 'PDF' : `${type[0].toUpperCase()}${type.slice(1)}`;
    showToast(`${label} Drop-In added.`);
  }, [nav.activePage.id, showToast]);

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

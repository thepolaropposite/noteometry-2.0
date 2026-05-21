import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Tldraw, Editor, createShapeId, toRichText } from 'tldraw';
import 'tldraw/tldraw.css';
import ContextMenu, { type ContextMenuItem } from './components/ContextMenu';
import MathMessagePane, { type MathMessagePaneHandle } from './components/MathMessagePane';
import SectionTabs from './components/SectionTabs';
import PageRail from './components/PageRail';
import ZoomControl from './components/ZoomControl';
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

  const handleMount = useCallback((e: Editor) => {
    setEditor(e);
    // tldraw's internal grid is disabled — Noteometry paints its own
    // engineering-paper grid on the canvas-shell via CSS gradients, and
    // doubling the two looks chaotic.
    e.updateInstanceState({ isGridMode: false });
    e.user.updateUserPreferences({ colorScheme: 'dark' });
    setCurrentTool(e.getCurrentToolId());
  }, []);

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

  /** Build the FLAT right-click context menu. Per Dan's ADHD rule: every
   *  command is visible at once — no submenus, no flyouts, no hover-reveal.
   *  Section headers are visual group labels only. This is the entire tool
   *  surface of the app; there is no toolbar, HUD, or launcher anywhere
   *  else on screen. */
  const handleCanvasContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!editor) return;

    const setTool = (id: string) => editor.setCurrentTool(id);
    const tick = (id: string) => currentTool === id ? '✓' : '';
    // Snapshot the right-click coords; menu items fire after the synthetic
    // event has been pooled.
    const spawnX = e.clientX;
    const spawnY = e.clientY;

    const items: ContextMenuItem[] = [
      { label: 'Drawing', header: true, accent: ACCENT_DRAWING },
      { label: 'Pen', iconNode: <PenIcon />, accent: ACCENT_DRAWING, shortcut: tick('draw'), onClick: () => setTool('draw') },
      { label: 'Eraser', iconNode: <EraserIcon />, accent: ACCENT_DRAWING, shortcut: tick('eraser'), onClick: () => setTool('eraser') },

      { label: 'Select', header: true, accent: ACCENT_SELECT },
      { label: 'Select / Lasso', iconNode: <CursorIcon />, accent: ACCENT_SELECT, shortcut: tick('select'), onClick: () => setTool('select') },

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
  }, [editor, currentTool, spawnDropIn, exportPng]);

  // tldraw's persistenceKey is the per-page store key. Using it as React
  // key too forces a clean remount when the active page changes, which is
  // exactly what we want — different page = different canvas content.
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
            persistenceKey={persistenceKey}
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
        onPaneOpenChange={setMmPaneOpen}
        onToast={showToast}
      />

      <ZoomControl editor={editor} />

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

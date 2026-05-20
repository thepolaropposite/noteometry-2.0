/**
 * ZoomControl — floating bottom-right zoom indicator and ± buttons.
 * Reads/writes through the tldraw Editor.
 */
import { useEffect, useState } from 'react';
import type { Editor } from 'tldraw';

interface Props {
  editor: Editor | null;
}

export default function ZoomControl({ editor }: Props) {
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    if (!editor) return;
    setZoom(editor.getZoomLevel());
    const unsubscribe = editor.store.listen(() => {
      const next = editor.getZoomLevel();
      setZoom((prev) => (Math.abs(prev - next) < 1e-4 ? prev : next));
    });
    return () => unsubscribe();
  }, [editor]);

  if (!editor) return null;
  const pct = Math.round(zoom * 100);

  return (
    <div className="noteometry-zoom-control" aria-label="Zoom controls">
      <button type="button" onClick={() => editor.zoomOut(undefined, { animation: { duration: 120 } })} aria-label="Zoom out">−</button>
      <button type="button" className="noteometry-zoom-reset" onClick={() => editor.resetZoom(undefined, { animation: { duration: 180 } })} aria-label="Reset zoom" title="Reset to 100%">
        {pct}%
      </button>
      <button type="button" onClick={() => editor.zoomIn(undefined, { animation: { duration: 120 } })} aria-label="Zoom in">+</button>
    </div>
  );
}

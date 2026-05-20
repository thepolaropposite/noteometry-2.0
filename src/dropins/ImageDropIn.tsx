/**
 * ImageDropIn — Phase 1 body for the image Drop-In™.
 *
 * Accepts a local file (read as a data: URL so the image survives
 * reloads via the per-page localStorage record) OR an http(s) URL. Not
 * a raw tldraw image shape — Law 2 keeps the canvas dumb; images are
 * anchored Drop-Ins™.
 */
import { useCallback } from 'react';
import type { ImageState } from './types';
import { updateImageState } from './dropInStore';

interface Props {
  pageId: string;
  dropInId: string;
  state: ImageState;
}

export default function ImageDropIn({ pageId, dropInId, state }: Props) {
  const onFile = useCallback((file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') {
        updateImageState(pageId, dropInId, { src: result, alt: file.name });
      }
    };
    reader.readAsDataURL(file);
  }, [pageId, dropInId]);

  return (
    <div className="noteometry-dropin-image">
      {state.src ? (
        <>
          <img src={state.src} alt={state.alt} className="noteometry-dropin-image-img" />
          <div className="noteometry-dropin-image-meta">
            <input
              type="text"
              value={state.alt}
              onChange={(e) => updateImageState(pageId, dropInId, { alt: e.target.value })}
              placeholder="Alt text"
              spellCheck={false}
              aria-label="Image description"
            />
            <button
              type="button"
              className="noteometry-dropin-action"
              onClick={() => updateImageState(pageId, dropInId, { src: '', alt: '' })}
            >
              Replace
            </button>
          </div>
        </>
      ) : (
        <div className="noteometry-dropin-image-empty">
          <label className="noteometry-dropin-action noteometry-dropin-action-primary">
            <input
              type="file"
              accept="image/*"
              onChange={(e) => onFile(e.target.files?.[0] ?? null)}
              style={{ display: 'none' }}
            />
            Upload image
          </label>
          <span className="noteometry-dropin-empty">or paste a URL below</span>
          <input
            type="text"
            placeholder="https://…"
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v) updateImageState(pageId, dropInId, { src: v });
            }}
            spellCheck={false}
            aria-label="Image URL"
          />
        </div>
      )}
    </div>
  );
}

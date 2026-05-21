/**
 * PdfDropIn — embeds a PDF inside the Drop-In™.
 *
 * Persistence:
 *   - localStorage stores a `data:application/pdf;base64,…` URL so the
 *     file survives reload.
 *   - At runtime we convert that data URL into a `Blob` and use
 *     `URL.createObjectURL` to get a `blob:` URL — Chrome and Safari's
 *     embedded PDF viewers reject `data:` URLs in `<iframe src>` but
 *     accept `blob:` URLs, which is why a naive `<object data={dataUrl}>`
 *     failed before.
 *   - http(s) URLs are passed through unchanged.
 *
 * Reliability:
 *   - We watch `<iframe>` load for ~1.5 s; if it never fires, we show
 *     a clean in-card error with "Replace" and "Open in new tab" so the
 *     user always has a way forward.
 */
/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useState } from 'react';
import type { PdfState } from './types';
import { updatePdfState } from './dropInStore';

interface Props {
  pageId: string;
  dropInId: string;
  state: PdfState;
}

function dataUrlToBlob(dataUrl: string): Blob | null {
  const m = dataUrl.match(/^data:([^;,]+)(;base64)?,(.*)$/);
  if (!m) return null;
  const [, mime, isBase64, payload] = m;
  try {
    if (isBase64) {
      const bin = atob(payload);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type: mime || 'application/pdf' });
    }
    return new Blob([decodeURIComponent(payload)], { type: mime || 'application/pdf' });
  } catch {
    return null;
  }
}

export default function PdfDropIn({ pageId, dropInId, state }: Props) {
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<boolean>(false);

  // Resolve `state.src` to something an <iframe> can render. Revoke
  // object URLs on cleanup so we don't leak.
  useEffect(() => {
    setLoaded(false);
    setError(null);
    if (!state.src) {
      setViewerUrl(null);
      return;
    }
    if (state.src.startsWith('blob:') || /^https?:\/\//i.test(state.src)) {
      setViewerUrl(state.src);
      return;
    }
    if (state.src.startsWith('data:')) {
      const blob = dataUrlToBlob(state.src);
      if (!blob) {
        setError('Stored PDF data is unreadable. Replace it to continue.');
        setViewerUrl(null);
        return;
      }
      const url = URL.createObjectURL(blob);
      setViewerUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setError('Unsupported PDF source.');
    setViewerUrl(null);
  }, [state.src]);

  // Heuristic load-watch: if the iframe never fires onLoad within
  // ~1.5 s, we assume the browser's PDF plugin rejected it.
  useEffect(() => {
    if (!viewerUrl || loaded || error) return;
    const t = window.setTimeout(() => {
      if (!loaded) setError('This browser blocked the embedded PDF viewer. Open it in a new tab instead.');
    }, 1500);
    return () => window.clearTimeout(t);
  }, [viewerUrl, loaded, error]);

  const onFile = useCallback((file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') updatePdfState(pageId, dropInId, { src: result });
    };
    reader.onerror = () => setError(`Could not read ${file.name}.`);
    reader.readAsDataURL(file);
  }, [pageId, dropInId]);

  const clearSrc = useCallback(() => {
    updatePdfState(pageId, dropInId, { src: '', page: 1 });
  }, [pageId, dropInId]);

  if (!state.src) {
    return (
      <div className="noteometry-dropin-pdf">
        <div className="noteometry-dropin-image-empty">
          <label className="noteometry-dropin-action noteometry-dropin-action-primary">
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => onFile(e.target.files?.[0] ?? null)}
              style={{ display: 'none' }}
            />
            Upload PDF
          </label>
          <span className="noteometry-dropin-empty">or paste a URL</span>
          <input
            type="text"
            placeholder="https://…/file.pdf"
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v) updatePdfState(pageId, dropInId, { src: v });
            }}
            spellCheck={false}
            aria-label="PDF URL"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="noteometry-dropin-pdf">
      {viewerUrl && !error && (
        <iframe
          key={viewerUrl}
          src={viewerUrl}
          className="noteometry-dropin-pdf-frame"
          title="PDF"
          onLoad={() => setLoaded(true)}
        />
      )}
      {error && (
        <div className="noteometry-dropin-pdf-error">
          <p>{error}</p>
          <div className="noteometry-dropin-image-meta">
            {viewerUrl && (
              <a
                className="noteometry-dropin-action noteometry-dropin-action-primary"
                href={viewerUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open in new tab
              </a>
            )}
            <label className="noteometry-dropin-action">
              <input
                type="file"
                accept="application/pdf"
                onChange={(e) => onFile(e.target.files?.[0] ?? null)}
                style={{ display: 'none' }}
              />
              Replace PDF
            </label>
            <button type="button" className="noteometry-dropin-action" onClick={clearSrc}>
              Clear
            </button>
          </div>
        </div>
      )}
      {viewerUrl && !error && (
        <div className="noteometry-dropin-image-meta">
          <a
            className="noteometry-dropin-action"
            href={viewerUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open in new tab
          </a>
          <button type="button" className="noteometry-dropin-action" onClick={clearSrc}>
            Replace
          </button>
        </div>
      )}
    </div>
  );
}

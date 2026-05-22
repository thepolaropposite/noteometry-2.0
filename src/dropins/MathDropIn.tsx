/**
 * MathDropIn — Phase 1 body for the math Drop-In™.
 *
 * Editable LaTeX textarea + live KaTeX preview. Not a raw tldraw shape —
 * the LaTeX source lives in the Drop-In™ state. Future copy-for-Word
 * will route through src/lib/mathml.ts so the export contract stays
 * single-sourced (Law 11).
 */
import { useMemo } from 'react';
import katex from 'katex';
import type { MathState } from './types';
import { updateMathState } from './dropInStore';

interface Props {
  pageId: string;
  dropInId: string;
  state: MathState;
}

function tryRender(src: string): { html: string } | { error: string } {
  try {
    return {
      html: katex.renderToString(src, {
        output: 'html',
        displayMode: true,
        throwOnError: true,
        strict: 'ignore',
      }),
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export default function MathDropIn({ pageId, dropInId, state }: Props) {
  const rendered = useMemo(() => (state.latex.trim() ? tryRender(state.latex) : null), [state.latex]);

  return (
    <div className="noteometry-dropin-math">
      <textarea
        className="noteometry-dropin-math-input"
        value={state.latex}
        onChange={(e) => updateMathState(pageId, dropInId, { latex: e.target.value })}
        placeholder="LaTeX (e.g. \\int_0^1 x^2 \\, dx)"
        spellCheck={false}
      />
      <div className="noteometry-dropin-math-preview">
        {rendered === null && <span className="noteometry-dropin-empty">(LaTeX renders here)</span>}
        {rendered && 'error' in rendered && (
          <span className="noteometry-dropin-error" title={rendered.error}>not valid LaTeX yet</span>
        )}
        {rendered && 'html' in rendered && (
          <span dangerouslySetInnerHTML={{ __html: rendered.html }} />
        )}
      </div>
    </div>
  );
}

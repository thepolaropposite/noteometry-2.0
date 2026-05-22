/**
 * TextDropIn — canvas-anchored text processor.
 *
 * The source stays plain text in the Drop-In™ record, while the preview
 * renders mixed prose, LaTeX delimiters, and pasted MathML through KaTeX.
 */
import { useMemo, useRef, useState } from 'react';
import type { TextState } from './types';
import { updateTextState } from './dropInStore';
import { copyForWord, renderAsKatexHtml } from '../lib/mathml';

interface Props {
  pageId: string;
  dropInId: string;
  state: TextState;
}

export default function TextDropIn({ pageId, dropInId, state }: Props) {
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const previewHtml = useMemo(() => renderAsKatexHtml(state.text), [state.text]);

  const setText = (text: string) => updateTextState(pageId, dropInId, { text });

  const insertAroundSelection = (before: string, after = before, fallback = 'text') => {
    const el = textareaRef.current;
    if (!el) {
      setText(`${state.text}${before}${fallback}${after}`);
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = state.text.slice(start, end) || fallback;
    const next = `${state.text.slice(0, start)}${before}${selected}${after}${state.text.slice(end)}`;
    setText(next);
    window.requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + before.length, start + before.length + selected.length);
    });
  };

  const prefixSelectionLines = (prefix: string) => {
    const el = textareaRef.current;
    if (!el) {
      setText(`${state.text}${state.text.endsWith('\n') || !state.text ? '' : '\n'}${prefix}`);
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = state.text.slice(start, end) || 'item';
    const nextSelected = selected
      .split(/\r?\n/)
      .map((line) => `${prefix}${line}`)
      .join('\n');
    const next = `${state.text.slice(0, start)}${nextSelected}${state.text.slice(end)}`;
    setText(next);
    window.requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start, start + nextSelected.length);
    });
  };

  const copyWord = async () => {
    try {
      await copyForWord(state.text);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
    window.setTimeout(() => setCopyState('idle'), 1400);
  };

  return (
    <div className="noteometry-dropin-text">
      <div className="noteometry-dropin-toolbar" role="toolbar" aria-label="Text tools">
        <button type="button" className={mode === 'edit' ? 'is-active' : ''} onClick={() => setMode('edit')}>Edit</button>
        <button type="button" className={mode === 'preview' ? 'is-active' : ''} onClick={() => setMode('preview')}>Preview</button>
        <span className="noteometry-dropin-toolbar-divider" />
        <button type="button" onClick={() => insertAroundSelection('**', '**', 'bold')}>B</button>
        <button type="button" onClick={() => insertAroundSelection('*', '*', 'italic')}>I</button>
        <button type="button" onClick={() => insertAroundSelection('$', '$', 'x^2')}>$x$</button>
        <button type="button" onClick={() => insertAroundSelection('$$\n', '\n$$', '\\frac{a}{b}')}>$$</button>
        <button type="button" onClick={() => prefixSelectionLines('- ')}>•</button>
        <span className="noteometry-dropin-toolbar-divider" />
        <button type="button" onClick={copyWord} disabled={!state.text.trim()}>
          {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Failed' : 'Word'}
        </button>
        <button type="button" onClick={() => setText('')} disabled={!state.text}>Clear</button>
      </div>

      {mode === 'edit' ? (
        <textarea
          ref={textareaRef}
          className="noteometry-dropin-text-input"
          value={state.text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type notes, $LaTeX$, or paste <math>MathML</math>."
          spellCheck={false}
        />
      ) : (
        <div
          className="noteometry-dropin-text-preview"
          aria-label="Rendered text preview"
          dangerouslySetInnerHTML={{
            __html: state.text.trim()
              ? previewHtml
              : '<span class="noteometry-dropin-empty">Preview is empty</span>',
          }}
        />
      )}
    </div>
  );
}

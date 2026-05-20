/**
 * MathML / Copy-for-Word.
 *
 * Ported from noteometry-obsidian v1.6.6 (commit 79cfb74, src/lib/mathml.ts).
 * Same conversion contract: render LaTeX with KaTeX's `output: 'mathml'`
 * mode, extract the bare <math>…</math> from the wrapper KaTeX emits,
 * then assemble HTML where math nodes become MathML and prose stays as
 * paragraph/line-break text. The resulting HTML pastes into Word as
 * real equations on macOS and Windows.
 */
import katex from 'katex';

/** Render mixed prose+math text to HTML with MathML islands.
 *  $...$ becomes inline MathML, $$...$$ becomes display MathML wrapped
 *  in a centered block. Newlines become <br>. */
export function renderAsMathML(text: string): string {
  if (!text) return '';
  const toMath = (tex: string, display: boolean): string => {
    try {
      const html = katex.renderToString(tex.trim(), {
        output: 'mathml',
        displayMode: display,
        throwOnError: false,
      });
      const match = html.match(/<math[\s\S]*?<\/math>/);
      if (match) {
        return display
          ? `<div style="text-align:center;margin:8px 0">${match[0]}</div>`
          : match[0];
      }
      return html;
    } catch {
      return tex;
    }
  };

  let result = text;
  result = result.replace(/\$\$([\s\S]*?)\$\$/g, (_m, tex) => toMath(tex, true));
  result = result.replace(/\$([^$]+?)\$/g, (_m, tex) => toMath(tex, false));
  result = result.replace(/\n/g, '<br>');
  return result;
}

/** Same conversion as renderAsMathML but wraps each non-empty line in a
 *  <p>, which Word interprets as a real paragraph break instead of a
 *  soft line break. Empty lines become an empty string so the paragraph
 *  separator survives. */
export function toMathMLForClipboard(text: string): string {
  const lines = text.split(/\n/);
  return lines
    .map((line) => {
      if (!line.trim()) return '';
      return `<p>${renderAsMathML(line)}</p>`;
    })
    .join('\n');
}

export interface ClipboardPayload {
  html: string;
  plain: string;
}

/** Build the two MIME payloads written via ClipboardItem: HTML
 *  (MathML-bearing, for Word) and plain text (raw LaTeX, fallback). */
export function buildClipboardPayload(text: string): ClipboardPayload {
  return {
    html: toMathMLForClipboard(text),
    plain: text,
  };
}

/** Primary clipboard path. Writes text/html (MathML) + text/plain in a
 *  single ClipboardItem so Word picks the HTML and lesser apps fall back
 *  to the LaTeX. */
export async function copyForWord(text: string): Promise<void> {
  const { html, plain } = buildClipboardPayload(text);
  const ClipboardItemCtor = (globalThis as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
  if (ClipboardItemCtor && navigator.clipboard?.write) {
    const blobHtml = new Blob([html], { type: 'text/html' });
    const blobText = new Blob([plain], { type: 'text/plain' });
    await navigator.clipboard.write([
      new ClipboardItemCtor({ 'text/html': blobHtml, 'text/plain': blobText }),
    ]);
    return;
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(plain);
    return;
  }
  throw new Error('Clipboard API unavailable in this browser.');
}

/** Convenience: just copy raw LaTeX/plain v12 text. */
export async function copyPlain(text: string): Promise<void> {
  if (!navigator.clipboard?.writeText) {
    throw new Error('Clipboard API unavailable in this browser.');
  }
  await navigator.clipboard.writeText(text);
}

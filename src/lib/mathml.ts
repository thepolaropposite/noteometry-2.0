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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderText(text: string): string {
  return escapeHtml(text).replace(/\n/g, '<br>');
}

function sanitizeMathML(math: string): string {
  return math
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*[^\s>]+/gi, '')
    .replace(/\s+href\s*=\s*(['"]?)javascript:[\s\S]*?\1/gi, '');
}

/** Render mixed prose+math text to HTML with MathML islands.
 *  $...$ and \(...\) become inline MathML; $$...$$ and \[...\] become
 *  display MathML. Raw <math>...</math> is preserved for pasted MathML.
 *  Prose is escaped before newlines become <br>. */
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
      return renderText(tex);
    }
  };

  const out: string[] = [];
  const tokenRe = /(<math[\s\S]*?<\/math>)|\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\)|\$\$([\s\S]*?)\$\$|\$([^$\n]+?)\$/gi;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(text))) {
    if (match.index > lastIdx) out.push(renderText(text.slice(lastIdx, match.index)));
    if (match[1] !== undefined) out.push(sanitizeMathML(match[1]));
    else if (match[2] !== undefined) out.push(toMath(match[2], true));
    else if (match[3] !== undefined) out.push(toMath(match[3], false));
    else if (match[4] !== undefined) out.push(toMath(match[4], true));
    else if (match[5] !== undefined) out.push(toMath(match[5], false));
    lastIdx = tokenRe.lastIndex;
  }
  if (lastIdx < text.length) out.push(renderText(text.slice(lastIdx)));
  return out.join('');
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

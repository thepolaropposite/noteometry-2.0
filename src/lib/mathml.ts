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

function renderKatexProse(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/(^|\n)-\s+([^\n]+)/g, '$1<span class="noteometry-prose-bullet">•</span> $2')
    .replace(/\n/g, '<br>');
}

function sanitizeMathML(math: string): string {
  return math
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*[^\s>]+/gi, '')
    .replace(/\s+href\s*=\s*(['"]?)javascript:[\s\S]*?\1/gi, '');
}

function escapeLatexText(text: string): string {
  return text
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/[{}#$%&_]/g, (ch) => `\\${ch}`)
    .replace(/\^/g, '\\^{}')
    .replace(/~/g, '\\~{}');
}

function compactLatex(parts: string[]): string {
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ');
}

function operatorToLatex(op: string): string {
  const normalized = op.trim();
  const map: Record<string, string> = {
    '−': '-',
    '×': '\\times',
    '·': '\\cdot',
    '÷': '\\div',
    '≤': '\\le',
    '≥': '\\ge',
    '≠': '\\ne',
    '≈': '\\approx',
    '≅': '\\cong',
    '±': '\\pm',
    '∞': '\\infty',
    '→': '\\to',
    '←': '\\leftarrow',
    '↔': '\\leftrightarrow',
    '∑': '\\sum',
    '∏': '\\prod',
    '∫': '\\int',
    '∂': '\\partial',
    '∇': '\\nabla',
    '√': '\\sqrt{}',
    '∈': '\\in',
    '∉': '\\notin',
    '⊂': '\\subset',
    '⊆': '\\subseteq',
    '∪': '\\cup',
    '∩': '\\cap',
    '∧': '\\land',
    '∨': '\\lor',
    '¬': '\\neg',
    'Ω': '\\Omega',
    'ω': '\\omega',
    'π': '\\pi',
    'θ': '\\theta',
    'φ': '\\phi',
    'α': '\\alpha',
    'β': '\\beta',
    'γ': '\\gamma',
    'δ': '\\delta',
    'Δ': '\\Delta',
    'λ': '\\lambda',
    'μ': '\\mu',
    'σ': '\\sigma',
  };
  return map[normalized] ?? normalized;
}

function textTokenToLatex(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function mathMLNodeToLatex(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return textTokenToLatex(node.textContent ?? '');
  if (!(node instanceof Element)) return '';

  const tag = node.localName.toLowerCase();
  const children = Array.from(node.childNodes);
  const childTex = () => compactLatex(children.map(mathMLNodeToLatex));
  const childAt = (index: number) => mathMLNodeToLatex(children[index] ?? node.ownerDocument.createTextNode(''));

  switch (tag) {
    case 'math':
    case 'semantics':
    case 'mrow':
    case 'mpadded':
    case 'mstyle':
      return childTex();
    case 'mi':
    case 'mn':
      return textTokenToLatex(node.textContent ?? '');
    case 'mo':
      return operatorToLatex(node.textContent ?? '');
    case 'mtext':
      return `\\text{${escapeLatexText(node.textContent ?? '')}}`;
    case 'msup':
      return `{${childAt(0)}}^{${childAt(1)}}`;
    case 'msub':
      return `{${childAt(0)}}_{${childAt(1)}}`;
    case 'msubsup':
      return `{${childAt(0)}}_{${childAt(1)}}^{${childAt(2)}}`;
    case 'mfrac':
      return `\\frac{${childAt(0)}}{${childAt(1)}}`;
    case 'msqrt':
      return `\\sqrt{${childTex()}}`;
    case 'mroot':
      return `\\sqrt[${childAt(1)}]{${childAt(0)}}`;
    case 'mover':
      return `\\overset{${childAt(1)}}{${childAt(0)}}`;
    case 'munder':
      return `\\underset{${childAt(1)}}{${childAt(0)}}`;
    case 'munderover':
      return `\\overset{${childAt(2)}}{\\underset{${childAt(1)}}{${childAt(0)}}}`;
    case 'mfenced': {
      const open = node.getAttribute('open') ?? '(';
      const close = node.getAttribute('close') ?? ')';
      return `\\left${open}${childTex()}\\right${close}`;
    }
    case 'mtable': {
      const rows = Array.from(node.children)
        .filter((child) => child.localName.toLowerCase() === 'mtr')
        .map(mathMLNodeToLatex);
      return `\\begin{array}{${'c'.repeat(Math.max(1, rows[0]?.split('&').length ?? 1))}}${rows.join(' \\\\ ')}\\end{array}`;
    }
    case 'mtr':
      return Array.from(node.children).map(mathMLNodeToLatex).join(' & ');
    case 'mtd':
      return childTex();
    case 'annotation':
      return '';
    default:
      return childTex();
  }
}

/** Converts a practical subset of Presentation MathML into LaTeX so the
 *  visible GUI can render pasted MathML with KaTeX. This intentionally
 *  favors common school/math output over a full symbolic round-trip. */
export function mathMLToLatex(mathml: string): string | null {
  if (typeof DOMParser === 'undefined') return null;
  const cleaned = sanitizeMathML(mathml);
  const doc = new DOMParser().parseFromString(cleaned, 'application/xml');
  if (doc.querySelector('parsererror')) return null;
  const math = doc.querySelector('math') ?? doc.documentElement;
  const tex = mathMLNodeToLatex(math).trim();
  return tex || null;
}

function renderLatexAsKatex(tex: string, display: boolean): string {
  try {
    return katex.renderToString(tex.trim(), {
      output: 'html',
      displayMode: display,
      throwOnError: false,
      strict: 'ignore',
    });
  } catch {
    return `<span class="noteometry-katex-error">${renderText(tex)}</span>`;
  }
}

/** Render mixed prose + LaTeX + raw MathML as GUI HTML. Unlike
 *  renderAsMathML(), this turns raw <math>...</math> into LaTeX first
 *  and then renders it through KaTeX, so the on-screen editor/preview
 *  never depends on browser MathML rendering. */
export function renderAsKatexHtml(text: string): string {
  if (!text) return '';
  const out: string[] = [];
  const tokenRe = /(<math[\s\S]*?<\/math>)|\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\)|\$\$([\s\S]*?)\$\$|\$([^$\n]+?)\$/gi;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(text))) {
    if (match.index > lastIdx) out.push(renderKatexProse(text.slice(lastIdx, match.index)));
    if (match[1] !== undefined) {
      const latex = mathMLToLatex(match[1]);
      out.push(latex
        ? renderLatexAsKatex(latex, /\bdisplay\s*=\s*["']block["']/i.test(match[1]))
        : `<span class="noteometry-katex-error">${renderText(match[1])}</span>`);
    } else if (match[2] !== undefined) out.push(renderLatexAsKatex(match[2], true));
    else if (match[3] !== undefined) out.push(renderLatexAsKatex(match[3], false));
    else if (match[4] !== undefined) out.push(renderLatexAsKatex(match[4], true));
    else if (match[5] !== undefined) out.push(renderLatexAsKatex(match[5], false));
    lastIdx = tokenRe.lastIndex;
  }
  if (lastIdx < text.length) out.push(renderKatexProse(text.slice(lastIdx)));
  return out.join('');
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

/**
 * MathPalette — app-like floating palette for stamping math glyphs
 * directly onto the canvas.
 *
 * Per Law 2 the canvas only ever holds (a) ink strokes and (b) Math
 * Palette character/symbol marks. This palette is the implementation of
 * exception (b): the user picks a glyph + a size mode, then clicks on
 * the canvas to drop the glyph as a small tldraw text shape.
 *
 * Style brief (Dan, 2026-05-18):
 *   - app-like, not Word-ribbon-like
 *   - large click targets (≥ 44 px where practical)
 *   - visible groups, no nested anything
 *   - clear "Stamp Mode" indicator so it's obvious why the cursor is
 *     suddenly painting symbols on the canvas
 */
import { useEffect, useState } from 'react';

export type MathPaletteSize = 'large' | 'small';

export interface PaletteStamp {
  symbol: string;
  size: MathPaletteSize;
}

interface SymbolGroup {
  id: string;
  label: string;
  symbols: Array<{ ch: string; aria: string }>;
}

const GROUPS: SymbolGroup[] = [
  {
    id: 'greek-lower',
    label: 'Greek (lower)',
    symbols: 'α β γ δ ε ζ η θ ι κ λ μ ν ξ π ρ σ τ υ φ χ ψ ω'.split(' ').map((ch) => ({ ch, aria: ch })),
  },
  {
    id: 'greek-upper',
    label: 'Greek (upper)',
    symbols: 'Γ Δ Θ Λ Ξ Π Σ Φ Ψ Ω'.split(' ').map((ch) => ({ ch, aria: ch })),
  },
  {
    id: 'operators',
    label: 'Operators',
    symbols: '+ − ± × ÷ · ∗ ∘ √ ∂'.split(' ').map((ch) => ({ ch, aria: ch })),
  },
  {
    id: 'relations',
    label: 'Relations',
    symbols: '= ≠ ≈ ≡ ≤ ≥ < > ∝ ≅'.split(' ').map((ch) => ({ ch, aria: ch })),
  },
  {
    id: 'calculus',
    label: 'Calculus',
    symbols: '∫ ∮ ∑ ∏ ∇ ∞ d/dx lim'.split(' ').map((ch) => ({ ch, aria: ch })),
  },
  {
    id: 'sets',
    label: 'Logic & Sets',
    symbols: '∀ ∃ ∈ ∉ ⊂ ⊆ ∪ ∩ ∅ ⇒ ⇔'.split(' ').map((ch) => ({ ch, aria: ch })),
  },
  {
    id: 'arrows',
    label: 'Arrows',
    symbols: '→ ← ↔ ⇒ ⇐ ⇔ ↦ ↑ ↓'.split(' ').map((ch) => ({ ch, aria: ch })),
  },
  {
    id: 'misc',
    label: 'Misc',
    symbols: '∠ ⊥ ∥ ° ′ ″ ⋯ ⋮ ℝ ℂ ℕ ℤ ℚ'.split(' ').map((ch) => ({ ch, aria: ch })),
  },
];

interface Props {
  open: boolean;
  /** Currently armed stamp (palette echoes it back so the user can see
   *  what the next canvas click will drop). */
  armed: PaletteStamp | null;
  onArm: (stamp: PaletteStamp | null) => void;
  onClose: () => void;
}

export default function MathPalette({ open, armed, onArm, onClose }: Props) {
  const [size, setSize] = useState<MathPaletteSize>(armed?.size ?? 'large');

  useEffect(() => { if (armed?.size) setSize(armed.size); }, [armed?.size]);

  // Esc dismisses the palette entirely; the canvas click handler also
  // disarms on its own when a stamp lands.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (armed) onArm(null);
        else onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, armed, onArm, onClose]);

  if (!open) return null;

  return (
    <aside className="noteometry-mathpalette" role="dialog" aria-label="Math Palette">
      <header className="noteometry-mathpalette-header">
        <div className="noteometry-mathpalette-title">Math Palette</div>
        <button
          type="button"
          className="noteometry-mathpalette-close"
          onClick={onClose}
          aria-label="Close palette"
          title="Close palette"
        >
          ×
        </button>
      </header>

      <div className="noteometry-mathpalette-sizes" role="group" aria-label="Mark size">
        <SizeButton current={size} value="large" label="Large" onPick={(v) => { setSize(v); if (armed) onArm({ ...armed, size: v }); }} />
        <SizeButton current={size} value="small" label="Small" onPick={(v) => { setSize(v); if (armed) onArm({ ...armed, size: v }); }} />
      </div>

      <div className="noteometry-mathpalette-status" aria-live="polite">
        {armed ? (
          <>
            <span className="noteometry-mathpalette-armed-glyph">{armed.symbol}</span>
            <span className="noteometry-mathpalette-armed-meta">{armed.size}</span>
          </>
        ) : (
          <span className="noteometry-mathpalette-hint">Pick a glyph · click canvas to drop · Esc to cancel</span>
        )}
      </div>

      <div className="noteometry-mathpalette-groups">
        {GROUPS.map((g) => (
          <section key={g.id} className="noteometry-mathpalette-group" aria-label={g.label}>
            <h3>{g.label}</h3>
            <div className="noteometry-mathpalette-grid">
              {g.symbols.map((s) => {
                const isArmed = armed?.symbol === s.ch;
                return (
                  <button
                    key={s.ch + g.id}
                    type="button"
                    className={`noteometry-mathpalette-key${isArmed ? ' is-armed' : ''}`}
                    onClick={() => onArm({ symbol: s.ch, size })}
                    aria-label={`Stamp ${s.aria}`}
                    title={`Stamp ${s.aria}`}
                  >
                    {s.ch}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </aside>
  );
}

function SizeButton({
  current, value, label, onPick,
}: {
  current: MathPaletteSize;
  value: MathPaletteSize;
  label: string;
  onPick: (v: MathPaletteSize) => void;
}) {
  return (
    <button
      type="button"
      className={`noteometry-mathpalette-size${current === value ? ' is-active' : ''}`}
      onClick={() => onPick(value)}
      aria-pressed={current === value}
    >
      {label}
    </button>
  );
}

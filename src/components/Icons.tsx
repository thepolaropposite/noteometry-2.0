/**
 * Icons — small SVG icon library for Noteometry OS.
 *
 * Style brief (Dan, 2026-05-18): no emojis, app-like, dyslexia-friendly.
 * All icons stroke at `currentColor`, sit on a 24×24 box, and look at
 * home inside the 36-px colored tiles used by the right-click menu and
 * other command surfaces.
 *
 * Add icons sparingly: one per command. If we need more, give it a real
 * name (`PenIcon`, not `Icon1`) so the menu code stays readable.
 */
import type { SVGProps } from 'react';

const base: SVGProps<SVGSVGElement> = {
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
};

export function PenIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M14.5 4.5l5 5L9 20H4v-5L14.5 4.5z" />
      <path d="M13 6l5 5" />
    </svg>
  );
}

export function EraserIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M6 18l-3-3a2 2 0 010-2.8l9-9a2 2 0 012.8 0l5 5a2 2 0 010 2.8L13 18H6z" />
      <path d="M8 16l4-4" />
    </svg>
  );
}

export function CursorIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M4 4l7 16 2.4-7.6L21 10 4 4z" />
    </svg>
  );
}

export function TextIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M5 6h14" />
      <path d="M12 6v13" />
      <path d="M8 19h8" />
    </svg>
  );
}

export function TableIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M3.5 10h17" />
      <path d="M3.5 15h17" />
      <path d="M10 4.5v15" />
      <path d="M15 4.5v15" />
    </svg>
  );
}

export function MathIcon(props: SVGProps<SVGSVGElement>) {
  // Capital Sigma (Σ): top-right corner → top bar leftward → diagonal
  // down-right to a left-leaning elbow → diagonal down-left → bottom
  // bar rightward. The V points LEFT, opening RIGHTWARD, so the icon
  // reads as forward-facing Σ (not the mirrored shape it used to draw).
  return (
    <svg {...base} {...props}>
      <path d="M18 5H6l6 7-6 7h12" />
    </svg>
  );
}

export function ImageIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M21 17l-5-5-9 9" />
    </svg>
  );
}

export function PdfIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M7 3h7l4 4v14H7z" />
      <path d="M14 3v4h4" />
      <path d="M9 13h2a1.5 1.5 0 010 3H9z" />
      <path d="M14 13v3M14 13h1.5a1.5 1.5 0 010 3H14" />
    </svg>
  );
}

export function MathPaletteIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
      <circle cx="8" cy="9" r="1" />
      <circle cx="12" cy="9" r="1" />
      <circle cx="16" cy="9" r="1" />
      <circle cx="8" cy="13" r="1" />
      <circle cx="12" cy="13" r="1" />
      <circle cx="16" cy="13" r="1" />
    </svg>
  );
}

export function ExportIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M12 4v12" />
      <path d="M7 11l5 5 5-5" />
      <path d="M5 20h14" />
    </svg>
  );
}

export function PlusIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

export function ChevronRightIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function ChevronLeftIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}

export function WordIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M7 9l2 6 3-4 3 4 2-6" />
    </svg>
  );
}

export function EyeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function SolveIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M9 3v4" />
      <path d="M15 3v4" />
      <path d="M5 7h14" />
      <rect x="5" y="7" width="14" height="14" rx="2" />
      <path d="M9 13h2M13 13h2" />
      <path d="M9 17h6" />
    </svg>
  );
}

export function CameraIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M3 8h4l2-3h6l2 3h4v11H3z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}

export function AskIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M21 12a8 8 0 11-3-6.2L21 4l-1.2 3.5A8 8 0 0121 12z" />
      <circle cx="12" cy="13" r="0.5" />
      <path d="M10 10.5a2 2 0 113 1.6c-.6.4-1 .7-1 1.4" />
    </svg>
  );
}

export function TrashIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3" />
      <path d="M6 7l1 13h10l1-13" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

export function InfoIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <circle cx="12" cy="8" r="0.6" />
    </svg>
  );
}

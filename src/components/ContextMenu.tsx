/**
 * ContextMenu — the FLAT right-click command palette for Noteometry OS.
 *
 * Rules (set by Dan):
 *   - No nested dropdowns.
 *   - No hover-to-reveal submenus.
 *   - Every command visible at once in a single tall list.
 *   - Section headers are visible group labels, not flyouts.
 *
 * This is the entire tool surface of the app. The pen/eraser/lasso/insert
 * actions are all reachable here and nowhere else — there is no toolbar,
 * no floating HUD, and no bottom-right drop-in launcher.
 */
import { useEffect, useRef, useCallback, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface ContextMenuItem {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  /** Visual separator line. */
  separator?: boolean;
  /** Non-clickable section header label. */
  header?: boolean;
  shortcut?: string;
  /** Legacy single-glyph icon (still supported but emoji-free now). */
  icon?: string;
  /** SVG icon component (preferred). When present, replaces `icon`. */
  iconNode?: ReactNode;
  /** Accent color for the icon tile and the header underline. Used to
   *  color-code command groups so the menu reads visually. */
  accent?: string;
}

interface Props {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export default function ContextMenu({ x, y, items, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);

  const portalTarget = typeof document !== "undefined" ? document.body : null;

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      const root = menuRef.current;
      if (!root) return;
      if (target && root.contains(target)) return;
      if (target instanceof Element && target.closest(".noteometry-ctx-menu")) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    let registered = false;
    const timer = setTimeout(() => {
      document.addEventListener("pointerdown", onDown, true);
      registered = true;
    }, 0);
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(timer);
      if (registered) document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Clamp position to stay on-screen.
  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (rect.right > vw) el.style.left = `${Math.max(8, vw - rect.width - 8)}px`;
    if (rect.bottom > vh) el.style.top = `${Math.max(8, vh - rect.height - 8)}px`;
    if (rect.top < 8) el.style.top = "8px";
    if (rect.left < 8) el.style.left = "8px";
  }, [x, y]);

  const handleRowClick = useCallback((e: React.PointerEvent, item: ContextMenuItem) => {
    if (item.disabled || item.header || item.separator) return;
    e.stopPropagation();
    item.onClick?.();
    onClose();
  }, [onClose]);

  if (!portalTarget) return null;

  const tree = (
    <div
      ref={menuRef}
      className="noteometry-ctx-menu"
      style={{ position: "fixed", left: x, top: y, zIndex: 10000 }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) => {
        if (item.separator) return <div key={i} className="noteometry-ctx-sep" />;
        if (item.header) {
          return (
            <div
              key={i}
              className="noteometry-ctx-header"
              style={item.accent ? ({ ['--nm-ctx-accent' as 'color']: item.accent } as React.CSSProperties) : undefined}
              aria-hidden="true"
            >
              <span className="noteometry-ctx-header-dot" style={item.accent ? { background: item.accent } : undefined} />
              {item.label}
            </div>
          );
        }
        return (
          <button
            key={i}
            type="button"
            className={[
              "noteometry-ctx-item",
              item.disabled ? "disabled" : "",
              item.danger ? "danger" : "",
              (item.iconNode || item.icon) ? "has-icon-tile" : "",
            ].filter(Boolean).join(" ")}
            disabled={item.disabled}
            onPointerUp={(e) => handleRowClick(e, item)}
          >
            {(item.iconNode || item.icon) && (
              <span
                className="noteometry-ctx-icon-tile"
                style={item.accent ? { background: `${item.accent}26`, color: item.accent } : undefined}
                aria-hidden="true"
              >
                {item.iconNode ?? <span className="noteometry-ctx-icon">{item.icon}</span>}
              </span>
            )}
            <span className="noteometry-ctx-label">{item.label}</span>
            {item.shortcut && <span className="noteometry-ctx-shortcut">{item.shortcut}</span>}
          </button>
        );
      })}
    </div>
  );

  return createPortal(tree, portalTarget);
}

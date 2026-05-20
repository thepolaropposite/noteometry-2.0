import type { ContextMenuItem } from "../components/ContextMenu";

export function buildClearCanvasAction(onDestructiveClear: () => void): ContextMenuItem {
  return {
    label: "Clear Canvas",
    icon: "🗑️",
    danger: true,
    onClick: onDestructiveClear,
  };
}

export const CLEAR_CANVAS_LABEL = "Clear Canvas";

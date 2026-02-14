"use client";

import { useEffect, type RefObject } from "react";

/**
 * Observes text selections within a container element.
 *
 * Uses `selectionchange` as the primary event with mouse-state tracking and
 * input-aware debouncing (Hypothesis annotation tool pattern):
 * - Mouse selections: 10ms delay after mouseup (selection finalized)
 * - Keyboard/programmatic: 100ms debounce on selectionchange
 * - During mouse drag: intermediate selectionchange events are ignored
 *
 * @param containerRef - Ref to the container element; selections outside it are ignored
 * @param onSelection - Called with the finalized Range when a non-collapsed selection is detected within the container
 * @param onClearSelection - Called when the selection is cleared (collapsed) or moves outside the container
 */
export function useSelectionObserver(
  containerRef: RefObject<HTMLElement | null>,
  onSelection: (range: Range) => void,
  onClearSelection: () => void,
) {
  useEffect(() => {
    let isMouseDown = false;
    let pendingTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleCallback = (delay: number) => {
      if (pendingTimer) clearTimeout(pendingTimer);
      pendingTimer = setTimeout(() => {
        const sel = document.getSelection();
        if (!sel || sel.isCollapsed) {
          onClearSelection();
          return;
        }
        const container = containerRef.current;
        if (!container || !container.contains(sel.anchorNode)) return;
        onSelection(sel.getRangeAt(0));
      }, delay);
    };

    const onMouseDown = () => {
      isMouseDown = true;
    };

    const onMouseUp = () => {
      isMouseDown = false;
      scheduleCallback(10);
    };

    const onSelectionChange = () => {
      if (isMouseDown) return;
      scheduleCallback(100);
    };

    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("selectionchange", onSelectionChange);

    return () => {
      if (pendingTimer) clearTimeout(pendingTimer);
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, [containerRef, onSelection, onClearSelection]);
}

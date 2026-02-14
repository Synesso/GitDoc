"use client";

import { useCallback, useRef, type RefObject } from "react";

/**
 * Hook that preserves scroll position across document refreshes by
 * recording the `data-source-start` attribute of the element at the
 * top of the viewport before refresh, and scrolling back to it after
 * the re-render completes.
 *
 * The scroll container is expected to be the `<main>` element with
 * `overflow-y-auto` from `DocumentReviewLayout`.
 */
export function useScrollPreservation(
  containerRef: RefObject<HTMLElement | null>,
) {
  const savedSourceLineRef = useRef<number | null>(null);

  /**
   * Record the `data-source-start` of the element currently at the
   * top of the visible viewport within the scroll container.
   * Call this **before** triggering a content refresh.
   */
  const saveScrollPosition = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    // Target point: just inside the top of the container (with padding offset)
    const targetY = containerRect.top + 24; // account for p-6 (1.5rem = 24px) padding

    const elements = container.querySelectorAll<HTMLElement>(
      "[data-source-start]",
    );

    let best: { el: HTMLElement; distance: number } | null = null;

    for (const el of elements) {
      const rect = el.getBoundingClientRect();
      // Only consider elements that are at or below the viewport top
      // (i.e., still visible or just scrolled past)
      if (rect.bottom < containerRect.top) continue;

      const distance = Math.abs(rect.top - targetY);
      if (!best || distance < best.distance) {
        best = { el, distance };
      }
    }

    if (best) {
      const sourceLine = parseInt(
        best.el.getAttribute("data-source-start") ?? "",
        10,
      );
      savedSourceLineRef.current = Number.isNaN(sourceLine)
        ? null
        : sourceLine;
    } else {
      savedSourceLineRef.current = null;
    }
  }, [containerRef]);

  /**
   * After re-render, find the element with the previously saved
   * `data-source-start` and scroll it into view. Falls back to the
   * nearest available source line if the exact line no longer exists.
   * Call this **after** the new content has been rendered.
   */
  const restoreScrollPosition = useCallback(() => {
    const container = containerRef.current;
    const targetLine = savedSourceLineRef.current;
    if (!container || targetLine === null) return;

    // Use rAF to ensure the DOM has been updated
    requestAnimationFrame(() => {
      // Try exact match first
      let target = container.querySelector<HTMLElement>(
        `[data-source-start="${targetLine}"]`,
      );

      // Fallback: find the closest available source line
      if (!target) {
        const elements = container.querySelectorAll<HTMLElement>(
          "[data-source-start]",
        );
        let bestEl: HTMLElement | null = null;
        let bestDelta = Infinity;

        for (const el of elements) {
          const line = parseInt(
            el.getAttribute("data-source-start") ?? "",
            10,
          );
          if (Number.isNaN(line)) continue;
          const delta = Math.abs(line - targetLine);
          if (delta < bestDelta) {
            bestDelta = delta;
            bestEl = el;
          }
        }

        target = bestEl;
      }

      if (target) {
        target.scrollIntoView({ behavior: "instant", block: "start" });
      }

      savedSourceLineRef.current = null;
    });
  }, [containerRef]);

  return { saveScrollPosition, restoreScrollPosition };
}

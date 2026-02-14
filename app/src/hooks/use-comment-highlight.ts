"use client";

import { useEffect } from "react";
import type { SelectionInfo } from "@/lib/extract-selection-info";

/**
 * Applies a CSS highlight class (`comment-target-highlight`) to rendered
 * markdown elements whose source line range falls within the selected
 * passage while the comment form is open.
 *
 * This provides a visual substitute for the native browser selection,
 * which is cleared when the comment form's textarea gains focus.
 * Mirrors the Google Docs pattern of highlighting the passage in the
 * margin while composing a comment.
 *
 * Elements are matched by their `data-source-start` / `data-source-end`
 * attributes (set by the `rehype-source-lines` plugin). An element is
 * highlighted if its source range overlaps with the selection range.
 *
 * @param containerRef - Ref to the rendered markdown container element
 * @param selectionInfo - The captured selection snapshot, or `null` if no
 *   comment form is open
 */
export function useCommentHighlight(
  containerRef: React.RefObject<HTMLElement | null>,
  selectionInfo: SelectionInfo | null,
) {
  useEffect(() => {
    if (!selectionInfo || !containerRef.current) return;

    const { startLine, endLine } = selectionInfo;
    const els = containerRef.current.querySelectorAll("[data-source-start]");
    const highlighted: Element[] = [];

    els.forEach((el) => {
      const s = Number(el.getAttribute("data-source-start"));
      const e = Number(el.getAttribute("data-source-end"));
      // Highlight elements whose source range overlaps the selection
      if (s >= startLine && e <= endLine) {
        el.classList.add("comment-target-highlight");
        highlighted.push(el);
      }
    });

    return () => {
      highlighted.forEach((el) =>
        el.classList.remove("comment-target-highlight"),
      );
    };
  }, [selectionInfo, containerRef]);
}

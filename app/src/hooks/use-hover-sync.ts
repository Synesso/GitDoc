"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CommentThread } from "@/lib/build-comment-threads";

/**
 * Bidirectional hover sync between comment thread cards in the sidebar
 * and their corresponding passages in the rendered markdown.
 *
 * - **Hover on thread card → highlight passage**: Adds `passage-hover-highlight`
 *   class to elements whose `[data-source-start, data-source-end]` range overlaps
 *   the thread's `[startLine, line]` range.
 * - **Hover on passage → highlight thread card**: When hovering a
 *   `[data-source-start]` element, finds all threads whose line range overlaps
 *   and reports their IDs via `highlightedThreadId`.
 *
 * The passage→thread mapping is pre-computed on each render to avoid per-hover
 * DOM queries.
 */
export function useHoverSync(
  contentRef: React.RefObject<HTMLElement | null>,
  threads: CommentThread[],
) {
  const [highlightedThreadId, setHighlightedThreadId] = useState<
    string | number | null
  >(null);
  const highlightedEls = useRef<Element[]>([]);

  // --- Direction 1: Thread card hover → highlight passage ---

  const onThreadMouseEnter = useCallback(
    (thread: CommentThread) => {
      const container = contentRef.current;
      if (!container) return;

      const startLine = thread.startLine ?? thread.line;
      const endLine = thread.line;
      const els = container.querySelectorAll("[data-source-start]");

      els.forEach((el) => {
        const s = Number(el.getAttribute("data-source-start"));
        const e = Number(el.getAttribute("data-source-end"));
        // Overlap check: element range [s,e] overlaps thread range [startLine,endLine]
        if (s <= endLine && e >= startLine) {
          el.classList.add("passage-hover-highlight");
          highlightedEls.current.push(el);
        }
      });
    },
    [contentRef],
  );

  const onThreadMouseLeave = useCallback(() => {
    highlightedEls.current.forEach((el) =>
      el.classList.remove("passage-hover-highlight"),
    );
    highlightedEls.current = [];
  }, []);

  // --- Direction 2: Passage hover → highlight thread card ---

  useEffect(() => {
    const container = contentRef.current;
    if (!container || threads.length === 0) return;

    const handleMouseOver = (e: MouseEvent) => {
      const target = e.target as Element;
      const el = target.closest?.("[data-source-start]");
      if (!el) {
        setHighlightedThreadId(null);
        return;
      }

      const s = Number(el.getAttribute("data-source-start"));
      const e2 = Number(el.getAttribute("data-source-end"));

      // Find the first thread whose line range overlaps this element
      const matched = threads.find((t) => {
        const tStart = t.startLine ?? t.line;
        const tEnd = t.line;
        return s <= tEnd && e2 >= tStart;
      });

      setHighlightedThreadId(matched?.id ?? null);
    };

    const handleMouseLeave = () => {
      setHighlightedThreadId(null);
    };

    container.addEventListener("mouseover", handleMouseOver);
    container.addEventListener("mouseleave", handleMouseLeave);

    return () => {
      container.removeEventListener("mouseover", handleMouseOver);
      container.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [contentRef, threads]);

  return {
    /** ID of the thread card to highlight (from passage hover) */
    highlightedThreadId,
    /** Call on thread card mouseenter */
    onThreadMouseEnter,
    /** Call on thread card mouseleave */
    onThreadMouseLeave,
  };
}

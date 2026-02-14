"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CommentThread } from "@/lib/build-comment-threads";

/** Duration (ms) for the momentary highlight after click-to-scroll */
const CLICK_HIGHLIGHT_DURATION = 1500;

/**
 * Finds DOM elements in `container` whose `[data-source-start, data-source-end]`
 * range overlaps the thread's `[startLine, line]` range.
 */
function findOverlappingElements(
  container: HTMLElement,
  thread: CommentThread,
): Element[] {
  const startLine = thread.startLine ?? thread.line;
  const endLine = thread.line;
  const matched: Element[] = [];
  const els = container.querySelectorAll("[data-source-start]");

  els.forEach((el) => {
    const s = Number(el.getAttribute("data-source-start"));
    const e = Number(el.getAttribute("data-source-end"));
    if (s <= endLine && e >= startLine) {
      matched.push(el);
    }
  });

  return matched;
}

/**
 * Bidirectional hover and click-to-scroll sync between comment thread cards
 * in the sidebar and their corresponding passages in the rendered markdown.
 *
 * **Hover sync:**
 * - **Thread card → passage**: Adds `passage-hover-highlight` class to elements
 *   whose source line range overlaps the thread's line range.
 * - **Passage → thread card**: Reports `highlightedThreadId` for the thread
 *   whose line range overlaps the hovered element.
 *
 * **Click-to-scroll sync:**
 * - **Thread card click → scroll passage into view**: Scrolls the first
 *   overlapping passage element into view and applies a momentary highlight.
 * - **Passage click → scroll thread card into view**: Scrolls the matching
 *   thread card into view and applies a momentary highlight.
 */
export function useHoverSync(
  contentRef: React.RefObject<HTMLElement | null>,
  threads: CommentThread[],
  /** Ref to the sidebar/thread list container, needed for click-to-scroll */
  sidebarRef?: React.RefObject<HTMLElement | null>,
) {
  const [highlightedThreadId, setHighlightedThreadId] = useState<
    string | number | null
  >(null);
  const highlightedEls = useRef<Element[]>([]);
  const clickHighlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Direction 1: Thread card hover → highlight passage ---

  const onThreadMouseEnter = useCallback(
    (thread: CommentThread) => {
      const container = contentRef.current;
      if (!container) return;

      const els = findOverlappingElements(container, thread);
      els.forEach((el) => {
        el.classList.add("passage-hover-highlight");
        highlightedEls.current.push(el);
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

  // --- Click-to-scroll: Thread card click → scroll passage into view ---

  const onThreadClick = useCallback(
    (thread: CommentThread) => {
      const container = contentRef.current;
      if (!container) return;

      const els = findOverlappingElements(container, thread);
      if (els.length === 0) return;

      // Scroll the first matching element into view
      els[0].scrollIntoView({ behavior: "smooth", block: "center" });

      // Apply momentary highlight, then fade
      els.forEach((el) => el.classList.add("passage-click-highlight"));
      if (clickHighlightTimer.current) clearTimeout(clickHighlightTimer.current);
      clickHighlightTimer.current = setTimeout(() => {
        els.forEach((el) => el.classList.remove("passage-click-highlight"));
      }, CLICK_HIGHLIGHT_DURATION);
    },
    [contentRef],
  );

  // --- Click-to-scroll: Passage click → scroll thread card into view ---

  const onPassageClickScrollToThread = useCallback(
    (threadId: string | number) => {
      const sidebar = sidebarRef?.current;
      if (!sidebar) return;

      const card = sidebar.querySelector(
        `[data-thread-id="${threadId}"]`,
      );
      if (!card) return;

      card.scrollIntoView({ behavior: "smooth", block: "center" });

      // Apply momentary highlight, then fade
      card.classList.add("thread-card-click-highlight");
      if (clickHighlightTimer.current) clearTimeout(clickHighlightTimer.current);
      clickHighlightTimer.current = setTimeout(() => {
        card.classList.remove("thread-card-click-highlight");
      }, CLICK_HIGHLIGHT_DURATION);
    },
    [sidebarRef],
  );

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (clickHighlightTimer.current) clearTimeout(clickHighlightTimer.current);
    };
  }, []);

  return {
    /** ID of the thread card to highlight (from passage hover) */
    highlightedThreadId,
    /** Call on thread card mouseenter */
    onThreadMouseEnter,
    /** Call on thread card mouseleave */
    onThreadMouseLeave,
    /** Call on thread card click — scrolls the corresponding passage into view */
    onThreadClick,
    /** Call when a passage comment indicator is clicked — scrolls the thread card into view */
    onPassageClickScrollToThread,
  };
}

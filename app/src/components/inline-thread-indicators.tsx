"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { MessageSquare } from "lucide-react";
import type { ReviewThread } from "@/hooks/use-pr-threads";

interface IndicatorPosition {
  threadId: string;
  top: number;
  commentCount: number;
  isResolved: boolean;
}

interface InlineThreadIndicatorsProps {
  /** Ref to the content container holding the rendered markdown */
  contentRef: React.RefObject<HTMLElement | null>;
  /** Ref to the scroll container (if different from contentRef) */
  scrollRef?: React.RefObject<HTMLElement | null>;
  /** Active (non-outdated) threads for the current file */
  threads: ReviewThread[];
  /** Called when an indicator is clicked — scrolls the sidebar thread card into view */
  onIndicatorClick: (threadId: string) => void;
}

const HAS_THREAD_CLASS = "has-thread-accent";

/**
 * Desktop inline comment indicators in the left gutter.
 *
 * Renders small comment-count badges positioned next to rendered markdown
 * passages that have existing comment threads. Clicking a badge scrolls
 * the corresponding thread card in the sidebar into view.
 *
 * Also applies a `has-thread-accent` CSS class to DOM elements that have
 * threads anchored to them, giving a subtle left-border visual treatment.
 *
 * Hidden below `md` breakpoint (mobile uses MobileCommentIndicators).
 */
export function InlineThreadIndicators({
  contentRef,
  scrollRef,
  threads,
  onIndicatorClick,
}: InlineThreadIndicatorsProps) {
  const [positions, setPositions] = useState<IndicatorPosition[]>([]);
  const rafRef = useRef<number>(0);
  const accentedEls = useRef<Element[]>([]);

  const computePositions = useCallback(() => {
    const container = contentRef.current;
    if (!container) return;

    // Clean up previously accented elements
    for (const el of accentedEls.current) {
      el.classList.remove(HAS_THREAD_CLASS);
    }
    accentedEls.current = [];

    const containerRect = container.getBoundingClientRect();

    const indicators: IndicatorPosition[] = [];

    for (const thread of threads) {
      if (thread.isOutdated || thread.line == null) continue;

      const threadStart = thread.startLine ?? thread.line;
      const threadEnd = thread.line;

      // Find a DOM element whose source-line range overlaps the thread's range
      const elements = container.querySelectorAll("[data-source-start]");
      let bestElement: Element | null = null;

      for (const el of elements) {
        const start = Number(el.getAttribute("data-source-start"));
        const end = Number(el.getAttribute("data-source-end"));
        if (start <= threadEnd && end >= threadStart) {
          // Apply accent class to all overlapping elements
          el.classList.add(HAS_THREAD_CLASS);
          accentedEls.current.push(el);
          if (!bestElement) bestElement = el;
        }
      }

      if (!bestElement) continue;

      // Position relative to the container's visible viewport — the overlay
      // is `absolute inset-0` so it doesn't scroll with content.
      const elRect = bestElement.getBoundingClientRect();
      const top = elRect.top - containerRect.top;

      indicators.push({
        threadId: thread.graphqlId,
        top,
        commentCount: thread.comments.length,
        isResolved: thread.isResolved,
      });
    }

    setPositions(indicators);
  }, [contentRef, threads]);

  useEffect(() => {
    computePositions();

    const scrollContainer = scrollRef?.current ?? contentRef.current;
    if (!scrollContainer) return;

    const onScroll = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(computePositions);
    };

    scrollContainer.addEventListener("scroll", onScroll);
    window.addEventListener("resize", onScroll);

    return () => {
      scrollContainer.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      // Clean up accent classes on unmount
      for (const el of accentedEls.current) {
        el.classList.remove(HAS_THREAD_CLASS);
      }
    };
  }, [contentRef, scrollRef, computePositions]);

  if (positions.length === 0) return null;

  return (
    <div className="absolute inset-0 pointer-events-none hidden md:block" aria-hidden="true">
      {positions.map((pos) => (
        <button
          key={pos.threadId}
          className={
            "inline-indicator-btn absolute left-0 pointer-events-auto flex items-center gap-0.5 rounded-r-md px-1.5 py-0.5 text-[11px] font-medium shadow-sm transition-colors z-10" +
            (pos.isResolved
              ? " bg-muted text-muted-foreground hover:bg-muted/80"
              : " bg-primary/90 text-primary-foreground hover:bg-primary")
          }
          style={{ top: pos.top }}
          onClick={() => onIndicatorClick(pos.threadId)}
          aria-label={`${pos.commentCount} ${pos.commentCount === 1 ? "comment" : "comments"} — click to view thread`}
        >
          <MessageSquare className="size-3" />
          <span>{pos.commentCount}</span>
        </button>
      ))}
    </div>
  );
}

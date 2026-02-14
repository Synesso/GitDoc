"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { MessageSquare } from "lucide-react";
import type { ReviewThread } from "@/hooks/use-pr-threads";

interface IndicatorPosition {
  threadId: string;
  top: number;
  commentCount: number;
}

interface MobileCommentIndicatorsProps {
  /** Ref to the scrollable content container holding the rendered markdown */
  contentRef: React.RefObject<HTMLElement | null>;
  /** Active (non-outdated) threads for the current file */
  threads: ReviewThread[];
  /** Called when an indicator is tapped — should open the drawer scrolled to this thread */
  onIndicatorTap: (threadId: string) => void;
}

/**
 * Mobile-only (<768px) inline comment indicators in the left gutter.
 *
 * Renders small comment-count badges positioned next to rendered markdown
 * passages that have existing comment threads. Tapping a badge opens
 * the mobile comment drawer pre-scrolled to that thread.
 *
 * Positions are computed from DOM elements with matching `data-source-start`
 * / `data-source-end` attributes, relative to the content container.
 */
export function MobileCommentIndicators({
  contentRef,
  threads,
  onIndicatorTap,
}: MobileCommentIndicatorsProps) {
  const [positions, setPositions] = useState<IndicatorPosition[]>([]);
  const rafRef = useRef<number>(0);

  const computePositions = useCallback(() => {
    const container = contentRef.current;
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const scrollTop = container.scrollTop;

    const indicators: IndicatorPosition[] = [];

    for (const thread of threads) {
      if (thread.isOutdated || thread.line == null) continue;

      // Find a DOM element whose source-line range includes the thread's anchor line
      const elements = container.querySelectorAll("[data-source-start]");
      let bestElement: Element | null = null;

      for (const el of elements) {
        const start = Number(el.getAttribute("data-source-start"));
        const end = Number(el.getAttribute("data-source-end"));
        if (start <= thread.line && thread.line <= end) {
          bestElement = el;
          break;
        }
      }

      if (!bestElement) continue;

      const elRect = bestElement.getBoundingClientRect();
      // Position relative to the content container's scroll
      const top = elRect.top - containerRect.top + scrollTop;

      indicators.push({
        threadId: thread.graphqlId,
        top,
        commentCount: thread.comments.length,
      });
    }

    setPositions(indicators);
  }, [contentRef, threads]);

  useEffect(() => {
    computePositions();

    const container = contentRef.current;
    if (!container) return;

    // Recompute on scroll (throttled via rAF)
    const onScroll = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(computePositions);
    };

    container.addEventListener("scroll", onScroll);
    window.addEventListener("resize", onScroll);

    return () => {
      container.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [contentRef, computePositions]);

  if (positions.length === 0) return null;

  return (
    <div className="absolute inset-0 pointer-events-none md:hidden" aria-hidden="true">
      {positions.map((pos) => (
        <button
          key={pos.threadId}
          className="mobile-indicator-btn absolute left-0 pointer-events-auto flex items-center gap-0.5 rounded-r-md bg-primary/90 text-primary-foreground px-1 py-0.5 text-[10px] font-medium shadow-sm hover:bg-primary transition-colors z-10"
          style={{ top: pos.top }}
          onClick={() => onIndicatorTap(pos.threadId)}
          aria-label={`${pos.commentCount} ${pos.commentCount === 1 ? "comment" : "comments"}`}
        >
          <MessageSquare className="size-3" />
          <span>{pos.commentCount}</span>
        </button>
      ))}
    </div>
  );
}

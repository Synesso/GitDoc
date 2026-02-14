"use client";

import { useCallback, useRef } from "react";

interface CommentThreadListProps {
  /** Whether comments are currently loading/revalidating */
  isLoading?: boolean;
  /** Accessible label for the feed */
  "aria-label"?: string;
  /** Additional className for the container */
  className?: string;
  children: React.ReactNode;
}

/**
 * WAI-ARIA feed container for comment thread cards.
 *
 * Renders `role="feed"` with `aria-busy` during loading.
 * Implements Page Down/Up keyboard navigation between
 * `role="article"` children (CommentThreadCard instances).
 */
export function CommentThreadList({
  isLoading = false,
  "aria-label": ariaLabel = "Comment threads",
  className,
  children,
}: CommentThreadListProps) {
  const feedRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== "PageDown" && e.key !== "PageUp") return;

    const feed = feedRef.current;
    if (!feed) return;

    const articles = Array.from(
      feed.querySelectorAll<HTMLElement>('[role="article"]'),
    );
    if (articles.length === 0) return;

    const activeEl = document.activeElement as HTMLElement | null;
    const currentIndex = activeEl ? articles.indexOf(activeEl) : -1;

    let nextIndex: number;
    if (e.key === "PageDown") {
      nextIndex = currentIndex < articles.length - 1 ? currentIndex + 1 : currentIndex;
    } else {
      nextIndex = currentIndex > 0 ? currentIndex - 1 : 0;
    }

    if (nextIndex !== currentIndex || (currentIndex === -1 && articles.length > 0)) {
      e.preventDefault();
      const target = articles[nextIndex === -1 ? 0 : nextIndex];
      target.focus();
      target.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, []);

  return (
    <div
      ref={feedRef}
      role="feed"
      aria-label={ariaLabel}
      aria-busy={isLoading}
      className={className}
      onKeyDown={handleKeyDown}
    >
      {children}
    </div>
  );
}

"use client";

import { type ReactNode, type RefObject } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";

interface DocumentReviewLayoutProps {
  /** Content for the main area (rendered markdown, comment anchor, etc.) */
  children: ReactNode;
  /** Content for the right comment sidebar */
  sidebar: ReactNode;
  /** Optional header element rendered above the two-column layout */
  header?: ReactNode;
  /** Optional ref forwarded to the main content container */
  contentRef?: RefObject<HTMLElement | null>;
  /** Optional ref forwarded to the sidebar container */
  sidebarRef?: RefObject<HTMLDivElement | null>;
}

/**
 * Two-column desktop layout for document review:
 *
 * - Top: optional header bar (PR info, file selector)
 * - Left: rendered markdown content (`flex-1`, scrollable, padded)
 * - Right: comment sidebar (`w-80 lg:w-96`, border-left, hidden below `md`)
 *
 * On viewports < 768px the sidebar is hidden via `hidden md:block`
 * (mobile layout uses a bottom drawer instead — separate component).
 */
export function DocumentReviewLayout({
  children,
  sidebar,
  header,
  contentRef,
  sidebarRef,
}: DocumentReviewLayoutProps) {
  return (
    <div className="flex flex-col min-h-screen">
      {header}
      <div className="flex flex-1 overflow-hidden">
        <main
          ref={contentRef}
          className="relative flex-1 overflow-y-auto p-6"
          aria-label="Rendered document"
        >
          {children}
        </main>
        <aside
          className="hidden md:block w-80 lg:w-96 border-l"
          aria-label="Comment threads"
        >
          <ScrollArea className="h-full" ref={sidebarRef}>
            <div className="p-4">{sidebar}</div>
          </ScrollArea>
        </aside>
      </div>
    </div>
  );
}

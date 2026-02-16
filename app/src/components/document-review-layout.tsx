"use client";

import { type ReactNode, type RefObject } from "react";
import { StatusAnnouncer } from "@/components/status-announcer";

interface DocumentReviewLayoutProps {
  /** Content for the main area (rendered markdown, comment anchor, etc.) */
  children: ReactNode;
  /** Content for the right comment sidebar */
  sidebar: ReactNode;
  /** Optional header element rendered above the two-column layout */
  header?: ReactNode;
  /** Optional mobile drawer element (MobileCommentDrawer) — shown below md breakpoint */
  mobileDrawer?: ReactNode;
  /** Optional ref forwarded to the main content container */
  contentRef?: RefObject<HTMLElement | null>;
  /** Optional ref forwarded to the sidebar container */
  sidebarRef?: RefObject<HTMLDivElement | null>;
  /** Optional ref forwarded to the scroll container wrapping both columns */
  scrollRef?: RefObject<HTMLDivElement | null>;
}

/**
 * Two-column desktop layout for document review:
 *
 * - Top: optional header bar (PR info, file selector)
 * - Left: rendered markdown content (`flex-1`, padded)
 * - Right: comment sidebar (`w-[22rem] lg:w-[26rem] xl:w-[30rem]`, border-left, hidden below `md`)
 *
 * Both columns share a single scroll container so that sidebar thread cards
 * can be vertically aligned with the content they reference.
 *
 * On viewports < 768px the sidebar is hidden via `hidden md:block`
 * (mobile layout uses a bottom drawer instead — separate component).
 */
export function DocumentReviewLayout({
  children,
  sidebar,
  header,
  mobileDrawer,
  contentRef,
  sidebarRef,
  scrollRef,
}: DocumentReviewLayoutProps) {
  return (
    <div className="flex flex-col min-h-screen">
      <StatusAnnouncer />
      {header}
      <div className="flex-1 overflow-y-auto" ref={scrollRef}>
        <div className="flex min-h-full">
          <main
            ref={contentRef}
            className="relative flex-1 min-w-0 p-6"
            aria-label="Rendered document"
          >
            {children}
          </main>
          <aside
            ref={sidebarRef}
            className="hidden md:block w-[22rem] lg:w-[26rem] xl:w-[30rem] border-l relative shrink-0"
            role="complementary"
            aria-label="Comment threads"
          >
            {sidebar}
          </aside>
        </div>
      </div>
      {mobileDrawer}
    </div>
  );
}

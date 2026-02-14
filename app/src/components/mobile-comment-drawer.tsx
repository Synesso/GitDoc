"use client";

import { useEffect, useRef } from "react";
import { MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ReactNode } from "react";

interface MobileCommentDrawerProps {
  /** Total number of comment threads for the current file */
  threadCount: number;
  /** Content to render inside the drawer (typically CommentThreadList + OutdatedThreadsSection) */
  children: ReactNode;
  /** Controlled open state — when provided, the drawer is controlled externally */
  open?: boolean;
  /** Called when the drawer open state changes */
  onOpenChange?: (open: boolean) => void;
  /** Thread ID to scroll to when the drawer opens (set by inline indicators) */
  scrollToThreadId?: string | null;
  /** Called after the scroll-to-thread has been handled — allows parent to clear the scrollToThreadId */
  onScrollToThreadHandled?: () => void;
}

/**
 * Mobile-only (<768px) bottom drawer for viewing comment threads.
 *
 * Renders a floating badge in the bottom-right corner showing the
 * comment count. Tapping the badge opens a Vaul-powered bottom drawer
 * containing the comment thread list inside a ScrollArea.
 *
 * Supports controlled open/close via `open`/`onOpenChange` props for
 * programmatic opening (e.g., from inline comment indicators).
 * When `scrollToThreadId` is set, the drawer auto-scrolls to that
 * thread card after opening.
 */
export function MobileCommentDrawer({
  threadCount,
  children,
  open,
  onOpenChange,
  scrollToThreadId,
  onScrollToThreadHandled,
}: MobileCommentDrawerProps) {
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  // When the drawer opens with a scrollToThreadId, scroll to that thread
  useEffect(() => {
    if (!open || !scrollToThreadId) return;

    // Small delay to allow drawer animation and DOM rendering
    const timer = setTimeout(() => {
      const container = scrollAreaRef.current;
      if (!container) return;

      const threadEl = container.querySelector(
        `[data-thread-id="${CSS.escape(scrollToThreadId)}"]`,
      );
      if (threadEl) {
        threadEl.scrollIntoView({ behavior: "smooth", block: "start" });
        // Apply momentary highlight
        threadEl.classList.add("thread-card-click-highlight");
        setTimeout(() => {
          threadEl.classList.remove("thread-card-click-highlight");
        }, 1500);
      }

      onScrollToThreadHandled?.();
    }, 300);

    return () => clearTimeout(timer);
  }, [open, scrollToThreadId, onScrollToThreadHandled]);

  // Build controlled props only if open is provided
  const drawerProps =
    open !== undefined
      ? { open, onOpenChange }
      : {};

  return (
    <Drawer {...drawerProps}>
      <DrawerTrigger asChild>
        <button
          className="fixed bottom-4 right-4 z-40 flex items-center gap-1.5 rounded-full bg-primary px-3 py-2 text-primary-foreground shadow-lg hover:bg-primary/90 transition-colors md:hidden"
          aria-label={`${threadCount} comment ${threadCount === 1 ? "thread" : "threads"}`}
        >
          <MessageSquare className="size-4" />
          <Badge
            variant="secondary"
            className="bg-primary-foreground/20 text-primary-foreground text-xs px-1.5 py-0"
          >
            {threadCount}
          </Badge>
        </button>
      </DrawerTrigger>
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader>
          <DrawerTitle>
            Comments ({threadCount})
          </DrawerTitle>
        </DrawerHeader>
        <ScrollArea className="px-4 pb-4 flex-1 overflow-auto" ref={scrollAreaRef}>
          {children}
        </ScrollArea>
      </DrawerContent>
    </Drawer>
  );
}

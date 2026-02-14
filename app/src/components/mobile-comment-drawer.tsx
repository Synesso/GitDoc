"use client";

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
}

/**
 * Mobile-only (<768px) bottom drawer for viewing comment threads.
 *
 * Renders a floating badge in the bottom-right corner showing the
 * comment count. Tapping the badge opens a Vaul-powered bottom drawer
 * containing the comment thread list inside a ScrollArea.
 */
export function MobileCommentDrawer({
  threadCount,
  children,
}: MobileCommentDrawerProps) {
  return (
    <Drawer>
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
        <ScrollArea className="px-4 pb-4 flex-1 overflow-auto">
          {children}
        </ScrollArea>
      </DrawerContent>
    </Drawer>
  );
}

"use client";

import { useState } from "react";
import { Info, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface StaleShabannerProps {
  /** Whether the PR head SHA has changed since the page loaded */
  isStale: boolean;
  /** Called when the user clicks "Refresh Now" */
  onRefresh: () => void;
  /** Whether a refresh is currently in progress */
  isRefreshing?: boolean;
}

/**
 * Non-intrusive top-of-page banner shown when the PR has new commits
 * since the page was loaded. Offers "Refresh Now" (triggers re-sync)
 * and "Dismiss" (hides until next SHA change).
 *
 * Uses `role="status"` (`aria-live="polite"`) so screen readers
 * announce the change without interrupting the current task.
 */
export function StaleShaBanner({ isStale, onRefresh, isRefreshing = false }: StaleShabannerProps) {
  const [dismissed, setDismissed] = useState(false);

  if (!isStale || dismissed) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 border-b bg-blue-50 px-4 py-2 text-sm text-blue-900 dark:bg-blue-950/40 dark:text-blue-200"
    >
      <Info className="size-4 shrink-0" />
      <p className="flex-1">
        This PR has been updated with new commits. The content and commentable
        regions may have changed.
      </p>
      <div className="flex items-center gap-2 shrink-0">
        <Button
          variant="outline"
          size="xs"
          onClick={onRefresh}
          disabled={isRefreshing}
          className="gap-1"
        >
          <RefreshCw className={`size-3 ${isRefreshing ? "animate-spin" : ""}`} />
          {isRefreshing ? "Refreshing…" : "Refresh Now"}
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
        >
          <X className="size-3" />
        </Button>
      </div>
    </div>
  );
}

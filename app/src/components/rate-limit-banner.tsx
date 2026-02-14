"use client";

import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRateLimitMonitor } from "@/hooks/use-rate-limit-monitor";

/**
 * Warning banner shown when the GitHub API rate limit is running low
 * (`x-ratelimit-remaining` ≤ 100). Displays remaining request count
 * and the reset time. Dismissible — reappears if a subsequent API
 * response still reports a low remaining count.
 *
 * Intended to slot between the header and main content in
 * `DocumentReviewLayout` alongside `StaleShaBanner`.
 */
export function RateLimitBanner() {
  const { isWarning, remaining, resetDate, dismiss } = useRateLimitMonitor();

  if (!isWarning) return null;

  const resetLabel = resetDate
    ? resetDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "soon";

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 border-b bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
    >
      <AlertTriangle className="size-4 shrink-0" />
      <p className="flex-1">
        GitHub API rate limit is low:{" "}
        <span className="font-medium tabular-nums">{remaining}</span> requests
        remaining. Resets at{" "}
        <span className="font-medium">{resetLabel}</span>.
      </p>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={dismiss}
        aria-label="Dismiss rate limit warning"
      >
        <X className="size-3" />
      </Button>
    </div>
  );
}

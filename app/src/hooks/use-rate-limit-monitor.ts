"use client";

import { useSyncExternalStore, useCallback } from "react";

const RATE_LIMIT_THRESHOLD = 100;

interface RateLimitState {
  remaining: number | null;
  resetAt: number | null; // UTC epoch seconds
}

// ---------------------------------------------------------------------------
// Module-level store — updated from any fetch call that returns rate headers
// ---------------------------------------------------------------------------

let state: RateLimitState = { remaining: null, resetAt: null };
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

/**
 * Call after any fetch to our API proxy routes to track the latest rate-limit
 * values. Extracts `x-ratelimit-remaining` and `x-ratelimit-reset` headers.
 */
export function updateRateLimitFromHeaders(headers: Headers) {
  const remaining = headers.get("x-ratelimit-remaining");
  const reset = headers.get("x-ratelimit-reset");
  if (remaining == null) return;

  const next: RateLimitState = {
    remaining: Number(remaining),
    resetAt: reset ? Number(reset) : state.resetAt,
  };

  // Only emit if values actually changed
  if (next.remaining !== state.remaining || next.resetAt !== state.resetAt) {
    state = next;
    emit();
  }
}

function getSnapshot(): RateLimitState {
  return state;
}

function getServerSnapshot(): RateLimitState {
  return { remaining: null, resetAt: null };
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

/**
 * Hook that monitors GitHub API rate-limit headers across all proxy responses.
 *
 * Returns `isWarning` when `x-ratelimit-remaining` drops below the threshold
 * (default: 100), along with the current remaining count and reset time.
 */
export function useRateLimitMonitor() {
  const { remaining, resetAt } = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  const isWarning =
    remaining != null && remaining <= RATE_LIMIT_THRESHOLD;

  const resetDate = resetAt ? new Date(resetAt * 1000) : null;

  const dismiss = useCallback(() => {
    // Reset to a non-warning state so the banner hides.
    // It will re-appear if a subsequent response still has low remaining.
    state = { remaining: null, resetAt: null };
    emit();
  }, []);

  return {
    /** True when remaining requests is at or below the warning threshold */
    isWarning,
    /** Number of requests remaining in the current rate-limit window */
    remaining,
    /** Date when the rate-limit window resets */
    resetDate,
    /** Dismiss the warning (until the next low-remaining response) */
    dismiss,
  };
}

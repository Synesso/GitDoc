"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Module-level external store for status announcements.
 *
 * A single persistent `<div aria-live="polite">` renders the current message.
 * The element must be in the DOM *before* the message is set (otherwise
 * screen readers may skip the announcement). The `StatusAnnouncer` component
 * handles that — it mounts once and stays in the tree.
 *
 * Messages auto-clear after `AUTO_CLEAR_MS` (5 000 ms) so stale
 * announcements don't linger for screen reader users re-entering the region.
 */

const AUTO_CLEAR_MS = 5_000;

let currentMessage = "";
let clearTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return currentMessage;
}

function getServerSnapshot() {
  return "";
}

/**
 * Set a new status message in the aria-live region.
 *
 * The message clears automatically after 5 seconds.
 * Calling again before the timer expires replaces the message and restarts
 * the timer.
 */
export function announce(message: string) {
  if (clearTimer) clearTimeout(clearTimer);
  currentMessage = message;
  emitChange();

  if (message) {
    clearTimer = setTimeout(() => {
      currentMessage = "";
      clearTimer = null;
      emitChange();
    }, AUTO_CLEAR_MS);
  }
}

/**
 * React hook that subscribes to the current status message.
 *
 * Returns `{ message, announce }`:
 * - `message` — the current text displayed in the aria-live region
 * - `announce` — stable callback to push a new status message
 */
export function useStatusAnnouncer() {
  const message = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const stableAnnounce = useCallback((msg: string) => announce(msg), []);

  return { message, announce: stableAnnounce } as const;
}

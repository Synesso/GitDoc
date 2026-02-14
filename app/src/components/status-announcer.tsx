"use client";

import { useStatusAnnouncer } from "@/hooks/use-status-announcer";

/**
 * Persistent aria-live region for screen reader announcements.
 *
 * Renders a visually-hidden `<div>` that is always present in the DOM.
 * Status messages (comment posted, error, loading, etc.) are announced
 * politely — they won't interrupt the user's current screen reader output.
 *
 * Mount this component **once** near the top of the component tree (e.g.
 * inside `DocumentReviewLayout`) so the container exists before any
 * announcement is triggered.
 */
export function StatusAnnouncer() {
  const { message } = useStatusAnnouncer();

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      role="status"
      className="sr-only"
      id="gitdoc-status"
    >
      {message}
    </div>
  );
}

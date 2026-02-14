"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AlertCircle, LogIn, RefreshCw, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { SelectionInfo } from "@/lib/extract-selection-info";
import type { ApiError } from "@/lib/api-error";
import {
  saveDraft,
  loadDraft,
  clearDraft,
  lineRangeKey,
} from "@/lib/comment-drafts";

export interface CommentSubmissionError {
  /** The classified API error */
  error: ApiError;
  /** Callback to manually retry submission */
  onRetry?: () => void;
  /** Callback to refresh PR data (for stale SHA 422 errors) */
  onRefresh?: () => void;
}

interface CommentFormProps {
  /** The captured selection snapshot — provides line context and selected text */
  selectionInfo: SelectionInfo;
  /** Called with the comment body when the user submits */
  onSubmit: (body: string) => void;
  /** Called when the user cancels (Escape or Cancel button) */
  onCancel: () => void;
  /** Whether the form is currently submitting */
  isSubmitting?: boolean;
  /** PR number — required for draft storage key */
  prNumber?: number;
  /** File path — required for draft storage key */
  filePath?: string;
  /** Error from a failed submission attempt, displayed by category */
  submissionError?: CommentSubmissionError | null;
}

/**
 * Non-modal comment input form that appears in the right margin when the
 * user initiates a comment on a text selection.
 *
 * Uses `role="dialog"` with `aria-modal="false"` so the user can still
 * interact with the document while composing. Auto-focuses the textarea
 * on mount. `aria-describedby` announces the line context to screen readers.
 */
export function CommentForm({
  selectionInfo,
  onSubmit,
  onCancel,
  isSubmitting = false,
  prNumber,
  filePath,
  submissionError,
}: CommentFormProps) {
  const { startLine, endLine, selectedText } = selectionInfo;
  const rangeKey = lineRangeKey(startLine, endLine);
  const canPersist = prNumber != null && filePath != null;

  const [body, setBody] = useState(() => {
    if (!canPersist) return "";
    return loadDraft(prNumber, filePath, rangeKey) ?? "";
  });
  const [restoredDraft, setRestoredDraft] = useState(() => {
    if (!canPersist) return false;
    return loadDraft(prNumber, filePath, rangeKey) != null;
  });

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const id = useId();

  const inputId = `comment-input-${id}`;
  const contextId = `comment-context-${id}`;

  // Auto-save draft on body change
  useEffect(() => {
    if (!canPersist) return;
    saveDraft(prNumber, filePath, rangeKey, body);
  }, [body, canPersist, prNumber, filePath, rangeKey]);

  // Dismiss "restored" indicator once the user starts typing
  useEffect(() => {
    if (restoredDraft && body === "") setRestoredDraft(false);
  }, [body, restoredDraft]);

  const contextText =
    selectedText.length > 50
      ? `${selectedText.slice(0, 50)}…`
      : selectedText;

  const lineLabel =
    startLine === endLine
      ? `line ${startLine}`
      : `lines ${startLine}–${endLine}`;

  const handleSubmit = useCallback(() => {
    const trimmed = body.trim();
    if (!trimmed) return;
    if (canPersist) clearDraft(prNumber, filePath, rangeKey);
    onSubmit(trimmed);
  }, [body, onSubmit, canPersist, prNumber, filePath, rangeKey]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
      // Cmd/Ctrl+Enter to submit
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [onCancel, handleSubmit],
  );

  return (
    <div
      role="dialog"
      aria-label="Add comment"
      aria-modal="false"
      onKeyDown={handleKeyDown}
      className="rounded-lg border bg-background shadow-md p-3 w-72"
    >
      <label htmlFor={inputId} className="sr-only">
        Write your comment
      </label>
      <Textarea
        ref={textareaRef}
        id={inputId}
        aria-describedby={contextId}
        autoFocus
        placeholder="Write a comment…"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        disabled={isSubmitting}
        className="min-h-20 resize-y text-sm"
      />
      <p id={contextId} className="sr-only">
        Commenting on {lineLabel}: &ldquo;{contextText}&rdquo;
      </p>
      {restoredDraft && (
        <p className="text-xs text-muted-foreground mt-1">
          Restored unsaved comment
        </p>
      )}
      {submissionError && (
        <SubmissionErrorBanner
          submissionError={submissionError}
          onDismiss={undefined}
        />
      )}
      <div className="flex items-center justify-end gap-2 mt-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={handleSubmit}
          disabled={isSubmitting || body.trim().length === 0}
        >
          {isSubmitting ? "Posting…" : "Submit"}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline error banner — displayed inside CommentForm on submission failure
// ---------------------------------------------------------------------------

function RateLimitCountdown({ retryAfter }: { retryAfter: number }) {
  const [remaining, setRemaining] = useState(retryAfter);

  useEffect(() => {
    if (remaining <= 0) return;
    const id = setInterval(() => {
      setRemaining((r) => Math.max(0, r - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [remaining]);

  if (remaining <= 0) return null;

  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  const display = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  return (
    <span className="tabular-nums font-medium">{display}</span>
  );
}

function SubmissionErrorBanner({
  submissionError,
  onDismiss,
}: {
  submissionError: CommentSubmissionError;
  onDismiss: (() => void) | undefined;
}) {
  const { error, onRetry, onRefresh } = submissionError;

  let icon: React.ReactNode;
  let message: React.ReactNode;
  let actions: React.ReactNode = null;

  switch (error.category) {
    case "validation":
      icon = <AlertCircle className="size-3.5 shrink-0 text-destructive" />;
      message = (
        <span>
          The PR was updated since you loaded this page. Your comment has been
          saved.
        </span>
      );
      if (onRefresh) {
        actions = (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-6 text-xs px-2"
            onClick={onRefresh}
          >
            <RefreshCw className="size-3 mr-1" />
            Refresh &amp; Retry
          </Button>
        );
      }
      break;

    case "auth":
      icon = <LogIn className="size-3.5 shrink-0 text-destructive" />;
      message = (
        <span>
          Your session has expired.{" "}
          <a
            href="/api/auth/login"
            className="underline font-medium hover:text-foreground"
          >
            Sign in again
          </a>{" "}
          to continue.
        </span>
      );
      break;

    case "rate_limit":
      icon = <Timer className="size-3.5 shrink-0 text-amber-500" />;
      message = (
        <span>
          Rate limit reached.
          {error.retryAfter != null && error.retryAfter > 0 ? (
            <>
              {" "}Retrying in{" "}
              <RateLimitCountdown retryAfter={error.retryAfter} />.
            </>
          ) : (
            " Please try again shortly."
          )}
        </span>
      );
      if (onRetry) {
        actions = (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-6 text-xs px-2"
            onClick={onRetry}
          >
            Retry now
          </Button>
        );
      }
      break;

    case "transient":
    case "network":
      icon = <AlertCircle className="size-3.5 shrink-0 text-destructive" />;
      message = <span>Failed to post comment.</span>;
      actions = (
        <div className="flex gap-1.5">
          {onRetry && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 text-xs px-2"
              onClick={onRetry}
            >
              Retry
            </Button>
          )}
          {onDismiss && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 text-xs px-2"
              onClick={onDismiss}
            >
              Dismiss
            </Button>
          )}
        </div>
      );
      break;

    default:
      icon = <AlertCircle className="size-3.5 shrink-0 text-destructive" />;
      message = <span>{error.message || "An error occurred."}</span>;
      if (onRetry) {
        actions = (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-6 text-xs px-2"
            onClick={onRetry}
          >
            Retry
          </Button>
        );
      }
      break;
  }

  return (
    <div
      role="alert"
      className="mt-2 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-xs text-foreground"
    >
      <div className="mt-0.5">{icon}</div>
      <div className="flex-1 space-y-1.5">
        <div>{message}</div>
        {actions && <div>{actions}</div>}
      </div>
    </div>
  );
}

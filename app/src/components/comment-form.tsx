"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { SelectionInfo } from "@/lib/extract-selection-info";
import {
  saveDraft,
  loadDraft,
  clearDraft,
  lineRangeKey,
} from "@/lib/comment-drafts";

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

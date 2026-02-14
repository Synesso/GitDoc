"use client";

import { useCallback, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { SelectionInfo } from "@/lib/extract-selection-info";

interface CommentFormProps {
  /** The captured selection snapshot — provides line context and selected text */
  selectionInfo: SelectionInfo;
  /** Called with the comment body when the user submits */
  onSubmit: (body: string) => void;
  /** Called when the user cancels (Escape or Cancel button) */
  onCancel: () => void;
  /** Whether the form is currently submitting */
  isSubmitting?: boolean;
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
}: CommentFormProps) {
  const [body, setBody] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const id = useId();

  const inputId = `comment-input-${id}`;
  const contextId = `comment-context-${id}`;

  const { startLine, endLine, selectedText } = selectionInfo;

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
    onSubmit(trimmed);
  }, [body, onSubmit]);

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

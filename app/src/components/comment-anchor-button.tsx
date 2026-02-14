"use client";

import { useCallback, useRef, useState } from "react";
import { MessageSquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSelectionObserver } from "@/hooks/use-selection-observer";
import { extractSelectionInfo, type SelectionInfo } from "@/lib/extract-selection-info";

interface CommentAnchorButtonProps {
  /** Ref to the markdown content container — selections outside it are ignored */
  containerRef: React.RefObject<HTMLElement | null>;
  /** Set of source line numbers that are commentable (appear in the PR diff) */
  commentableLines: Set<number>;
  /** Called when the user clicks the anchor button with a valid commentable selection */
  onComment: (selectionInfo: SelectionInfo) => void;
}

/**
 * Floating "Add comment" button that appears in the right margin when the
 * user selects text within the rendered markdown.
 *
 * - Commentable selection: shows a clickable comment button
 * - Non-commentable selection: shows a dismissible tooltip explaining why
 * - No selection / selection outside container: hidden
 *
 * Positioning uses `Range.getBoundingClientRect()` to place the button at
 * the selection's vertical position in the right margin of the container.
 */
export function CommentAnchorButton({
  containerRef,
  commentableLines,
  onComment,
}: CommentAnchorButtonProps) {
  const [selectionInfo, setSelectionInfo] = useState<SelectionInfo | null>(null);
  const [showNonCommentableHint, setShowNonCommentableHint] = useState(false);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onSelection = useCallback(
    (range: Range) => {
      const info = extractSelectionInfo(range, commentableLines);
      if (!info) {
        setSelectionInfo(null);
        setShowNonCommentableHint(false);
        return;
      }

      setSelectionInfo(info);

      if (!info.isCommentable) {
        setShowNonCommentableHint(true);
        // Auto-dismiss after 4 seconds
        if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = setTimeout(() => {
          setShowNonCommentableHint(false);
        }, 4000);
      } else {
        setShowNonCommentableHint(false);
      }
    },
    [commentableLines],
  );

  const onClearSelection = useCallback(() => {
    setSelectionInfo(null);
    setShowNonCommentableHint(false);
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  }, []);

  useSelectionObserver(containerRef, onSelection, onClearSelection);

  if (!selectionInfo) return null;

  // Compute position relative to the container's right edge.
  // anchorTop is already document-relative (rect.top + scrollY from extractSelectionInfo).
  // We position the button absolutely within the container's coordinate space.
  const container = containerRef.current;
  if (!container) return null;

  const containerRect = container.getBoundingClientRect();
  const containerTop = containerRect.top + window.scrollY;

  // Position the button just outside the container's right edge
  const top = selectionInfo.anchorTop - containerTop;

  if (selectionInfo.isCommentable) {
    return (
      <div
        className="absolute z-50 -right-12"
        style={{ top }}
      >
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon-sm"
                className="rounded-full shadow-md bg-background hover:bg-primary hover:text-primary-foreground"
                aria-label={`Add comment on lines ${selectionInfo.startLine}–${selectionInfo.endLine}`}
                onClick={() => onComment(selectionInfo)}
              >
                <MessageSquarePlus className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">Add comment</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    );
  }

  // Non-commentable selection: show a brief hint
  if (showNonCommentableHint) {
    return (
      <div
        className="absolute z-50 -right-4"
        style={{ top }}
      >
        <div
          role="status"
          className="bg-muted text-muted-foreground text-xs rounded-md px-3 py-1.5 shadow-md max-w-56 whitespace-normal"
        >
          This passage wasn&apos;t changed in this PR — comments can only be
          placed on changed content.
        </div>
      </div>
    );
  }

  return null;
}

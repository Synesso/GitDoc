import { findSourceElement } from "./find-source-element";

/**
 * Plain-data snapshot of a text selection within the rendered markdown.
 *
 * Captured immediately when a selection is detected so that all semantic
 * data is available even after the browser clears the native selection
 * (e.g., when a comment form textarea gains focus).
 */
export interface SelectionInfo {
  /** Source start line (from data-source-start of first selected block) */
  startLine: number;
  /** Source end line (from data-source-end of last selected block) */
  endLine: number;
  /** The selected text (for preview in the comment form) */
  selectedText: string;
  /** Vertical position for anchoring the comment UI (relative to document) */
  anchorTop: number;
  /** Whether any selected lines are commentable */
  isCommentable: boolean;
  /** The subset of lines in the selection range that are commentable (for snapping) */
  commentableLines: number[];
}

/**
 * Converts a DOM `Range` into a plain `SelectionInfo` object.
 *
 * Must be called while the `Range` is still live (before any focus shift
 * or re-render that would invalidate the DOM node references). Uses
 * `findSourceElement()` to walk from the Range endpoints up to the nearest
 * ancestor with `[data-source-start]` / `[data-source-end]` attributes.
 *
 * @param range - A live DOM Range from the current selection
 * @param commentableLines - Set of line numbers that appear in the PR diff
 *   (from `getCommentableLines()`). Pass an empty set if commentability
 *   checking is not needed — `isCommentable` will be `false` and
 *   `commentableLines` will be empty.
 * @returns A `SelectionInfo` snapshot, or `null` if the selection endpoints
 *   don't fall within elements annotated with source line data attributes.
 */
export function extractSelectionInfo(
  range: Range,
  commentableLines: Set<number>,
): SelectionInfo | null {
  const startEl = findSourceElement(range.startContainer);
  const endEl = findSourceElement(range.endContainer);

  if (!startEl || !endEl) return null;

  const startLine = Number(startEl.getAttribute("data-source-start"));
  const endLine = Number(endEl.getAttribute("data-source-end"));

  if (isNaN(startLine) || isNaN(endLine)) return null;

  // Determine which lines in the range are commentable
  const matchingLines: number[] = [];
  for (let l = startLine; l <= endLine; l++) {
    if (commentableLines.has(l)) matchingLines.push(l);
  }

  // Capture positioning while the Range is still valid
  const rect = range.getBoundingClientRect();
  const selectedText = range.toString().trim();

  return {
    startLine,
    endLine,
    selectedText,
    anchorTop: rect.top + window.scrollY,
    isCommentable: matchingLines.length > 0,
    commentableLines: matchingLines,
  };
}

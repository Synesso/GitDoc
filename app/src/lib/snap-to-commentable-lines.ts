import type { SelectionInfo } from "./extract-selection-info";

/**
 * The line range parameters accepted by the GitHub PR review comment API.
 *
 * - `line` — the **last** line of the comment range (required). Must be a
 *   line that appears in the diff on the RIGHT side.
 * - `startLine` — the **first** line, only set for multi-line comments.
 *   When `startLine === line`, omit it (single-line comment).
 */
export interface CommentLineRange {
  /** The end line of the comment (GitHub API `line` param, always RIGHT side) */
  line: number;
  /** The start line for multi-line comments (GitHub API `start_line`), or undefined for single-line */
  startLine: number | undefined;
}

/**
 * Snaps a selection's line range to the nearest commentable lines.
 *
 * When a user selects text that spans a mix of commentable and
 * non-commentable lines, the GitHub API will reject the request unless
 * both `line` and `start_line` are in the diff. This function finds the
 * contiguous or non-contiguous subset of commentable lines and returns
 * the first and last as the `startLine`/`line` pair.
 *
 * @param selectionInfo - The captured selection snapshot
 * @returns A `CommentLineRange` with snapped line numbers, or `null` if
 *   no commentable lines exist in the selection
 */
export function snapToCommentableLines(
  selectionInfo: SelectionInfo,
): CommentLineRange | null {
  const { commentableLines } = selectionInfo;

  if (commentableLines.length === 0) return null;

  // commentableLines is already sorted (built by iterating startLine..endLine)
  const first = commentableLines[0];
  const last = commentableLines[commentableLines.length - 1];

  return {
    line: last,
    startLine: first !== last ? first : undefined,
  };
}

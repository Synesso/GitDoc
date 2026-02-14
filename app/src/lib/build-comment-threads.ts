import type { PRComment } from "@/hooks/use-pr-comments";

/**
 * A thread of comments anchored to a specific line range in a file.
 * Built by grouping flat REST API comments by `inReplyToId`.
 *
 * This is the REST-only fallback; the primary data source is the
 * GraphQL `reviewThreads` endpoint which provides resolution state.
 */
export interface CommentThread {
  /** ID of the top-level comment (thread anchor) */
  id: number | string;
  /** File path in the repo */
  path: string;
  /** End line — used for vertical positioning in the sidebar */
  line: number;
  /** Start line for multi-line comments (undefined for single-line) */
  startLine?: number;
  /** Comments in the thread, sorted by createdAt ascending */
  comments: PRComment[];
  /** Always false for REST-only (no resolution data available) */
  isResolved: boolean;
}

/**
 * Groups a flat list of REST PR review comments into threaded conversations
 * for a specific file.
 *
 * - Filters to comments on `filePath` with `side === "RIGHT"` (head-ref).
 * - Top-level comments (no `inReplyToId`) anchor a thread.
 * - Replies are attached to their parent thread via `inReplyToId`.
 * - Orphaned replies (parent on a different file/side) are silently dropped.
 * - Comments with `line === null/undefined` are treated as outdated and
 *   placed at line 0 so they sort to the top.
 * - Threads are sorted by line number (top of document first).
 */
export function buildCommentThreads(
  comments: PRComment[],
  filePath: string,
): CommentThread[] {
  // Filter to current file, RIGHT side only
  const fileComments = comments.filter(
    (c) => c.path === filePath && (!c.side || c.side === "RIGHT"),
  );

  const threads = new Map<number | string, CommentThread>();

  // Pass 1: Create threads from top-level comments
  for (const comment of fileComments) {
    if (!comment.inReplyToId) {
      threads.set(comment.id, {
        id: comment.id,
        path: comment.path,
        line: comment.line ?? 0,
        startLine: comment.startLine,
        comments: [comment],
        isResolved: false,
      });
    }
  }

  // Pass 2: Attach replies to their parent thread
  for (const comment of fileComments) {
    if (comment.inReplyToId) {
      const thread = threads.get(comment.inReplyToId);
      if (thread) {
        thread.comments.push(comment);
      }
      // If parent not found (e.g., parent is on LEFT side or different file),
      // the reply is orphaned — skip it silently.
    }
  }

  // Sort comments within each thread by creation time
  for (const thread of threads.values()) {
    thread.comments.sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }

  // Return threads sorted by line number (top of document first)
  return Array.from(threads.values()).sort((a, b) => a.line - b.line);
}

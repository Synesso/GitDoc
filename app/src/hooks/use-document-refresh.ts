"use client";

import { useCallback, useRef, useState } from "react";
import { mutate } from "swr";
import {
  getCommentableLines,
  type PrFile,
  type CommentableLinesResult,
} from "@/lib/commentable-lines";
import { saveDraft, lineRangeKey } from "@/lib/comment-drafts";

interface DocumentRefreshParams {
  owner: string;
  repo: string;
  prNumber: number;
  filePath: string;
}

interface DraftToSave {
  body: string;
  startLine: number;
  endLine: number;
}

export interface RefreshResult {
  headSha: string;
  content: string;
  commentableResult: CommentableLinesResult;
  files: PrFile[];
}

/**
 * Hook that coordinates the full re-sync flow when a user clicks
 * "Refresh Now" on the stale SHA banner.
 *
 * Steps performed by `refresh()`:
 * 1. Save any open comment draft to sessionStorage
 * 2. Re-fetch the latest PR head SHA
 * 3. Re-fetch the PR file list (with new diff patches)
 * 4. Rebuild commentable lines for the current file
 * 5. Re-fetch file content at the new SHA
 * 6. Trigger SWR revalidation for comments and threads
 * 7. Return the new data for the caller to update its state
 *
 * The caller is responsible for storing the returned data
 * (headSha, content, commentableResult, files) in its own state
 * and passing the updated headSha to `usePrHeadSha` so that
 * future polling compares against the new value.
 */
export function useDocumentRefresh({
  owner,
  repo,
  prNumber,
  filePath,
}: DocumentRefreshParams) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<Error | null>(null);

  /** Ref to a callback that returns the current comment draft (if any) */
  const getDraftRef = useRef<(() => DraftToSave | null) | null>(null);

  /**
   * Register a callback that provides the current open comment form's
   * text and line range for draft saving before a refresh.
   */
  const registerDraftProvider = useCallback(
    (provider: (() => DraftToSave | null) | null) => {
      getDraftRef.current = provider;
    },
    [],
  );

  const refresh = useCallback(async (): Promise<RefreshResult> => {
    setIsRefreshing(true);
    setRefreshError(null);

    try {
      // 1. Save any open comment draft
      const draft = getDraftRef.current?.();
      if (draft && draft.body.trim()) {
        const range = lineRangeKey(draft.startLine, draft.endLine);
        saveDraft(prNumber, filePath, range, draft.body);
      }

      // 2. Fetch the latest head SHA
      const headRes = await fetch(
        `/api/repos/${owner}/${repo}/pulls/${prNumber}/head`,
      );
      if (!headRes.ok) {
        throw new Error(`Failed to fetch PR head: ${headRes.status}`);
      }
      const { headSha: newHeadSha } = await headRes.json();

      // 3. Re-fetch file list with diff patches and file content in parallel
      const [filesRes, contentRes] = await Promise.all([
        fetch(`/api/repos/${owner}/${repo}/pulls/${prNumber}/files`),
        fetch(
          `/api/repos/${owner}/${repo}/contents/${filePath}?ref=${newHeadSha}`,
        ),
      ]);

      if (!filesRes.ok) {
        throw new Error(`Failed to fetch PR files: ${filesRes.status}`);
      }
      if (!contentRes.ok) {
        throw new Error(`Failed to fetch file content: ${contentRes.status}`);
      }

      const { files: newFiles } = (await filesRes.json()) as {
        files: PrFile[];
      };
      const { content: newContent } = await contentRes.json();

      // 4. Rebuild commentable lines for the current file
      const currentFile = newFiles.find((f) => f.filename === filePath);
      const commentableResult: CommentableLinesResult = currentFile
        ? getCommentableLines(currentFile)
        : { readOnly: true, reason: "File is no longer changed in this PR" };

      // 5. Revalidate SWR caches for comments and threads
      //    Use Promise.allSettled so a failed revalidation doesn't block the refresh
      const commentKey = `/api/repos/${owner}/${repo}/pulls/${prNumber}/comments?path=${encodeURIComponent(filePath)}`;
      const commentKeyAll = `/api/repos/${owner}/${repo}/pulls/${prNumber}/comments`;
      const threadKey = `/api/repos/${owner}/${repo}/pulls/${prNumber}/threads?path=${encodeURIComponent(filePath)}`;
      const threadKeyAll = `/api/repos/${owner}/${repo}/pulls/${prNumber}/threads`;

      await Promise.allSettled([
        mutate(commentKey),
        mutate(commentKeyAll),
        mutate(threadKey),
        mutate(threadKeyAll),
      ]);

      return {
        headSha: newHeadSha,
        content: newContent,
        commentableResult,
        files: newFiles,
      };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setRefreshError(error);
      throw error;
    } finally {
      setIsRefreshing(false);
    }
  }, [owner, repo, prNumber, filePath]);

  return {
    /** Whether a refresh is currently in progress */
    isRefreshing,
    /** Error from the last refresh attempt (null on success) */
    refreshError,
    /** Trigger the full re-sync flow. Returns the new data for state updates. */
    refresh,
    /**
     * Register a callback that provides the current draft's text and line range.
     * Called before refresh to save the draft to sessionStorage.
     */
    registerDraftProvider,
  };
}

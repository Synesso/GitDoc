"use client";

import useSWR from "swr";

/**
 * Shape of a PR review comment as returned by our API routes.
 * Matches the camelCase format from GET /api/repos/.../comments.
 */
export interface PRComment {
  id: number | string;
  body: string;
  user: { login: string; avatarUrl: string };
  path: string;
  line: number;
  startLine?: number;
  side?: string;
  inReplyToId?: number;
  createdAt: string;
  updatedAt?: string;
  /** Client-side flag for optimistic (not-yet-confirmed) comments */
  isPending?: boolean;
}

interface SubmitCommentParams {
  body: string;
  path: string;
  line: number;
  startLine?: number;
  commitId: string;
}

interface UsePRCommentsOptions {
  /** Current user info for optimistic comment attribution */
  currentUser?: { login: string; avatarUrl: string };
  /** Filter comments to a specific file path (server-side) */
  path?: string;
}

const fetcher = async (url: string): Promise<PRComment[]> => {
  const res = await fetch(url);
  if (!res.ok) {
    const err = new Error("Failed to fetch comments");
    throw err;
  }
  const json = await res.json();
  return json.comments;
};

/**
 * SWR-backed hook for fetching and mutating PR review comments.
 *
 * Provides:
 * - `comments` — the current list of comments (empty array while loading)
 * - `submitComment()` — posts a new comment with optimistic UI
 * - `refreshComments()` — manually triggers revalidation
 * - `isLoading` / `error` — loading and error state
 */
export function usePRComments(
  owner: string,
  repo: string,
  prNumber: number,
  options: UsePRCommentsOptions = {},
) {
  const { currentUser, path } = options;

  const baseKey = `/api/repos/${owner}/${repo}/pulls/${prNumber}/comments`;
  const key = path ? `${baseKey}?path=${encodeURIComponent(path)}` : baseKey;

  const { data, error, isLoading, mutate } = useSWR<PRComment[]>(key, fetcher, {
    refreshInterval: 30_000,
    revalidateOnFocus: true,
  });

  const submitComment = async (params: SubmitCommentParams) => {
    const optimisticComment: PRComment = {
      id: `temp-${Date.now()}`,
      body: params.body,
      user: currentUser ?? { login: "you", avatarUrl: "" },
      path: params.path,
      line: params.line,
      startLine: params.startLine,
      createdAt: new Date().toISOString(),
      isPending: true,
    };

    await mutate(
      async (currentData) => {
        const res = await fetch(baseKey, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
        });

        if (!res.ok) {
          const errorBody = await res.json().catch(() => ({}));
          const err = new Error(errorBody.error ?? `HTTP ${res.status}`);
          (err as any).status = res.status;
          (err as any).category = errorBody.category;
          throw err;
        }

        const serverComment: PRComment = await res.json();
        // Replace the optimistic comment with the server response
        return (currentData ?? []).map((c) =>
          c.id === optimisticComment.id ? serverComment : c,
        );
      },
      {
        optimisticData: (current) => [...(current ?? []), optimisticComment],
        rollbackOnError: true,
        populateCache: true,
        revalidate: true,
      },
    );
  };

  return {
    comments: data ?? [],
    isLoading,
    error,
    submitComment,
    refreshComments: mutate,
  };
}

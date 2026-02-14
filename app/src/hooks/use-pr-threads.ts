"use client";

import useSWR from "swr";
import { updateRateLimitFromHeaders } from "@/hooks/use-rate-limit-monitor";

/** Shape of a comment within a thread (from GraphQL threads API) */
export interface ThreadComment {
  databaseId: number;
  body: string;
  createdAt: string;
  outdated: boolean;
  author: { login: string; avatarUrl: string };
  diffHunk?: string;
  /** Client-side flag for optimistic (not-yet-confirmed) comments */
  isPending?: boolean;
}

/** Shape of a thread from GET /api/repos/.../threads */
export interface ReviewThread {
  graphqlId: string;
  topLevelCommentId: number | null;
  isResolved: boolean;
  resolvedBy?: { login: string; avatarUrl: string };
  viewerCanResolve: boolean;
  viewerCanUnresolve: boolean;
  isOutdated: boolean;
  path: string;
  line: number | null;
  startLine: number | null;
  originalLine: number | null;
  diffSide: "LEFT" | "RIGHT";
  subjectType: "LINE" | "FILE";
  comments: ThreadComment[];
}

interface UsePRThreadsOptions {
  /** Filter threads to a specific file path (server-side) */
  path?: string;
}

const fetcher = async (url: string): Promise<ReviewThread[]> => {
  const res = await fetch(url);
  updateRateLimitFromHeaders(res.headers);
  if (!res.ok) {
    throw new Error("Failed to fetch threads");
  }
  const json = await res.json();
  return json.threads;
};

/**
 * SWR-backed hook for fetching PR review threads and performing
 * resolve/unresolve mutations with optimistic UI.
 */
export function usePRThreads(
  owner: string,
  repo: string,
  prNumber: number,
  options: UsePRThreadsOptions = {},
) {
  const { path } = options;

  const baseKey = `/api/repos/${owner}/${repo}/pulls/${prNumber}/threads`;
  const key = path ? `${baseKey}?path=${encodeURIComponent(path)}` : baseKey;

  const { data, error, isLoading, mutate } = useSWR<ReviewThread[]>(
    key,
    fetcher,
    {
      refreshInterval: 30_000,
      revalidateOnFocus: true,
    },
  );

  const resolveThread = async (
    threadGraphqlId: string,
    currentUser?: { login: string; avatarUrl: string },
  ) => {
    const resolveUrl = `/api/repos/${owner}/${repo}/pulls/${prNumber}/threads/${encodeURIComponent(threadGraphqlId)}/resolve`;

    await mutate(
      async (currentThreads) => {
        const res = await fetch(resolveUrl, { method: "POST" });
        if (!res.ok) {
          const errorBody = await res.json().catch(() => ({}));
          throw new Error(errorBody.error ?? `HTTP ${res.status}`);
        }
        const result = await res.json();

        return (currentThreads ?? []).map((t) =>
          t.graphqlId === threadGraphqlId
            ? {
                ...t,
                isResolved: true,
                resolvedBy: result.resolvedBy ?? currentUser,
                viewerCanResolve: false,
                viewerCanUnresolve: true,
              }
            : t,
        );
      },
      {
        optimisticData: (current) =>
          (current ?? []).map((t) =>
            t.graphqlId === threadGraphqlId
              ? {
                  ...t,
                  isResolved: true,
                  resolvedBy: currentUser ?? t.resolvedBy,
                  viewerCanResolve: false,
                  viewerCanUnresolve: true,
                }
              : t,
          ),
        rollbackOnError: true,
        populateCache: true,
        revalidate: true,
      },
    );
  };

  const unresolveThread = async (threadGraphqlId: string) => {
    const unresolveUrl = `/api/repos/${owner}/${repo}/pulls/${prNumber}/threads/${encodeURIComponent(threadGraphqlId)}/unresolve`;

    await mutate(
      async (currentThreads) => {
        const res = await fetch(unresolveUrl, { method: "POST" });
        if (!res.ok) {
          const errorBody = await res.json().catch(() => ({}));
          throw new Error(errorBody.error ?? `HTTP ${res.status}`);
        }

        return (currentThreads ?? []).map((t) =>
          t.graphqlId === threadGraphqlId
            ? {
                ...t,
                isResolved: false,
                resolvedBy: undefined,
                viewerCanResolve: true,
                viewerCanUnresolve: false,
              }
            : t,
        );
      },
      {
        optimisticData: (current) =>
          (current ?? []).map((t) =>
            t.graphqlId === threadGraphqlId
              ? {
                  ...t,
                  isResolved: false,
                  resolvedBy: undefined,
                  viewerCanResolve: true,
                  viewerCanUnresolve: false,
                }
              : t,
          ),
        rollbackOnError: true,
        populateCache: true,
        revalidate: true,
      },
    );
  };

  return {
    threads: data ?? [],
    isLoading,
    error,
    resolveThread,
    unresolveThread,
    refreshThreads: mutate,
  };
}

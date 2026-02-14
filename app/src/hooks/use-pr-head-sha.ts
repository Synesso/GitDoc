"use client";

import useSWR from "swr";
import { updateRateLimitFromHeaders } from "@/hooks/use-rate-limit-monitor";

interface PrHeadResponse {
  headSha: string;
  state: string;
}

const fetcher = async (url: string): Promise<PrHeadResponse> => {
  const res = await fetch(url);
  updateRateLimitFromHeaders(res.headers);
  if (!res.ok) {
    throw new Error("Failed to fetch PR head SHA");
  }
  return res.json();
};

/**
 * SWR-backed hook that polls the PR's head SHA every 60s (and on focus)
 * to detect when the branch has been updated since the page was loaded.
 *
 * Returns `isStale: true` when the current head SHA differs from the
 * initial value, signalling that the rendered content and commentable
 * regions may be out of date.
 */
export function usePrHeadSha(
  owner: string,
  repo: string,
  prNumber: number,
  initialHeadSha: string,
) {
  const key = `/api/repos/${owner}/${repo}/pulls/${prNumber}/head`;

  const { data, error, isLoading } = useSWR<PrHeadResponse>(key, fetcher, {
    refreshInterval: 60_000,
    revalidateOnFocus: true,
    fallbackData: { headSha: initialHeadSha, state: "open" },
  });

  const isStale = data ? data.headSha !== initialHeadSha : false;

  return {
    currentHeadSha: data?.headSha ?? initialHeadSha,
    prState: data?.state ?? "open",
    isStale,
    isLoading,
    error,
  };
}

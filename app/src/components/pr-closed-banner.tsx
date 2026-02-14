"use client";

import { GitMerge, GitPullRequestClosed, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface PrClosedBannerProps {
  /** The PR state from GitHub (e.g., "closed", "merged"). Hidden when "open". */
  prState: string;
  /** Owner of the repository */
  owner: string;
  /** Repository name */
  repo: string;
  /** PR number */
  prNumber: number;
}

/**
 * Banner shown when SHA polling detects the PR is no longer open (closed or merged).
 * Commenting is no longer possible on a closed/merged PR — the banner informs the
 * user and links to the PR on GitHub.
 *
 * Uses `role="status"` (`aria-live="polite"`) for screen reader announcement.
 */
export function PrClosedBanner({ prState, owner, repo, prNumber }: PrClosedBannerProps) {
  if (prState === "open") return null;

  const isMerged = prState === "merged";
  const Icon = isMerged ? GitMerge : GitPullRequestClosed;
  const label = isMerged ? "merged" : "closed";
  const prUrl = `https://github.com/${owner}/${repo}/pull/${prNumber}`;

  return (
    <div
      role="status"
      aria-live="polite"
      className={
        "flex items-center gap-3 border-b px-4 py-2 text-sm " +
        (isMerged
          ? "bg-purple-50 text-purple-900 dark:bg-purple-950/40 dark:text-purple-200"
          : "bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200")
      }
    >
      <Icon className="size-4 shrink-0" />
      <p className="flex-1">
        This pull request has been <span className="font-medium">{label}</span>.
        Commenting is no longer available.
      </p>
      <Button variant="outline" size="xs" asChild className="gap-1 shrink-0">
        <a href={prUrl} target="_blank" rel="noopener noreferrer">
          View on GitHub
          <ExternalLink className="size-3" />
        </a>
      </Button>
    </div>
  );
}

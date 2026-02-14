"use client";

import { useState } from "react";
import { ChevronRight, ExternalLink } from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { ReviewThread } from "@/hooks/use-pr-threads";

export interface OutdatedThreadsSectionProps {
  /** Outdated threads, sorted by createdAt ascending */
  threads: ReviewThread[];
  /** GitHub URL parts for "Open in GitHub" links */
  owner: string;
  repo: string;
  prNumber: number;
}

/**
 * Renders a collapsible "Outdated Comments" section at the bottom of the
 * comment sidebar. Collapsed by default. Each outdated thread is dimmed
 * and shows the original diff_hunk as a code block when expanded.
 */
export function OutdatedThreadsSection({
  threads,
  owner,
  repo,
  prNumber,
}: OutdatedThreadsSectionProps) {
  const [isSectionOpen, setIsSectionOpen] = useState(false);

  if (threads.length === 0) return null;

  return (
    <Collapsible open={isSectionOpen} onOpenChange={setIsSectionOpen}>
      <CollapsibleTrigger asChild>
        <button className="flex items-center gap-1.5 w-full text-left px-1 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ChevronRight
            className={
              "size-3.5 shrink-0 transition-transform" +
              (isSectionOpen ? " rotate-90" : "")
            }
          />
          <span>Outdated Comments</span>
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-1">
            {threads.length}
          </Badge>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2">
        {threads.map((thread) => (
          <OutdatedThreadCard
            key={thread.graphqlId}
            thread={thread}
            owner={owner}
            repo={repo}
            prNumber={prNumber}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

interface OutdatedThreadCardProps {
  thread: ReviewThread;
  owner: string;
  repo: string;
  prNumber: number;
}

function OutdatedThreadCard({
  thread,
  owner,
  repo,
  prNumber,
}: OutdatedThreadCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const topComment = thread.comments[0];
  if (!topComment) return null;

  const replies = thread.comments.slice(1);
  const diffHunk = topComment.diffHunk;

  const githubUrl = `https://github.com/${owner}/${repo}/pull/${prNumber}/files#diff-${encodeFilePath(thread.path)}`;

  return (
    <Card className="py-3 gap-3 opacity-60">
      <CardContent className="px-3">
        <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-1.5 w-full text-left">
              <ChevronRight
                className={
                  "size-3.5 text-muted-foreground shrink-0 transition-transform" +
                  (isExpanded ? " rotate-90" : "")
                }
              />
              <Avatar size="sm" className="size-5 shrink-0">
                <AvatarImage
                  src={topComment.author.avatarUrl}
                  alt={topComment.author.login}
                />
                <AvatarFallback className="text-[8px]">
                  {topComment.author.login.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="text-xs font-medium truncate">
                {topComment.author.login}
              </span>
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                Outdated
              </Badge>
              {replies.length > 0 && (
                <span className="text-xs text-muted-foreground ml-auto shrink-0">
                  {replies.length} {replies.length === 1 ? "reply" : "replies"}
                </span>
              )}
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3 space-y-3">
            {diffHunk && (
              <pre className="text-xs bg-muted rounded-md p-2 overflow-x-auto whitespace-pre font-mono leading-relaxed">
                <code>{diffHunk}</code>
              </pre>
            )}

            <OutdatedCommentBody comment={topComment} />

            {replies.length > 0 && (
              <div className="border-l-2 border-muted pl-2 space-y-3">
                {replies.map((reply) => (
                  <OutdatedCommentBody
                    key={reply.databaseId}
                    comment={reply}
                  />
                ))}
              </div>
            )}

            <div className="flex justify-end">
              <a
                href={githubUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Open in GitHub
                <ExternalLink className="size-3" />
              </a>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}

function OutdatedCommentBody({
  comment,
}: {
  comment: ReviewThread["comments"][number];
}) {
  return (
    <div className="flex gap-2">
      <Avatar size="sm" className="mt-0.5 shrink-0">
        <AvatarImage src={comment.author.avatarUrl} alt={comment.author.login} />
        <AvatarFallback>
          {comment.author.login.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium truncate">
            {comment.author.login}
          </span>
          <time
            dateTime={comment.createdAt}
            className="text-xs text-muted-foreground shrink-0"
            title={new Date(comment.createdAt).toLocaleString()}
          >
            {formatRelativeTime(comment.createdAt)}
          </time>
        </div>
        <p className="text-sm text-foreground mt-0.5 whitespace-pre-wrap break-words">
          {comment.body}
        </p>
      </div>
    </div>
  );
}

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;

  const years = Math.floor(months / 12);
  return `${years}y ago`;
}

function encodeFilePath(path: string): string {
  return Array.from(new TextEncoder().encode(path))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

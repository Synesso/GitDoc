"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

/** A comment within a thread (matches the GraphQL threads API shape) */
export interface ThreadComment {
  databaseId: number;
  body: string;
  createdAt: string;
  outdated?: boolean;
  author: { login: string; avatarUrl: string };
  diffHunk?: string;
}

/** Props for the CommentThreadCard component */
export interface CommentThreadCardProps {
  /** Unique thread identifier (GraphQL node ID or REST comment ID) */
  threadId: string | number;
  /** Line the thread is anchored to */
  line: number;
  /** Start line for multi-line comments */
  startLine?: number | null;
  /** Comments in the thread, sorted by createdAt ascending */
  comments: ThreadComment[];
  /** Whether this thread is resolved */
  isResolved?: boolean;
  /** User who resolved the thread */
  resolvedBy?: { login: string; avatarUrl: string };
  /** GitHub URL parts for "Open in GitHub" link */
  owner: string;
  repo: string;
  prNumber: number;
  filePath: string;
  /** Number of replies to show before collapsing */
  collapsedReplyLimit?: number;
  /** Whether this card is highlighted (from passage hover sync) */
  isHighlighted?: boolean;
  /** Called on mouse enter — for bidirectional hover sync */
  onMouseEnter?: () => void;
  /** Called on mouse leave — for bidirectional hover sync */
  onMouseLeave?: () => void;
  /** Called on click — for click-to-scroll sync (scrolls passage into view) */
  onClick?: () => void;
}

/** Maximum replies shown before the Collapsible kicks in */
const DEFAULT_COLLAPSED_REPLY_LIMIT = 2;

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

function CommentBody({ comment }: { comment: ThreadComment }) {
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

/**
 * Renders a single comment thread card for the right-margin sidebar.
 *
 * Shows the top-level comment with avatar, body, and timestamp.
 * Replies are shown below, with a Collapsible to hide excess replies
 * when there are more than `collapsedReplyLimit`.
 * Includes an "Open in GitHub" link at the bottom.
 */
export function CommentThreadCard({
  threadId,
  comments,
  isResolved = false,
  resolvedBy,
  owner,
  repo,
  prNumber,
  filePath,
  line,
  collapsedReplyLimit = DEFAULT_COLLAPSED_REPLY_LIMIT,
  isHighlighted = false,
  onMouseEnter,
  onMouseLeave,
  onClick,
}: CommentThreadCardProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (comments.length === 0) return null;

  const topComment = comments[0];
  const replies = comments.slice(1);
  const hasHiddenReplies = replies.length > collapsedReplyLimit;
  const visibleReplies = hasHiddenReplies && !isOpen
    ? replies.slice(-collapsedReplyLimit)
    : replies;
  const hiddenCount = hasHiddenReplies ? replies.length - collapsedReplyLimit : 0;

  const githubUrl = `https://github.com/${owner}/${repo}/pull/${prNumber}/files#diff-${encodeFilePath(filePath)}R${line}`;

  return (
    <Card
      className={
        "py-3 gap-3 transition-colors cursor-pointer" +
        (isResolved ? " opacity-70" : "") +
        (isHighlighted ? " thread-card-highlighted" : "")
      }
      data-thread-id={threadId}
      data-thread-line={line}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
    >
      <CardContent className="px-3 space-y-3">
        {isResolved && (
          <div className="flex items-center gap-1.5">
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              Resolved
            </Badge>
            {resolvedBy && (
              <span className="text-xs text-muted-foreground">
                by {resolvedBy.login}
              </span>
            )}
          </div>
        )}

        <CommentBody comment={topComment} />

        {replies.length > 0 && (
          <div className="border-l-2 border-muted pl-2 space-y-3">
            {hasHiddenReplies && (
              <Collapsible open={isOpen} onOpenChange={setIsOpen}>
                <CollapsibleTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs text-muted-foreground px-1"
                  >
                    {isOpen ? (
                      <>
                        <ChevronUp className="size-3 mr-1" />
                        Hide replies
                      </>
                    ) : (
                      <>
                        <ChevronDown className="size-3 mr-1" />
                        {hiddenCount} earlier {hiddenCount === 1 ? "reply" : "replies"}
                      </>
                    )}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-3">
                  {replies.slice(0, hiddenCount).map((reply) => (
                    <CommentBody key={reply.databaseId} comment={reply} />
                  ))}
                </CollapsibleContent>
              </Collapsible>
            )}
            {visibleReplies.map((reply) => (
              <CommentBody key={reply.databaseId} comment={reply} />
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
      </CardContent>
    </Card>
  );
}

/**
 * Encodes a file path for use in GitHub's diff fragment identifier.
 * GitHub uses a hex-encoded hash-like scheme, but for simplicity we
 * just use the path directly — GitHub will scroll to the file.
 */
function encodeFilePath(path: string): string {
  // GitHub uses a hex encoding of the file path for anchor links
  return Array.from(new TextEncoder().encode(path))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

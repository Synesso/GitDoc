"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import { LogIn, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DocumentReviewLayout } from "@/components/document-review-layout";
import { ReviewHeader, type PrFileEntry } from "@/components/review-header";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { CommentAnchorButton } from "@/components/comment-anchor-button";
import { CommentForm, type CommentSubmissionError } from "@/components/comment-form";
import { CommentThreadList } from "@/components/comment-thread-list";
import { CommentThreadCard } from "@/components/comment-thread-card";
import { InlineThreadIndicators } from "@/components/inline-thread-indicators";
import { OutdatedThreadsSection } from "@/components/outdated-threads-section";
import { StaleShaBanner } from "@/components/stale-sha-banner";
import { PrClosedBanner } from "@/components/pr-closed-banner";
import { RateLimitBanner } from "@/components/rate-limit-banner";
import { usePRThreads, type ReviewThread } from "@/hooks/use-pr-threads";
import { usePrHeadSha } from "@/hooks/use-pr-head-sha";
import { useCommentHighlight } from "@/hooks/use-comment-highlight";
import { useHoverSync } from "@/hooks/use-hover-sync";
import { getCommentableLines, type PrFile } from "@/lib/commentable-lines";
import { snapToCommentableLines } from "@/lib/snap-to-commentable-lines";
import type { SelectionInfo } from "@/lib/extract-selection-info";
import type { CommentThread } from "@/lib/build-comment-threads";
import { layoutThreadCards, type PositionedThread } from "@/lib/layout-thread-cards";
import { updateRateLimitFromHeaders } from "@/hooks/use-rate-limit-monitor";

const jsonFetcher = async (url: string) => {
  const res = await fetch(url);
  updateRateLimitFromHeaders(res.headers);
  if (res.status === 401) {
    const err = new Error("Unauthorized") as Error & { status: number };
    err.status = 401;
    throw err;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

export default function PullRequestPage() {
  const params = useParams<{
    owner: string;
    repo: string;
    pull_number: string;
  }>();
  const router = useRouter();
  const { owner, repo, pull_number } = params;
  const prNumber = Number(pull_number);

  // --- Auth check ---
  const { data: user, error: userError } = useSWR("/api/auth/me", jsonFetcher, {
    revalidateOnFocus: false,
  });
  const isUnauthed =
    userError?.status === 401 || (userError && !user);

  // --- PR metadata ---
  const { data: prData, error: prError } = useSWR(
    !isUnauthed ? `/api/repos/${owner}/${repo}/pulls/${prNumber}` : null,
    jsonFetcher,
  );

  // --- PR files ---
  const { data: filesData } = useSWR(
    prData ? `/api/repos/${owner}/${repo}/pulls/${prNumber}/files` : null,
    jsonFetcher,
  );

  const files: PrFile[] = filesData?.files ?? [];
  const mdFiles: PrFileEntry[] = files.map((f) => ({
    filename: f.filename,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
  }));

  // --- File selection ---
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const currentFile = selectedFile ?? files[0]?.filename ?? null;

  useEffect(() => {
    if (files.length > 0 && !selectedFile) {
      setSelectedFile(files[0].filename);
    }
  }, [files, selectedFile]);

  // --- Head SHA tracking ---
  const initialHeadSha = prData?.headSha ?? "";
  const { isStale, currentHeadSha, prState } = usePrHeadSha(
    owner,
    repo,
    prNumber,
    initialHeadSha,
  );

  // --- File content ---
  const { data: contentData } = useSWR(
    currentFile && initialHeadSha
      ? `/api/repos/${owner}/${repo}/contents/${currentFile}?ref=${initialHeadSha}`
      : null,
    jsonFetcher,
  );
  const markdownContent: string = contentData?.content ?? "";

  // --- Commentable lines ---
  const commentableResult = useMemo(() => {
    const file = files.find((f) => f.filename === currentFile);
    if (!file) return null;
    return getCommentableLines(file);
  }, [files, currentFile]);

  const commentableLines = useMemo(() => {
    if (!commentableResult || commentableResult.readOnly) return new Set<number>();
    return commentableResult.lines;
  }, [commentableResult]);

  // --- Threads ---
  const {
    threads,
    isLoading: threadsLoading,
    resolveThread,
    unresolveThread,
    refreshThreads,
  } = usePRThreads(owner, repo, prNumber, { path: currentFile ?? undefined });

  const currentThreads = useMemo(
    () => threads.filter((t) => !t.isOutdated),
    [threads],
  );
  const outdatedThreads = useMemo(
    () => threads.filter((t) => t.isOutdated),
    [threads],
  );

  // Convert ReviewThread[] to CommentThread[] for hover sync
  const commentThreads: CommentThread[] = useMemo(
    () =>
      currentThreads.map((t) => ({
        id: t.graphqlId,
        path: t.path,
        line: t.line ?? 0,
        startLine: t.startLine ?? undefined,
        comments: t.comments.map((c) => ({
          id: c.databaseId,
          body: c.body,
          user: c.author,
          path: t.path,
          line: t.line ?? 0,
          createdAt: c.createdAt,
        })),
        isResolved: t.isResolved,
      })),
    [currentThreads],
  );

  // --- Refs ---
  const contentRef = useRef<HTMLElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // --- Positioned thread cards ---
  const [positionedThreads, setPositionedThreads] = useState<PositionedThread[]>([]);
  const cardHeightsRef = useRef<Map<string | number, number>>(new Map());

  useEffect(() => {
    const container = contentRef.current;
    if (!container || commentThreads.length === 0) {
      setPositionedThreads(prev => prev.length === 0 ? prev : []);
      return;
    }

    const compute = () => {
      const positioned = layoutThreadCards(commentThreads, container, cardHeightsRef.current);
      setPositionedThreads(positioned);
    };

    const raf = requestAnimationFrame(compute);
    window.addEventListener("resize", compute);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", compute);
    };
  }, [commentThreads]);

  const measureCardHeight: RefCallback<HTMLElement> = useCallback((el) => {
    if (!el) return;
    const threadId = el.getAttribute("data-positioned-thread-id");
    if (threadId) {
      cardHeightsRef.current.set(threadId, el.getBoundingClientRect().height);
    }
  }, []);

  // --- Comment state ---
  const [selectionInfo, setSelectionInfo] = useState<SelectionInfo | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<CommentSubmissionError | null>(null);

  useCommentHighlight(contentRef, selectionInfo);

  const {
    highlightedThreadId,
    onThreadMouseEnter,
    onThreadMouseLeave,
    onThreadClick,
    onPassageClickScrollToThread,
  } = useHoverSync(contentRef, commentThreads, sidebarRef);

  const handleComment = useCallback((info: SelectionInfo) => {
    setSelectionInfo(info);
    setSubmissionError(null);
  }, []);

  const handleCommentTrigger = useCallback(
    (startLine: number, endLine: number, anchorTop: number) => {
      const matchingLines: number[] = [];
      for (let l = startLine; l <= endLine; l++) {
        if (commentableLines.has(l)) matchingLines.push(l);
      }
      if (matchingLines.length === 0) return;
      setSelectionInfo({
        startLine,
        endLine,
        selectedText: "",
        anchorTop,
        isCommentable: true,
        commentableLines: matchingLines,
      });
      setSubmissionError(null);
    },
    [commentableLines],
  );

  const handleSubmitComment = useCallback(
    async (body: string) => {
      if (!selectionInfo || !currentFile || !initialHeadSha) return;

      const snapped = snapToCommentableLines(selectionInfo);
      if (!snapped) return;

      setIsSubmitting(true);
      setSubmissionError(null);

      try {
        const res = await fetch(
          `/api/repos/${owner}/${repo}/pulls/${prNumber}/comments`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              body,
              path: currentFile,
              line: snapped.line,
              startLine: snapped.startLine,
              commitId: initialHeadSha,
            }),
          },
        );

        if (!res.ok) {
          const { parseApiError, parseRetryAfter } = await import(
            "@/lib/api-error"
          );
          const err = parseApiError(res);
          err.retryAfter = parseRetryAfter(res);
          setSubmissionError({ error: err });
          return;
        }

        setSelectionInfo(null);
        refreshThreads();
      } finally {
        setIsSubmitting(false);
      }
    },
    [selectionInfo, currentFile, initialHeadSha, owner, repo, prNumber, refreshThreads],
  );

  const handleCancelComment = useCallback(() => {
    setSelectionInfo(null);
    setSubmissionError(null);
  }, []);

  const handleRefresh = useCallback(() => {
    router.refresh();
  }, [router]);

  // --- Auth gate ---
  if (isUnauthed) {
    const returnTo = `/${owner}/${repo}/pull/${pull_number}`;
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="flex flex-col items-center gap-4 text-center max-w-sm">
          <h1 className="text-2xl font-semibold">Sign in to continue</h1>
          <p className="text-muted-foreground">
            GitDoc needs access to GitHub to load PR content and comments.
          </p>
          <Button size="lg" asChild>
            <a href={`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`}>
              <LogIn className="size-4" />
              Sign in with GitHub
            </a>
          </Button>
        </div>
      </div>
    );
  }

  // --- Loading ---
  if (!prData && !prError) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // --- Error ---
  if (prError) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="flex flex-col items-center gap-3 text-center max-w-sm">
          <AlertCircle className="size-8 text-destructive" />
          <h1 className="text-xl font-semibold">Unable to load PR</h1>
          <p className="text-sm text-muted-foreground">
            Could not fetch {owner}/{repo}#{pull_number}. Check that the
            repository exists and you have access.
          </p>
        </div>
      </div>
    );
  }

  // --- No markdown files ---
  if (filesData && files.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="flex flex-col items-center gap-3 text-center max-w-sm">
          <h1 className="text-xl font-semibold">No markdown files changed</h1>
          <p className="text-sm text-muted-foreground">
            This PR does not contain any changed <code>.md</code> or{" "}
            <code>.mdx</code> files.
          </p>
          <Button variant="outline" asChild>
            <a
              href={`https://github.com/${owner}/${repo}/pull/${prNumber}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              View on GitHub
            </a>
          </Button>
        </div>
      </div>
    );
  }

  // --- Sidebar content ---
  const sidebarMinHeight = positionedThreads.length > 0
    ? Math.max(...positionedThreads.map(p =>
        p.actualY + (cardHeightsRef.current.get(p.thread.id) ?? 100)
      ))
    : undefined;

  const sidebar = (
    <>
      <div
        className="relative"
        style={{ minHeight: sidebarMinHeight }}
      >
        <CommentThreadList isLoading={threadsLoading}>
          {positionedThreads.map((positioned, i) => {
            const thread = currentThreads.find(t => t.graphqlId === positioned.thread.id);
            if (!thread) return null;
            const ctIdx = commentThreads.findIndex(ct => ct.id === positioned.thread.id);
            return (
              <div
                key={thread.graphqlId}
                className="absolute left-0 right-0 px-2"
                style={{ top: positioned.actualY }}
                data-positioned-thread-id={thread.graphqlId}
                ref={measureCardHeight}
              >
                <CommentThreadCard
                  threadId={thread.graphqlId}
                  line={thread.line ?? 0}
                  startLine={thread.startLine}
                  comments={thread.comments}
                  isResolved={thread.isResolved}
                  resolvedBy={thread.resolvedBy}
                  viewerCanResolve={thread.viewerCanResolve}
                  viewerCanUnresolve={thread.viewerCanUnresolve}
                  onResolve={() => resolveThread(thread.graphqlId, user)}
                  onUnresolve={() => unresolveThread(thread.graphqlId)}
                  owner={owner}
                  repo={repo}
                  prNumber={prNumber}
                  filePath={currentFile ?? ""}
                  isHighlighted={highlightedThreadId === thread.graphqlId}
                  onMouseEnter={() => ctIdx >= 0 ? onThreadMouseEnter(commentThreads[ctIdx]) : undefined}
                  onMouseLeave={onThreadMouseLeave}
                  onClick={() => ctIdx >= 0 ? onThreadClick(commentThreads[ctIdx]) : undefined}
                  ariaPosinset={i + 1}
                  ariaSetsize={positionedThreads.length}
                />
              </div>
            );
          })}
        </CommentThreadList>
      </div>
      {outdatedThreads.length > 0 && (
        <div className="px-3 pt-2">
          <OutdatedThreadsSection
            threads={outdatedThreads}
            owner={owner}
            repo={repo}
            prNumber={prNumber}
          />
        </div>
      )}
    </>
  );

  const header = (
    <>
      <ReviewHeader
        owner={owner}
        repo={repo}
        prNumber={prNumber}
        prTitle={prData?.title ?? ""}
        draft={prData?.draft}
        files={mdFiles}
        currentFile={currentFile ?? undefined}
        onFileSelect={setSelectedFile}
      />
      <StaleShaBanner
        isStale={isStale}
        onRefresh={handleRefresh}
      />
      <PrClosedBanner
        prState={prState}
        owner={owner}
        repo={repo}
        prNumber={prNumber}
      />
      <RateLimitBanner />
    </>
  );

  return (
    <DocumentReviewLayout
      header={header}
      sidebar={sidebar}
      contentRef={contentRef}
      sidebarRef={sidebarRef}
      scrollRef={scrollRef}
    >
      {markdownContent ? (
        <>
          <MarkdownRenderer
            content={markdownContent}
            owner={owner}
            repo={repo}
            headSha={initialHeadSha}
            filePath={currentFile ?? undefined}
            commentableLines={commentableLines}
            onCommentTrigger={handleCommentTrigger}
          />
          <InlineThreadIndicators
            contentRef={contentRef}
            scrollRef={scrollRef}
            threads={currentThreads}
            onIndicatorClick={onPassageClickScrollToThread}
          />
          {prState === "open" && !commentableResult?.readOnly && (
            <CommentAnchorButton
              containerRef={contentRef}
              commentableLines={commentableLines}
              onComment={handleComment}
              isCommentFormOpen={selectionInfo !== null}
            />
          )}
          {selectionInfo && (
            <div className="absolute z-50 right-4" style={{ top: selectionInfo.anchorTop }}>
              <CommentForm
                selectionInfo={selectionInfo}
                onSubmit={handleSubmitComment}
                onCancel={handleCancelComment}
                isSubmitting={isSubmitting}
                prNumber={prNumber}
                filePath={currentFile ?? undefined}
                submissionError={submissionError}
              />
            </div>
          )}
        </>
      ) : (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      )}
    </DocumentReviewLayout>
  );
}

"use client";

import { useCallback, useMemo } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypePrismPlus from "rehype-prism-plus";
import { rehypeSourceLines } from "@/lib/rehype-source-lines";
import { rehypeCodeSourceLines } from "@/lib/rehype-code-source-lines";
import { rehypeCommentable } from "@/lib/rehype-commentable";
import { rehypeCommentButtons } from "@/lib/rehype-comment-buttons";
import { makeUrlTransform } from "@/lib/url-transform";

interface MarkdownRendererProps {
  content: string;
  /** Repository owner (e.g., "octocat"). When provided with repo/headSha/filePath, enables relative URL rewriting. */
  owner?: string;
  /** Repository name (e.g., "hello-world"). */
  repo?: string;
  /** Head commit SHA of the PR branch. */
  headSha?: string;
  /** Path of the markdown file within the repo (e.g., "docs/README.md"). */
  filePath?: string;
  /** Set of source line numbers that are commentable (appear in the PR diff). When provided, elements overlapping these lines get `data-commentable="true"`. */
  commentableLines?: Set<number>;
  /** Called when a keyboard/screen-reader user activates a comment trigger button. Receives the start and end source line numbers. */
  onCommentTrigger?: (startLine: number, endLine: number) => void;
}

/**
 * Renders markdown content with GFM support, source-line tracking, and
 * syntax-highlighted code blocks with per-line source annotations.
 *
 * Rehype plugin pipeline order:
 * 1. rehypeSourceLines — annotates all elements with data-source-start/end
 *    from the original markdown positions (must run first, before any
 *    plugins that create new elements without position data)
 * 2. rehypePrismPlus — syntax highlights code blocks AND wraps each line
 *    in <span class="code-line"> elements (always produces line wrappers)
 * 3. rehypeCodeSourceLines — annotates the code-line wrappers with correct
 *    source line numbers (fenceStartLine + 1 + lineIndex)
 */
export function MarkdownRenderer({
  content,
  owner,
  repo,
  headSha,
  filePath,
  commentableLines,
  onCommentTrigger,
}: MarkdownRendererProps) {
  const urlTransform = useMemo(() => {
    if (owner && repo && headSha && filePath) {
      return makeUrlTransform(owner, repo, headSha, filePath);
    }
    return undefined;
  }, [owner, repo, headSha, filePath]);

  const rehypePlugins = useMemo(() => {
    const plugins: Parameters<typeof Markdown>[0]["rehypePlugins"] = [
      rehypeSourceLines,
      [rehypePrismPlus, { ignoreMissing: true }],
      rehypeCodeSourceLines,
    ];
    if (commentableLines) {
      plugins.push([rehypeCommentable, { commentableLines }]);
      plugins.push(rehypeCommentButtons);
    }
    return plugins;
  }, [commentableLines]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      const target = e.target as HTMLElement;
      if (!onCommentTrigger) return;
      if (target.tagName !== "BUTTON") return;
      if (!target.hasAttribute("data-comment-trigger")) return;

      const start = Number(target.getAttribute("data-trigger-start"));
      const end = Number(target.getAttribute("data-trigger-end"));
      if (!isNaN(start) && !isNaN(end)) {
        onCommentTrigger(start, end);
      }
    },
    [onCommentTrigger],
  );

  return (
    <article
      className="prose dark:prose-invert lg:prose-lg max-w-none"
      onClick={handleClick}
    >
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={rehypePlugins}
        urlTransform={urlTransform}
      >
        {content}
      </Markdown>
    </article>
  );
}

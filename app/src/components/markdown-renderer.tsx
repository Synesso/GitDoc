"use client";

import { useMemo } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypePrismPlus from "rehype-prism-plus";
import { rehypeSourceLines } from "@/lib/rehype-source-lines";
import { rehypeCodeSourceLines } from "@/lib/rehype-code-source-lines";
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
}: MarkdownRendererProps) {
  const urlTransform = useMemo(() => {
    if (owner && repo && headSha && filePath) {
      return makeUrlTransform(owner, repo, headSha, filePath);
    }
    return undefined;
  }, [owner, repo, headSha, filePath]);

  return (
    <article className="prose dark:prose-invert lg:prose-lg max-w-none">
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          rehypeSourceLines,
          [rehypePrismPlus, { ignoreMissing: true }],
          rehypeCodeSourceLines,
        ]}
        urlTransform={urlTransform}
      >
        {content}
      </Markdown>
    </article>
  );
}

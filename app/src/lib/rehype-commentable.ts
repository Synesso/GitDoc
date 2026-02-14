import { visit } from "unist-util-visit";
import type { Root, Element } from "hast";

/**
 * Check whether any line in the range [start, end] is in the commentable set.
 */
function hasCommentableLineInRange(
  start: number,
  end: number,
  commentableLines: Set<number>,
): boolean {
  for (let line = start; line <= end; line++) {
    if (commentableLines.has(line)) return true;
  }
  return false;
}

/**
 * Rehype plugin that marks elements with `data-commentable="true"` when
 * their source line range (from `data-source-start`/`data-source-end`)
 * includes at least one line from the commentable lines set.
 *
 * Must run AFTER `rehype-source-lines` (which sets `dataSourceStart`/
 * `dataSourceEnd` on elements) and AFTER `rehype-code-source-lines`
 * (which annotates per-line code wrappers).
 *
 * Usage:
 * ```tsx
 * <Markdown
 *   rehypePlugins={[
 *     rehypeSourceLines,
 *     [rehypePrismPlus, { ignoreMissing: true }],
 *     rehypeCodeSourceLines,
 *     [rehypeCommentable, { commentableLines: mySet }],
 *   ]}
 * >
 * ```
 */
export function rehypeCommentable(options: { commentableLines: Set<number> }) {
  const { commentableLines } = options;

  return (tree: Root) => {
    visit(tree, "element", (node: Element) => {
      const start = node.properties["dataSourceStart"];
      const end = node.properties["dataSourceEnd"];

      if (typeof start !== "number" || typeof end !== "number") return;

      if (hasCommentableLineInRange(start, end, commentableLines)) {
        node.properties["dataCommentable"] = "true";
      }
    });
  };
}

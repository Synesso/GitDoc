import { visit, SKIP } from "unist-util-visit";
import type { Root, Element, ElementContent } from "hast";

/**
 * Set of HTML tag names considered block-level for the purpose of
 * inserting comment trigger buttons. We only insert buttons before
 * block-level elements to avoid cluttering the tab order with
 * triggers inside inline elements like <em>, <strong>, <code>, etc.
 */
const BLOCK_ELEMENTS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "blockquote",
  "pre",
  "table",
  "tr",
  "div",
]);

/**
 * Rehype plugin that injects a visually-hidden `<button>` element before
 * each block-level commentable element. The button is `sr-only` by default
 * (invisible to sighted users) but becomes visible and focusable when
 * reached via keyboard Tab navigation (`focus:not-sr-only`).
 *
 * This provides keyboard and screen reader users with an entry point for
 * commenting without polluting the reading flow — the buttons are only
 * encountered when navigating by focusable elements, not when reading
 * the document linearly.
 *
 * Must run AFTER `rehype-commentable` (which sets `dataCommentable`).
 *
 * The injected button has `data-comment-trigger`, `data-trigger-start`,
 * and `data-trigger-end` attributes so parent components can handle
 * clicks via event delegation.
 */
export function rehypeCommentButtons() {
  return (tree: Root) => {
    visit(tree, "element", (node: Element, index, parent) => {
      if (!parent || index === undefined || index === null) return;

      // Only process block-level commentable elements
      if (!BLOCK_ELEMENTS.has(node.tagName)) return;
      if (node.properties["dataCommentable"] !== "true") return;

      const start = node.properties["dataSourceStart"];
      const end = node.properties["dataSourceEnd"];
      if (typeof start !== "number" || typeof end !== "number") return;

      const label =
        start === end
          ? `Add comment on line ${start}`
          : `Add comment on lines ${start}\u2013${end}`;

      const button: Element = {
        type: "element",
        tagName: "button",
        properties: {
          type: "button",
          className: [
            "comment-trigger-btn",
          ],
          ariaLabel: label,
          "dataCommentTrigger": "true",
          "dataTriggerStart": start,
          "dataTriggerEnd": end,
        },
        children: [
          {
            type: "text",
            value: "💬",
          },
        ],
      };

      // Insert the button before the current node in the parent's children
      (parent as Element).children.splice(
        index,
        0,
        button as ElementContent,
      );

      // Skip past the inserted button + the current node to avoid re-visiting
      return [SKIP, index + 2] as const;
    });
  };
}

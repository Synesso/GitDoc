import { visit } from "unist-util-visit";
import type { Root, Element } from "hast";

/**
 * Rehype plugin that copies source line positions from the hast tree
 * into `data-source-start` / `data-source-end` HTML attributes on
 * every element node.
 *
 * Position data originates from the markdown source (via remark/mdast)
 * and is preserved through remark-rehype into hast nodes. This plugin
 * makes it available in the rendered DOM for use by the commenting system.
 *
 * Produces output like: <p data-source-start="5" data-source-end="7">...</p>
 */
export function rehypeSourceLines() {
  return (tree: Root) => {
    visit(tree, "element", (node: Element) => {
      if (node.position) {
        node.properties["dataSourceStart"] = node.position.start.line;
        node.properties["dataSourceEnd"] = node.position.end.line;
      }
    });
  };
}

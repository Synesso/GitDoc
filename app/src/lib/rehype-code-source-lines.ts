import { visit } from "unist-util-visit";
import type { Root, Element } from "hast";

/**
 * Rehype plugin that annotates per-line wrapper elements inside fenced
 * code blocks with the correct original markdown source line number.
 *
 * Must run AFTER a line-wrapping plugin (e.g. `rehype-prism-plus` or
 * `rehype-highlight-code-lines`) that splits `<pre><code>` text content
 * into per-line `<span class="code-line">` (or `<div class="code-line">`)
 * wrapper elements.
 *
 * The source line is computed as: fenceStartLine + 1 + lineIndex
 *   - fenceStartLine is the ``` opening fence line (from hast position)
 *   - +1 skips the fence line itself
 *   - lineIndex is the 0-based index of the line within the code block
 *
 * Produces output like:
 *   <span class="code-line" data-source-start="43" data-source-end="43">
 */
export function rehypeCodeSourceLines() {
  return (tree: Root) => {
    visit(tree, "element", (node: Element) => {
      if (node.tagName !== "pre") return;

      const codeEl = node.children.find(
        (c): c is Element => c.type === "element" && c.tagName === "code",
      );
      if (!codeEl) return;

      // The pre element's position.start.line is the ``` opening fence line.
      // The actual code content starts on the NEXT line.
      const fenceStartLine = node.position?.start.line;
      if (!fenceStartLine) return;
      const codeStartLine = fenceStartLine + 1;

      let lineIndex = 0;
      visit(codeEl, "element", (lineNode: Element) => {
        // Target line wrappers produced by rehype-prism-plus or
        // rehype-highlight-code-lines (both use the "code-line" class)
        const classes = Array.isArray(lineNode.properties?.className)
          ? lineNode.properties.className
          : [];
        if (classes.includes("code-line")) {
          lineNode.properties["dataSourceStart"] = codeStartLine + lineIndex;
          lineNode.properties["dataSourceEnd"] = codeStartLine + lineIndex;
          lineIndex++;
        }
      });
    });
  };
}

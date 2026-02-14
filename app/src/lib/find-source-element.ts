/**
 * Walks from a DOM node up to the nearest ancestor element that has a
 * `data-source-start` attribute (set by the `rehype-source-lines` plugin).
 *
 * Selection API nodes (`Range.startContainer`, `Range.endContainer`) are
 * typically Text nodes, which don't have `closest()`. This function
 * handles both Text nodes and Element nodes.
 *
 * @param node - A DOM node, usually from `Range.startContainer` or `Range.endContainer`
 * @returns The nearest ancestor Element with `[data-source-start]`, or `null` if none found
 */
export function findSourceElement(node: Node): Element | null {
  const el =
    node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
  return el?.closest("[data-source-start]") ?? null;
}

import type { CommentThread } from "./build-comment-threads";

const MIN_CARD_GAP = 8; // px between thread cards
const ESTIMATED_CARD_HEIGHT = 100; // px — refined with actual measurements via cardHeights param

export interface PositionedThread {
  thread: CommentThread;
  /** Ideal vertical position (from DOM element's position relative to container) */
  desiredY: number;
  /** Final position after overlap resolution */
  actualY: number;
  /** True if pushed away from desired position */
  displaced: boolean;
}

/**
 * Computes the desired Y position for a thread by finding the DOM element
 * whose `data-source-start`/`data-source-end` range covers the thread's
 * target line, then returning its vertical midpoint relative to the
 * container.
 *
 * @param thread - The comment thread to anchor
 * @param container - The markdown content container element
 * @returns Y position in px relative to the container's top, or null if not found
 */
export function getThreadAnchorY(
  thread: CommentThread,
  container: HTMLElement,
): number | null {
  const targetLine = thread.line;
  const elements = container.querySelectorAll("[data-source-start]");

  for (const el of elements) {
    const start = Number(el.getAttribute("data-source-start"));
    const end = Number(el.getAttribute("data-source-end"));
    if (start <= targetLine && targetLine <= end) {
      const rect = el.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      return rect.top - containerRect.top;
    }
  }

  return null;
}

/**
 * Computes positioned layout for comment thread cards in the right sidebar.
 *
 * Each thread's desired Y position is derived from the DOM element it anchors
 * to. When multiple threads target nearby lines, their cards may overlap
 * vertically — this algorithm pushes overlapping cards downward with a
 * minimum gap constraint (Google Docs–style push-apart layout).
 *
 * @param threads - Comment threads to position (typically active, non-outdated)
 * @param container - The markdown content container element (for DOM queries)
 * @param cardHeights - Optional map of thread ID → measured card height in px.
 *   When provided, uses actual heights instead of the estimated default.
 * @returns Positioned threads sorted top-to-bottom with final Y coordinates
 */
export function layoutThreadCards(
  threads: CommentThread[],
  container: HTMLElement,
  cardHeights?: Map<number | string, number>,
): PositionedThread[] {
  const positioned: PositionedThread[] = threads
    .map((thread) => ({
      thread,
      desiredY: getThreadAnchorY(thread, container) ?? 0,
      actualY: 0,
      displaced: false,
    }))
    .filter((p) => p.desiredY > 0)
    .sort((a, b) => a.desiredY - b.desiredY);

  let nextAvailableY = 0;

  for (const item of positioned) {
    if (item.desiredY >= nextAvailableY) {
      item.actualY = item.desiredY;
    } else {
      item.actualY = nextAvailableY;
      item.displaced = true;
    }

    const height =
      cardHeights?.get(item.thread.id) ?? ESTIMATED_CARD_HEIGHT;
    nextAvailableY = item.actualY + height + MIN_CARD_GAP;
  }

  return positioned;
}

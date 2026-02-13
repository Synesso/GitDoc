# Engineering Design Document

This document is place to collect all of the things that need to be done to implement the git document review feature described in the prd.md file.

This file WILL NOT be created in one go. It MUST be incrementally updated as you investigate and learn more about the project. Most of the time you will be adding 'Things to Explore' bullet points to the document as you learn discover more things that you need to better understand before you can start have a comprehensive but concise design.

It is extremely important that you first generate ideas for what you need to explore to see if it is relevant to the project. Sometimes you will have questions that later turn out to be irrelevant to the project and that is ok, just explore, learn and update the document as you go along with progress.md. 

# Engineering Design document content

## Architecture Overview

The PRD specifies a three-tier architecture: **Browser (React SPA) ↔ GitDoc API (Node/Edge) ↔ GitHub API**. No database — all state lives in GitHub.

### Recommended Stack

- **Frontend**: Next.js (App Router) — gives us file-based routing, SSR for initial page loads (SEO not critical but helps perceived perf), and API routes as the backend layer. This collapses the "GitDoc API" and "Frontend" into a single deployable.
- **Markdown rendering**: `react-markdown` (built on `remark`/`rehype`) with `remark-gfm` for GitHub Flavoured Markdown (tables, task lists, strikethrough, alerts). Custom components via the `components` prop for styling and source-line tracking.
- **Auth**: GitHub OAuth (or GitHub App user-access tokens). The backend (Next.js API route / server action) handles the OAuth flow and stores the access token in a secure HTTP-only cookie. The token is never exposed to client JS.
- **API proxy**: Next.js API routes proxy all GitHub API calls server-side, attaching the user's OAuth token from the cookie. This keeps tokens secure and lets us handle rate-limit caching.

### Key GitHub API Endpoints

| Action | Endpoint | Notes |
|--------|----------|-------|
| List open PRs | `GET /repos/{owner}/{repo}/pulls` | Filter `state=open` |
| List changed files | `GET /repos/{owner}/{repo}/pulls/{pull_number}/files` | Filter client-side for `.md`/`.mdx` |
| Fetch file content | `GET /repos/{owner}/{repo}/contents/{path}?ref={head_sha}` | Base64-encoded; decode client-side |
| List review comments | `GET /repos/{owner}/{repo}/pulls/{pull_number}/comments` | Filter by `path` for current file |
| Create review comment | `POST /repos/{owner}/{repo}/pulls/{pull_number}/comments` | Requires: `body`, `commit_id` (head SHA), `path`, `line`, `side: "RIGHT"`. Optional: `start_line`/`start_side` for multi-line. |
| Reply to comment | `POST /repos/{owner}/{repo}/pulls/{pull_number}/comments/{comment_id}/replies` | Only requires `body`; `in_reply_to` for threading |

### Critical Constraint: Comments Only on Diff Lines

**GitHub PR review comments can ONLY be placed on lines that appear in the diff** (added, removed, or context lines around changes). You cannot comment on arbitrary lines of the file. This is a fundamental constraint that affects the UX:

- The rendered markdown view must somehow indicate which passages are commentable (i.e., which source lines appear in the diff).
- We need to fetch the diff for the PR file and build a mapping of which source lines are in the diff.
- Lines NOT in the diff cannot receive comments — the UI must make this clear (e.g., only show the comment anchor for commentable passages).

### Diff-Line Mapping: Which Lines Are Commentable

**Data source**: The `GET /repos/{owner}/{repo}/pulls/{pull_number}/files` endpoint returns a `patch` field on each file object. This is a standard unified diff string (e.g., `@@ -132,7 +132,7 @@ module Test`). GitHub uses 3 lines of context by default (standard unified diff), and **there is no API parameter to increase context lines**.

**Parsing**: Use the [`parse-diff`](https://www.npmjs.com/package/parse-diff) npm package (~1M weekly downloads, MIT, zero dependencies). It parses unified diff strings and returns structured data with per-line type info:

- **`AddChange`**: `{ type: 'add', ln: <new-file-line-number>, content }` — added lines
- **`DeleteChange`**: `{ type: 'del', ln: <old-file-line-number>, content }` — deleted lines
- **`NormalChange`**: `{ type: 'normal', ln1: <old-line>, ln2: <new-line>, content }` — context lines

**Building the commentable-line set**: Since GitDoc shows only the **head-ref** (new) version of the file, commentable lines on side `RIGHT` are:
1. All `AddChange.ln` values (new/modified lines)
2. All `NormalChange.ln2` values (context lines around changes)

These are the only lines where the GitHub API will accept a review comment with `side: "RIGHT"`.

**Algorithm** (per markdown file in the PR):
```
1. Call GET /repos/{o}/{r}/pulls/{n}/files → find file entry by filename
2. Extract file.patch (unified diff string)
3. Parse with parse-diff → get chunks[].changes[]
4. For each change:
   - if type === 'add': add change.ln to commentableLines set
   - if type === 'normal': add change.ln2 to commentableLines set
5. Store as Set<number> keyed by file path
```

**Key constraint**: Only ~3 context lines surround each change hunk. For a file with sparse edits, large sections of the rendered markdown will be *non-commentable*. The UI must clearly communicate this — e.g., only show comment anchors on commentable passages and visually dim or annotate non-commentable regions.

**Edge cases**:
- **New files** (`status: "added"`): The entire file is in the diff → every line is commentable.
- **Deleted files**: Not relevant for GitDoc (we show head-ref, deleted files don't exist).
- **Renamed files**: The `patch` field still contains the diff; `filename` is the new path.
- **Binary/large files**: May have no `patch` field → no commentable lines.
- **Truncated patches**: GitHub may truncate very large diffs. The API docs say responses include a max of 3000 files. For individual file patches that are too large, `patch` may be absent — need to handle gracefully (show as read-only).

### Source Line Mapping Strategy

To connect rendered DOM elements back to source line numbers (required for commenting):

1. Use `remark` to parse the markdown AST. Each AST node has a `position` property with `start.line` and `end.line`.
2. During rendering via `react-markdown`, pass source line info through as `data-source-line` attributes on rendered elements.
3. When the user selects text, walk up the DOM to find the nearest element with `data-source-line`, then use that to determine which source line(s) to target for the GitHub API call.
4. Cross-reference with the diff line map to confirm the line is commentable.

#### How Position Data Flows Through the Pipeline

The unified pipeline is: **markdown → remark (mdast) → remark-rehype (hast) → react-markdown (React)**. Position data is preserved at each step:

1. **remark** parses markdown into an mdast AST. Every mdast node gets a `position` property: `{ start: { line, column, offset }, end: { line, column, offset } }`. These refer to the **original markdown source** line numbers (1-indexed).

2. **remark-rehype** (`mdast-util-to-hast`) transforms mdast → hast. Internally it calls a `patch(from, to)` function on every node, which copies `from.position` (the mdast node's position) onto the resulting hast node. So **hast elements retain the original markdown source line numbers**.

3. **react-markdown** renders hast nodes into React. Every custom component receives a `node` prop — the original hast `Element`. This node has a `position` property with the source lines.

#### Approach: Custom Rehype Plugin (`rehype-source-lines`)

Write a small rehype plugin that walks the hast tree and copies `position.start.line` / `position.end.line` into HTML `data-*` attributes on every element node. This runs after `remark-rehype` but before React rendering:

```ts
import { visit } from 'unist-util-visit';
import type { Root, Element } from 'hast';

export function rehypeSourceLines() {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element) => {
      if (node.position) {
        node.properties['dataSourceStart'] = node.position.start.line;
        node.properties['dataSourceEnd'] = node.position.end.line;
      }
    });
  };
}
```

This produces DOM output like: `<p data-source-start="5" data-source-end="7">...</p>`.

**Usage with react-markdown**:
```tsx
<Markdown
  remarkPlugins={[remarkGfm]}
  rehypePlugins={[rehypeSourceLines]}
>
  {markdownContent}
</Markdown>
```

#### Alternative Approach: Custom Components

Instead of a rehype plugin, use `react-markdown`'s `components` prop. Every component receives a `node` prop (the hast element with `position`):

```tsx
const components = {
  p: ({ node, children, ...props }) => (
    <p
      data-source-start={node?.position?.start?.line}
      data-source-end={node?.position?.end?.line}
      {...props}
    >
      {children}
    </p>
  ),
  // ... repeat for h1-h6, li, blockquote, table, etc.
};
```

**Trade-off**: The rehype plugin approach is cleaner — it applies to *all* element nodes automatically without needing to override every component. The components approach is more boilerplate but gives finer control (e.g., only annotate block-level elements).

**Recommendation**: Use the rehype plugin for broad coverage, then optionally use custom components for specific UI needs (e.g., adding comment anchors to block elements).

#### Key Considerations

- **Block vs. inline elements**: Block-level elements (`p`, `h1`–`h6`, `li`, `blockquote`, `pre`, `table`, `tr`) are the natural units for commenting. Inline elements (`em`, `strong`, `a`, `code`) also get position data, but comments should target the enclosing block element's line range.
- **Multi-line elements**: A paragraph spanning lines 5–10 should produce `data-source-start="5" data-source-end="10"`. When the user selects text within it, we need the full line range.
- **Granularity for multi-line comments**: The GitHub API supports `start_line` + `line` for multi-line comments. If a user selects across multiple block elements, we'd use the `data-source-start` of the first element and `data-source-end` of the last.
- **Text nodes**: hast `text` nodes don't become DOM elements, so they can't carry data attributes. The enclosing element's position is the best we can do for line resolution.
- **Code blocks**: A fenced code block (` ``` `) becomes `<pre><code>...</code></pre>`. The `position` on the `pre`/`code` element covers the entire block. For line-level commenting within code blocks, we'd need to split the code content by newlines and map each to a source line — a more advanced feature to consider later.

## Text Selection UX: Mapping DOM Selection to Source Lines

The commenting flow starts when a user selects rendered text. We need to: (1) detect the selection, (2) map it to source line numbers via our `data-source-start`/`data-source-end` attributes, (3) check those lines are commentable (in the diff), and (4) show a floating comment anchor.

### Event Handling Strategy

**Recommended approach**: Use `selectionchange` as the primary event with **mouse-state tracking** and **input-aware debouncing**. This pattern (proven by Hypothesis, the most widely-used open-source annotation tool) handles mouse, keyboard, and programmatic selections uniformly without special-casing each input type.

#### Why Not `mouseup` Alone?

The earlier approach of `selectstart` + `mouseup` has a critical gap: `mouseup` never fires for keyboard-based selections (Shift+Arrow, Shift+Home/End, Ctrl+Shift+Arrow for word selection, etc.). Adding `keyup` as a supplemental listener is fragile — it doesn't cover all keyboard shortcuts across OS/browser combos (e.g., macOS uses Option+Shift+Arrow for word selection). Caret Browsing (F7) and assistive technologies also extend selections without mouse or standard keyboard events.

#### Recommended Pattern: SelectionObserver (Hypothesis approach)

Track mouse state with `mousedown`/`mouseup`, and use `selectionchange` as the universal selection event. Apply different debounce delays based on input type:

- **Mouse selections**: After `mouseup`, the selection is finalized → use a **short delay (~10ms)** to let the browser settle.
- **Keyboard/other selections**: `selectionchange` fires on every Shift+Arrow keystroke → use a **longer debounce (~100ms)** to wait for the user to finish extending the selection.
- **During mouse drag**: While the mouse button is held (`isMouseDown === true`), ignore intermediate `selectionchange` events to prevent jumpy repositioning during drag-selection.

```tsx
function useSelectionObserver(
  containerRef: React.RefObject<HTMLElement>,
  onSelection: (range: Range) => void,
  onClearSelection: () => void,
) {
  useEffect(() => {
    let isMouseDown = false;
    let pendingTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleCallback = (delay: number) => {
      if (pendingTimer) clearTimeout(pendingTimer);
      pendingTimer = setTimeout(() => {
        const sel = document.getSelection();
        if (!sel || sel.isCollapsed) {
          onClearSelection();
          return;
        }
        // Verify selection is within our markdown container
        const container = containerRef.current;
        if (!container || !container.contains(sel.anchorNode)) return;
        onSelection(sel.getRangeAt(0));
      }, delay);
    };

    const onMouseDown = () => { isMouseDown = true; };

    const onMouseUp = () => {
      isMouseDown = false;
      scheduleCallback(10); // Selection finalized — short delay
    };

    const onSelectionChange = () => {
      if (isMouseDown) return; // Ignore intermediate drag updates
      scheduleCallback(100); // Keyboard/other — debounce
    };

    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('selectionchange', onSelectionChange);

    return () => {
      if (pendingTimer) clearTimeout(pendingTimer);
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('selectionchange', onSelectionChange);
    };
  }, [containerRef, onSelection, onClearSelection]);
}
```

#### How This Handles Every Input Type

| Input Type | Event Flow | Delay |
|------------|-----------|-------|
| Mouse drag | `mousedown` → (drag, `selectionchange` ignored) → `mouseup` → callback | 10ms |
| Shift+Arrow keys | `selectionchange` × N → last one schedules callback | 100ms debounce |
| Shift+Home/End, Ctrl+Shift+Arrow | Same as Shift+Arrow | 100ms debounce |
| Caret Browsing (F7) + Shift+Arrow | Same — fires `selectionchange` | 100ms debounce |
| Triple-click (select paragraph) | `mousedown` → `mouseup` → callback | 10ms |
| Programmatic selection (assistive tech) | `selectionchange` → callback | 100ms debounce |
| Clear selection (click elsewhere) | `mouseup` with collapsed selection → `onClearSelection` | 10ms |

#### Why This Is Better Than Alternatives

- **`keyup` listener**: Fragile — doesn't catch all keyboard shortcuts across platforms (macOS Option+Shift+Arrow, Ctrl+Shift+Home on Windows, etc.). Also doesn't handle assistive technology or programmatic selections.
- **`selectionchange` without debounce**: Fires on every character during Shift+Arrow, causing dozens of re-renders per second and jumpy comment anchor positioning.
- **`selectionchange` without mouse-state filtering**: During mouse drag, `selectionchange` fires continuously as the selection extends, causing the same jumpy behavior.
- **The combined approach**: Gives responsive feedback for mouse selections (10ms) while buffering keyboard selections (100ms) — no jumpy UI, no missed selections.

#### Reference Implementation: Hypothesis Client

The open-source [Hypothesis client](https://github.com/hypothesis/client) uses this exact pattern in its `SelectionObserver` class (`src/annotator/selection-observer.ts`). It's been battle-tested across millions of web pages with diverse DOM structures, and handles edge cases like:
- Selections that start inside and end outside the annotatable content
- Shadow DOM boundaries
- iframes (with separate documents)
- RTL text and mixed-direction selections

### Resolving Source Lines from DOM Selection

Given a non-collapsed `Selection`, we need to find which source lines the user selected:

1. **Get the Range**: `const range = selection.getRangeAt(0);`
2. **Find annotated ancestor elements**: Both `startContainer` and `endContainer` of the range may be **Text nodes** (most common case). Text nodes don't have `closest()`, so use `parentElement`:
   ```ts
   function findSourceElement(node: Node): Element | null {
     const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
     return el?.closest('[data-source-start]') ?? null;
   }
   ```
3. **Extract line range**:
   ```ts
   const startEl = findSourceElement(range.startContainer);
   const endEl = findSourceElement(range.endContainer);
   const startLine = Number(startEl?.getAttribute('data-source-start'));
   const endLine = Number(endEl?.getAttribute('data-source-end'));
   ```
4. **Build the GitHub API parameters**:
   - If `startLine === endLine`: single-line comment → `{ line: endLine, side: 'RIGHT' }`
   - If `startLine < endLine`: multi-line comment → `{ start_line: startLine, line: endLine, start_side: 'RIGHT', side: 'RIGHT' }`

### Cross-Reference with Commentable Lines

Before showing the comment anchor, verify that the selected lines are actually in the diff:

```ts
const commentableLines: Set<number> = /* from diff parsing */;
const anyCommentable = /* check if at least one line in [startLine, endLine] is commentable */;
```

**Decision**: If the selection spans a mix of commentable and non-commentable lines, we have options:
- **Option A**: Allow it — snap the `start_line`/`line` to the nearest commentable lines within the range. This is more forgiving but may create comments that don't precisely match the selection.
- **Option B**: Only show the anchor if ALL lines in the range are commentable. Simpler but restrictive.
- **Recommendation**: Option A with a visual hint — show the comment anchor, but indicate which portion of the selection is commentable. The GitHub API will reject the request if the exact `line`/`start_line` aren't in the diff, so we must snap to valid diff lines.

### Positioning the Comment Anchor

Use `Range.getBoundingClientRect()` to position a floating comment button near the selection:

```ts
const rect = range.getBoundingClientRect();
const anchorPosition = {
  x: rect.right + MARGIN, // or in the right margin of the document
  y: rect.top + window.scrollY,
};
```

**Positioning library**: Consider using `@floating-ui/react` (successor to Popper.js, ~3KB gzipped) for robust positioning that handles viewport edges, scroll, and flipping. Alternatively, for the Google Docs–style margin approach described in the PRD, position the anchor in a fixed right-margin column aligned with the selection's vertical position — this avoids needing a floating library entirely.

### Edge Cases

- **Empty selection**: `selection.isCollapsed === true` → do nothing, clear any visible anchor.
- **Selection outside the markdown container**: Check that the selection is within the rendered markdown area before processing.
- **Selection across non-commentable regions**: The anchor-line of the GitHub comment must be a diff line. Snap to nearest valid line or show a "not commentable" state.
- **Very long selections**: A selection spanning many paragraphs should still work — use `data-source-start` of the first element and `data-source-end` of the last.
- **Inline elements**: If the selection starts/ends inside an `<em>`, `<strong>`, `<code>`, etc., `closest('[data-source-start]')` will walk up to the enclosing block element (e.g., `<p>`), which is the correct granularity for commenting.

## Resolving Relative Image Paths

Markdown files in a PR often reference images with relative paths (e.g., `![diagram](./images/arch.png)`). Since GitDoc renders markdown fetched from GitHub — not from a local filesystem — these relative paths won't resolve unless we rewrite them.

### Raw Content URL Format

GitHub serves raw file content at:
```
https://raw.githubusercontent.com/{owner}/{repo}/{ref}/{path}
```

For a PR, `{ref}` is the **head branch name** (e.g., `feature/docs-update`) or the **head SHA**. Using the head SHA is more precise and avoids issues if the branch is force-pushed between fetches.

### URL Rewriting Strategy

**Approach**: Use `react-markdown`'s `urlTransform` prop. This is a function called for every URL in the rendered markdown (`href` on links, `src` on images). It receives `(url, key, node)` and returns the transformed URL.

```tsx
function makeUrlTransform(owner: string, repo: string, headSha: string, filePath: string) {
  const dir = filePath.substring(0, filePath.lastIndexOf('/') + 1); // e.g., "docs/"

  return (url: string, key: string, node: Element) => {
    // Skip absolute URLs and data URIs
    if (/^(https?:\/\/|data:|#)/.test(url)) {
      return url;
    }

    // Resolve relative path against the markdown file's directory
    let resolved: string;
    if (url.startsWith('/')) {
      // Repo-root-relative: /images/foo.png → images/foo.png
      resolved = url.slice(1);
    } else {
      // Directory-relative: ./images/foo.png or ../assets/bar.png
      // Use URL constructor for proper path resolution
      const base = `https://raw.githubusercontent.com/${owner}/${repo}/${headSha}/${dir}`;
      resolved = new URL(url, base).pathname.split('/').slice(4).join('/');
      // slice(4) removes: /{owner}/{repo}/{headSha}/
    }

    return `https://raw.githubusercontent.com/${owner}/${repo}/${headSha}/${resolved}`;
  };
}
```

**Usage**:
```tsx
<Markdown
  remarkPlugins={[remarkGfm]}
  rehypePlugins={[rehypeSourceLines]}
  urlTransform={makeUrlTransform(owner, repo, headSha, filePath)}
>
  {markdownContent}
</Markdown>
```

### What Gets Rewritten

The `urlTransform` callback is invoked for:
- **`img` elements**: `src` attribute (image references like `![alt](path)`)
- **`a` elements**: `href` attribute (links like `[text](path)`)

This means relative links to other markdown files (e.g., `[see also](./other-doc.md)`) will also be rewritten to `raw.githubusercontent.com` URLs, which would download the raw file. This is acceptable for images but not ideal for `.md` links.

### Handling Relative Links to Other Markdown Files

For links to other `.md` files in the repo, we have two options:
1. **Option A**: Rewrite `.md` links to point to the GitHub PR file view (`github.com/{owner}/{repo}/blob/{headSha}/{path}`) — takes the user out of GitDoc but keeps the link functional.
2. **Option B**: Rewrite `.md` links to an internal GitDoc route (e.g., `/review/{owner}/{repo}/{pr_number}/{path}`) — keeps the user in GitDoc if the linked file is also changed in the PR.
3. **Recommendation**: Start with Option A. Option B is a nice enhancement but adds complexity (need to check if the linked file is in the PR's changed files list).

The `urlTransform` function can distinguish by checking if the URL ends with `.md` or `.mdx`:
```ts
if (/\.mdx?$/.test(url)) {
  return `https://github.com/${owner}/${repo}/blob/${headSha}/${resolved}`;
}
return `https://raw.githubusercontent.com/${owner}/${repo}/${headSha}/${resolved}`;
```

### Authentication for Private Repos

`raw.githubusercontent.com` requires authentication for private repos. Two options:
1. **Proxy through our API**: Rewrite image URLs to an API route like `/api/image/{owner}/{repo}/{sha}/{path}` that fetches the content server-side with the user's OAuth token and streams it back. This is the most secure approach and avoids CORS issues.
2. **Use GitHub Contents API**: Fetch image content via `GET /repos/{owner}/{repo}/contents/{path}?ref={sha}` (returns base64-encoded content) and convert to a data URI or blob URL client-side.

**Recommendation**: For public repos, rewrite directly to `raw.githubusercontent.com`. For private repos, use the API proxy approach (option 1). The proxy also respects rate limits via our caching layer.

### Edge Cases

- **Absolute URLs**: Passed through unchanged (e.g., `https://example.com/img.png`).
- **Anchor-only URLs**: `#section` links — passed through unchanged.
- **Data URIs**: `data:image/png;base64,...` — passed through unchanged.
- **`..` path traversal**: Handled correctly by the `URL` constructor's path resolution.
- **URL-encoded paths**: Paths with spaces (`my%20image.png`) work since the URL constructor handles encoding.
- **HTML `<img>` tags in markdown**: If using `rehype-raw` to support inline HTML, the `urlTransform` applies to those too.
- **SVG images**: Served with correct MIME type from `raw.githubusercontent.com`, so they render correctly.

## UI Framework & Component Library

### Recommendation: Tailwind CSS + shadcn/ui

**Tailwind CSS** as the styling foundation, **shadcn/ui** (built on Radix UI primitives) for interactive components. This is the dominant stack for Next.js App Router projects in 2025–2026 — well-documented, accessible, tree-shakeable, and fully owned (copy-paste, not npm dependency).

### Why This Stack

- **shadcn/ui** gives us accessible, pre-styled components built on Radix UI primitives (WAI-ARIA compliant). Components are copied into the codebase — full ownership, no version lock-in, easy to customize.
- **Tailwind CSS** is utility-first and the natural fit for Next.js (first-class support). It avoids CSS-in-JS runtime overhead (unlike Chakra/MUI).
- **Radix UI** underpins shadcn/ui's interactive primitives (Popover, Dialog, Tooltip, etc.) — handles focus management, keyboard navigation, and ARIA roles correctly.

### Key Components Needed from shadcn/ui

| Component | GitDoc Use Case |
|-----------|----------------|
| `Button` | Comment submit, reply, navigation actions |
| `Textarea` | Comment input, reply input |
| `Popover` | Floating comment anchor after text selection |
| `Sidebar` (side=`right`) | Right-margin comment threads panel (Google Docs-style) |
| `Card` | Individual comment thread containers |
| `Avatar` | GitHub user avatars on comments |
| `Collapsible` | Expand/collapse comment threads, resolved threads |
| `Tooltip` | Hover hints (e.g., "not commentable", user info) |
| `Skeleton` | Loading states for markdown content, comments |
| `Badge` | Comment count, PR status indicators |
| `ScrollArea` | Scrollable comment sidebar |
| `Dialog` | Auth flow, confirmation dialogs |
| `Sonner` (toast) | Success/error notifications for comment submission |
| `DropdownMenu` | PR selection, file selection |

### Markdown Rendering Styling: `@tailwindcss/typography`

Tailwind's Preflight (CSS reset) strips default heading sizes, list styles, etc. from rendered HTML. This breaks `react-markdown` output. The official **`@tailwindcss/typography`** plugin solves this by providing `prose` classes that apply beautiful typographic defaults to arbitrary HTML:

```tsx
<article className="prose dark:prose-invert lg:prose-lg max-w-none">
  <Markdown
    remarkPlugins={[remarkGfm]}
    rehypePlugins={[rehypeSourceLines]}
    urlTransform={makeUrlTransform(owner, repo, headSha, filePath)}
  >
    {markdownContent}
  </Markdown>
</article>
```

- `prose` — base typographic styles (headings, lists, code blocks, tables, blockquotes)
- `dark:prose-invert` — dark mode support
- `max-w-none` — override the default `max-width` since GitDoc has its own layout with a comment sidebar
- Element modifiers like `prose-headings:underline` or `prose-a:text-blue-600` allow fine-tuning without custom CSS

### Layout Structure

The Google Docs-style layout maps to a two-column design:

```
┌─────────────────────────────────────────┐
│  Header (PR info, file selector)        │
├───────────────────────┬─────────────────┤
│  Rendered Markdown    │  Comment Margin  │
│  (prose content)      │  (Sidebar right) │
│  ~65% width           │  ~35% width      │
│                       │                  │
│  [data-source-*]      │  Comment threads │
│  elements with        │  anchored to     │
│  hover highlights     │  source lines    │
│                       │                  │
└───────────────────────┴─────────────────┘
```

shadcn/ui's `Sidebar` component (with `side="right"`) could work for the comment panel, but it's designed for app navigation (collapsible, responsive). A simpler approach may be a **fixed-width right column** using Tailwind's flexbox/grid utilities, with `ScrollArea` for overflow. The `Sidebar` component is worth evaluating but may be over-engineered for a static document margin.

### Alternatives Considered

- **Chakra UI**: Good DX with prop-based styling, but uses CSS-in-JS (Emotion) — runtime overhead, and RSC/App Router integration requires extra care. Less alignment with Tailwind ecosystem.
- **MUI (Material UI)**: Heavy, opinionated Material Design aesthetic, CSS-in-JS. Not a good fit for a minimal, document-centric UI.
- **Headless UI (Tailwind Labs)**: Fewer components than Radix/shadcn, less community momentum.
- **Radix UI directly (without shadcn)**: Unstyled — would require writing all styles from scratch. shadcn/ui gives us a head start with Tailwind-styled Radix components.

## Visual Indication of Commentable vs Non-Commentable Regions

Since GitHub PR review comments can only target lines that appear in the diff (~3 context lines around each change hunk), large portions of a rendered markdown document will be **non-commentable**. The UI must clearly communicate this distinction without disrupting the reading experience.

### Design Principles

1. **Reading first** — The rendered markdown is the primary content. Visual indicators should be subtle, not distracting. Unlike a code diff view, we're presenting a readable document, not a code review tool.
2. **Progressive disclosure** — Don't overwhelm the reader with commentability info upfront. Reveal it on interaction (hover, selection).
3. **No false affordances** — Don't show a comment anchor on text that can't actually receive a comment. This avoids confusing API rejections.

### Recommended Approach: Layered Indicators

#### Layer 1: Left-margin gutter markers (always visible, subtle)

Add a thin vertical accent bar in the left margin alongside commentable block elements. This is analogous to GitHub's green/red bars in the diff view, but much subtler:

```
  │  ## Introduction                    ← commentable (changed)
  │  This paragraph was modified in     ← commentable (changed)
  │  the PR and can receive comments.   ← commentable (changed)
     
     This paragraph is unchanged and    ← non-commentable
     has no visual marker.              ← non-commentable
     
  │  Updated conclusion text here.      ← commentable (changed)
```

**Implementation**: Use a CSS `border-left` or `::before` pseudo-element on block elements whose `data-source-start`/`data-source-end` range includes at least one commentable line. Apply via a `data-commentable` attribute set during rendering:

```tsx
// After building the commentableLines set from the diff:
// In a rehype plugin or post-render pass, mark elements:
if (hasCommentableLineInRange(sourceStart, sourceEnd, commentableLines)) {
  node.properties['dataCommentable'] = true;
}
```

```css
[data-commentable="true"] {
  border-left: 3px solid var(--accent-color); /* e.g., blue-400 */
  padding-left: 0.75rem;
}
```

The color should be the app's primary accent (e.g., a soft blue), not a diff green — we're not showing a diff, we're showing a document with commentable regions.

#### Layer 2: Hover highlight on commentable elements (interactive)

When the user hovers over a commentable block element, apply a subtle background highlight to reinforce that this passage can receive a comment. Non-commentable elements get no hover effect — the absence of the highlight communicates non-interactivity.

```css
[data-commentable="true"]:hover {
  background-color: var(--commentable-hover-bg); /* e.g., blue-50/10% opacity */
  cursor: text; /* normal text selection cursor */
}
```

Non-commentable regions retain the default cursor and have no hover effect, making the distinction feel natural without needing an explicit "you can't comment here" indicator.

#### Layer 3: Selection-time feedback (on text selection)

This is the critical moment. When the user selects text:

- **All lines commentable**: Show the comment anchor button in the right margin (Google Docs style). Normal flow.
- **Some lines commentable**: Show the comment anchor, but with a visual hint that the comment will be snapped to the nearest commentable lines. A subtle tooltip: "Comment will cover lines X–Y" (the snapped range).
- **No lines commentable**: Do NOT show the comment anchor. Instead, show a brief, dismissible tooltip near the selection: "This passage wasn't changed in this PR — comments can only be placed on changed content." Use a Sonner toast or inline tooltip (not a modal).

#### Layer 4: Comment-count badge in gutter (for existing comments)

For passages that already have comments, show a small badge/count in the right margin column (alongside the comment threads). This serves double duty: it indicates the region is commentable AND has existing discussion.

### Alternatives Considered

**Option A — Full background tinting**: Apply a light background color (e.g., pale green or blue) to all commentable regions. This is more visually prominent but risks making the document look like a diff. It would work well for short documents with many changes, but becomes noisy for long documents with sparse edits. **Rejected as default** — too visually heavy for a reading-focused tool. Could be offered as a toggle (e.g., "Show changed regions").

**Option B — No proactive indicators, feedback only on selection**: Don't show any visual distinction until the user tries to comment. Simpler UI, but leads to frustrating "trial-and-error" — the user selects text, gets told they can't comment, has to guess where they can. **Rejected** — poor discoverability.

**Option C — Dim/fade non-commentable regions**: Reduce opacity on non-commentable text (e.g., `opacity: 0.6`). This strongly emphasizes changed regions but makes the document harder to read. **Rejected** — conflicts with "reading first" principle; the whole point of GitDoc is to provide a good reading experience.

**Option D — Toggle between "reading mode" and "review mode"**: In reading mode, no indicators. In review mode, show full commentable-region highlighting. **Worth considering as a future enhancement** — would let users switch between focused reading and active reviewing. Not needed for MVP.

### Implementation Notes

- The `data-commentable` attribute should be computed during rendering by cross-referencing each element's `data-source-start`/`data-source-end` range with the `commentableLines: Set<number>` from the diff parser.
- An element is commentable if **any** line in its `[sourceStart, sourceEnd]` range is in the `commentableLines` set. This is because the GitHub API comment will be anchored to a specific commentable line within that range.
- For the gutter bar, use `border-left` on the element itself rather than a separate gutter column — this keeps the layout simpler and works with the existing `prose` typography styling.
- Accessibility: the gutter bar provides a visual cue but isn't the only indicator. The hover and selection-time feedback provide additional signals. For screen readers, announce "commentable region" via `aria-label` on commentable block elements.

## Authentication Model & Comment Attribution

### How Comments Are Attributed to the User

**Key finding**: Both OAuth App tokens and GitHub App user-access tokens result in API actions being attributed to the authenticated user. When GitDoc creates a PR review comment using either token type, the comment's `user` field is the authenticated GitHub user — their avatar, login, and profile link appear on the comment in the GitHub UI. There is no risk of comments appearing as a bot or service account.

- **OAuth App token**: Comments appear exactly as if the user posted them directly on GitHub. No visual badge or indication that an app was involved.
- **GitHub App user-access token**: Comments appear as the user, but with a small **app identicon badge** overlaid on the user's avatar in the GitHub UI. The GitHub docs state: *"the GitHub UI will show the user's avatar photo along with the app's identicon badge as the author."* The comment is still attributed to the user in all other respects (audit logs list the user as the actor).
- **GitHub App installation token** (NOT recommended): Comments would appear as the app bot (`my-app[bot]`), not the user. This defeats the PRD goal of "native GitHub comments" attributed to the reviewer.

### Option A: GitHub OAuth App (Recommended for MVP)

**Flow**: Standard OAuth 2.0 authorization code grant.
1. User clicks "Sign in with GitHub" → redirected to `https://github.com/login/oauth/authorize?client_id=...&scope=repo&state=...`
2. User authorizes → GitHub redirects back with a `code`
3. Backend exchanges `code` for an access token via `POST https://github.com/login/oauth/access_token`
4. Token is stored in a secure, HTTP-only, SameSite cookie

**Required scope**: `repo` — grants read/write access to repositories, including PR contents and review comments. This is broad (also covers commit statuses, invitations, webhooks), but OAuth Apps don't have finer-grained alternatives. For public-only repos, `public_repo` would suffice, but `repo` is needed for private repos.

**Token lifetime**: OAuth App tokens **do not expire** by default. They persist until the user revokes access or the app owner resets the client secret. No refresh token mechanism needed.

**Pros**:
- Simpler setup (register at github.com/settings/applications/new, get client ID + secret)
- No token expiry handling — less backend complexity
- Comments appear as the user with no app badge

**Cons**:
- `repo` scope is overly broad — grants full repo access (read/write code, not just PRs)
- Long-lived tokens — if compromised, they remain valid until manually revoked
- GitHub officially recommends GitHub Apps over OAuth Apps for new projects

### Option B: GitHub App with User-Access Tokens

**Flow**: Similar OAuth web flow but through a GitHub App registration.
1. User clicks "Sign in with GitHub" → redirected to `https://github.com/login/oauth/authorize?client_id=<app_client_id>&state=...`
2. User authorizes → GitHub redirects back with a `code`
3. Backend exchanges `code` for a user-access token (starts with `ghu_`) via `POST https://github.com/login/oauth/access_token`
4. Token + refresh token stored server-side (HTTP-only cookie for the access token)

**Required permissions** (fine-grained, set in app registration):
- `pull_requests: write` — create/read PR review comments
- `contents: read` — fetch file content from the PR branch

**Token lifetime**: User-access tokens expire after **8 hours** (`expires_in: 28800`). A refresh token (starts with `ghr_`) is provided, valid for **6 months** (`refresh_token_expires_in: 15897600`). The backend must handle token refresh transparently.

**Token refresh flow**:
```
POST https://github.com/login/oauth/access_token
  grant_type=refresh_token
  client_id=<app_client_id>
  client_secret=<app_client_secret>
  refresh_token=<ghr_...>
```

**Pros**:
- Fine-grained permissions — only request exactly what's needed (PR write + contents read)
- Short-lived tokens — reduced blast radius if compromised
- GitHub's recommended approach for new apps
- App can be installed per-org, giving org admins control over which repos the app can access

**Cons**:
- Requires token refresh logic (8-hour expiry)
- Small identicon badge appears on comments (minor visual difference)
- More complex setup (register GitHub App, configure permissions, handle installation flow)
- Token access is intersection of app permissions AND user permissions AND installed repos — more conditions to debug

### Recommendation

**Start with OAuth App** for MVP — simpler to implement, no token refresh logic, and comments look identical to native GitHub comments. The broad `repo` scope is a tradeoff, but acceptable for an MVP where users explicitly opt in.

**Migrate to GitHub App** post-MVP — when the app has more users and security matters more. The fine-grained permissions (`pull_requests: write` + `contents: read`) are significantly better than `repo`. The 8-hour token expiry adds complexity but is a security win.

### Implementation: Next.js Auth Flow

The OAuth flow maps cleanly to Next.js API routes:

1. **`GET /api/auth/login`** — Generates `state`, stores it in a cookie, redirects to GitHub authorize URL
2. **`GET /api/auth/callback`** — Receives `code` + `state`, validates state, exchanges code for token, stores token in encrypted HTTP-only cookie, redirects to app
3. **`GET /api/auth/logout`** — Clears the auth cookie
4. **`GET /api/auth/me`** — Returns the current user's GitHub profile (calls `GET /user` with the stored token)

**Cookie security**:
- `HttpOnly` — not accessible to client JavaScript
- `Secure` — only sent over HTTPS
- `SameSite=Lax` — prevents CSRF while allowing navigation-initiated requests
- Encrypted with a server-side secret (e.g., using `iron-session` or `next-auth`)

**Library options evaluated**: See detailed evaluation below.

### Auth Library Evaluation: Auth.js vs iron-session vs Better Auth

GitDoc's auth needs are narrow: GitHub OAuth login, store the user's access token for GitHub API proxying, and encrypt it in an HTTP-only cookie. There's no database, no multi-provider auth, no roles system. The three main options are:

#### Option 1: `iron-session` (Manual OAuth + Encrypted Cookies) — **Recommended**

`iron-session` (~4.1K GitHub stars, MIT, actively maintained) is a minimal library that encrypts/decrypts session data into a stateless, tamper-proof cookie using `@hapi/iron` (AES-256-CBC + HMAC-SHA-256). It does NOT handle the OAuth flow itself — you implement the 3-step GitHub OAuth exchange manually in Next.js API routes/Server Actions.

**What you write**:
- `GET /api/auth/login` — redirect to GitHub authorize URL with `state` param
- `GET /api/auth/callback` — exchange `code` for token, store in `iron-session` cookie
- `GET /api/auth/logout` — `session.destroy()`
- A `getSession()` helper using `getIronSession<SessionData>(cookies(), sessionOptions)`

**Pros**:
- **Minimal abstraction** — ~3 API routes, ~50 lines of auth code. No magic, easy to debug.
- **Full control over the GitHub token** — the access token is stored directly in the encrypted cookie and is available in every API route for proxying GitHub API calls. No callback indirection needed.
- **Zero database required** — purely stateless, aligns with GitDoc's "no database" architecture.
- **Tiny bundle** — `iron-session` is ~5KB, no transitive dependencies on database adapters or provider configs.
- **App Router native** — v8+ supports `cookies()` from `next/headers`, Server Actions, and Route Handlers.
- **Edge Runtime compatible** — provides `iron-session/edge` exports using Web Crypto API.

**Cons**:
- **Manual CSRF/state validation** — you must generate and verify the `state` parameter yourself (straightforward: `crypto.randomUUID()` stored in a short-lived cookie).
- **No built-in session rotation** — you manage cookie expiry via the `ttl` option.
- **Single provider only** — if we ever add Google login etc., each provider's OAuth flow is separate code. Fine for GitDoc (GitHub-only).

**Implementation sketch**:
```ts
// lib/session.ts
import { getIronSession } from 'iron-session';
import { cookies } from 'next/headers';

interface SessionData {
  githubToken?: string;
  githubLogin?: string;
  avatarUrl?: string;
}

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), {
    password: process.env.SESSION_SECRET!,
    cookieName: 'gitdoc_session',
    ttl: 60 * 60 * 24 * 30, // 30 days
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    },
  });
}
```

#### Option 2: Auth.js (next-auth v5) — **Not Recommended for GitDoc**

Auth.js v5 is the canonical Next.js auth library with a built-in GitHub provider, JWT session strategy, App Router support via `auth()` helper, and Edge compatibility.

**However**, Auth.js joined Better Auth in September 2025 and is now in **maintenance mode** — receiving only security patches and critical fixes. The v5 release has been in `@beta` for over 2 years with no stable release. The Auth.js team recommends Better Auth for new projects.

**Why it's not ideal for GitDoc**:
- **Overkill** — Auth.js is designed for multi-provider, multi-adapter authentication. GitDoc needs exactly one OAuth flow with one provider and no database. Auth.js's abstraction layers (providers, adapters, callbacks, session strategies) add complexity we don't need.
- **Token access is indirect** — Auth.js manages the session internally. To access the raw GitHub OAuth access token for API proxying, you must hook into the `jwt` callback to persist `account.access_token` into the token, then the `session` callback to expose it. This is well-documented but adds indirection.
- **In maintenance mode** — Auth.js is maintained by the Better Auth team for security patches only. No new features, no v5 stable release expected. Building on a library entering its sunset phase is a risk.
- **Community frustration** — significant community criticism of v5 documentation quality, long beta period, and breaking changes between beta versions.
- **Bundle size** — larger dependency tree than `iron-session` (pulls in `@auth/core`, provider configs, etc.).

**When it WOULD be appropriate**: If GitDoc needed multiple OAuth providers, database-backed sessions, or role-based access control.

#### Option 3: Better Auth — **Interesting but Over-Engineered for GitDoc**

Better Auth (26K+ GitHub stars, MIT) is the successor to Auth.js — more comprehensive, actively maintained, with a plugin system, stateless session support (no database), and a `getAccessToken()` API for retrieving provider tokens.

**Pros**: Stateless sessions without database (new feature), `getAccessToken({ providerId: 'github' })` API for retrieving the stored OAuth token, active development and community.

**Cons**: **Requires a database by default** — stateless mode was added recently and is less battle-tested. The library is designed for comprehensive auth (2FA, multi-tenant, organizations) — vastly more than GitDoc needs. Larger dependency footprint. Had a CVE-2025-61928 (9.3 severity) in late 2025 related to API key creation.

**When it WOULD be appropriate**: A larger application with multiple auth methods, team management, or plugin-based extensibility needs.

#### Decision: `iron-session` with Manual GitHub OAuth

For GitDoc's narrow requirements (single GitHub OAuth provider, no database, stateless sessions, direct access to the GitHub token for API proxying), **`iron-session` is the right choice**. The ~50 lines of manual OAuth code are trivial compared to the abstraction tax of Auth.js or Better Auth. The GitHub OAuth flow is one of the simplest OAuth implementations possible (3 HTTP exchanges, no OIDC complexity, no token refresh for OAuth Apps).

The implementation maps directly to the API route structure already designed:
1. `GET /api/auth/login` → redirect to GitHub
2. `GET /api/auth/callback` → exchange code, store token in `iron-session`
3. `GET /api/auth/logout` → `session.destroy()`
4. `GET /api/auth/me` → return `session.githubLogin` etc.

If we later migrate to GitHub App (with 8-hour token expiry), token refresh is a simple addition to the `getSession()` helper — check expiry, call refresh endpoint, update the cookie. This is actually *easier* to implement manually than through Auth.js/Better Auth's callback chain.

## Deployment & Hosting

### Recommendation: Vercel (Primary) with Docker Self-Host as Fallback

**Vercel** is the natural deployment target for GitDoc:

- **Next.js native**: Vercel is built by the Next.js team — zero-config deployments, automatic optimization of App Router, Server Components, and API routes. No other platform matches this integration depth.
- **Edge/Serverless fit**: GitDoc is stateless (no database) — all state lives in GitHub. This maps perfectly to Vercel's serverless model. API routes that proxy GitHub calls run as serverless functions with automatic scaling.
- **Preview deployments**: Every PR gets a preview URL automatically — ideal for a tool that's itself about PR review workflows.
- **OAuth cookie handling**: Vercel supports secure HTTP-only cookies, environment variables for OAuth secrets (`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `SESSION_SECRET`), and custom domains with free TLS.
- **Image proxy**: The API route that proxies private repo images (discussed in the image resolution section) runs as a serverless function — no separate image service needed.

**Cost**: For a small-to-medium internal tool, Vercel's free tier (Hobby) or Pro plan ($20/month per member) is sufficient. Usage-based pricing only becomes a concern at high traffic volumes.

### Why Not Internal Block Infrastructure?

The PRD doesn't specify internal deployment, and GitDoc has no Block-specific dependencies — it's a general-purpose GitHub tool. Deploying on Vercel keeps the app portable and avoids coupling to internal infrastructure. If internal deployment becomes a requirement later (e.g., for compliance or private network access), the fallback is:

- **Docker self-hosted**: Next.js supports `output: 'standalone'` in `next.config.js`, producing a minimal Node.js server in a Docker container. This can run on any container platform (AWS ECS/Fargate, GCP Cloud Run, Kubernetes, etc.).
- **OpenNext on AWS**: For AWS-native deployment with serverless benefits, OpenNext bundles Next.js for Lambda + CloudFront. More operational overhead than Vercel but avoids vendor lock-in.

### Environment Configuration

Required environment variables:
- `GITHUB_CLIENT_ID` — OAuth App client ID
- `GITHUB_CLIENT_SECRET` — OAuth App client secret
- `SESSION_SECRET` — Encryption key for `iron-session` HTTP-only auth cookies (32+ character secret)
- `NEXT_PUBLIC_APP_URL` — Canonical app URL (for OAuth callback redirect)

All secrets stored via Vercel's encrypted environment variables (or equivalent secrets management on other platforms).

### Edge Runtime Considerations

Some API routes (e.g., the GitHub API proxy) could run on Edge Runtime for lower latency. `iron-session` provides Edge-compatible exports via `iron-session/edge` using the Web Crypto API, so Edge Runtime is viable for auth-related routes. **Recommendation**: Start with Node.js runtime for all API routes; evaluate Edge for read-only routes (PR list, file content) once the app is stable.

## Caching Strategy

### Rate Limit Context

GitHub REST API allows **5,000 requests per hour** per authenticated user (OAuth or GitHub App user-access token). For a single reviewer session, the main API calls are:

1. **List PR files** (`GET /pulls/{n}/files`) — 1 request per PR load
2. **Fetch file content** (`GET /contents/{path}?ref={sha}`) — 1 request per markdown file
3. **List review comments** (`GET /pulls/{n}/comments`) — 1 request per PR load
4. **Create comment / reply** (`POST /pulls/{n}/comments`) — 1 per comment (not cacheable)

A typical session (open PR, view 3–5 markdown files, post a few comments) uses ~10–20 requests. 5,000/hour is generous for a single user. The risk is:
- **Multiple users sharing the same OAuth app**: Each user has their own 5,000 budget — no shared pool for OAuth/GitHub App user tokens.
- **Burst scenarios**: If a PR has many changed files or the user navigates rapidly, the request count can spike.
- **Redundant fetches**: Navigating back to a previously viewed file, or re-rendering the same PR page, should NOT re-fetch immutable data.

### Cacheability Analysis: What Can Be Cached

| Data | Cacheable? | Cache Key | TTL / Invalidation |
|------|------------|-----------|-------------------|
| File content (`GET /contents/{path}?ref={sha}`) | **Yes — immutable** | `{owner}/{repo}/{sha}/{path}` | Indefinite (content at a SHA never changes) |
| PR file list with patches (`GET /pulls/{n}/files`) | **Partially** | `{owner}/{repo}/pulls/{n}/files` | Short-lived — changes when new commits are pushed to the PR. Cache until head SHA changes. |
| Review comments (`GET /pulls/{n}/comments`) | **No** for long-term | `{owner}/{repo}/pulls/{n}/comments` | Very short TTL or no cache — comments can be added at any time by any user. Use conditional requests (ETags). |
| PR list (`GET /pulls?state=open`) | **No** for long-term | n/a | Changes frequently — new PRs, status updates. Short TTL (30–60s) or no cache. |
| Diff/patch data | **Yes** (per head SHA) | `{owner}/{repo}/pulls/{n}/files/{sha}` | Tied to the PR's head SHA — cache as long as head SHA hasn't changed. |

**Key insight**: File content fetched at a specific commit SHA is **immutable** — the same SHA always returns the same content. This is the highest-value cache target. The diff/patch is also stable as long as the PR's head SHA hasn't changed.

### Recommended Approach: Layered Caching

#### Layer 1: GitHub Conditional Requests (ETags)

GitHub returns `ETag` and `Last-Modified` headers on most responses. Subsequent requests with `If-None-Match: "<etag>"` or `If-Modified-Since: "<date>"` return **304 Not Modified** if nothing changed — and **304s do NOT count against the primary rate limit** (when the request includes a valid `Authorization` header).

This is the most impactful rate-limit optimization and should be applied to ALL GitHub API calls:

```ts
// Pseudocode for ETag-aware fetching
async function fetchWithETag(url: string, token: string, cache: Map<string, CacheEntry>) {
  const cached = cache.get(url);
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
  };
  if (cached?.etag) {
    headers['If-None-Match'] = cached.etag;
  }

  const res = await fetch(url, { headers });

  if (res.status === 304 && cached) {
    return cached.data; // Not modified — use cached data (free request!)
  }

  const data = await res.json();
  const etag = res.headers.get('etag');
  cache.set(url, { data, etag, timestamp: Date.now() });
  return data;
}
```

**Where to store the ETag cache**: In-memory on the Next.js server (e.g., a `Map` or `lru-cache`). This works for single-instance deployments (Vercel serverless has per-function memory, but functions may be recycled). For persistence across cold starts, consider:
- **Vercel KV** (Redis-compatible): If deployed on Vercel, this gives persistent key-value storage with sub-millisecond latency.
- **Simple in-memory `Map`**: Acceptable for MVP — cache lives as long as the serverless function instance is warm.

#### Layer 2: SHA-Keyed Content Cache (Immutable Data)

File content at a specific SHA never changes. Cache it aggressively:

```ts
// Cache key: `content:${owner}/${repo}/${sha}/${path}`
// TTL: indefinite (or very long, e.g., 7 days, to avoid unbounded memory growth)
```

This means if a user navigates to a file, goes back to the PR file list, then returns to the same file — no GitHub API call is needed. The same applies to the parsed diff: cache the `patch` field (and the parsed `commentableLines` set) keyed by the PR's head SHA.

```ts
// Cache key: `diff:${owner}/${repo}/${pull_number}/${headSha}`
// Value: Map<filePath, { patch: string, commentableLines: Set<number> }>
// TTL: indefinite per SHA (or until evicted by LRU)
```

#### Layer 3: Short-TTL Cache for Dynamic Data

For PR lists and review comments, use a short time-to-live to avoid stale data:

- **PR list**: Cache for 30–60 seconds. Users don't need real-time PR list updates.
- **Review comments**: Cache for 10–15 seconds, or use ETags exclusively (conditional requests are free). After the user posts a comment, optimistically add it to the local state and invalidate the cache for that PR's comments.

#### Layer 4: Client-Side SWR (Stale-While-Revalidate)

On the frontend, use **SWR** or **TanStack Query** (React Query) for data fetching from our Next.js API routes. These libraries provide:
- **Deduplication**: Multiple components requesting the same data share a single fetch.
- **Stale-while-revalidate**: Show cached data immediately, re-fetch in the background.
- **Focus revalidation**: Re-fetch when the user returns to the tab (catches new comments).
- **Optimistic updates**: When posting a comment, immediately show it in the UI before the API call completes.

```tsx
// Example with SWR
const { data: comments, mutate } = useSWR(
  `/api/repos/${owner}/${repo}/pulls/${prNumber}/comments`,
  fetcher,
  { refreshInterval: 30_000 } // poll every 30s for new comments
);

// After posting a comment:
await postComment(body);
mutate(); // revalidate the comments cache
```

### Implementation: Server-Side Cache in Next.js API Routes

The caching layer lives in the Next.js API routes (which proxy all GitHub API calls). A simple `lru-cache` (npm package, ~3KB, widely used) provides bounded in-memory caching:

```ts
import { LRUCache } from 'lru-cache';

const cache = new LRUCache<string, CacheEntry>({
  max: 500,           // max 500 entries
  maxSize: 50_000_000, // max ~50MB total
  sizeCalculation: (value) => JSON.stringify(value.data).length,
  ttl: 1000 * 60 * 60, // default 1-hour TTL (overridden per-entry)
});

interface CacheEntry {
  data: unknown;
  etag?: string;
  timestamp: number;
}
```

**SHA-keyed entries** get no TTL (or very long TTL). **Dynamic entries** (PR list, comments) get short TTLs. The LRU eviction policy ensures memory stays bounded.

### Rate Limit Monitoring

Forward GitHub's rate-limit headers to the frontend so the UI can display a warning if the user is approaching their limit:

- `x-ratelimit-remaining`: Requests left in the current window
- `x-ratelimit-reset`: When the window resets (UTC epoch seconds)

If `x-ratelimit-remaining` drops below a threshold (e.g., 100), show a warning banner. If a `403` or `429` is received, show an error with the reset time and stop making requests until then.

### Serverless Considerations

On Vercel (serverless), each API route invocation may run in a fresh function instance with no in-memory state. This limits the effectiveness of in-memory caching:

- **Warm instances**: Vercel reuses function instances for a period — in-memory cache helps for rapid sequential requests.
- **Cold starts**: Cache is empty — every request hits GitHub. Acceptable for MVP; for optimization, consider Vercel KV or Upstash Redis for persistent caching across function invocations.
- **Per-user isolation**: Since each user has their own OAuth token, ETags are per-user. The ETag cache should be keyed by `{userId}:{url}` if serving multiple users from the same function instance.

**Recommendation**: Start with in-memory `lru-cache` + ETag conditional requests for MVP. The ETag approach alone dramatically reduces rate-limit consumption (304s are free). Add Redis/KV if rate limits become an issue with higher traffic.

## Handling Missing/Truncated Patch Fields (Large Diffs)

### The Problem

The `GET /repos/{owner}/{repo}/pulls/{pull_number}/files` endpoint returns a `patch` field on each file object containing the unified diff. However, GitHub imposes several diff limits that can cause this field to be **absent or the entire API call to fail**:

### GitHub Diff Limits (from official docs + observed behavior)

| Limit | Value | Effect |
|-------|-------|--------|
| **Max files in a single diff** | 300 | `GET /pulls/{n}` with `Accept: application/vnd.github.diff` returns `406` with `code: too_large`. The **List PR files** endpoint (`GET /pulls/{n}/files`) still works — it paginates up to 3000 files. |
| **Max total diff lines** | 20,000 lines | `GET /pulls/{n}` with diff media type returns `406`. |
| **Max total diff size** | 1 MB raw diff data | Same — `406` on the PR diff endpoint. |
| **Max single file diff size** | 500 KB raw diff data | The `patch` field on the individual file object in the **List PR files** response is **omitted** (set to `undefined`/absent). The file entry still appears with `filename`, `status`, `additions`, `deletions`, etc. — just no `patch`. |
| **Max single file diff lines** | 20,000 lines loadable | Same behavior — `patch` may be absent. |

**Key distinction**: The **List PR files** endpoint (`GET /pulls/{n}/files`) is more resilient than the **Get PR** endpoint (`GET /pulls/{n}` with diff Accept header). The files endpoint still returns file metadata even when individual patches are too large — it just omits the `patch` field on those files. The PR diff endpoint fails entirely with `406` for large PRs.

### When `patch` Is Absent: Specific Scenarios

1. **Very large file changes**: A single markdown file with 500KB+ of diff data (e.g., a complete rewrite of a long document). The file entry appears in the response but `patch` is `undefined`.
2. **Binary files**: Images, PDFs, etc. have no textual diff. `patch` is absent. (Not relevant for GitDoc since we only care about `.md`/`.mdx` files, but worth handling.)
3. **Renamed files with no content changes**: Files with `status: "renamed"` and no content modifications may have an empty or absent `patch`. The `previous_filename` field is present.
4. **File count exceeds 3000**: The API caps at 3000 files per PR. Files beyond this limit simply aren't returned. Extremely unlikely for markdown-focused PRs.

### Detection Strategy

```ts
interface PrFile {
  sha: string;
  filename: string;
  status: 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged';
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;  // ← absent when diff is too large
  // ...
}

function getCommentableLines(file: PrFile): { lines: Set<number>; readOnly: boolean; reason?: string } {
  // Binary or non-text files
  if (!file.patch && file.changes === 0 && file.status !== 'added') {
    return { lines: new Set(), readOnly: true, reason: 'binary-or-unchanged' };
  }

  // Patch truncated/absent for large diffs
  if (!file.patch && file.changes > 0) {
    return { lines: new Set(), readOnly: true, reason: 'diff-too-large' };
  }

  // New file with no patch (edge case — shouldn't happen for added files, but defensive)
  if (!file.patch && file.status === 'added') {
    // For newly added files, the entire file should be in the diff.
    // If patch is still absent, the file is too large for GitHub to diff.
    return { lines: new Set(), readOnly: true, reason: 'diff-too-large' };
  }

  // Normal case: parse the patch
  if (file.patch) {
    const parsed = parseDiff('--- a\n+++ b\n' + file.patch); // parse-diff needs file headers
    const commentableLines = new Set<number>();
    for (const chunk of parsed[0]?.chunks ?? []) {
      for (const change of chunk.changes) {
        if (change.type === 'add') commentableLines.add(change.ln);
        if (change.type === 'normal') commentableLines.add(change.ln2);
      }
    }
    return { lines: commentableLines, readOnly: false };
  }

  return { lines: new Set(), readOnly: true, reason: 'unknown' };
}
```

### UI Behavior in Read-Only Mode

When a markdown file's diff is too large and the `patch` field is absent:

1. **Render the markdown normally** — the file content is still fetchable via `GET /repos/{owner}/{repo}/contents/{path}?ref={headSha}`. The content endpoint has no diff-related limits.
2. **Hide all commenting affordances** — no gutter bars, no hover highlights, no comment anchors on text selection. The document is purely for reading.
3. **Show an info banner** at the top of the document:
   > "This file's changes are too large for inline commenting. You can read the rendered content below, but comments must be left directly on GitHub."
   Include a link to the file's diff view on GitHub: `https://github.com/{owner}/{repo}/pull/{pr_number}/files#diff-{sha}`.
4. **Existing comments still display** — the `GET /pulls/{n}/comments` endpoint returns ALL review comments regardless of diff size. Comments on this file can still be fetched and shown, but without precise line anchoring (since we don't have the diff-line mapping). Show them in a "file-level comments" section in the sidebar.

### Fallback: Using the Compare API for Per-File Diffs

As a potential enhancement (not MVP), the **Compare API** (`GET /repos/{owner}/{repo}/compare/{basehead}`) returns per-file patches and supports up to 300 files per response (paginated). However, it has the same per-file patch size limits — large individual file diffs will still have `patch` absent.

There is **no GitHub API endpoint that provides a larger or uncapped diff** for a single file. The `GET /pulls/{n}` endpoint with `Accept: application/vnd.github.diff` returns the full multi-file diff but is subject to the 20,000 line / 300 file / 1MB limits and returns `406` when exceeded.

### Recommendation

**For MVP**: Detect absent `patch` field, render the file read-only with an info banner and link to GitHub. This is the simplest and most robust approach. Large markdown file diffs are rare in practice — most documentation PRs involve moderate changes.

**Post-MVP enhancement**: If needed, fetch the PR's base and head versions of the file and compute a diff locally using a JavaScript diff library (e.g., `diff` npm package). This would recover commentable-line data for files with truncated patches. However, locally-computed diffs may not match GitHub's diff exactly (different context window, different diff algorithm), which could cause comment placement mismatches. This approach needs careful validation before adoption.

## Line-Level Commenting Within Fenced Code Blocks

### The Problem

Fenced code blocks (` ``` `) render as a single `<pre><code>...</code></pre>` structure. The `position` data from the mdast/hast pipeline spans the **entire block** — there are no per-line position objects. The code content is a single text node with embedded `\n` characters. This means our existing `data-source-start`/`data-source-end` attributes on the `<pre>` or `<code>` element cover the whole block as one unit, making it impossible for users to comment on individual lines within code blocks.

### Default Hast Structure

When `remark-rehype` transforms a fenced code block, the code handler produces:

```
{
  type: 'element',
  tagName: 'pre',
  position: { start: { line: 5 }, end: { line: 12 } },  // whole block
  children: [{
    type: 'element',
    tagName: 'code',
    properties: { className: ['language-js'] },
    children: [{
      type: 'text',
      value: "console.log('hello')\nreturn 42;\n"  // single text node
    }]
  }]
}
```

There is **no per-line granularity** in the default hast tree. The `position` only gives `start.line` and `end.line` for the entire code block.

### Solution: Line-Wrapping Rehype Plugin + Source-Line Annotation

The approach has two steps: (1) split the single text node into per-line wrapper elements, (2) annotate each line wrapper with the correct source line number.

#### Existing Libraries for Line Wrapping

Two mature options exist for splitting code blocks into per-line elements:

**Option A: `rehype-prism-plus`** (~780K weekly downloads, MIT, 199 stars)
- Wraps each line in a `<div class="code-line" line="N">` element
- Uses Prism (via refractor) for syntax highlighting
- Supports line highlighting (`{1,3-4}`), line numbers (`showLineNumbers`), and diff code blocks
- The `line` attribute is a 1-indexed count within the code block (NOT the source file line)

**Option B: `rehype-highlight-code-lines`** (14 stars, MIT, actively maintained)
- Wraps each line in a `<span class="code-line" data-line-number="N">` element
- Designed to work **after** `rehype-highlight` (uses lowlight/highlight.js instead of Prism)
- Uses `<span>` (inline) instead of `<div>` (block) — more semantically correct inside `<code>`
- Supports `showLineNumbers`, line highlighting, and custom start line numbering

**Recommendation**: Either works. `rehype-prism-plus` has far more adoption (780K vs minimal downloads). The choice depends on whether we prefer Prism or highlight.js for syntax highlighting. For GitDoc, syntax highlighting is a nice-to-have (markdown documentation code blocks often don't need it), so `rehype-highlight-code-lines` with `rehype-highlight` is the lighter option. However, `rehype-prism-plus` is battle-tested and more widely used.

#### Custom Rehype Plugin: `rehype-code-source-lines`

After the line-wrapping plugin runs, we need a second plugin to annotate each line wrapper with the **original markdown source line number** (not the 1-indexed line within the code block). This is what our `data-source-start` system uses for commenting:

```ts
import { visit } from 'unist-util-visit';
import type { Root, Element } from 'hast';

export function rehypeCodeSourceLines() {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'pre') return;

      const codeEl = node.children.find(
        (c): c is Element => c.type === 'element' && c.tagName === 'code'
      );
      if (!codeEl) return;

      // The pre element's position.start.line is the ``` opening fence line
      // The actual code content starts on the NEXT line
      const fenceStartLine = node.position?.start.line;
      if (!fenceStartLine) return;
      const codeStartLine = fenceStartLine + 1; // skip the ``` line

      let lineIndex = 0;
      visit(codeEl, 'element', (lineNode: Element) => {
        // Target line wrappers (from rehype-prism-plus or rehype-highlight-code-lines)
        const classes = Array.isArray(lineNode.properties?.className)
          ? lineNode.properties.className
          : [];
        if (classes.includes('code-line')) {
          lineNode.properties['dataSourceStart'] = codeStartLine + lineIndex;
          lineNode.properties['dataSourceEnd'] = codeStartLine + lineIndex;
          lineIndex++;
        }
      });
    });
  };
}
```

#### Pipeline Order

The plugin order is critical:

```
remark-parse           → parse markdown into mdast
remark-gfm             → add GFM support
remark-rehype          → transform mdast → hast (preserves position)
rehype-source-lines    → annotate ALL elements with data-source-start/end
rehype-highlight       → syntax-highlight code (adds token spans)
  — OR rehype-prism-plus
rehype-highlight-code-lines  → wrap each code line in a span/div
  — OR rehype-prism-plus (does both highlighting + wrapping)
rehype-code-source-lines  → add source line numbers to code line wrappers
```

#### Resulting DOM Structure

After the full pipeline, a fenced code block starting at source line 42:

```html
<pre data-source-start="42" data-source-end="47">
  <code class="hljs language-js">
    <span class="code-line" data-source-start="43" data-source-end="43">
      <span class="hljs-keyword">const</span> x = <span class="hljs-number">1</span>;
    </span>
    <span class="code-line" data-source-start="44" data-source-end="44">
      <span class="hljs-keyword">const</span> y = <span class="hljs-number">2</span>;
    </span>
    <span class="code-line" data-source-start="45" data-source-end="45">
      <span class="hljs-variable">console</span>.<span class="hljs-title">log</span>(x + y);
    </span>
  </code>
</pre>
```

Note: Line 42 is the ` ``` ` fence line, line 43 is the first code line, line 46 is the closing ` ``` ` fence. The `pre` element spans 42–47 (including fence lines), but only lines 43–45 are code content lines that get `data-source-start` attributes.

### Integration with Existing Comment System

With per-line `data-source-start` attributes on code line wrappers:

1. **Text selection within code blocks**: When a user selects text within a code block, `closest('[data-source-start]')` will find the nearest `<span class="code-line">` wrapper — giving us the specific source line, not the entire block.

2. **Multi-line selection**: If the user selects across multiple code lines, we get `startLine` from the first `code-line` span and `endLine` from the last — producing a multi-line comment (`start_line` + `line` in the GitHub API).

3. **Commentable-line check**: Works identically to prose elements — cross-reference the code line's `data-source-start` value against the `commentableLines: Set<number>` from the diff parser.

4. **Visual indicators**: The `data-commentable` attribute can be set on individual `code-line` spans, enabling per-line gutter markers within code blocks (rather than marking the entire block as commentable/non-commentable).

### Alternative: Custom Code Component Without a Plugin

Instead of a rehype plugin, use `react-markdown`'s `components` prop to override the `code` component and manually split lines:

```tsx
const components = {
  code: ({ node, children, className, ...props }) => {
    const isBlock = node?.position && /* check if parent is pre */;
    if (!isBlock) return <code className={className} {...props}>{children}</code>;

    const codeStartLine = (node?.position?.start?.line ?? 0) + 1;
    const lines = String(children).replace(/\n$/, '').split('\n');

    return (
      <code className={className} {...props}>
        {lines.map((line, i) => (
          <span
            key={i}
            className="code-line"
            data-source-start={codeStartLine + i}
            data-source-end={codeStartLine + i}
          >
            {line}
            {'\n'}
          </span>
        ))}
      </code>
    );
  },
};
```

**Trade-off**: This approach is simpler (no external plugin dependency) but loses syntax highlighting — the `children` are already rendered React elements from the highlighting plugin, not raw text. Splitting rendered children by newlines is fragile since syntax tokens may span multiple lines.

**Recommendation**: Use the rehype plugin approach. It integrates cleanly with syntax highlighting plugins and the existing `data-source-start` system. The custom component approach is viable as a fallback for projects that don't want syntax highlighting.

### Edge Cases

- **Empty lines within code blocks**: The line-wrapping plugins create empty `<span class="code-line">` elements for blank lines. These still get `data-source-start` attributes and are commentable if in the diff.
- **Trailing newline**: The `remark-rehype` code handler appends a trailing `\n` to all code blocks. Line-wrapping plugins handle this — `rehype-highlight-code-lines` strips the trailing blank line by default (`keepOuterBlankLine: false`).
- **Code blocks without a language**: Both plugins handle language-less code blocks. `rehype-prism-plus` has `ignoreMissing: true` option; `rehype-highlight-code-lines` works without a highlighter entirely.
- **Inline code** (`` `code` ``): Not affected — inline code renders as bare `<code>` without a `<pre>` parent. The plugin targets `pre > code` only.
- **Code block fence lines**: The opening ` ```js ` and closing ` ``` ` lines ARE source lines but are NOT code content. They should NOT get `data-source-start` attributes on code-line wrappers. However, the `<pre>` element's position includes them. Our plugin correctly skips them by starting `codeStartLine = fenceStartLine + 1`.

## Touch Device Support for Select-to-Comment

### The Challenge

On mobile/touch devices, text selection works fundamentally differently from desktop:

1. **Selection trigger**: Users long-press to start a selection, then drag selection handles to adjust — there's no mousedown/mouseup cycle.
2. **Native selection toolbar**: Mobile browsers (iOS Safari, Android Chrome) display their own system-level callout bar above/below the selection with actions like "Copy", "Select All", "Look Up", etc. This toolbar competes for visual space with any custom comment anchor UI.
3. **No hover**: Touch devices have no hover state, so the Layer 2 hover highlight (from the commentable regions design) doesn't apply.

### How `selectionchange` Unifies Touch and Mouse Selection

**Key finding**: The existing `useSelectionObserver` hook (designed in the Text Selection UX section) already handles touch selection correctly. The `selectionchange` event fires universally for ALL selection methods, including:

- **Long-press text selection** on iOS Safari and Android Chrome
- **Dragging selection handles** on touch devices (fires `selectionchange` on each handle movement)
- **Keyboard selection** via external Bluetooth keyboards on mobile

The `selectionchange` event is the **only reliable event** for detecting text selection on mobile — `touchend` does NOT fire when the browser enters text selection mode (confirmed on Android Chrome). The `contextmenu` event fires on long-press on Android Chrome and iOS Safari, but it fires at the start of selection, before the user has finished adjusting handles — not useful for determining the final selection.

**No explicit `touchend`/`touchstart` listeners are needed**. The mouse-state tracking (`isMouseDown` flag) in our `useSelectionObserver` naturally doesn't interfere with touch — `mousedown`/`mouseup` don't fire during touch selection, so the `isMouseDown` flag stays `false`, and `selectionchange` events are handled with the 100ms debounce (same as keyboard). This longer debounce works well for touch because users continuously adjust selection handles, firing many intermediate `selectionchange` events.

### Reference: Hypothesis Client's Approach

The Hypothesis annotation client (the most widely-used open-source web annotation tool) confirms this approach. Their `SelectionObserver` ([`src/annotator/selection-observer.ts`](https://github.com/hypothesis/client/blob/main/src/annotator/selection-observer.ts)):

- **No explicit touch event listeners** — only `selectionchange`, `mousedown`, and `mouseup`.
- Uses the same mouse-state tracking + debounce strategy: 10ms delay after `mouseup`, 100ms debounce for all other `selectionchange` events (including touch handle adjustments).
- Touch selection flows through the exact same code path as keyboard selection.

### Positioning: Avoiding the Native Selection Toolbar

The main UX challenge on touch devices is where to place the custom comment anchor button relative to the native selection toolbar.

**Native toolbar behavior**:
- **iOS Safari**: Callout bar appears **above** the selection by default. If there's not enough room above, it flips below.
- **Android Chrome**: Context menu typically appears **above** the selection. Some manufacturers (Samsung) customize this.
- Both toolbars show actions like Copy, Select All, Share, Look Up.

**Recommended approach** (validated by Hypothesis):

1. **Always position the comment anchor BELOW the selection on touch devices**. The native toolbar almost always renders above, so placing below avoids overlap. Use `Range.getBoundingClientRect()` and position the anchor at `rect.bottom + offset`.

2. **Add extra vertical clearance on touch devices** (10–15px beyond the normal margin). Touch selection handles extend below the selection text, and some browsers add extra padding. Example:

```ts
const touchOffset = isTouchDevice() ? 15 : 0;
const anchorPosition = {
  x: rect.right + MARGIN,
  y: rect.bottom + window.scrollY + touchOffset,
};
```

3. **Detect touch devices via CSS media query**, not user-agent sniffing:

```ts
function isTouchDevice(): boolean {
  return window.matchMedia('(pointer: coarse)').matches;
}
```

`(pointer: coarse)` detects devices whose primary pointing device has limited accuracy (fingers on touchscreens), while `(pointer: fine)` matches precise devices (mouse, trackpad). This is more reliable than checking `'ontouchstart' in window` (which is true on many modern laptops with touchscreens but where the user is using a mouse).

4. **For the Google Docs-style right margin comment panel** (our primary layout): On touch devices, the margin comment panel works well because it doesn't compete with the native toolbar at all — it's in a separate column. The issue is only with the initial "Add comment" anchor/button that appears near the selection. On touch, this anchor should appear in the right margin column (aligned vertically with the selection) rather than floating near the selection text, completely avoiding the native toolbar conflict.

### No-Hover Adaptation

Since touch devices lack hover, the Layer 2 hover highlight (background color on `[data-commentable]:hover`) won't appear. This is acceptable because:

- **Layer 1** (left-margin gutter bars) provides always-visible indication of commentable regions — no hover needed.
- **Layer 3** (selection-time feedback) still works — the user selects text and gets immediate feedback about whether it's commentable.
- **Active state**: Replace `hover` with `active` for touch — `[data-commentable]:active` fires during long-press, giving a brief visual flash before the browser enters selection mode. However, this is unreliable (the active state duration varies by browser). Better to rely on Layers 1 and 3 only on touch devices.

### MVP Recommendation: Desktop-First

**For MVP, prioritize desktop browsers and treat mobile as read-only or degraded commenting**. Rationale:

1. **GitDoc's primary use case is PR review** — an inherently desktop-centric workflow. Reviewers typically use laptops/desktops for code review.
2. **The Google Docs-style margin layout** requires significant horizontal space. On mobile viewports (<768px), the two-column layout (content + comment margin) needs a responsive redesign — likely a bottom sheet or full-screen comment overlay.
3. **Touch-based select-to-comment works** (via `selectionchange`) but the UX is frictional: long-press to select → adjust handles → find and tap comment anchor → type comment on virtual keyboard. This is inherently slower than desktop mouse selection.

**MVP mobile strategy**:
- Render the markdown beautifully (responsive typography via `prose` classes)
- Display existing comments (collapsed in a bottom sheet or inline)
- Allow replying to existing comments (simple textarea, no selection needed)
- Defer select-to-comment on mobile to post-MVP

**Post-MVP mobile enhancements** (if needed):
- Bottom sheet comment panel that slides up from the bottom on mobile
- Touch-optimized comment anchor in the right margin
- Responsive breakpoint that switches from side-by-side to stacked layout

### Edge Cases

- **Tablet devices with stylus** (iPad + Apple Pencil, Samsung S Pen): These have `(pointer: fine)` when the stylus is active but `(pointer: coarse)` for touch. `(any-pointer: fine)` can detect stylus capability. For MVP, treat tablets the same as touch devices.
- **Hybrid devices** (Surface Pro, iPad with keyboard): May have both `(pointer: fine)` and `(any-pointer: coarse)`. Use `(pointer: coarse)` as the primary check — it matches the *primary* input device.
- **Selection cleared by focus shift**: On mobile, when the user taps the comment input (textarea), focus shifts and some browsers clear the text selection. The selection range must be saved BEFORE showing the comment input. Our `useSelectionObserver` already captures the range — store it in state before rendering the comment form.
- **iOS Safari selection quirks**: iOS sometimes fires `selectionchange` with a collapsed selection immediately after a non-collapsed one (when the callout bar appears). The 100ms debounce handles this — the final `selectionchange` with the actual selection replaces the transient collapsed one.
- **Android Chrome `contextmenu`**: On Android, `contextmenu` fires on long-press (before selection is complete). Don't use `contextmenu` for selection detection — stick with `selectionchange`.

## SAML SSO Handling

### Context

The original design flagged a concern: if an organization enforces SAML SSO, GitHub App user-access tokens might fail when accessing org resources unless the user has an active SAML session. This could result in `403 Forbidden` errors that are confusing for users.

### Key Finding: App Tokens Are Automatically Authorized for SAML SSO

From GitHub's official documentation on REST API authentication:

> **"Access tokens created by apps are automatically authorized for SAML SSO."**

This applies to **both** OAuth App tokens and GitHub App user-access tokens. When a user authorizes an OAuth App or GitHub App, the resulting token is automatically granted access to SAML-protected organizations — no separate SSO authorization step is required.

This is in contrast to **Personal Access Tokens (classic)**, which require the user to manually authorize each token for each SAML-protected organization at `https://github.com/settings/tokens` → "Configure SSO".

### Impact on GitDoc

**For MVP (OAuth App)**: SAML SSO is a **non-issue**. The OAuth App token obtained through the standard authorization code flow is automatically authorized for SAML SSO. No additional detection, handling, or user guidance is needed.

**For post-MVP (GitHub App)**: User-access tokens from GitHub Apps are also automatically SAML-authorized. However, there is a nuance documented on GitHub's "SAML and GitHub Apps" page:

- When a user authorizes a GitHub App, a **credential authorization is created for each organization that the user has an active SSO session for** at the time of authorization.
- If the user does NOT have an active SSO session for a particular organization when they authorize the app, the app won't be able to access that org's resources.
- The fix is: start an SSO session first (visit `https://github.com/orgs/ORG-NAME/sso`), then revoke and re-authorize the GitHub App.

This is primarily an issue at **initial authorization time**, not during ongoing use. Once the credential authorization is established for an org, it persists across sessions.

### Detection and Recovery (Post-MVP GitHub App Only)

If a `403 Forbidden` is received when accessing org resources with a GitHub App user-access token, check for the `X-GitHub-SSO` response header:

**Header format** (two variants):
1. **Single org access**: `X-GitHub-SSO: required; url=https://github.com/orgs/ORG/sso?...` — contains a direct URL for the user to start their SAML session. The URL expires after 1 hour.
2. **Multi-org listing**: `X-GitHub-SSO: partial-results; organizations=21955855,20582480` — indicates some org results were omitted because the token isn't authorized for those SAML-protected orgs.

**Recovery flow for GitDoc**:
1. Detect `403` + `X-GitHub-SSO` header presence on any GitHub API proxy response.
2. Parse the header to extract the SSO URL or org IDs.
3. Show a user-facing message: *"Your organization requires SAML single sign-on. Please [start an SSO session](url) for your organization, then sign out and back into GitDoc."*
4. After the user completes SSO, their next GitDoc login (which re-authorizes the GitHub App) will include the credential authorization for that org.

### Recommendation

**MVP**: No SAML handling needed. OAuth App tokens are auto-authorized.

**Post-MVP**: Add a middleware/interceptor in the GitHub API proxy layer that checks for `X-GitHub-SSO` headers on `403` responses and surfaces the SSO URL to the user. This is a small enhancement (~20 lines of code in the API proxy) and can be deferred until a user reports SAML-related access issues.

## Responsive Layout Design

### The Challenge

The primary desktop layout is a two-column design: rendered markdown content (~65% width) on the left, comment margin/sidebar (~35% width) on the right. This breaks on viewports below ~768px — there isn't enough horizontal space for both content and a usable comment panel side-by-side. The layout must adapt gracefully without losing core functionality.

### Breakpoint Strategy

Use Tailwind's standard `md` breakpoint (768px), which aligns with shadcn/ui's conventions:

| Viewport | Layout | Comment UX |
|----------|--------|------------|
| **≥768px** (desktop/tablet landscape) | Two-column: content + right comment margin | Comment threads anchored in right column, aligned with source lines |
| **<768px** (mobile/tablet portrait) | Single-column: full-width content | Comment threads in a bottom drawer; existing comments via inline indicators |

### Desktop Layout (≥768px)

No change from the existing design — the Google Docs-style two-column layout described in the Layout Structure section above:

```
┌─────────────────────────────────────────┐
│  Header (PR info, file selector)        │
├───────────────────────┬─────────────────┤
│  Rendered Markdown    │  Comment Margin  │
│  (prose content)      │  (fixed right)   │
│  flex-1               │  w-80 / w-96     │
└───────────────────────┴─────────────────┘
```

Implemented with Tailwind flex utilities:

```tsx
<div className="flex min-h-screen">
  <main className="flex-1 overflow-y-auto p-6">
    <article className="prose dark:prose-invert max-w-none">
      {/* Rendered markdown */}
    </article>
  </main>
  <aside className="hidden md:block w-80 lg:w-96 border-l overflow-y-auto p-4">
    {/* Comment threads, ScrollArea */}
  </aside>
</div>
```

The `hidden md:block` on the aside ensures it only shows on desktop. On mobile, the aside is hidden and replaced by the drawer approach below.

### Mobile Layout (<768px): Bottom Drawer Pattern

**Recommended approach**: Use shadcn/ui's `Drawer` component (built on Vaul by Emil Kowalski) as a bottom-sheet for comment threads on mobile. This matches native mobile UX conventions (iOS sheets, Android bottom sheets) and is the pattern used by Linear, Vercel, and other mobile-first apps.

#### Why Bottom Drawer (Not Alternatives)

**Option A — Stacked layout (content above, comments below)**: Forces the user to scroll past all rendered markdown to see comments. Loses the spatial anchoring between passages and their comments. Reading and reviewing become separate sequential activities rather than parallel ones. **Rejected** — breaks the core "Google Docs" interaction model.

**Option B — Collapsible right sidebar (offscreen, slides in)**: Works on tablets but on phone-sized screens (<400px) the sidebar would cover most of the content anyway. Also competes with the native back-gesture (swipe-from-left-edge) on iOS, and swipe-from-right on some Android launchers. **Rejected for phone** — acceptable as a tablet enhancement post-MVP.

**Option C — Bottom drawer** (recommended): The drawer slides up from the bottom edge, covering the lower portion of the screen. The user can see the rendered markdown above it, maintaining spatial context. Swipe-to-dismiss is natural on touch devices. The drawer can snap to multiple heights (peek, half, full) via Vaul's snap points. This is the standard mobile pattern for contextual panels (Apple Maps, Google Maps, Slack, etc.).

#### Responsive Component Switching

Use the `useMediaQuery` hook (provided by shadcn/ui) to conditionally render the desktop aside vs mobile drawer:

```tsx
import { useMediaQuery } from '@/hooks/use-media-query';

function CommentPanel({ comments, onReply, onNewComment }) {
  const isDesktop = useMediaQuery('(min-width: 768px)');

  if (isDesktop) {
    return (
      <aside className="w-80 lg:w-96 border-l overflow-y-auto p-4">
        <CommentThreadList comments={comments} onReply={onReply} />
      </aside>
    );
  }

  return (
    <Drawer>
      <DrawerTrigger asChild>
        <FloatingCommentBadge count={comments.length} />
      </DrawerTrigger>
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader>
          <DrawerTitle>Comments ({comments.length})</DrawerTitle>
        </DrawerHeader>
        <ScrollArea className="px-4 pb-4">
          <CommentThreadList comments={comments} onReply={onReply} />
        </ScrollArea>
      </DrawerContent>
    </Drawer>
  );
}
```

The `useMediaQuery` hook pattern:

```tsx
import { useState, useEffect } from 'react';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mql = matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener('change', onChange);
    setMatches(mql.matches);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
```

#### Mobile Comment Entry Points

On mobile, there are three ways users access comments:

1. **Floating badge**: A fixed-position badge in the bottom-right corner showing the total comment count for the current file. Tapping opens the drawer with all comment threads. Similar to Google Docs mobile's comment count indicator.

2. **Inline comment indicators**: Small icons or badges in the left gutter next to passages that have existing comments. Tapping an indicator opens the drawer pre-scrolled to that specific comment thread. Implementation: the drawer opens with a `scrollTo` to the target thread element.

3. **Select-to-comment anchor** (post-MVP on mobile): If/when mobile select-to-comment is enabled, the comment anchor button opens the drawer with a new comment form pre-filled with the selected line range. The selection range must be saved to state before the drawer opens (see the Selection Range Preservation task).

#### Drawer Snap Points

Vaul supports snap points — predefined heights where the drawer "snaps" during dragging. Useful for a peek-expand pattern:

- **Peek** (~25% viewport): Shows the header + first 1–2 comment threads. User sees the markdown content above.
- **Half** (~50% viewport): Shows several threads comfortably. Good default open height.
- **Full** (~85% viewport): Full comment list with scrolling. User initiated by dragging up.

```tsx
<Drawer snapPoints={[0.25, 0.5, 0.85]}>
  {/* ... */}
</Drawer>
```

For MVP, a single open height (~50–60%) is sufficient. Snap points are a post-MVP enhancement.

#### Header Adaptation

The header (PR info, file selector) also needs responsive treatment:

- **Desktop**: Horizontal bar with PR title, file selector dropdown, and navigation breadcrumb.
- **Mobile**: Condensed header. PR title truncated with ellipsis. File selector as a full-width dropdown menu or a `Sheet` sliding from the top. Navigation via a hamburger menu if needed.

```tsx
<header className="flex items-center justify-between p-4 border-b">
  <div className="flex items-center gap-2 min-w-0">
    <h1 className="text-sm font-medium truncate">{prTitle}</h1>
  </div>
  <div className="hidden md:flex items-center gap-2">
    {/* Desktop: full file selector, breadcrumbs */}
  </div>
  <div className="md:hidden">
    {/* Mobile: compact file selector, hamburger */}
  </div>
</header>
```

### Typography Adaptation

The `prose` classes from `@tailwindcss/typography` already handle responsive typography via size modifiers:

- **Mobile**: `prose` (default — 16px base, comfortable line height for small screens)
- **Desktop**: `prose lg:prose-lg` (18px base, wider measure for larger screens)

The `max-w-none` override (needed for the two-column layout on desktop) should be applied conditionally or left in place — on mobile, the single-column layout naturally constrains width to the viewport.

### Existing Comments Display on Mobile

On mobile, existing comment threads (which live in the drawer) need a different anchoring strategy since there's no visible right column:

1. **Gutter indicators**: The left-margin gutter bars (Layer 1 from the Visual Indication section) still work on mobile. Passages with existing comments additionally get a small comment-count badge in the gutter (e.g., a `💬 3` indicator). Tapping opens the drawer scrolled to that thread.

2. **Highlight on scroll**: When the drawer is open and the user scrolls through comment threads, the corresponding passage in the document could receive a highlight (same as the desktop hover-to-highlight behavior). This maintains the spatial connection between comments and content. Implementation: use `scrollIntoView` on the `[data-source-start]` element when a comment thread gains focus in the drawer.

3. **No margin-anchored threads**: The desktop layout positions comment threads at the vertical position of their target passage. On mobile this isn't possible (the drawer is at the bottom, not alongside). Instead, threads are shown in document order within the drawer, with a "Jump to passage" link on each thread that scrolls the document to the relevant section.

### Edge Cases

- **Orientation change**: When a user rotates a tablet from portrait to landscape (crossing the 768px breakpoint), the `useMediaQuery` hook triggers a re-render switching between drawer and aside. If the drawer was open with a partially-written reply, the reply state must be preserved in a parent component (not local to the drawer). Lift comment draft state to a shared context or store.
- **Tablet-specific considerations**: iPads in portrait mode are typically 768–810px wide. The `md` breakpoint (768px) catches most tablets in portrait as "desktop", which works because iPads have enough width for the two-column layout. Split-view multitasking on iPad may push the viewport below 768px — the drawer pattern handles this gracefully.
- **Keyboard on mobile**: When the virtual keyboard opens for a comment reply, the drawer's height should adjust. Vaul handles this automatically on iOS (viewport resize), but Android's keyboard behavior varies — some browsers resize the viewport, others use visual viewport API. Test on real devices.
- **SSR mismatch**: `useMediaQuery` returns `false` on the server (no `window`). The initial SSR render will show the mobile layout; it hydrates to the correct layout on the client. To avoid a flash, consider using CSS-only hiding (`hidden md:block` / `md:hidden`) for the initial render, and only use the hook for interactive behavior (drawer open state).

### Recommendation

**MVP**: Implement the desktop two-column layout with `hidden md:block` for the aside. On mobile (<768px), hide the aside and show a floating comment count badge that opens a basic `Drawer` with comment threads. Defer select-to-comment on mobile (read-only + reply-only on mobile).

**Post-MVP enhancements**:
- Snap points for the drawer (peek/half/full)
- Scroll-synced highlighting between drawer threads and document passages
- Tablet-optimized layout (collapsible right panel instead of drawer for tablets in portrait)
- Mobile select-to-comment with drawer-based comment input

## Selection Range Preservation

### The Problem

When the user selects text in the rendered markdown and clicks "Add comment" (or the comment anchor button), the browser renders a comment textarea. On **focus shift** to the textarea, most browsers clear the document's text selection. This is standard browser behavior — only one element can have focus at a time, and text selection in a non-editable area is tied to focus.

This is especially aggressive on **mobile browsers**: iOS Safari and Android Chrome almost always clear the selection when focus moves to an input element. On desktop browsers, the behavior is inconsistent — some preserve the selection visually (dimmed highlight) while others clear it entirely.

The problem: by the time the user is typing their comment, the original `Range` object from the selection may be invalidated or the selection cleared. We need the source line numbers from the selection to know which lines to target in the GitHub API `POST /pulls/{n}/comments` call.

### Why Not Just Store the DOM `Range` Object?

A DOM `Range` holds live references to DOM nodes (`startContainer`, `endContainer`). These references become stale if:

1. **The selection is cleared** — the `Range` object itself remains valid (it still points to the same nodes), but `document.getSelection()` no longer returns it. The saved `Range` still works for extracting data.
2. **React re-renders the markdown** — if the component tree re-renders and replaces DOM nodes (e.g., due to a state change), the `Range`'s node references become orphaned. `Range.getBoundingClientRect()` returns a zero-rect, and traversal via `closest()` may fail.
3. **`cloneRange()`** — this creates a new `Range` pointing to the **same** DOM nodes, not cloned nodes. If the original nodes are removed from the DOM, the cloned range is equally stale.

**Conclusion**: Don't rely on keeping a live `Range` or `Selection` object in React state for later use. Instead, **extract the semantic data you need immediately** when the selection is detected, and store that as plain data.

### Recommended Approach: Extract Source Lines at Selection Time

When the `useSelectionObserver` hook detects a valid selection, immediately extract and store the source line information as plain data — before any UI state change that could trigger a re-render or focus shift.

#### Data Model

```ts
interface SelectionInfo {
  /** Source start line (from data-source-start of first selected block) */
  startLine: number;
  /** Source end line (from data-source-end of last selected block) */
  endLine: number;
  /** The selected text (for preview in the comment form) */
  selectedText: string;
  /** Vertical position for anchoring the comment UI (relative to document) */
  anchorTop: number;
  /** Whether all selected lines are commentable */
  isCommentable: boolean;
  /** The subset of lines that are commentable (for snapping) */
  commentableLines: number[];
}
```

#### Extraction Logic

This runs inside the `useSelectionObserver` callback, before any state change:

```ts
function extractSelectionInfo(
  range: Range,
  commentableLines: Set<number>,
): SelectionInfo | null {
  // 1. Find the block elements containing the selection endpoints
  const startEl = (range.startContainer instanceof Element
    ? range.startContainer
    : range.startContainer.parentElement
  )?.closest('[data-source-start]');

  const endEl = (range.endContainer instanceof Element
    ? range.endContainer
    : range.endContainer.parentElement
  )?.closest('[data-source-start]');

  if (!startEl || !endEl) return null;

  const startLine = Number(startEl.getAttribute('data-source-start'));
  const endLine = Number(endEl.getAttribute('data-source-end'));

  if (isNaN(startLine) || isNaN(endLine)) return null;

  // 2. Determine which lines in the range are commentable
  const matchingLines: number[] = [];
  for (let l = startLine; l <= endLine; l++) {
    if (commentableLines.has(l)) matchingLines.push(l);
  }

  // 3. Get positioning info while the Range is still valid
  const rect = range.getBoundingClientRect();

  // 4. Get selected text for preview
  const selectedText = range.toString().trim();

  return {
    startLine,
    endLine,
    selectedText,
    anchorTop: rect.top + window.scrollY,
    isCommentable: matchingLines.length > 0,
    commentableLines: matchingLines,
  };
}
```

#### State Management Pattern

```tsx
function MarkdownReviewer({ markdownContent, commentableLines, ... }) {
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Plain data — survives re-renders and focus shifts
  const [selectionInfo, setSelectionInfo] = useState<SelectionInfo | null>(null);
  const [isCommentFormOpen, setIsCommentFormOpen] = useState(false);

  useSelectionObserver(
    containerRef,
    // onSelection — called when a valid selection is detected
    (range: Range) => {
      const info = extractSelectionInfo(range, commentableLines);
      setSelectionInfo(info);
    },
    // onClearSelection — called when selection is cleared
    () => {
      if (!isCommentFormOpen) {
        // Only clear if the comment form isn't open
        // (clicking the textarea clears the selection, but we want to keep the info)
        setSelectionInfo(null);
      }
    },
  );

  const handleOpenCommentForm = () => {
    // selectionInfo is already stored — safe to show the form
    // The browser will clear the selection when the textarea gains focus,
    // but we don't need it anymore — all data is in selectionInfo
    setIsCommentFormOpen(true);
  };

  const handleSubmitComment = async (body: string) => {
    if (!selectionInfo) return;

    // Use the stored line numbers for the GitHub API call
    await createReviewComment({
      body,
      path: filePath,
      line: selectionInfo.commentableLines[selectionInfo.commentableLines.length - 1],
      start_line: selectionInfo.commentableLines.length > 1
        ? selectionInfo.commentableLines[0]
        : undefined,
      side: 'RIGHT',
      commit_id: headSha,
    });

    setSelectionInfo(null);
    setIsCommentFormOpen(false);
  };

  // ...
}
```

### Key Design Decisions

1. **Extract early, store as plain data**: The `SelectionInfo` object contains only primitive values (numbers, strings, boolean, array of numbers). It has no DOM references, so it survives React re-renders, focus shifts, and even component unmount/remount cycles.

2. **Don't try to restore the DOM selection**: Some annotation tools (like WYSIWYG editors) try to save and restore the browser selection using `selection.addRange()`. This is fragile and unnecessary for GitDoc — we don't need the selection to persist visually. The comment form replaces the selection as the user's focus.

3. **Guard `onClearSelection` when comment form is open**: When the user clicks the textarea, the browser fires `selectionchange` with a collapsed (empty) selection. The `onClearSelection` callback must NOT clear `selectionInfo` while the comment form is open — otherwise the line numbers are lost. The `isCommentFormOpen` flag gates this.

4. **Visual highlight as substitute for selection**: Once the comment form opens and the browser selection clears, the user loses visual context of what they selected. To compensate, use the stored `startLine`/`endLine` to apply a CSS highlight class on the corresponding `[data-source-start]` elements:

```tsx
// Apply highlight to elements in the selected range
useEffect(() => {
  if (!selectionInfo || !containerRef.current) return;
  const { startLine, endLine } = selectionInfo;
  const els = containerRef.current.querySelectorAll('[data-source-start]');
  els.forEach((el) => {
    const s = Number(el.getAttribute('data-source-start'));
    const e = Number(el.getAttribute('data-source-end'));
    if (s >= startLine && e <= endLine) {
      el.classList.add('comment-target-highlight');
    }
  });
  return () => {
    els.forEach((el) => el.classList.remove('comment-target-highlight'));
  };
}, [selectionInfo]);
```

```css
.comment-target-highlight {
  background-color: var(--comment-highlight-bg); /* e.g., yellow-100/20% */
  border-radius: 2px;
  transition: background-color 150ms ease;
}
```

This mirrors the Google Docs pattern where the selected passage remains highlighted in yellow while the comment form is open in the margin.

### Mobile-Specific Considerations

On mobile, the selection-clearing-on-focus issue is more severe:

- **iOS Safari**: Almost always clears the selection when any input element receives focus. There is no reliable way to prevent this.
- **Android Chrome**: Also clears the selection on focus, though some older versions may partially preserve it.

The "extract early" pattern handles this perfectly — by the time the mobile bottom drawer opens and the comment textarea gains focus, all needed data is already in `selectionInfo`. The visual highlight (applied via CSS classes using stored line numbers) provides context even after the native selection is gone.

### Integration with the `useSelectionObserver` Hook

The existing `useSelectionObserver` hook (from the Text Selection UX section) needs one small modification: the `onClearSelection` callback should be aware of whether the comment form is currently open. This can be done by:

1. Passing a `ref` for the `isCommentFormOpen` state (to avoid stale closure issues in the event listener):

```ts
const isCommentFormOpenRef = useRef(false);
useEffect(() => { isCommentFormOpenRef.current = isCommentFormOpen; }, [isCommentFormOpen]);
```

2. In the `scheduleCallback` function inside `useSelectionObserver`, when the selection is collapsed, check the ref before calling `onClearSelection`.

Alternatively, the simpler approach is to handle the guard in the parent component's `onClearSelection` callback itself (as shown in the State Management Pattern above), keeping `useSelectionObserver` generic.

### Edge Cases

- **React re-render during selection**: If a re-render replaces the DOM nodes while the user is actively selecting, the `Range` becomes invalid. This is unlikely in practice — the markdown content doesn't change during a review session (it's fetched once per file view). If it did re-render (e.g., new comments loaded via polling), the `selectionInfo` already holds plain data and is unaffected.
- **Multiple rapid selections**: If the user quickly selects text, opens the comment anchor, then selects different text before clicking the anchor, the `selectionInfo` is overwritten by the latest selection. This is the correct behavior.
- **Selection spanning commentable and non-commentable regions**: The `commentableLines` array in `SelectionInfo` contains only the commentable subset. The comment submission logic uses the first and last commentable lines as `start_line` and `line`. If no lines are commentable, `isCommentable` is `false` and the comment anchor is not shown.
- **Stale closures in event handlers**: The `isCommentFormOpen` state used in `onClearSelection` must be accessed via a ref (not directly from the closure) to avoid stale closure bugs in `useEffect`-based event listeners.
- **Comment form dismissal**: When the user closes the comment form without submitting (e.g., pressing Escape or clicking away), `setIsCommentFormOpen(false)` should also call `setSelectionInfo(null)` to clear the highlight and reset the UI.

## Accessibility (WCAG 2.1 AA Compliance)

### Context

The PRD requires WCAG 2.1 AA compliance. GitDoc has several interaction patterns that need careful accessibility treatment: commentable region indication, text selection and comment anchoring, comment thread navigation, comment form input, and dynamic status updates. Radix UI primitives (via shadcn/ui) provide strong baseline accessibility for individual components, but the composed commenting UX requires additional ARIA patterns.

### What Radix/shadcn Gives Us for Free

Radix UI primitives follow WAI-ARIA authoring practices and handle `aria` roles, `role` attributes, focus management, and keyboard navigation out of the box. The following shadcn/ui components already meet AA requirements:

- **Popover**: `role="dialog"`, `aria-expanded`, focus trap, `Escape` to close, return focus on close
- **Dialog/Drawer**: `role="dialog"`, `aria-modal="true"`, focus trap, `Tab`/`Shift+Tab` cycling, `Escape` to close
- **Collapsible**: `aria-expanded`, `aria-controls`, `Enter`/`Space` to toggle — maps to the WAI-ARIA Disclosure pattern
- **Button**: Proper `role="button"`, `Enter`/`Space` activation, focus ring
- **Tooltip**: `role="tooltip"`, keyboard-triggerable, meets 1.4.13 Content on Hover or Focus (dismissible, hoverable, persistent)
- **ScrollArea**: Keyboard-scrollable, ARIA scrollbar semantics
- **Sonner (toast)**: Uses `aria-live="polite"` for non-intrusive announcements

**What we must implement ourselves**: ARIA semantics for the composed commenting workflow (commentable region annotation, comment thread list structure, focus management across selection → anchor → form → submission feedback, and live region announcements for dynamic content).

### 1. Commentable Region Accessibility

#### Screen Reader Announcement

The `data-commentable` attribute provides visual indication (gutter bar, hover highlight) but conveys nothing to screen readers. Add `aria-label` to annotate commentable block elements:

```tsx
// In the rehype plugin or post-render pass:
if (hasCommentableLineInRange(sourceStart, sourceEnd, commentableLines)) {
  node.properties['dataCommentable'] = true;
  node.properties['ariaLabel'] = `Commentable region, lines ${sourceStart} to ${sourceEnd}`;
}
```

**Trade-off**: Annotating every commentable paragraph with an `aria-label` risks making the document "chatty" for screen reader users. A better approach is to make the gutter indicator itself focusable and labelled, rather than annotating the prose content:

```tsx
// Before each commentable block, inject a visually-hidden comment trigger:
<button
  className="sr-only focus:not-sr-only focus:absolute focus:left-0"
  aria-label={`Add comment on lines ${sourceStart}–${sourceEnd}`}
  onClick={() => openCommentForm(sourceStart, sourceEnd)}
  tabIndex={0}
>
  💬
</button>
```

This avoids polluting the reading flow — screen reader users encounter these buttons only when navigating by focusable elements, not when reading the document linearly.

**Recommendation**: Use the hidden button approach. Do NOT add `aria-label` to prose elements (`<p>`, `<h1>`, etc.) — this overrides the element's text content for screen readers, which is destructive. Instead, keep prose elements clean and provide the commenting affordance via a separate focusable element.

#### WCAG 1.4.11 Non-Text Contrast

The gutter bar (3px `border-left` in accent color) is a **UI component indicator** — it must meet the 3:1 contrast ratio requirement against adjacent colors (WCAG 1.4.11). Ensure the accent color (e.g., `blue-400` / `#60a5fa`) has ≥3:1 contrast against the page background. Against white (`#ffffff`), `blue-400` has a contrast ratio of ~3.1:1 — borderline. Consider using `blue-500` (`#3b82f6`, ~4.6:1 against white) for more headroom.

The commentable-region hover highlight background must also meet 3:1 non-text contrast against the non-highlighted state — this is inherent if the background color change is visible.

### 2. Comment Thread List — ARIA Structure

The comment sidebar (desktop) or drawer (mobile) contains a list of comment threads. Use the WAI-ARIA **feed** pattern (`role="feed"` + `role="article"`) for the thread list, since threads can load dynamically and users need to skim through them:

```tsx
<div role="feed" aria-label="Comment threads" aria-busy={isLoadingComments}>
  {threads.map((thread, index) => (
    <article
      key={thread.id}
      role="article"
      aria-posinset={index + 1}
      aria-setsize={threads.length}
      aria-labelledby={`thread-title-${thread.id}`}
      tabIndex={0}
    >
      <div id={`thread-title-${thread.id}`}>
        <Avatar user={thread.author} />
        <span>{thread.author.login}</span>
        <time>{thread.createdAt}</time>
      </div>
      <p>{thread.body}</p>
      {thread.replies.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger aria-expanded={isExpanded}>
            {thread.replies.length} replies
          </CollapsibleTrigger>
          <CollapsibleContent>
            {/* Nested replies */}
          </CollapsibleContent>
        </Collapsible>
      )}
    </article>
  ))}
</div>
```

**Keyboard navigation** (from the feed pattern):
- **`Page Down`**: Move focus to the next thread article
- **`Page Up`**: Move focus to the previous thread article
- **`Ctrl+End`**: Move focus past the feed (to elements after the comment panel)
- **`Ctrl+Home`**: Move focus before the feed

**`aria-busy`**: Set to `true` while loading/refreshing comments (e.g., during SWR revalidation). Set to `false` when the update completes. This prevents screen readers from announcing incomplete state during loading.

### 3. Comment Input Form — Focus Management

When the user activates the comment anchor (either by clicking the floating button after selection, or pressing Enter on a hidden gutter button), a comment form appears. Focus management follows the WAI-ARIA **Dialog** pattern:

#### Focus Flow

```
1. User selects text → comment anchor button appears
2. User clicks/presses Enter on anchor → comment form opens
3. Focus moves to the textarea inside the comment form
4. Tab cycles within the form: textarea → Submit button → Cancel button → textarea
5a. Submit: focus returns to the passage being commented on (or the new thread in the sidebar)
5b. Cancel/Escape: focus returns to the element that triggered the form (the anchor button, or the nearest commentable element)
```

#### Implementation

The comment form should use `role="dialog"` with `aria-label`:

```tsx
<div
  role="dialog"
  aria-label="Add comment"
  aria-modal="false"  // non-modal — user can still interact with the document
>
  <label htmlFor={`comment-input-${id}`} className="sr-only">
    Write your comment
  </label>
  <textarea
    id={`comment-input-${id}`}
    autoFocus  // moves focus on open
    aria-describedby={`comment-context-${id}`}
  />
  <p id={`comment-context-${id}`} className="sr-only">
    Commenting on lines {startLine}–{endLine}: "{selectedText.slice(0, 50)}..."
  </p>
  <div className="flex gap-2">
    <Button type="submit">Submit</Button>
    <Button type="button" onClick={handleCancel}>Cancel</Button>
  </div>
</div>
```

**Key decisions**:

1. **Non-modal dialog** (`aria-modal="false"`): The comment form sits in the margin/popover alongside the document. Users should still be able to read the document while composing a comment. A modal dialog would block access to the document content — inappropriate for this use case.

2. **Auto-focus textarea**: When the form opens, programmatically focus the textarea. This satisfies WCAG 2.4.3 Focus Order (A) — focus moves to the relevant input immediately.

3. **`aria-describedby` for context**: Screen readers announce "Write your comment — Commenting on lines 5–7: 'This paragraph was modified...'" — giving the user context about what they're commenting on without needing to see the visual highlight.

4. **Return focus on close**: After submitting or cancelling, return focus to a logical element. On submit, focus the newly created thread in the sidebar. On cancel, return focus to the anchor element that opened the form (or the nearest `[data-commentable]` element if the anchor was transient).

#### Escape Key Handling

`Escape` should close the comment form and return focus. If the Popover component (from Radix) wraps the form, it handles `Escape` automatically. Otherwise, add an explicit keydown handler:

```tsx
const handleKeyDown = (e: React.KeyboardEvent) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    handleCancel();
    anchorRef.current?.focus(); // return focus
  }
};
```

### 4. Status Messages — ARIA Live Regions (WCAG 4.1.3)

Dynamic status messages that don't take focus must be announced to screen readers via ARIA live regions. GitDoc has several:

| Status Message | ARIA Role | Rationale |
|----------------|-----------|-----------|
| "Comment posted successfully" | `role="status"` (`aria-live="polite"`) | Success feedback — non-urgent, shouldn't interrupt |
| "Failed to post comment" | `role="alert"` (`aria-live="assertive"`) | Error — should interrupt immediately |
| "Loading comments..." | `role="status"` | Progress state — informational |
| "This passage wasn't changed in this PR" (on non-commentable selection) | `role="status"` | Informational — user tried to comment on non-commentable text |
| "3 new comments" (polling update) | `role="status"` | New content arrived — polite announcement |

**Implementation**: Use the Sonner toast system (already in the shadcn/ui stack) for success/error messages — Sonner already uses `aria-live` regions. For inline status messages (like the "not commentable" tooltip), wrap in a live region:

```tsx
// A persistent live region container (rendered once, always in DOM):
<div aria-live="polite" aria-atomic="true" className="sr-only" id="gitdoc-status">
  {statusMessage}
</div>

// Update statusMessage on events:
setStatusMessage('Comment posted successfully');
setTimeout(() => setStatusMessage(''), 5000); // clear after 5s
```

**Important**: The live region element must be present in the DOM **before** the message content is added to it. Adding both the container and the message simultaneously may not be announced. Render the container on mount with empty content; update the text content when a status message occurs.

### 5. Keyboard-Only Commenting Workflow

Users who navigate purely via keyboard (no mouse) need a complete commenting flow. The end-to-end keyboard path:

```
1. Tab through the document → reach a visually-hidden comment trigger button at a commentable region
2. Press Enter/Space → opens the comment form (focus moves to textarea)
3. Type comment → Tab to Submit button → Enter to submit
4. Announcement: "Comment posted successfully" via aria-live region
5. Focus moves to the new comment thread in the sidebar
```

For **keyboard-based text selection** (Shift+Arrow), the flow is:

```
1. Navigate to the rendered markdown content area
2. Use Shift+Arrow to select text
3. The comment anchor appears (it must be focusable and keyboard-accessible)
4. Tab to the anchor button → Enter to activate → same flow as above
```

**The comment anchor button** that appears after text selection must:
- Be a `<button>` element (not a styled `<div>`)
- Receive focus automatically or be reachable via `Tab` from the current position
- Have an accessible name: `aria-label="Add comment on selected text"`

#### Focus Visibility (WCAG 2.4.7)

All interactive elements must show a visible focus indicator. Tailwind's `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` utility provides this. Ensure it's applied to:
- Comment anchor button
- Hidden gutter trigger buttons
- Textarea and form buttons
- Comment thread articles (since they're `tabIndex={0}`)
- Collapsible thread expand/collapse triggers

shadcn/ui's Button, Textarea, and Collapsible components already include focus ring styles.

### 6. Hover-Triggered Content (WCAG 1.4.13)

The Layer 2 hover highlight and comment-count tooltips are "content on hover or focus." WCAG 1.4.13 requires:

1. **Dismissible**: The hover highlight is purely visual (CSS `:hover`) and doesn't add new content, so no dismiss mechanism is needed. Tooltips (e.g., "not commentable") must be dismissible without moving the pointer — `Escape` key should work. Radix's `Tooltip` component handles this.

2. **Hoverable**: If a tooltip appears on hover, the user must be able to move the pointer over the tooltip content without it disappearing. Radix's `Tooltip` component supports this via its `delayDuration` and pointer-stay behavior.

3. **Persistent**: The content remains visible until hover/focus is removed, or the user dismisses it. CSS `:hover` naturally satisfies this.

### 7. Document Landmarks and Heading Structure (WCAG 1.3.1, 2.4.6)

Use ARIA landmarks to define the page regions:

```tsx
<header role="banner">
  {/* PR info, file selector */}
</header>

<main role="main" aria-label="Rendered document">
  <article className="prose dark:prose-invert max-w-none">
    {/* Rendered markdown */}
  </article>
</main>

<aside role="complementary" aria-label="Comment threads">
  {/* Comment sidebar or drawer */}
</aside>
```

This enables screen reader users to jump between landmarks (e.g., JAWS: `R` key, NVDA: `D` key). The `<article>` wrapping the markdown preserves the document's own heading hierarchy (h1–h6 from the markdown content).

### 8. Color and Contrast

WCAG 1.4.3 requires 4.5:1 contrast for normal text and 3:1 for large text. Key areas to verify:

- **Comment body text**: Must meet 4.5:1 against the comment card background
- **Comment metadata** (author name, timestamp): Often styled lighter — ensure ≥4.5:1, or use larger text to qualify for the 3:1 threshold
- **Gutter bar color**: ≥3:1 against adjacent background (WCAG 1.4.11 non-text contrast)
- **Comment highlight background** (yellow/blue tint on passage being commented on): The text on top of this highlight must maintain 4.5:1 contrast. A very light tint (e.g., `yellow-50` at 10% opacity) preserves text contrast.
- **Dark mode**: `prose-invert` from `@tailwindcss/typography` handles text color inversion. Verify gutter bar and highlight colors also meet contrast in dark mode.

**No information conveyed by color alone** (WCAG 1.4.1): The commentable/non-commentable distinction uses both color (gutter bar) AND interaction feedback (hover highlight, selection-time tooltip). The hidden trigger buttons provide a non-visual path. This satisfies the "use of color" criterion.

### Summary of Required ARIA Attributes

| Element | ARIA Attributes |
|---------|----------------|
| Comment thread list | `role="feed"`, `aria-label`, `aria-busy` |
| Individual thread | `role="article"`, `aria-posinset`, `aria-setsize`, `aria-labelledby`, `tabIndex={0}` |
| Thread expand/collapse | `aria-expanded`, `aria-controls` (Radix Collapsible provides) |
| Comment form container | `role="dialog"`, `aria-label`, `aria-modal="false"` |
| Comment textarea | `id`, `aria-describedby` (context about selected lines) |
| Textarea label | `<label>` with `htmlFor` or `aria-label` |
| Gutter trigger button | `aria-label="Add comment on lines N–M"`, `className="sr-only"` |
| Comment anchor (selection) | `aria-label="Add comment on selected text"` |
| Status messages | `role="status"` or `role="alert"`, `aria-live` |
| Loading states | `aria-busy="true"` on the feed container |
| Non-commentable tooltip | `role="tooltip"` (Radix Tooltip provides) |

### Edge Cases

- **Screen reader reading order**: The two-column layout (content + comments) means screen readers encounter content first, then comments. This is the correct reading order. The feed pattern's keyboard shortcuts (Page Down/Up) allow quick navigation within the comment panel.
- **Resolved/collapsed threads**: Use `aria-expanded="false"` on the collapse trigger. The collapsed content is hidden from screen readers via Radix's Collapsible (which toggles `display: none` / `hidden` attribute).
- **Mobile drawer**: Vaul's Drawer component handles `aria-modal`, focus trap, and escape-to-close. When the drawer is open on mobile, content behind it should be inert (`aria-hidden="true"` on `<main>` while drawer is open).
- **Dynamic comment count updates**: When new comments arrive via polling, update the live region with a count message. Don't announce every individual comment — aggregate into "3 new comments" to avoid verbosity.
- **Code blocks with per-line commenting**: Each `code-line` span gets its own hidden trigger button. This could create many focusable elements in long code blocks. Consider a single trigger per code block (at the `<pre>` level) that opens a line-picker for accessibility, rather than one per line. This is a post-MVP refinement.

## Error Handling & Optimistic UI for Comment Submission

### Context

When a user submits a comment in GitDoc, the app calls our Next.js API route, which proxies to `POST /repos/{owner}/{repo}/pulls/{pull_number}/comments`. This round-trip takes 200–2000ms depending on network conditions. During this time, the user should see immediate feedback — and if the call fails, the UI must recover gracefully.

### GitHub API Error Codes for Comment Creation

The `POST /repos/{owner}/{repo}/pulls/{pull_number}/comments` endpoint documents three response codes:

| Status | Meaning | Retryable? |
|--------|---------|------------|
| **201** | Created — comment posted successfully | — |
| **403** | Forbidden — insufficient permissions, SAML SSO required, or **rate limit exceeded** | Only rate limit (with backoff) |
| **422** | Validation failed — invalid `line`, `path`, `commit_id`, or line not in diff | **No** — bad request data |

Additional undocumented but observed error scenarios:

| Status | Cause | Retryable? |
|--------|-------|------------|
| **401** | Token expired or revoked (relevant for GitHub App tokens with 8-hour expiry) | No — re-auth needed |
| **404** | PR not found, repo not found, or SAML-related private repo access denied (GitHub returns 404 instead of 403 to avoid confirming repo existence) | No |
| **429** | Secondary rate limit exceeded (>900 points/min or >100 concurrent requests) | Yes — with `Retry-After` header |
| **500/502/503** | GitHub server error | Yes — transient |
| **Network error** | Fetch failed, timeout, DNS resolution | Yes — transient |

### Error Classification

Errors fall into four categories with different handling strategies:

#### Category 1: Validation Errors (422)

**Cause**: The comment targets an invalid line (not in the diff), uses a stale `commit_id` (PR was force-pushed since page load), or has an invalid `path`.

**Stale SHA** is the most likely 422 for GitDoc: the user loads a PR, someone force-pushes the branch (changing the head SHA), and the user tries to comment with the old `commit_id`. The GitHub API rejects this because the line numbers may no longer be valid.

**Handling**:
- **No automatic retry** — the request data itself is invalid.
- Show an inline error message on the comment form (don't dismiss the form — preserve the user's typed comment text).
- For stale SHA: detect via error message pattern (GitHub returns `"Validation Failed"` with details about `commit_id`). Show: *"The PR was updated since you loaded this page. Your comment has been saved — please refresh to try again."*
- For invalid line: *"This line is no longer part of the diff. The PR may have been updated."*
- Offer a **"Refresh & Retry"** button that reloads the PR data (new head SHA, new diff) and attempts to re-submit if the line is still valid.

#### Category 2: Auth Errors (401, 403 non-rate-limit)

**Cause**: OAuth token revoked, expired (GitHub App 8-hour tokens), or insufficient permissions.

**Handling**:
- **No automatic retry** — re-authentication needed.
- Detect 401 or 403 (without rate limit headers).
- If 403 with `X-GitHub-SSO` header: show SSO re-auth flow (see SAML SSO section).
- Otherwise: show *"Your session has expired. Please sign in again to continue."* with a link to `/api/auth/login`.
- **Preserve the comment text** in the form so the user doesn't lose their work. Store the draft in `sessionStorage` keyed by `{prNumber}:{filePath}:{startLine}-{endLine}` before redirecting to login.

#### Category 3: Rate Limit Errors (403 with rate limit headers, 429)

**Cause**: Primary rate limit (5,000/hour) or secondary rate limit (900 points/min) exceeded.

**Detection**: Check for `x-ratelimit-remaining: 0` header on 403, or a 429 status code.

**Handling**:
- Parse `x-ratelimit-reset` (UTC epoch seconds) or `Retry-After` header to determine when the limit resets.
- Show: *"GitHub rate limit reached. Your comment will be submitted automatically at {time}."*
- Queue the comment for automatic retry after the reset time.
- Show a countdown indicator on the comment form.
- Do NOT roll back the optimistic update immediately — keep it visible with a "pending" indicator.

#### Category 4: Transient Errors (5xx, network failures)

**Cause**: GitHub server issues, network connectivity problems, DNS resolution failures, or request timeouts.

**Handling**:
- **Automatic retry with exponential backoff**: 1s, 2s, 4s (max 3 attempts).
- During retries, show a subtle retry indicator: *"Retrying... (attempt 2/3)"*.
- If all retries fail, show error with manual retry button: *"Failed to post comment. [Retry] [Dismiss]"*
- On final failure, roll back the optimistic update and restore the comment text in the form.

### Optimistic UI Pattern

#### Recommended Approach: SWR `mutate()` with Optimistic Data

The design already specifies SWR for client-side data fetching (see Caching Strategy section). SWR's `mutate()` function supports optimistic updates natively via `optimisticData` + `rollbackOnError`:

```tsx
// hooks/use-pr-comments.ts
import useSWR from 'swr';

interface PRComment {
  id: number | string;
  body: string;
  user: { login: string; avatar_url: string };
  path: string;
  line: number;
  start_line?: number;
  created_at: string;
  isPending?: boolean;  // client-side flag for optimistic comments
}

function usePRComments(owner: string, repo: string, prNumber: number) {
  const key = `/api/repos/${owner}/${repo}/pulls/${prNumber}/comments`;
  const { data, error, isLoading, mutate } = useSWR<PRComment[]>(key, fetcher, {
    refreshInterval: 30_000,  // poll every 30s for new comments
  });

  const submitComment = async (params: {
    body: string;
    path: string;
    line: number;
    start_line?: number;
    commit_id: string;
  }) => {
    const optimisticComment: PRComment = {
      id: `temp-${Date.now()}`,
      body: params.body,
      user: currentUser,  // from auth context
      path: params.path,
      line: params.line,
      start_line: params.start_line,
      created_at: new Date().toISOString(),
      isPending: true,
    };

    await mutate(
      // The async mutation function (POST request)
      postComment(key, params),
      {
        // Show the optimistic comment immediately
        optimisticData: (current) => [...(current ?? []), optimisticComment],

        // Roll back to previous data on error
        rollbackOnError: (error) => {
          // Don't roll back for rate limit errors (we'll retry)
          if (error.status === 429) return false;
          if (error.status === 403 && error.isRateLimit) return false;
          return true;
        },

        // Merge server response into the cache
        populateCache: (serverComment, currentData) => {
          // Replace the optimistic comment with the server response
          return (currentData ?? []).map((c) =>
            c.id === optimisticComment.id ? serverComment : c
          );
        },

        // Always revalidate after mutation to catch comments from others
        revalidate: true,
      }
    );
  };

  return {
    comments: data ?? [],
    isLoading,
    error,
    submitComment,
    refreshComments: mutate,
  };
}
```

#### The `postComment` Helper

```ts
async function postComment(
  baseUrl: string,
  params: { body: string; path: string; line: number; start_line?: number; commit_id: string },
): Promise<PRComment> {
  let lastError: ApiError | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });

      if (res.ok) {
        return await res.json();
      }

      const error = await parseApiError(res);

      // Non-retryable errors: stop immediately
      if (error.status === 422 || error.status === 401 || error.status === 404) {
        throw error;
      }

      // Rate limit: throw with metadata for special handling
      if (error.status === 429 || (error.status === 403 && error.isRateLimit)) {
        error.retryAfter = parseRetryAfter(res);
        throw error;
      }

      // Transient (5xx): retry with backoff
      lastError = error;
      await sleep(Math.pow(2, attempt) * 1000);
    } catch (e) {
      if (e instanceof ApiError) throw e;  // re-throw classified errors

      // Network error: retry with backoff
      lastError = new ApiError(0, 'Network error', 'network');
      if (attempt < 2) {
        await sleep(Math.pow(2, attempt) * 1000);
      }
    }
  }

  throw lastError ?? new ApiError(0, 'Unknown error', 'unknown');
}

class ApiError extends Error {
  status: number;
  category: 'validation' | 'auth' | 'rate_limit' | 'transient' | 'network' | 'unknown';
  isRateLimit: boolean;
  retryAfter?: number;  // seconds until rate limit resets

  constructor(status: number, message: string, category: ApiError['category']) {
    super(message);
    this.status = status;
    this.category = category;
    this.isRateLimit = category === 'rate_limit';
  }
}

function parseApiError(res: Response): ApiError {
  const rateLimitRemaining = res.headers.get('x-ratelimit-remaining');
  if (res.status === 403 && rateLimitRemaining === '0') {
    return new ApiError(403, 'Rate limit exceeded', 'rate_limit');
  }
  if (res.status === 429) {
    return new ApiError(429, 'Secondary rate limit exceeded', 'rate_limit');
  }
  if (res.status === 422) {
    return new ApiError(422, 'Validation failed', 'validation');
  }
  if (res.status === 401 || res.status === 403) {
    return new ApiError(res.status, 'Authentication error', 'auth');
  }
  if (res.status >= 500) {
    return new ApiError(res.status, 'Server error', 'transient');
  }
  return new ApiError(res.status, `HTTP ${res.status}`, 'unknown');
}

function parseRetryAfter(res: Response): number | undefined {
  // Primary rate limit: x-ratelimit-reset is UTC epoch seconds
  const reset = res.headers.get('x-ratelimit-reset');
  if (reset) return Math.max(0, Number(reset) - Math.floor(Date.now() / 1000));
  // Secondary rate limit: Retry-After is seconds
  const retryAfter = res.headers.get('retry-after');
  if (retryAfter) return Number(retryAfter);
  return undefined;
}
```

### UI Behavior for Each Error State

#### Visual States of a Comment

```
┌─────────────────────────────────┐
│ 👤 username · just now          │   ← Normal comment (from server)
│                                 │
│ This is the comment body.       │
└─────────────────────────────────┘

┌─────────────────────────────────┐
│ 👤 username · Posting... ⏳     │   ← Optimistic (pending)
│                                 │      opacity: 0.6
│ This is the comment body.       │
└─────────────────────────────────┘

┌─────────────────────────────────┐
│ 👤 username · ⚠️ Failed        │   ← Error state
│                                 │      red border-left
│ This is the comment body.       │
│                                 │
│ [Retry]  [Edit]  [Dismiss]      │   ← Action buttons
└─────────────────────────────────┘
```

**Pending state**: The optimistic comment renders with `opacity: 0.6` and a subtle spinner or "Posting..." label. The comment form closes, the highlight clears, and the comment appears in the sidebar (desktop) or drawer (mobile) at the correct position.

**Success state**: The `isPending` flag is removed when the server response replaces the optimistic entry. The comment transitions to full opacity. A Sonner toast announces: *"Comment posted"* (brief, auto-dismiss after 3s). The `aria-live` region announces the same for screen readers.

**Error state**: Depends on the error category (see below).

#### Error State UI by Category

| Category | Form Behavior | Comment Display | Toast | Action Buttons |
|----------|---------------|----------------|-------|----------------|
| **Validation (422)** | Form reopens with body preserved | Optimistic comment removed (rolled back) | ⚠️ "Couldn't post comment — the PR may have been updated" | "Refresh & Retry" |
| **Auth (401/403)** | Form stays open, body preserved | Optimistic comment removed | 🔒 "Session expired — please sign in again" | "Sign In" (link) |
| **Rate limit (429)** | Form closes normally | Optimistic comment stays with "Queued" badge | ⏱️ "Rate limited — will retry in {N}s" | Countdown timer, auto-retry |
| **Transient (5xx/network)** | Form reopens with body preserved (after 3 retries fail) | Optimistic comment removed | ❌ "Failed to post comment" | "Retry", "Dismiss" |

### Comment Draft Preservation

When a comment submission fails, the user's typed text must not be lost. This is handled at two levels:

1. **In-memory**: The `submitComment` function is called from the comment form component. On error, the error is caught and the form body is **not cleared** — the `setIsCommentFormOpen(true)` state keeps the form visible with the user's text intact.

2. **Cross-page**: If the user needs to re-authenticate (401/403) or refresh the page (stale SHA), store the draft in `sessionStorage`:

```ts
function saveDraft(prNumber: number, filePath: string, lineRange: string, body: string) {
  const key = `gitdoc:draft:${prNumber}:${filePath}:${lineRange}`;
  sessionStorage.setItem(key, JSON.stringify({ body, savedAt: Date.now() }));
}

function loadDraft(prNumber: number, filePath: string, lineRange: string): string | null {
  const key = `gitdoc:draft:${prNumber}:${filePath}:${lineRange}`;
  const data = sessionStorage.getItem(key);
  if (!data) return null;
  const parsed = JSON.parse(data);
  // Expire drafts after 1 hour
  if (Date.now() - parsed.savedAt > 3600_000) {
    sessionStorage.removeItem(key);
    return null;
  }
  return parsed.body;
}
```

On page load or file navigation, check for a saved draft and pre-fill the comment form if one exists. Show a subtle indicator: *"Restored unsaved comment"*.

### Reply Submission

Reply submission (`POST /repos/{owner}/{repo}/pulls/{pull_number}/comments/{comment_id}/replies`) follows the same optimistic pattern but is simpler:

- **Optimistic update**: Append the reply to the thread's replies array in the SWR cache.
- **Rollback**: Remove the optimistic reply on error.
- **Error handling**: Same 4-category classification. The most common error for replies is 404 (parent comment was deleted) — show *"The original comment was deleted."*
- **No stale SHA risk**: Replies use `in_reply_to` (comment ID), not `commit_id` + `line`. The reply endpoint only requires `body` — it's less error-prone than new comment creation.

### Integration with Existing Design

The optimistic UI pattern integrates with several existing design decisions:

1. **SWR cache** (from Caching Strategy section): The `mutate()` function directly manipulates the SWR cache for `comments`. The `refreshInterval: 30_000` polling ensures eventual consistency — even if the optimistic update or rollback has a subtle bug, the next poll corrects it.

2. **Comment form state** (from Selection Range Preservation section): The `isCommentFormOpen` flag that guards `onClearSelection` also serves to keep the form visible on error, preserving the user's draft.

3. **Sonner toast** (from UI Framework section): Error/success notifications use Sonner, which is already in the shadcn/ui stack and provides `aria-live` announcements for accessibility.

4. **`aria-live` status region** (from Accessibility section): Comment submission status ("posting...", "posted successfully", "failed") is announced via the persistent live region designed in the Accessibility section.

5. **Rate limit monitoring** (from Caching Strategy section): The `x-ratelimit-remaining` header forwarded from the GitHub API proxy is used to detect rate limit errors and display the pre-emptive warning banner when approaching the limit.

### Edge Cases

- **Concurrent comment submissions**: If the user submits two comments rapidly (e.g., on different passages), both get separate optimistic entries. SWR handles concurrent mutations correctly — each `mutate()` call operates on the latest cache state via the function form of `optimisticData`.
- **Comment submitted but response lost**: If the POST succeeds on GitHub but the response is lost (network drops after server processes), the comment exists on GitHub but not in our cache. The `revalidate: true` option on `mutate()` triggers a re-fetch after the mutation settles, which will pick up the server-created comment. The duplicate-detection logic isn't needed because SWR's re-fetch replaces the entire comment list.
- **PR force-pushed during typing**: The user may type a long comment while someone force-pushes the PR branch. The 422 error on submission is the first signal. The "Refresh & Retry" flow should re-fetch the PR head SHA and diff, then check if the target lines still exist in the new diff before re-submitting.
- **Offline submission**: If the device goes offline, `fetch` throws a network error. The 3-retry loop with backoff handles transient disconnections. For prolonged offline scenarios, show *"You're offline. Your comment will be saved and submitted when you reconnect."* — but this is a post-MVP enhancement (requires service worker or `navigator.onLine` detection).
- **Empty comment body**: Validate on the client side before submission — don't send empty `body` to the API. The submit button should be disabled when the textarea is empty.

## Next.js API Route Structure

### Design Rationale

All GitHub API calls are proxied through Next.js API routes (Route Handlers). This serves three purposes:

1. **Token security**: The user's GitHub OAuth token is stored in an encrypted HTTP-only cookie (`iron-session`). Client-side code never sees the token — the API route reads it from the session and attaches it to GitHub API requests server-side.
2. **Caching**: The server-side caching layer (ETag-based conditional requests + SHA-keyed content cache from the Caching Strategy section) runs in the API routes, reducing redundant GitHub API calls.
3. **Response shaping**: API routes transform GitHub's raw responses into the shapes the frontend needs, avoiding over-fetching and simplifying client-side code.

### File Structure

```
app/
├── api/
│   ├── auth/
│   │   ├── login/route.ts          # GET  → redirect to GitHub OAuth
│   │   ├── callback/route.ts       # GET  → exchange code for token, set session
│   │   ├── logout/route.ts         # GET  → destroy session
│   │   └── me/route.ts             # GET  → return current user profile
│   └── repos/
│       └── [owner]/
│           └── [repo]/
│               ├── pulls/
│               │   ├── route.ts                    # GET  → list open PRs
│               │   └── [pull_number]/
│               │       ├── route.ts                # GET  → PR detail (head SHA, state)
│               │       ├── files/
│               │       │   └── route.ts            # GET  → list changed files + patches
│               │       ├── comments/
│               │       │   ├── route.ts            # GET  → list review comments
│               │       │   │                       # POST → create new review comment
│               │       │   └── [comment_id]/
│               │       │       └── replies/
│               │       │           └── route.ts    # POST → reply to comment thread
│               │       └── head/
│               │           └── route.ts            # GET  → lightweight SHA polling
│               └── contents/
│                   └── [...path]/
│                       └── route.ts                # GET  → fetch file content (raw)
```

### Shared Auth Helper

Every API route (except `/api/auth/login` and `/api/auth/callback`) must verify the session before proceeding. A shared helper keeps this DRY:

```ts
// lib/auth.ts
import { getIronSession } from 'iron-session';
import { cookies } from 'next/headers';

interface SessionData {
  githubToken?: string;
  githubLogin?: string;
  avatarUrl?: string;
}

const sessionOptions = {
  password: process.env.SESSION_SECRET!,
  cookieName: 'gitdoc_session',
  ttl: 60 * 60 * 24 * 30,
  cookieOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
  },
};

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), sessionOptions);
}

/** Returns the session if authenticated, or a 401 Response. */
export async function requireAuth(): Promise<
  { session: SessionData & { githubToken: string }; error?: never } |
  { session?: never; error: Response }
> {
  const session = await getSession();
  if (!session.githubToken) {
    return { error: Response.json({ error: 'Unauthorized', category: 'auth' }, { status: 401 }) };
  }
  return { session: session as SessionData & { githubToken: string } };
}
```

### Standardised Error Response Format

All API routes return errors in a consistent shape that the frontend `ApiError` class (from the Error Handling section) can parse:

```ts
interface ApiErrorResponse {
  error: string;           // Human-readable message
  category: 'validation' | 'auth' | 'rate_limit' | 'transient' | 'unknown';
  retryAfter?: number;     // Seconds until rate limit resets (only for rate_limit)
  details?: unknown;       // Optional structured error data from GitHub
}
```

Example error responses:

| Status | Body |
|--------|------|
| 401 | `{ "error": "Unauthorized", "category": "auth" }` |
| 403 (rate limit) | `{ "error": "Rate limit exceeded", "category": "rate_limit", "retryAfter": 3542 }` |
| 403 (SSO) | `{ "error": "SAML SSO required", "category": "auth", "details": { "ssoUrl": "https://..." } }` |
| 422 | `{ "error": "Validation failed: commit_id is stale", "category": "validation" }` |
| 502 | `{ "error": "GitHub API error", "category": "transient" }` |

### GitHub API Proxy Helper

A shared function handles the GitHub fetch, ETag caching, rate-limit header forwarding, and error classification:

```ts
// lib/github.ts
import { LRUCache } from 'lru-cache';

interface CacheEntry {
  data: unknown;
  etag?: string;
  timestamp: number;
}

const cache = new LRUCache<string, CacheEntry>({
  max: 500,
  maxSize: 50_000_000,
  sizeCalculation: (value) => JSON.stringify(value.data).length,
  ttl: 1000 * 60 * 60, // 1h default, overridden per-entry
});

export async function githubFetch(
  url: string,
  token: string,
  options?: {
    method?: string;
    body?: unknown;
    cacheTtl?: number;   // 0 = no cache
    cacheKey?: string;   // Override the default URL-based key
  },
): Promise<{ data: unknown; status: number; headers: Headers }> {
  const method = options?.method ?? 'GET';
  const key = options?.cacheKey ?? url;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  // ETag conditional request (GET only)
  if (method === 'GET') {
    const cached = cache.get(key);
    if (cached?.etag) {
      headers['If-None-Match'] = cached.etag;
    }
  }

  const fetchOptions: RequestInit = { method, headers };
  if (options?.body) {
    headers['Content-Type'] = 'application/json';
    fetchOptions.body = JSON.stringify(options.body);
  }

  const res = await fetch(url, fetchOptions);

  // 304 Not Modified — return cached data (free request)
  if (res.status === 304) {
    const cached = cache.get(key);
    if (cached) return { data: cached.data, status: 200, headers: res.headers };
  }

  const data = await res.json();

  // Cache successful GET responses
  if (method === 'GET' && res.ok) {
    const etag = res.headers.get('etag') ?? undefined;
    const ttl = options?.cacheTtl;
    cache.set(key, { data, etag, timestamp: Date.now() }, { ttl });
  }

  return { data, status: res.status, headers: res.headers };
}

/** Classify a GitHub API error response into our standard format. */
export function classifyGitHubError(
  status: number,
  headers: Headers,
  data: unknown,
): { error: string; category: string; retryAfter?: number; details?: unknown } {
  // Rate limit
  const remaining = headers.get('x-ratelimit-remaining');
  if (status === 403 && remaining === '0') {
    const reset = headers.get('x-ratelimit-reset');
    const retryAfter = reset
      ? Math.max(0, Number(reset) - Math.floor(Date.now() / 1000))
      : undefined;
    return { error: 'Rate limit exceeded', category: 'rate_limit', retryAfter };
  }
  if (status === 429) {
    const retryAfter = Number(headers.get('retry-after')) || undefined;
    return { error: 'Secondary rate limit exceeded', category: 'rate_limit', retryAfter };
  }

  // SAML SSO
  const ssoHeader = headers.get('x-github-sso');
  if (status === 403 && ssoHeader) {
    const urlMatch = ssoHeader.match(/url=([^\s;]+)/);
    return {
      error: 'SAML SSO required',
      category: 'auth',
      details: { ssoUrl: urlMatch?.[1] },
    };
  }

  // Auth
  if (status === 401 || status === 403) {
    return { error: 'Authentication failed', category: 'auth' };
  }

  // Validation
  if (status === 422) {
    return { error: 'Validation failed', category: 'validation', details: data };
  }

  // Not found (may also be SAML-masked private repo)
  if (status === 404) {
    return { error: 'Not found', category: 'validation' };
  }

  // Transient
  if (status >= 500) {
    return { error: `GitHub server error (${status})`, category: 'transient' };
  }

  return { error: `HTTP ${status}`, category: 'unknown' };
}
```

### Middleware

Next.js middleware (`middleware.ts` at project root) is used for a lightweight auth gate on all `/api/repos/` routes. It checks for the presence of the session cookie — if absent, it short-circuits with a 401 before the route handler runs. This avoids decrypting the cookie in every route handler for unauthenticated requests:

```ts
// middleware.ts
import { NextRequest, NextResponse } from 'next/server';

export const config = {
  matcher: ['/api/repos/:path*'],
};

export function middleware(request: NextRequest) {
  const sessionCookie = request.cookies.get('gitdoc_session');
  if (!sessionCookie?.value) {
    return NextResponse.json(
      { error: 'Unauthorized', category: 'auth' },
      { status: 401 },
    );
  }
  // Cookie exists — proceed to route handler for full decryption + validation
  return NextResponse.next();
}
```

Note: This is an **optimistic check** — the cookie's presence doesn't guarantee it's valid (it could be expired or corrupted). The route handler still calls `requireAuth()` to decrypt and validate the session. But the middleware eliminates the overhead of running the full route handler for completely unauthenticated requests.

### Route-by-Route Specification

#### Auth Routes (already designed in Authentication Model section)

| Route | Method | Purpose | Auth | Request | Response |
|-------|--------|---------|------|---------|----------|
| `/api/auth/login` | GET | Redirect to GitHub OAuth | No | `?returnTo=/path` (optional) | 302 redirect to `github.com/login/oauth/authorize` |
| `/api/auth/callback` | GET | Exchange code for token | No | `?code=...&state=...` (from GitHub) | 302 redirect to app (or `returnTo`) |
| `/api/auth/logout` | GET | Destroy session | Yes | — | 302 redirect to `/` |
| `/api/auth/me` | GET | Current user profile | Yes | — | `{ login, avatarUrl, name }` |

#### PR Routes

**`GET /api/repos/[owner]/[repo]/pulls`** — List open PRs

| Field | Value |
|-------|-------|
| GitHub endpoint | `GET /repos/{owner}/{repo}/pulls?state=open&sort=updated&per_page=30` |
| Cache | Short TTL (30s), ETag conditional requests |
| Query params | `page` (pagination) |
| Response shape | `{ pulls: Array<{ number, title, user: { login, avatarUrl }, headSha, updatedAt, draft }> }` |

Only the fields the frontend needs are returned — not the full GitHub PR object.

**`GET /api/repos/[owner]/[repo]/pulls/[pull_number]`** — PR detail

| Field | Value |
|-------|-------|
| GitHub endpoint | `GET /repos/{owner}/{repo}/pulls/{pull_number}` |
| Cache | Short TTL (30s), ETag |
| Response shape | `{ number, title, state, draft, headSha, baseSha, user: { login, avatarUrl }, updatedAt }` |

**`GET /api/repos/[owner]/[repo]/pulls/[pull_number]/files`** — Changed files with patches

| Field | Value |
|-------|-------|
| GitHub endpoint | `GET /repos/{owner}/{repo}/pulls/{pull_number}/files?per_page=100` |
| Cache | Keyed by `{owner}/{repo}/pulls/{n}/files/{headSha}` — stable while head SHA unchanged. Uses ETag. |
| Response shape | `{ files: Array<{ filename, status, additions, deletions, patch?, sha }> }` |
| Notes | Filters to `.md`/`.mdx` files on the server side to reduce payload. Includes `patch` field (may be absent for large diffs — see Handling Missing Patch section). Handles pagination if >100 files. |

**`GET /api/repos/[owner]/[repo]/pulls/[pull_number]/comments`** — Review comments

| Field | Value |
|-------|-------|
| GitHub endpoint | `GET /repos/{owner}/{repo}/pulls/{pull_number}/comments?per_page=100` |
| Cache | Very short TTL (10s), ETag conditional requests |
| Query params | `path` (optional — filter by file path server-side) |
| Response shape | `{ comments: Array<{ id, body, user: { login, avatarUrl }, path, line, startLine?, side, inReplyToId?, createdAt, updatedAt }> }` |
| Notes | If `path` query param is provided, filters comments to that file path server-side. Returns all comments for the PR otherwise. The `inReplyToId` field is used by the frontend to group comments into threads. |

**`POST /api/repos/[owner]/[repo]/pulls/[pull_number]/comments`** — Create review comment

| Field | Value |
|-------|-------|
| GitHub endpoint | `POST /repos/{owner}/{repo}/pulls/{pull_number}/comments` |
| Cache | No cache. Invalidates the comments cache for this PR after success. |
| Request body | `{ body: string, path: string, line: number, startLine?: number, commitId: string }` |
| Response shape | `{ id, body, user: { login, avatarUrl }, path, line, startLine?, createdAt }` |
| Notes | Maps `commitId` → `commit_id`, `startLine` → `start_line`, adds `side: "RIGHT"` automatically (GitDoc only shows head-ref). |
| Validation | Reject empty `body` with 422 before calling GitHub. |

**`POST /api/repos/[owner]/[repo]/pulls/[pull_number]/comments/[comment_id]/replies`** — Reply to thread

| Field | Value |
|-------|-------|
| GitHub endpoint | `POST /repos/{owner}/{repo}/pulls/{pull_number}/comments/{comment_id}/replies` |
| Cache | No cache. Invalidates the comments cache after success. |
| Request body | `{ body: string }` |
| Response shape | `{ id, body, user: { login, avatarUrl }, createdAt }` |
| Notes | Simpler than creating a new comment — no `commit_id`, `path`, or `line` needed. Only requires `body`. |

**`GET /api/repos/[owner]/[repo]/pulls/[pull_number]/head`** — Lightweight SHA polling

| Field | Value |
|-------|-------|
| GitHub endpoint | `GET /repos/{owner}/{repo}/pulls/{pull_number}` |
| Cache | ETag only (no TTL cache — always check with GitHub via conditional request) |
| Response shape | `{ headSha: string, state: string, updatedAt: string }` |
| Notes | Intentionally minimal response — only the fields needed for stale SHA detection. The frontend polls this every 60s via SWR's `refreshInterval`. Includes `state` so the frontend can detect closed/merged PRs. |

#### Content Routes

**`GET /api/repos/[owner]/[repo]/contents/[...path]`** — Fetch file content

| Field | Value |
|-------|-------|
| GitHub endpoint | `GET /repos/{owner}/{repo}/contents/{path}?ref={sha}` |
| Cache | **Immutable** — keyed by `{owner}/{repo}/{sha}/{path}`, indefinite TTL. Content at a specific SHA never changes. |
| Query params | `ref` (required — commit SHA) |
| Response shape | `{ content: string, sha: string, encoding: "utf-8" }` |
| Notes | GitHub returns base64-encoded content. The API route decodes it to UTF-8 before returning. Uses Next.js catch-all segment `[...path]` to handle nested file paths (e.g., `docs/guide/intro.md`). Also serves as the **image proxy** for private repos: if the requested path is an image (detected by extension or GitHub's response `Content-Type`), the route streams the raw bytes with the correct `Content-Type` header instead of returning JSON. |

### Request Processing Pipeline

Each API route follows the same processing pipeline. This is implemented as composable helper functions, not middleware wrapping:

```
1. requireAuth()         → Check session, return 401 if missing
2. Parse params + query  → Extract [owner], [repo], query params
3. Validate request      → Check required fields (body for POST)
4. githubFetch()         → Call GitHub API with token, ETag, cache
5. Check response        → If error, classifyGitHubError() → return error response
6. Transform response    → Shape GitHub data into frontend-friendly format
7. Forward rate headers  → Copy x-ratelimit-remaining/reset to response
8. Return JSON           → NextResponse.json(data, { status, headers })
```

Example route handler:

```ts
// app/api/repos/[owner]/[repo]/pulls/[pull_number]/comments/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { githubFetch, classifyGitHubError } from '@/lib/github';

type RouteParams = {
  params: Promise<{ owner: string; repo: string; pull_number: string }>;
};

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { owner, repo, pull_number } = await params;
  const path = request.nextUrl.searchParams.get('path');

  const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${pull_number}/comments?per_page=100`;
  const { data, status, headers } = await githubFetch(url, session.githubToken, {
    cacheTtl: 10_000,
  });

  if (status !== 200) {
    return NextResponse.json(classifyGitHubError(status, headers, data), { status });
  }

  let comments = (data as any[]).map((c) => ({
    id: c.id,
    body: c.body,
    user: { login: c.user.login, avatarUrl: c.user.avatar_url },
    path: c.path,
    line: c.line,
    startLine: c.start_line ?? undefined,
    side: c.side,
    inReplyToId: c.in_reply_to_id ?? undefined,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  }));

  // Server-side filter by path if requested
  if (path) {
    comments = comments.filter((c) => c.path === path);
  }

  // Forward rate limit headers for frontend monitoring
  const res = NextResponse.json({ comments });
  const remaining = headers.get('x-ratelimit-remaining');
  const reset = headers.get('x-ratelimit-reset');
  if (remaining) res.headers.set('x-ratelimit-remaining', remaining);
  if (reset) res.headers.set('x-ratelimit-reset', reset);
  return res;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { owner, repo, pull_number } = await params;
  const body = await request.json();

  // Client-side validation
  if (!body.body?.trim()) {
    return NextResponse.json(
      { error: 'Comment body is required', category: 'validation' },
      { status: 422 },
    );
  }

  const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${pull_number}/comments`;
  const { data, status, headers } = await githubFetch(url, session.githubToken, {
    method: 'POST',
    body: {
      body: body.body,
      commit_id: body.commitId,
      path: body.path,
      line: body.line,
      start_line: body.startLine,
      side: 'RIGHT',
    },
  });

  if (status !== 201) {
    return NextResponse.json(classifyGitHubError(status, headers, data), { status });
  }

  const comment = data as any;
  return NextResponse.json({
    id: comment.id,
    body: comment.body,
    user: { login: comment.user.login, avatarUrl: comment.user.avatar_url },
    path: comment.path,
    line: comment.line,
    startLine: comment.start_line ?? undefined,
    createdAt: comment.created_at,
  }, { status: 201 });
}
```

### Rate Limit Header Forwarding

All API routes forward GitHub's rate limit headers to the frontend:

- `x-ratelimit-remaining` — requests left in the current window
- `x-ratelimit-reset` — UTC epoch seconds when the window resets

The frontend uses these to show a pre-emptive warning when approaching the limit (as designed in the Caching Strategy section's Rate Limit Monitoring subsection).

### Image Proxy for Private Repos

The `GET /api/repos/[owner]/[repo]/contents/[...path]` route doubles as an image proxy. When the requested file is an image (detected by extension: `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.webp`):

1. Fetch via GitHub Contents API with `Accept: application/vnd.github.raw+json` to get raw bytes
2. Stream the response body directly with the correct `Content-Type` header
3. Set `Cache-Control: public, max-age=31536000, immutable` (content at a SHA never changes)

The `urlTransform` function (from the Resolving Relative Image Paths section) rewrites image URLs to point to this proxy route instead of `raw.githubusercontent.com`:

```ts
// For private repos (or all repos for simplicity):
return `/api/repos/${owner}/${repo}/contents/${resolved}?ref=${headSha}`;
```

### Frontend SWR Integration

The frontend uses SWR (as designed in the Caching Strategy section) to fetch from these API routes. The route structure maps directly to SWR cache keys:

```ts
// hooks/use-pr-files.ts
const { data } = useSWR(
  `/api/repos/${owner}/${repo}/pulls/${prNumber}/files`,
  fetcher,
);

// hooks/use-pr-comments.ts
const { data, mutate } = useSWR(
  `/api/repos/${owner}/${repo}/pulls/${prNumber}/comments?path=${encodeURIComponent(filePath)}`,
  fetcher,
  { refreshInterval: 30_000 },
);

// hooks/use-pr-head-sha.ts (stale SHA polling)
const { data } = useSWR(
  `/api/repos/${owner}/${repo}/pulls/${prNumber}/head`,
  fetcher,
  { refreshInterval: 60_000, revalidateOnFocus: true },
);
```

### Edge Cases

- **Pagination**: GitHub's `per_page` max is 100. For PRs with >100 changed files or >100 comments, the API route must paginate through all pages before returning. Use the `Link` header from GitHub to detect additional pages. Return the full aggregated list to the frontend.
- **Concurrent requests in serverless**: On Vercel, multiple users may hit different function instances. The in-memory `LRUCache` is per-instance — no shared state. ETags still work because they're forwarded to GitHub regardless of local cache state.
- **Request body size**: Next.js API routes have a default body size limit of 1MB (configurable via `export const config = { api: { bodySize: ... } }` in Pages Router, or response streaming in App Router). Comment bodies are unlikely to exceed this.
- **Path encoding**: The catch-all segment `[...path]` in the contents route receives path segments as an array. Join with `/` to reconstruct the file path. Handle URL-encoded characters (spaces, special chars) correctly.
- **CORS**: Not needed — the frontend and API routes are on the same origin (same Next.js app). No cross-origin requests.

## Stale SHA Detection & Auto-Refresh

### The Problem

When a reviewer opens a PR in GitDoc, the app fetches the PR's head SHA, file content, and diff data. If someone force-pushes the branch (or pushes new commits) while the reviewer has the page open, the stored `head.sha` (used as `commit_id` in comment creation) becomes stale. Submitting a comment with the old `commit_id` results in a `422 Validation Failed` from the GitHub API because the line numbers may no longer be valid against the new commit.

The Error Handling section already covers the 422 recovery flow. This section addresses **proactive detection** — alerting the user that the PR has been updated before they attempt to comment.

### Detection Approach: Polling with ETag Conditional Requests

**Recommended**: Poll `GET /repos/{owner}/{repo}/pulls/{pull_number}` at a regular interval, comparing the returned `head.sha` against the stored value from initial page load.

**Why polling (not webhooks/SSE)**:
- **Webhooks** require a server endpoint to receive `push` events from GitHub. GitDoc's Next.js API routes could handle this, but it introduces complexity: webhook registration, signature verification, and a mechanism to push updates to the specific browser tab (WebSocket or SSE from our server). This is over-engineered for MVP.
- **Server-Sent Events / WebSocket from GitHub**: GitHub does not offer a public SSE or WebSocket API for real-time PR updates. Their web UI uses internal channels not available to third-party apps.
- **Polling is simple, proven, and rate-limit-friendly**: Using ETag conditional requests, 304 responses do NOT count against the rate limit (when `Authorization` header is present). This makes frequent polling essentially free.

### Polling Strategy

**Interval**: 60 seconds. This balances freshness with request volume. Force-pushes during active review sessions are infrequent — a 60-second detection window is acceptable.

**ETag usage**: Store the `ETag` header from the `GET /pulls/{n}` response. On subsequent polls, send `If-None-Match`. If the response is 304 (unchanged), the PR hasn't been updated — no rate limit cost. If the response is 200, compare `head.sha`.

**Implementation via SWR polling**: The existing SWR-based data fetching layer (from the Caching Strategy section) can handle this naturally:

```tsx
// hooks/use-pr-head-sha.ts
import useSWR from 'swr';

interface PrHeadInfo {
  headSha: string;
  updatedAt: string;
}

function usePrHeadSha(
  owner: string,
  repo: string,
  prNumber: number,
  initialHeadSha: string,
) {
  const { data } = useSWR<PrHeadInfo>(
    `/api/repos/${owner}/${repo}/pulls/${prNumber}/head`,
    fetcher,
    {
      refreshInterval: 60_000, // poll every 60s
      revalidateOnFocus: true, // also check when user returns to tab
    }
  );

  const isStale = data ? data.headSha !== initialHeadSha : false;

  return {
    currentHeadSha: data?.headSha ?? initialHeadSha,
    isStale,
  };
}
```

The API route `/api/repos/{owner}/{repo}/pulls/{n}/head` is a lightweight proxy that calls `GET /pulls/{n}` (with ETag forwarding) and returns only the `head.sha` field — keeping the response payload minimal.

### API Route for SHA Polling

```ts
// app/api/repos/[owner]/[repo]/pulls/[pull_number]/head/route.ts
export async function GET(req: Request, { params }) {
  const { owner, repo, pull_number } = params;
  const session = await getSession();
  if (!session.githubToken) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const data = await fetchWithETag(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${pull_number}`,
    session.githubToken,
    cache,
  );

  return Response.json({
    headSha: data.head.sha,
    updatedAt: data.updated_at,
  });
}
```

This reuses the `fetchWithETag` helper from the Caching Strategy section, so repeated polls that return 304 are free against the rate limit.

### UX: Prompt, Don't Auto-Refresh

**Critical decision**: When a stale SHA is detected, show a **non-intrusive banner** prompting the user to refresh — do NOT auto-refresh. Reasons:

1. **Unsaved comment drafts**: The user may be mid-comment. Auto-refreshing would discard their work (or require complex draft preservation logic to execute atomically with a refresh).
2. **Reading context**: The user may be in the middle of reading a section. Auto-refreshing re-renders the markdown, potentially losing scroll position and mental context.
3. **Force-push may not affect the current file**: A force-push might change unrelated files. The user's current view may still be valid. Let them decide.

**Banner design**:

```
┌──────────────────────────────────────────────────────────────────┐
│ ℹ️  This PR has been updated with new commits.                   │
│     The content and commentable regions may have changed.        │
│     [Refresh Now]  [Dismiss]                                     │
└──────────────────────────────────────────────────────────────────┘
```

- Positioned at the top of the document area (below the header, above the rendered markdown).
- Uses `role="status"` (`aria-live="polite"`) for screen reader announcement — it's informational, not urgent.
- **Dismiss** hides the banner until the next SHA change detection. The user can continue working, but should be aware that commenting may fail.
- **Refresh Now** triggers the re-sync flow described below.

### Re-Sync Flow on Refresh

When the user clicks "Refresh Now":

1. **Save comment drafts**: Before re-fetching, persist any open comment form text to `sessionStorage` using the draft preservation pattern from the Error Handling section (`gitdoc:draft:{prNumber}:{filePath}:{lineRange}`).

2. **Re-fetch PR data**: Fetch the new `head.sha` from `GET /pulls/{n}` (if not already available from the polling response).

3. **Re-fetch file content**: Fetch the file content at the new SHA via `GET /contents/{path}?ref={newHeadSha}`. This is an immutable-content fetch keyed by SHA — if the content hasn't changed between the old and new SHA, the cache from the Caching Strategy section may still be valid (but the SHA is different, so it's a cache miss unless the file content is literally identical).

4. **Re-fetch diff and rebuild commentable lines**: Fetch `GET /pulls/{n}/files` (the diff may have changed). Parse the new `patch` field and rebuild the `commentableLines: Set<number>` for each file.

5. **Re-render markdown**: The new file content triggers a React re-render. The rehype plugins re-annotate all elements with updated `data-source-start`, `data-source-end`, and `data-commentable` attributes based on the new diff.

6. **Re-fetch comments**: The comment list may also have changed (new comments from other reviewers, or comments that are now on outdated lines). Trigger an SWR revalidation of the comments cache.

7. **Restore comment drafts**: After re-render, check `sessionStorage` for saved drafts. If a draft exists for the current file, check if the target line range still exists in the new diff. If yes, pre-fill the comment form. If the lines are no longer commentable (e.g., the line was removed in the force-push), show a notification: *"Your draft comment on lines N–M can no longer be placed — those lines are no longer part of the diff."* Keep the draft text in the notification so the user can copy it.

8. **Update stored head SHA**: Replace `initialHeadSha` with the new value so future polls compare against the latest known SHA.

### Scroll Position Preservation

On refresh, the markdown content may change (new content, removed content, reordered sections). Preserving exact scroll position is best-effort:

- **Before refresh**: Record the `data-source-start` of the element currently at the top of the viewport (using `IntersectionObserver` or manual calculation).
- **After re-render**: Find the element with the same `data-source-start` value and `scrollIntoView()` it. If that line no longer exists, scroll to the nearest available line.
- **Fallback**: If the file content has changed significantly, scroll to the top and let the user navigate.

### Interaction with Comment Submission

The stale SHA detection integrates with the Error Handling section's 422 recovery flow:

1. **Proactive path** (preferred): Polling detects the SHA change → banner shown → user refreshes → comment submitted with new SHA. No error.
2. **Reactive path** (fallback): User submits comment before the next poll cycle → 422 error → error handler shows "PR was updated" message → user clicks "Refresh & Retry" → same re-sync flow as above.

Both paths converge on the same re-sync logic. The proactive path is better UX because the user is warned before losing time on a comment that would fail.

### Rate Limit Impact

- **Polling cost**: One `GET /pulls/{n}` request every 60 seconds. With ETag, most polls return 304 (free). In a 1-hour session, this costs ~0–2 actual requests (only charged when the PR is updated).
- **Re-sync cost**: On refresh, 3–4 requests: `GET /pulls/{n}` (already fetched), `GET /pulls/{n}/files` (diff), `GET /contents/{path}?ref={sha}` (file content), `GET /pulls/{n}/comments` (comments). Total: ~4 requests per refresh event.
- **Compared to budget**: 5,000 requests/hour per user. The stale detection system adds negligible overhead.

### Edge Cases

- **Rapid successive pushes**: If the PR branch receives multiple pushes in quick succession (e.g., CI auto-fixers), the 60-second poll interval means we might miss intermediate SHAs. This is fine — we only care about the latest `head.sha` at poll time.
- **PR closed/merged while viewing**: The `GET /pulls/{n}` response includes a `state` field (`open`, `closed`). If the PR is merged or closed during the session, show a different banner: *"This PR has been merged/closed."* with a link to the GitHub PR page.
- **Network offline during poll**: SWR handles failed fetches gracefully — it retries on the next interval. The user continues working with stale data until connectivity is restored.
- **Tab backgrounded**: SWR's `revalidateOnFocus: true` triggers a poll when the user returns to the tab after it was backgrounded. This catches updates that happened while the tab was inactive, without wasting requests during inactivity.
- **Multiple files open**: If the user navigates between files in the same PR, the SHA polling is per-PR (not per-file). A single poll covers all files. The re-sync flow should update all cached file data, not just the current file.
- **Comment form open when banner appears**: If the user has an open comment form when the stale banner appears, do NOT close the form or clear the draft. Show the banner above the content area. If the user submits the comment, it may succeed (if the target lines haven't changed) or fail with 422 (handled by the error flow). If they click "Refresh Now", save the draft first.

### Recommendation

**MVP**: Implement SWR-based polling with 60-second interval, ETag conditional requests, and a simple top-of-page banner with "Refresh Now" / "Dismiss" buttons. On refresh, re-fetch file content + diff, rebuild commentable lines, and preserve/restore comment drafts.

**Post-MVP enhancements**:
- **Smart diff comparison**: On SHA change, compute whether the *current file* actually changed (compare file SHA from the files list). If the current file is unchanged, show a less urgent banner: *"Other files in this PR were updated. Your current view is still valid."*
- **Webhook-based push notification**: If GitDoc migrates to a GitHub App, register for `push` webhooks and forward to the client via SSE. This would reduce detection latency from 60s to near-real-time.
- **Incremental re-sync**: Instead of re-fetching everything, diff the old and new file lists to determine which files changed. Only re-fetch content/diff for changed files.

# Things to Explore
- [x] What should be the architecture of the service?
- [x] Where will it be deployed? — Vercel recommended (zero-config Next.js, serverless, preview deploys). Docker standalone as self-hosted fallback. No Block-internal infrastructure dependency identified.
- [x] How will comments be attributable to the github user? — Both OAuth App and GitHub App user-access tokens attribute comments to the authenticated user. OAuth has no badge; GitHub App adds a small identicon badge.
- [x] Be sure to align the comments 1:1 with line comments in the underlying PRs
- [x] How to build the diff-line mapping: fetch the diff, parse it, and determine which source lines are commentable
- [x] Source-line tracking in rendered markdown: rehype plugin approach to attach `data-source-start`/`data-source-end` attributes (position data flows mdast → hast → DOM)
- [x] How to handle text selection UX: map a DOM selection range back to source lines
- [x] How to resolve relative image paths in markdown to the PR branch head
- [x] Caching strategy: cache file content and diff per commit SHA to respect GitHub rate limits
- [x] What UI framework/component library to use (e.g., Tailwind, shadcn/ui, Radix)
- [x] How to visually indicate commentable vs non-commentable regions in the rendered markdown (only ~3 context lines around each change are commentable)
- [x] Handle missing/truncated `patch` field for very large diffs — graceful degradation to read-only mode
- [x] Line-level commenting within fenced code blocks — solved via line-wrapping rehype plugins that split the single `pre > code > text` structure into per-line `<span>` or `<div>` elements, each with a `data-source-start` attribute computed from the code block's `position.start.line`
- [x] How to handle keyboard-based text selection (Shift+Arrow) — Solved: use `selectionchange` as primary event with mouse-state tracking and input-aware debouncing (10ms for mouse, 100ms for keyboard). Pattern proven by Hypothesis client's `SelectionObserver`. No need for separate `keyup` listener — `selectionchange` fires universally for all selection methods (keyboard, mouse, assistive tech, caret browsing).
- [x] Touch device support for select-to-comment — No explicit `touchend`/`touchstart` needed; `selectionchange` fires universally on touch. Position comment anchor BELOW selection on touch (native toolbar goes above). Detect touch via `(pointer: coarse)` media query. MVP recommendation: desktop-first, mobile as read-only/degraded. Validated by Hypothesis client's identical approach.
- [x] Evaluate `next-auth` (Auth.js) vs manual `iron-session` implementation for the GitHub OAuth flow — **`iron-session` recommended**. Auth.js is in maintenance mode (joined Better Auth Sep 2025), overkill for single-provider OAuth. Better Auth is over-engineered for GitDoc's needs. `iron-session` gives minimal abstraction, direct token access, no database, ~5KB bundle.
- [x] SAML SSO handling — **Not a concern for MVP (OAuth App)**. OAuth App and GitHub App tokens are "automatically authorized for SAML SSO" per GitHub docs. Only PATs (classic) need manual SSO authorization. If migrating to GitHub App post-MVP, users must have an active SAML session when they first authorize the app; the `X-GitHub-SSO` header on 403 responses provides a re-auth URL. See SAML SSO section in design doc.
- [x] Responsive layout design: how should the two-column layout (content + comment margin) adapt for mobile viewports (<768px)? — Bottom drawer pattern using shadcn/ui's `Drawer` component (Vaul-based, swipe-to-dismiss). On desktop (≥768px), right-margin column for comments; on mobile (<768px), full-width rendered markdown with bottom drawer for comment threads, triggered by a floating comment count badge or tapping on comment indicators. Uses `useMediaQuery`/`useIsMobile` hook for responsive switching. See Responsive Layout section in design doc.
- [x] Selection range preservation: when the user taps the comment textarea, focus shifts and mobile browsers may clear the text selection. — **Solved**: Don't store the DOM `Range` — extract source line numbers, selected text, and positioning as plain data (`SelectionInfo`) immediately when the selection is detected. Guard `onClearSelection` with an `isCommentFormOpen` flag to prevent clearing stored data when the textarea gains focus. Apply a CSS highlight class on the selected passage using stored line numbers as a visual substitute for the cleared native selection. See Selection Range Preservation section in design doc.
- [x] Accessibility audit: ensure comment UX meets WCAG 2.1 AA — **Comprehensive section added.** Key findings: (1) Use visually-hidden `<button>` elements per commentable region for keyboard/screen reader access (don't pollute prose with `aria-label`). (2) Comment thread list uses WAI-ARIA feed pattern (`role="feed"` + `role="article"` with `aria-posinset`/`aria-setsize`, Page Down/Up navigation). (3) Comment form is a non-modal `role="dialog"` with auto-focus textarea, `aria-describedby` for line context, Escape-to-close with return focus. (4) Status messages via `aria-live` regions (`role="status"` for success/info, `role="alert"` for errors). (5) Gutter bar must meet WCAG 1.4.11 non-text contrast (≥3:1) — recommend `blue-500` over `blue-400`. (6) Radix/shadcn components cover Popover, Dialog, Collapsible, Tooltip accessibility out of the box. See Accessibility section in design doc.
- [x] Error handling & optimistic UI for comment submission: what happens when a comment POST fails? Design retry logic, error state display, and optimistic UI update pattern. — **Comprehensive section added.** Uses SWR's `mutate()` with `optimisticData` + `rollbackOnError` for cache-based optimistic updates. Error classification into 4 categories (validation 422, auth 401/403, rate limit 403/429, transient 5xx/network). No automatic retry for 4xx; exponential backoff for transient failures. Sonner toast for success/error feedback. Visual "pending" state on optimistic comments (reduced opacity, spinner). `isCommentFormOpen` state persists comment body on error for easy resubmission. See Error Handling & Optimistic UI section in design doc.
- [x] Stale SHA detection & auto-refresh: Designed polling-based detection using `GET /pulls/{n}` with ETag conditional requests (304s are free against rate limits). Poll every 60s, compare `head.sha` against stored value. On change: show a non-intrusive banner prompting the user to refresh (don't auto-refresh — user may have unsaved comment drafts). On refresh: re-fetch file content + diff, rebuild `commentableLines` set, preserve comment drafts in `sessionStorage`. Webhooks/SSE rejected for MVP — require server infrastructure and don't work for pure-client apps. See Stale SHA Detection section in design doc.
- [x] Next.js API route structure: defined complete set of API routes — 4 auth routes, 7 GitHub proxy routes (PR list, PR detail, files, comments GET/POST, replies POST, SHA polling), 1 content/image proxy route. Designed shared `requireAuth()` helper, `githubFetch()` with ETag caching, `classifyGitHubError()` for standardised error responses. Middleware optimistically gates `/api/repos/*` on session cookie presence. All errors use `{ error, category, retryAfter?, details? }` format matching the frontend `ApiError` class. Response shapes transform GitHub snake_case to camelCase. See Next.js API Route Structure section in design doc.
- [ ] Comment threading & display: design how to group flat GitHub review comments into threaded conversations (using `in_reply_to_id`), position them in the right margin aligned with their target source lines, handle overlapping thread positions, and manage scroll-sync between document passages and comment threads.

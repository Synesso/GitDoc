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

**Recommended approach**: Use `selectstart` + `mouseup` events (not `selectionchange`).

- **`selectstart`** (on `document`): Fires when a new selection begins. Use this to clear any previously visible comment anchor/popover — prevents stale UI.
- **`mouseup`** (on `document`): Fires when the user finishes selecting. At this point, read `document.getSelection()` to get the final selection. This avoids the "jumpy" UX of repositioning the comment button on every character during drag-selection.
- **`selectionchange`** (on `document`): An alternative that fires continuously as the selection changes. Good for live feedback, but causes constant re-renders and repositioning — not ideal for a comment anchor that should only appear after selection is complete.
- **Keyboard selection**: `mouseup` doesn't catch Shift+Arrow selections. To handle this, also listen for `keyup` when the selection is non-empty, or use `selectionchange` with a debounce as a fallback for keyboard-based selection.

**React integration**: Use a `useEffect` hook to attach/detach event listeners:

```tsx
useEffect(() => {
  const onSelectStart = () => setCommentAnchor(null);
  const onMouseUp = () => {
    const sel = document.getSelection();
    if (!sel || sel.isCollapsed) return;
    // ... resolve source lines, check commentability, position anchor
  };
  document.addEventListener('selectstart', onSelectStart);
  document.addEventListener('mouseup', onMouseUp);
  return () => {
    document.removeEventListener('selectstart', onSelectStart);
    document.removeEventListener('mouseup', onMouseUp);
  };
}, []);
```

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

**Library options**:
- **`next-auth`** (Auth.js): Has a built-in GitHub provider. Handles the OAuth flow, session management, and token storage. Well-maintained, widely used with Next.js App Router. This is the path of least resistance.
- **Manual implementation**: More control, fewer dependencies. Use `iron-session` for encrypted cookies. Straightforward since the GitHub OAuth flow is simple (just 3 HTTP requests).
- **Recommendation**: Use `next-auth` with the GitHub provider for MVP — it handles edge cases (CSRF, state validation, session rotation) that are easy to get wrong manually.

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
- `SESSION_SECRET` — Encryption key for HTTP-only auth cookies
- `NEXTAUTH_URL` — Canonical app URL (for OAuth callback)
- `NEXTAUTH_SECRET` — next-auth session encryption (if using next-auth)

All secrets stored via Vercel's encrypted environment variables (or equivalent secrets management on other platforms).

### Edge Runtime Considerations

Some API routes (e.g., the GitHub API proxy) could run on Edge Runtime for lower latency. However, `next-auth` and cookie encryption libraries (`iron-session`) may require Node.js runtime due to crypto API differences. **Recommendation**: Start with Node.js runtime for all API routes; evaluate Edge for read-only routes (PR list, file content) once the app is stable.

# Things to Explore
- [x] What should be the architecture of the service?
- [x] Where will it be deployed? — Vercel recommended (zero-config Next.js, serverless, preview deploys). Docker standalone as self-hosted fallback. No Block-internal infrastructure dependency identified.
- [x] How will comments be attributable to the github user? — Both OAuth App and GitHub App user-access tokens attribute comments to the authenticated user. OAuth has no badge; GitHub App adds a small identicon badge.
- [x] Be sure to align the comments 1:1 with line comments in the underlying PRs
- [x] How to build the diff-line mapping: fetch the diff, parse it, and determine which source lines are commentable
- [x] Source-line tracking in rendered markdown: rehype plugin approach to attach `data-source-start`/`data-source-end` attributes (position data flows mdast → hast → DOM)
- [x] How to handle text selection UX: map a DOM selection range back to source lines
- [x] How to resolve relative image paths in markdown to the PR branch head
- [ ] Caching strategy: cache file content and diff per commit SHA to respect GitHub rate limits
- [x] What UI framework/component library to use (e.g., Tailwind, shadcn/ui, Radix)
- [x] How to visually indicate commentable vs non-commentable regions in the rendered markdown (only ~3 context lines around each change are commentable)
- [ ] Handle missing/truncated `patch` field for very large diffs — graceful degradation to read-only mode
- [ ] Line-level commenting within fenced code blocks: the `pre`/`code` hast element covers the whole block — would need to split code content by newlines for per-line commenting
- [ ] How to handle keyboard-based text selection (Shift+Arrow) — `mouseup` doesn't fire, need `keyup` or debounced `selectionchange` fallback
- [ ] Touch device support for select-to-comment: `touchend` event, conflict with native browser selection toolbar on mobile
- [ ] Evaluate `next-auth` (Auth.js) vs manual `iron-session` implementation for the GitHub OAuth flow — complexity, bundle size, App Router compatibility
- [ ] SAML SSO handling: GitHub App user-access tokens may fail for org resources if the user hasn't started an active SAML session — how to detect and guide users

# Minimal Changes

A checklist of everything that needs to be built, derived from the design document.

## Project Scaffolding

- [x] Initialize Next.js project with App Router, TypeScript, Tailwind CSS — the foundation for all routes and UI
- [x] Install and configure shadcn/ui (Radix primitives) — provides Button, Card, Popover, Drawer, Collapsible, Avatar, Tooltip, Skeleton, Badge, ScrollArea, Dialog, Sonner, DropdownMenu, Textarea
- [x] Install `@tailwindcss/typography` plugin — provides `prose` classes so rendered markdown has proper heading/list/table styling
- [x] Set up environment variables (`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `SESSION_SECRET`, `NEXT_PUBLIC_APP_URL`) — required for OAuth and session encryption

## Authentication

- [x] Install `iron-session` — encrypts the GitHub OAuth token into a stateless HTTP-only cookie
- [x] Create `lib/session.ts` with `getSession()` and `requireAuth()` helpers — shared session access for all API routes
- [ ] Create `GET /api/auth/login` route — generates `state` param, stores in cookie, redirects to GitHub OAuth authorize URL
- [ ] Create `GET /api/auth/callback` route — exchanges `code` for access token, stores token in `iron-session` cookie, redirects to app
- [ ] Create `GET /api/auth/logout` route — calls `session.destroy()`, redirects to `/`
- [ ] Create `GET /api/auth/me` route — returns current user's GitHub profile (login, avatar, name) from session
- [ ] Create `middleware.ts` — optimistic auth gate on `/api/repos/*` that short-circuits with 401 if session cookie is absent

## GitHub API Proxy Layer

- [ ] Create `lib/github.ts` with `githubFetch()` helper — handles Authorization header, ETag conditional requests, LRU cache, and response caching
- [ ] Implement `classifyGitHubError()` — classifies GitHub HTTP errors into `validation`, `auth`, `rate_limit`, `transient`, `unknown` categories
- [ ] Install `lru-cache` — bounded in-memory cache (~500 entries, ~50MB) for GitHub API responses
- [ ] Forward `x-ratelimit-remaining` and `x-ratelimit-reset` headers to frontend on every proxy response — enables client-side rate limit monitoring
- [ ] Create standardised error response format (`{ error, category, retryAfter?, details? }`) — consistent shape consumed by frontend `ApiError` class

## API Routes (GitHub Proxy)

- [ ] Create `GET /api/repos/[owner]/[repo]/pulls` — lists open PRs with title, author, headSha, updatedAt, draft status
- [ ] Create `GET /api/repos/[owner]/[repo]/pulls/[pull_number]` — returns PR detail (number, title, state, draft, headSha, baseSha)
- [ ] Create `GET /api/repos/[owner]/[repo]/pulls/[pull_number]/files` — lists changed files with patches, filtered server-side to `.md`/`.mdx` only
- [ ] Create `GET /api/repos/[owner]/[repo]/pulls/[pull_number]/comments` (REST) — lists review comments, optional server-side `path` filter
- [ ] Create `POST /api/repos/[owner]/[repo]/pulls/[pull_number]/comments` — creates a new PR review comment (maps camelCase body to GitHub's snake_case, adds `side: "RIGHT"`)
- [ ] Create `POST /api/repos/[owner]/[repo]/pulls/[pull_number]/comments/[comment_id]/replies` — replies to an existing comment thread
- [ ] Create `GET /api/repos/[owner]/[repo]/pulls/[pull_number]/head` — lightweight endpoint returning only headSha + state for stale-SHA polling
- [ ] Create `GET /api/repos/[owner]/[repo]/contents/[...path]` — fetches file content at a specific ref, decodes base64 to UTF-8; doubles as image proxy for private repos (streams raw bytes with correct Content-Type for image extensions)
- [ ] Handle pagination for files and comments — GitHub caps at 100 per page; aggregate all pages before returning

## GraphQL Integration (Thread Resolution)

- [ ] Create `lib/graphql.ts` with `githubGraphQL()` helper — simple `fetch` wrapper for `POST https://api.github.com/graphql` with token auth
- [ ] Create `GET /api/repos/[owner]/[repo]/pulls/[pull_number]/threads` — fetches `PullRequest.reviewThreads` via GraphQL, returns pre-grouped threads with `isResolved`, `isOutdated`, `viewerCanResolve`
- [ ] Create `POST /api/repos/[owner]/[repo]/pulls/[pull_number]/threads/[threadId]/resolve` — calls `resolveReviewThread` GraphQL mutation
- [ ] Create `POST /api/repos/[owner]/[repo]/pulls/[pull_number]/threads/[threadId]/unresolve` — calls `unresolveReviewThread` GraphQL mutation

## Markdown Rendering Pipeline

- [ ] Install `react-markdown`, `remark-gfm`, `remark-rehype` — core markdown rendering with GFM support (tables, task lists, strikethrough, alerts)
- [ ] Write `rehype-source-lines` plugin — walks the hast tree and copies `position.start.line` / `position.end.line` into `data-source-start` / `data-source-end` attributes on every element
- [ ] Write `rehype-code-source-lines` plugin — annotates per-line `<span class="code-line">` wrappers inside code blocks with the correct original markdown source line number (fenceStartLine + 1 + index)
- [ ] Install a code line-wrapping plugin (`rehype-prism-plus` or `rehype-highlight` + `rehype-highlight-code-lines`) — splits `<pre><code>` text nodes into per-line wrapper elements
- [ ] Configure the rehype plugin pipeline in the correct order: `rehype-source-lines` → syntax highlighter → line wrapper → `rehype-code-source-lines`
- [ ] Write `makeUrlTransform()` function — rewrites relative image paths to `raw.githubusercontent.com/{owner}/{repo}/{headSha}/...` and relative `.md` links to GitHub blob view

## Diff Parsing & Commentable Line Detection

- [ ] Install `parse-diff` — parses unified diff strings from GitHub's `patch` field into structured per-line change objects
- [ ] Build `getCommentableLines(file)` function — extracts commentable line numbers from parsed diff (`add` → `ln`, `normal` → `ln2`), returns `Set<number>` or read-only status with reason
- [ ] Handle absent `patch` field — detect large diffs, binary files, renamed-with-no-changes; mark file as read-only with appropriate reason string
- [ ] Mark rendered elements with `data-commentable` attribute — cross-reference each element's `[sourceStart, sourceEnd]` range against the `commentableLines` set during rendering

## Text Selection & Comment Anchoring

- [ ] Implement `useSelectionObserver` hook — listens to `selectionchange` + `mousedown`/`mouseup`, debounces (10ms after mouseup, 100ms for keyboard/touch), ignores intermediate drag events
- [ ] Implement `findSourceElement()` — walks from a Text node up to the nearest ancestor with `[data-source-start]` via `closest()`
- [ ] Implement `extractSelectionInfo()` — converts a DOM `Range` into a plain `SelectionInfo` object (startLine, endLine, selectedText, anchorTop, isCommentable, commentableLines array) before any focus shift
- [ ] Snap selection to nearest commentable lines — when selection spans a mix of commentable and non-commentable lines, find the valid `start_line`/`line` subset for the GitHub API
- [ ] Position comment anchor button — use `Range.getBoundingClientRect()` to place the "Add comment" button in the right margin at the selection's vertical position
- [ ] Guard `onClearSelection` with `isCommentFormOpen` flag — prevent clearing stored `SelectionInfo` when textarea focus clears the native browser selection

## Comment Form & Submission

- [ ] Build comment form component — textarea with Submit/Cancel, `role="dialog"` `aria-modal="false"`, auto-focus on open, `aria-describedby` with line context
- [ ] Apply CSS highlight class on selected passage while comment form is open — uses stored `startLine`/`endLine` to highlight `[data-source-start]` elements as a visual substitute for the cleared native selection
- [ ] Implement `usePRComments` hook with SWR — fetches comments from API, provides `submitComment()` with optimistic `mutate()`, `rollbackOnError`, and `populateCache`
- [ ] Build `postComment()` helper with retry logic — 3 attempts with exponential backoff for transient errors; immediate throw for 422/401/404; rate-limit metadata extraction
- [ ] Build `ApiError` class — categorises errors into validation, auth, rate_limit, transient, network, unknown with status, retryAfter, isRateLimit fields
- [ ] Implement comment draft preservation — save to `sessionStorage` keyed by `{prNumber}:{filePath}:{lineRange}` before auth redirects or page refreshes; restore and pre-fill on return

## Comment Threading & Display

- [ ] Build `buildCommentThreads()` function — groups flat REST comments by `in_reply_to_id` into `CommentThread[]` sorted by line number (used as fallback; primary source is GraphQL)
- [ ] Build thread layout algorithm (`layoutThreadCards()`) — computes desired Y positions from DOM elements, pushes overlapping cards apart with minimum gap constraint
- [ ] Build `CommentThread` card component — Avatar, body, timestamp, reply count, Collapsible for long threads, "Open in GitHub" link
- [ ] Implement bidirectional hover sync — hovering a thread card highlights the passage, hovering a commented passage highlights the thread card
- [ ] Implement click-to-scroll sync — clicking a thread card scrolls the passage into view (`scrollIntoView({ behavior: 'smooth', block: 'center' })`), and vice versa
- [ ] Display resolved threads collapsed/dimmed with "Resolved" badge and `resolvedBy` avatar — expand on click to see history
- [ ] Show resolve/unresolve buttons conditionally based on `viewerCanResolve`/`viewerCanUnresolve` — calls GraphQL mutations with optimistic UI
- [ ] Display outdated threads in a separate "Outdated Comments" section at sidebar bottom — collapsed by default, dimmed (`opacity: 0.6`), "Outdated" badge, original `diff_hunk` shown as code block on expand

## Visual Indication of Commentable Regions

- [ ] Add left-margin gutter bar on commentable elements — 3px `border-left` in accent color (`blue-500` for ≥3:1 contrast) on `[data-commentable="true"]` elements
- [ ] Add hover highlight on commentable elements — subtle background color on `[data-commentable="true"]:hover`; non-commentable elements get no hover effect
- [ ] Show selection-time feedback — comment anchor when lines are commentable; dismissible tooltip ("This passage wasn't changed in this PR") when not commentable

## Page Layout

- [ ] Build two-column desktop layout (≥768px) — rendered markdown (`flex-1`) on left, comment sidebar (`w-80 lg:w-96 border-l`, `hidden md:block`) on right
- [ ] Build header component — PR title, file selector dropdown, navigation breadcrumb; responsive condensed version for mobile
- [ ] Wrap rendered markdown in `<article className="prose dark:prose-invert lg:prose-lg max-w-none">` — typography plugin styles with dark mode support
- [ ] Build mobile layout (<768px) with bottom Drawer (Vaul) — full-width content, floating comment count badge, drawer with `CommentThreadList` inside `ScrollArea`
- [ ] Build `useMediaQuery` hook — switches between desktop aside and mobile drawer based on `(min-width: 768px)`
- [ ] Add inline comment indicators in left gutter on mobile — tapping opens drawer pre-scrolled to that thread

## Stale SHA Detection & Refresh

- [ ] Implement `usePrHeadSha` hook — SWR polling every 60s with `revalidateOnFocus: true`, compares returned headSha against stored initial value
- [ ] Show stale-SHA banner — non-intrusive top-of-page banner with "Refresh Now" and "Dismiss" when `isStale` is true
- [ ] Implement re-sync flow on "Refresh Now" — save comment drafts, re-fetch file content + diff at new SHA, rebuild `commentableLines`, re-render markdown, restore drafts, update stored headSha
- [ ] Preserve scroll position on refresh — record `data-source-start` of element at viewport top before refresh, `scrollIntoView()` the same element after re-render

## Error Handling UI

- [ ] Show pending state on optimistic comments — `opacity: 0.6`, "Posting..." label with spinner
- [ ] Show error state by category — form reopens with body preserved for validation/transient errors; "Sign In" link for auth errors; countdown + auto-retry for rate limit
- [ ] Show rate limit warning banner — triggered when `x-ratelimit-remaining` drops below threshold (e.g., 100)
- [ ] Show PR closed/merged banner — when SHA polling detects `state !== "open"`

## Accessibility (WCAG 2.1 AA)

- [ ] Add visually-hidden `<button>` before each commentable block — `sr-only focus:not-sr-only`, `aria-label="Add comment on lines N–M"`, provides keyboard/screen reader comment entry point
- [ ] Implement comment thread list as WAI-ARIA feed — `role="feed"` container, `role="article"` per thread with `aria-posinset`, `aria-setsize`, `tabIndex={0}`, Page Down/Up navigation
- [ ] Add `aria-live` status region — persistent `<div aria-live="polite" className="sr-only">` for comment success/failure/loading announcements
- [ ] Apply focus-visible rings on all interactive elements — comment anchor, gutter buttons, textarea, form buttons, thread articles, collapsible triggers
- [ ] Set `aria-busy="true"` on feed during comment loading/revalidation — prevents screen readers from announcing incomplete state
- [ ] Use ARIA landmarks — `<header role="banner">`, `<main aria-label="Rendered document">`, `<aside role="complementary" aria-label="Comment threads">`
- [ ] Ensure non-text contrast ≥3:1 for gutter bars and highlight backgrounds — use `blue-500` (`#3b82f6`) over `blue-400`

## Deployment

- [ ] Configure `next.config.js` with `output: 'standalone'` — enables Docker self-hosted fallback alongside Vercel
- [ ] Set up Vercel project with environment variables — `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `SESSION_SECRET`, `NEXT_PUBLIC_APP_URL`

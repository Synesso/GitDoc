# What I've done

In this section very briefly (1 or 2 lines) describe what you've done in this turn.

- Researched architecture options and GitHub API for PR review comments. Wrote initial architecture section in design.md covering stack (Next.js + react-markdown), API endpoints, auth model, and the critical diff-line constraint.
- Researched diff-line mapping: how to fetch the diff via `GET /pulls/{n}/files` (returns `patch` field), parse it with `parse-diff` npm package, and build a set of commentable line numbers for each file.
- Researched source-line tracking: traced how position data flows through the unified pipeline (mdast → hast → React), designed a `rehype-source-lines` plugin to attach `data-source-start`/`data-source-end` attributes to rendered DOM elements.

- Researched text selection UX: how to detect text selection via browser Selection API, map DOM selections back to source lines using `closest('[data-source-start]')`, position a floating comment anchor via `Range.getBoundingClientRect()`, and cross-reference with commentable diff lines.

- Researched resolving relative image paths: use `react-markdown`'s `urlTransform` prop to rewrite relative `src`/`href` URLs to `raw.githubusercontent.com/{owner}/{repo}/{headSha}/{path}`. Designed strategy for `.md` links (point to GitHub blob view), private repos (API proxy), and path resolution using `URL` constructor.

- Researched UI framework/component library: Recommended **Tailwind CSS + shadcn/ui** (Radix UI primitives). Identified key shadcn components needed (Popover, Card, Avatar, Collapsible, ScrollArea, etc.) and the critical need for `@tailwindcss/typography` plugin (`prose` classes) to style `react-markdown` output. Designed two-column layout (rendered markdown + comment margin).

- Researched visual indication of commentable vs non-commentable regions. Designed a 4-layer approach: (1) subtle left-margin gutter bars on commentable blocks using `data-commentable` attribute + CSS `border-left`, (2) hover highlight on commentable elements only, (3) selection-time feedback — show comment anchor only when commentable lines exist, with tooltip for non-commentable selections, (4) comment-count badges in gutter. Evaluated and rejected alternatives: full background tinting (too visually heavy), selection-only feedback (poor discoverability), opacity dimming (hurts readability), and reading/review mode toggle (future enhancement).

- Researched comment attribution and authentication model. Both OAuth App tokens and GitHub App user-access tokens attribute PR review comments to the authenticated user. OAuth App: no badge, long-lived tokens, broad `repo` scope. GitHub App: small identicon badge on avatar, 8-hour token expiry + 6-month refresh tokens, fine-grained permissions (`pull_requests: write` + `contents: read`). Designed the full auth section with OAuth flow, token storage (encrypted HTTP-only cookies), Next.js API route structure, and `next-auth` recommendation.

- Researched deployment & hosting options. Recommended **Vercel** as primary target — zero-config Next.js integration, serverless model fits the stateless architecture (no DB), preview deploys per PR, encrypted env vars for OAuth secrets. Docker standalone (`output: 'standalone'`) as self-hosted fallback for container platforms. OpenNext for AWS Lambda+CloudFront if AWS-native needed. No Block-internal infrastructure requirement identified in the PRD. Edge Runtime deferred — `next-auth`/`iron-session` may need Node.js runtime for crypto APIs.

# Things I've learned

- GitHub PR review comments can ONLY target lines in the diff (added/removed/context lines), not arbitrary file lines. This is a fundamental UX constraint — the app must know which rendered passages map to diff lines.
- The `line` parameter in the create-comment API refers to the line number in the blob (source file), not the diff position. The old `position` parameter (diff-relative) is deprecated.
- `side: "RIGHT"` is used for additions/new lines; `side: "LEFT"` for deletions. For GitDoc (showing head-ref only), we always use `RIGHT`.
- `react-markdown` built on `remark`/`rehype` provides AST `position` info (start.line, end.line) which can be used for source-line tracking.
- GitHub OAuth App gives `repo` scope (broad); GitHub App allows fine-grained `pull_requests: write` + `contents: read`. Both support user-access tokens so comments appear as the authenticated user.
- `sq codesearch` CLI does not exist; no internal code search tool was found via `sq`.
- The `patch` field in the list-files response is a standard unified diff with 3 context lines. There is NO GitHub API parameter to increase context lines.
- `parse-diff` npm package (MIT, zero deps, ~1M weekly downloads) returns structured data per change: `AddChange` has `ln` (new-file line), `NormalChange` has `ln2` (new-file line), `DeleteChange` has `ln` (old-file line). For GitDoc (showing head-ref), commentable lines = all `AddChange.ln` + all `NormalChange.ln2`.
- New files (`status: "added"`) have the entire file in the diff, so every line is commentable.
- Very large diffs may have the `patch` field absent/truncated — need graceful fallback to read-only.
- Position data (source line numbers) is preserved through the entire unified pipeline: remark parses markdown into mdast with `position` on every node; `mdast-util-to-hast` copies position via an internal `patch()` function to hast nodes; `react-markdown` exposes the hast `node` (with position) as a prop to custom components.
- A simple rehype plugin using `unist-util-visit` can walk the hast tree and set `data-source-start`/`data-source-end` properties on all element nodes — these become HTML data attributes in the rendered DOM.
- Two approaches exist: (1) rehype plugin (cleaner, applies to all elements automatically), (2) custom `components` prop on `react-markdown` (more boilerplate but finer control). Recommend rehype plugin.
- Fenced code blocks are a special case: the whole block becomes one `pre > code` element. Per-line commenting within code blocks would require splitting the text content by newlines — a separate task.
- hast `text` nodes don't become DOM elements, so line tracking relies on the enclosing element's position data.
- The browser Selection API returns `anchorNode`/`focusNode` which are usually **Text nodes** (not Elements). To find our `data-source-start` attributes, we must use `node.parentElement.closest('[data-source-start]')` since Text nodes don't have `closest()`.
- Best event strategy for select-to-comment: `selectstart` to clear stale UI + `mouseup` to read the final selection. `selectionchange` fires continuously during drag and causes jumpy repositioning — not ideal for a comment button that should appear only after selection completes.
- `Range.getBoundingClientRect()` returns viewport-relative coordinates. For absolute positioning in a scrollable document, add `window.scrollY` / `window.scrollX`. `@floating-ui/react` (~3KB) is a lightweight alternative for robust edge-aware positioning.
- `mouseup` alone doesn't catch keyboard-based text selection (Shift+Arrow). Need supplemental `keyup` listener or debounced `selectionchange` as fallback.
- Touch devices present a UX conflict: mobile browsers show their own native selection toolbar above selected text, which competes with a custom comment anchor UI.
- Tools like Hypothes.is allow commenting anywhere (no restriction), but GitDoc is constrained by GitHub's diff-line limitation. This is a unique UX challenge — most document annotation tools don't have "non-commentable" regions.
- GitHub's own diff view uses a hover-triggered "+" icon in the gutter for commentable lines — a progressive disclosure pattern. GitDoc should adapt this to a rendered document context with subtler indicators.
- The best visual indicator approach is "layered": always-visible but subtle gutter markers for commentable regions, interactive hover highlights, and clear selection-time feedback. This balances discoverability with reading-focused design.
- Using `data-commentable` as a computed attribute on rendered elements (cross-referencing source lines with the commentableLines set) is the cleanest integration point — it extends the existing `data-source-start`/`data-source-end` approach from the rehype plugin.
- Full background tinting or opacity dimming of non-commentable regions hurts readability — incompatible with the "reading first" principle from the PRD's Google Docs-style interaction model.
- GitHub API comment attribution: when using an OAuth App token, the comment `user` field is the authenticated user with no visual badge. When using a GitHub App user-access token, the user's avatar gets a small identicon badge overlay; audit logs still list the user as actor with `programmatic_access_type: "GitHub App user-to-server token"`. Installation tokens create comments as `app-name[bot]` — not suitable for GitDoc.
- OAuth App tokens do NOT expire by default — they persist until the user revokes access or the client secret is reset. GitHub App user-access tokens expire after 8 hours with a 6-month refresh token.
- OAuth Apps require the broad `repo` scope for private repo access (covers code, PRs, commit statuses, webhooks, etc.). There's no finer scope for just PR comments. `public_repo` works for public repos only. GitHub Apps use fine-grained permissions: `pull_requests: write` + `contents: read` is sufficient.
- GitHub officially recommends GitHub Apps over OAuth Apps for all new projects due to fine-grained permissions and short-lived tokens.
- SAML SSO caveat: if an org uses SAML SSO, users must have an active SAML session before the GitHub App user-access token can access org resources. The app should detect 403s and guide users to re-authenticate.
- GitHub serves raw file content at `https://raw.githubusercontent.com/{owner}/{repo}/{ref}/{path}`. The `{ref}` can be a branch name or commit SHA. SHA is preferred for consistency.
- `react-markdown` provides a `urlTransform` prop — a function `(url, key, node) => string` called for every URL in the rendered output. It applies to both `img[src]` and `a[href]`. The default transform (`defaultUrlTransform`) follows GitHub's safety rules (allows `http`, `https`, `mailto`, etc.).
- The `urlTransform` applies to inline HTML images too (when using `rehype-raw`), not just markdown syntax images.
- `raw.githubusercontent.com` requires authentication for private repos — can't just rewrite URLs for private repos without a proxy or token.
- Relative paths like `../assets/img.png` can be resolved using the `URL` constructor with a base URL, which handles `..` traversal correctly.
- For relative links to `.md` files, rewriting to `raw.githubusercontent.com` would serve raw markdown text (not rendered) — need to rewrite those differently (e.g., to GitHub blob view or internal GitDoc route).
- Tailwind's Preflight CSS reset strips default HTML element styles (heading sizes, list bullets, etc.), which breaks `react-markdown` output. The `@tailwindcss/typography` plugin provides `prose` classes to restore beautiful typographic defaults on arbitrary HTML content.
- shadcn/ui copies component source into your codebase (not an npm dependency) — full ownership, easy to customize, no version upgrade burden. It's built on Radix UI primitives which handle WAI-ARIA accessibility, focus management, and keyboard navigation.
- shadcn/ui's `Sidebar` component supports `side="right"` but is designed for app navigation (collapsible, responsive). For a static document comment margin, a simpler Tailwind flex/grid layout with `ScrollArea` may be more appropriate.
- The `prose` class from `@tailwindcss/typography` sets a default `max-width` for readability — need `max-w-none` to override it when using a custom two-column layout.
- Vercel is the most integrated Next.js hosting platform (built by the same team). Zero-config deployment, serverless functions for API routes, preview URLs per PR, and encrypted env vars. Usage-based pricing; free/hobby tier sufficient for small tools.
- Next.js `output: 'standalone'` in `next.config.js` produces a minimal self-contained Node.js server suitable for Docker containers — the portable fallback if Vercel isn't an option.
- OpenNext is a community project that bundles Next.js for AWS Lambda + CloudFront, providing serverless benefits on AWS without Vercel. More operational overhead.
- Edge Runtime on Vercel has limitations — crypto APIs differ from Node.js, so libraries like `next-auth` and `iron-session` may not work on Edge. Start with Node.js runtime for auth-related routes.

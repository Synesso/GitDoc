# GitDoc — Requirements

## Overview

GitDoc is a web application that provides a rendered markdown reading and review experience on top of GitHub Pull Requests. Reviewers navigate to a PR, open any changed `.md` file, read the rendered output, and leave comments that are persisted as **GitHub PR line comments** — keeping the canonical GitHub review in sync.

---

## Goals

1. **Readable reviews** — Render markdown files from a PR as they will appear to end users, not as raw diffs.
2. **Native GitHub comments** — Every comment made in GitDoc is written back to GitHub as a line-level review comment on the correct file and line.
3. **Zero data duplication** — GitDoc owns no review state; GitHub is the single source of truth.

## Non-Goals

- General-purpose code review (non-markdown files).
- Merge/approve/request-changes workflows (use GitHub for that).
- Offline support.

---

## User Stories

| # | As a…       | I want to…                                                        | So that…                                                    |
|---|-------------|-------------------------------------------------------------------|-------------------------------------------------------------|
| 1 | Reviewer    | Browse open PRs in a repository                                   | I can pick one to review                                    |
| 2 | Reviewer    | See which markdown files changed in a PR                          | I can focus on content changes                              |
| 3 | Reviewer    | Read a changed markdown file fully rendered                       | I can evaluate the content as a reader would see it         |
| 4 | Reviewer    | Select a passage and leave a comment                              | My feedback appears as a GitHub line comment on the PR      |
| 5 | Reviewer    | See existing GitHub review comments inline                        | I have full context without switching to GitHub             |
| 6 | Reviewer    | Reply to an existing comment thread                               | Conversations stay threaded, matching the GitHub model      |
| 7 | Author      | See review comments on my rendered markdown                       | I can understand feedback in context                        |

---

## Functional Requirements

### F1 — Authentication

- Users authenticate via GitHub OAuth (or a GitHub App installation).
- The app requests scopes sufficient to read repo content, list PRs, and create review comments.

### F2 — PR Navigation

- Given a repository (owner/repo), list open PRs with title, author, and status.
- Select a PR to view its changed files, filtered to markdown files (`.md`, `.mdx`).

### F3 — Markdown Rendering

- Fetch the **head-ref version** of a selected markdown file from the PR branch.
- Render it client-side using a CommonMark-compliant renderer (e.g. `remark` / `rehype`).
- Support GitHub-Flavoured Markdown extensions: tables, task lists, footnotes, alerts.
- Maintain a mapping from rendered DOM elements back to **source line numbers** so that comments can target the correct line.

### F4 — Commenting

- User selects rendered text (single or multi-line range).
- A comment input appears anchored to the selection.
- On submit, the app creates a **GitHub pull request review comment** via the REST or GraphQL API, specifying:
  - `path` — the markdown file path in the repo.
  - `line` / `start_line` — source line(s) corresponding to the selection.
  - `commit_id` — the head SHA of the PR.
  - `body` — the comment text (markdown).
- Multi-line selections produce a multi-line comment (`start_line` + `line`).

### F5 — Displaying Existing Comments

- Fetch all review comments for the PR and filter to the current file.
- Display each comment inline, anchored to the rendered paragraph / heading that corresponds to its source line.
- Support threaded replies; show reply count with expand/collapse.

### F6 — Replying to Comments

- Users can reply to any existing comment thread.
- Replies are posted via the GitHub API as reply comments (`in_reply_to`).

---

## Non-Functional Requirements

| Area          | Requirement                                                                 |
|---------------|-----------------------------------------------------------------------------|
| Performance   | Rendered view loads in < 2 s for files up to 5 000 lines.                   |
| Security      | OAuth tokens stored server-side or in secure HTTP-only cookies; never exposed to client JS. |
| Rate limits   | Respect GitHub API rate limits; cache file content per commit SHA.           |
| Accessibility | Rendered markdown and comment UI meet WCAG 2.1 AA.                          |
| Browser       | Support latest two versions of Chrome, Firefox, Safari, Edge.               |
| Cost          | Incur no financial cost to the operator while in MVP.                       |
| Deployment    | Able to be deployed to public infrastructure or Block internal infrastructure. |

---

## Architecture (high-level)

```
┌──────────┐        ┌──────────────┐        ┌────────────┐
│  Browser  │◄──────►│  GitDoc API  │◄──────►│ GitHub API │
│ (React)   │  REST  │  (Node/Edge) │  REST/ │            │
│           │        │              │  GQL   │            │
└──────────┘        └──────────────┘        └────────────┘
```

- **Frontend** — React (or similar) SPA; markdown rendered client-side.
- **Backend** — Lightweight API server that proxies GitHub calls and manages OAuth sessions.
- **No database** — all state lives in GitHub.

---

## Decisions

1. **No diff view** — Show only the rendered head-ref version, not a side-by-side old-vs-new diff.
2. **Draft PRs** — If GitHub allows review comments on draft PRs, treat them identically. If not, show the rendered markdown in read-only mode (no comment UI).
3. **Images** — Resolve image paths relative to the PR branch head so that new/changed images render correctly in the viewer.
4. **No pending reviews** — Comments are posted individually on submit; no batching into a single review.

---

## Interaction Model

The commenting UX should feel like **Google Docs**: the content is the primary focus, and review comments live alongside it without disrupting the reading flow.

### Key Principles

- **Select-to-comment** — The user highlights a passage of rendered text. A comment anchor (button or icon) appears in the right margin at the level of the selection, inviting them to add a comment.
- **Margin-anchored threads** — Comment threads are displayed in a right-hand margin/sidebar, visually connected to the passage they reference. They do not obscure the rendered content.
- **Highlight on hover** — Hovering over a comment thread highlights the referenced passage in the document, and vice-versa: hovering over a commented passage highlights its thread in the margin.
- **Inline reply** — Clicking a thread expands it in place, showing the full conversation and a reply box. Replies are submitted immediately to GitHub.
- **Resolved state** — If a GitHub comment thread is resolved, it appears collapsed/dimmed in the margin. Users can expand it to read the history.
- **Presence of content, not chrome** — The UI should be minimal: no heavy toolbars or modal dialogs. The rendered markdown occupies the centre of the viewport; comments float in the margin.

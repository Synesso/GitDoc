import { requireAuth } from "@/lib/session";
import {
  githubFetch,
  classifyGitHubError,
  buildProxyResponse,
  parseLinkHeader,
} from "@/lib/github";

type RouteParams = {
  params: Promise<{ owner: string; repo: string; pull_number: string }>;
};

export async function GET(request: Request, { params }: RouteParams) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { owner, repo, pull_number } = await params;
  const path = new URL(request.url).searchParams.get("path");

  const allComments: any[] = [];
  let url: string | null =
    `/repos/${owner}/${repo}/pulls/${pull_number}/comments?per_page=100`;
  let lastHeaders: Headers = new Headers();

  // Paginate through all pages
  while (url) {
    const { data, status, headers } = await githubFetch(
      url,
      session.githubToken,
      { cacheTtl: 10_000 },
    );

    lastHeaders = headers;

    if (status !== 200) {
      return buildProxyResponse(
        classifyGitHubError(status, headers, data),
        status,
        headers,
      );
    }

    allComments.push(...(data as any[]));
    url = parseLinkHeader(headers.get("link"));
  }

  let comments = allComments.map((c) => ({
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

  return buildProxyResponse({ comments }, 200, lastHeaders);
}

export async function POST(request: Request, { params }: RouteParams) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { owner, repo, pull_number } = await params;

  let body: { body: string; path: string; line: number; startLine?: number; commitId: string };
  try {
    body = await request.json();
  } catch {
    return buildProxyResponse(
      { error: "Invalid JSON body", category: "validation" },
      400,
      new Headers(),
    );
  }

  // Validate required fields
  if (!body.body?.trim()) {
    return buildProxyResponse(
      { error: "Comment body is required", category: "validation" },
      422,
      new Headers(),
    );
  }
  if (!body.path || !body.line || !body.commitId) {
    return buildProxyResponse(
      { error: "path, line, and commitId are required", category: "validation" },
      422,
      new Headers(),
    );
  }

  // Map camelCase to GitHub's snake_case and add side: "RIGHT"
  const githubBody: Record<string, unknown> = {
    body: body.body,
    path: body.path,
    line: body.line,
    commit_id: body.commitId,
    side: "RIGHT",
  };
  if (body.startLine != null) {
    githubBody.start_line = body.startLine;
    githubBody.start_side = "RIGHT";
  }

  const { data, status, headers } = await githubFetch(
    `/repos/${owner}/${repo}/pulls/${pull_number}/comments`,
    session.githubToken,
    { method: "POST", body: githubBody, cacheTtl: 0 },
  );

  if (status !== 201) {
    return buildProxyResponse(
      classifyGitHubError(status, headers, data),
      status,
      headers,
    );
  }

  const c = data as any;
  return buildProxyResponse(
    {
      id: c.id,
      body: c.body,
      user: { login: c.user.login, avatarUrl: c.user.avatar_url },
      path: c.path,
      line: c.line,
      startLine: c.start_line ?? undefined,
      createdAt: c.created_at,
    },
    201,
    headers,
  );
}

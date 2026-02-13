import { requireAuth } from "@/lib/session";
import {
  githubFetch,
  classifyGitHubError,
  buildProxyResponse,
} from "@/lib/github";

type RouteParams = {
  params: Promise<{ owner: string; repo: string; pull_number: string }>;
};

function parseLinkHeader(header: string | null): string | null {
  if (!header) return null;
  const match = header.match(/<([^>]+)>;\s*rel="next"/);
  return match?.[1] ?? null;
}

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

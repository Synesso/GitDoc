import { requireAuth } from "@/lib/session";
import {
  githubFetch,
  classifyGitHubError,
  buildProxyResponse,
} from "@/lib/github";

type RouteParams = {
  params: Promise<{
    owner: string;
    repo: string;
    pull_number: string;
    comment_id: string;
  }>;
};

export async function POST(request: Request, { params }: RouteParams) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { owner, repo, pull_number, comment_id } = await params;

  let body: { body: string };
  try {
    body = await request.json();
  } catch {
    return buildProxyResponse(
      { error: "Invalid JSON body", category: "validation" },
      400,
      new Headers(),
    );
  }

  if (!body.body?.trim()) {
    return buildProxyResponse(
      { error: "Reply body is required", category: "validation" },
      422,
      new Headers(),
    );
  }

  const { data, status, headers } = await githubFetch(
    `/repos/${owner}/${repo}/pulls/${pull_number}/comments/${comment_id}/replies`,
    session.githubToken,
    { method: "POST", body: { body: body.body }, cacheTtl: 0 },
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
      inReplyToId: c.in_reply_to_id ?? undefined,
      createdAt: c.created_at,
    },
    201,
    headers,
  );
}

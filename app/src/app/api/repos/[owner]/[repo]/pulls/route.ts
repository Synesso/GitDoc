import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/session";
import {
  githubFetch,
  classifyGitHubError,
  buildProxyResponse,
} from "@/lib/github";

type RouteParams = {
  params: Promise<{ owner: string; repo: string }>;
};

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { owner, repo } = await params;
  const page = request.nextUrl.searchParams.get("page") ?? "1";

  const url = `/repos/${owner}/${repo}/pulls?state=open&sort=updated&per_page=30&page=${page}`;
  const { data, status, headers } = await githubFetch(url, session.githubToken, {
    cacheTtl: 30_000,
  });

  if (status !== 200) {
    return buildProxyResponse(
      classifyGitHubError(status, headers, data),
      status,
      headers,
    );
  }

  const pulls = (data as any[]).map((pr) => ({
    number: pr.number,
    title: pr.title,
    user: { login: pr.user.login, avatarUrl: pr.user.avatar_url },
    headSha: pr.head.sha,
    updatedAt: pr.updated_at,
    draft: pr.draft,
  }));

  return buildProxyResponse({ pulls }, 200, headers);
}

import { requireAuth } from "@/lib/session";
import {
  githubFetch,
  classifyGitHubError,
  buildProxyResponse,
} from "@/lib/github";

type RouteParams = {
  params: Promise<{ owner: string; repo: string; pull_number: string }>;
};

export async function GET(_request: Request, { params }: RouteParams) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { owner, repo, pull_number } = await params;

  const url = `/repos/${owner}/${repo}/pulls/${pull_number}`;
  const { data, status, headers } = await githubFetch(url, session.githubToken, {
    cacheTtl: 15_000,
  });

  if (status !== 200) {
    return buildProxyResponse(
      classifyGitHubError(status, headers, data),
      status,
      headers,
    );
  }

  const pr = data as any;
  return buildProxyResponse(
    {
      headSha: pr.head.sha,
      state: pr.state,
    },
    200,
    headers,
  );
}

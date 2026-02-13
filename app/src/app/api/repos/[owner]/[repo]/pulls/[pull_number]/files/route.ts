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

export async function GET(_request: Request, { params }: RouteParams) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { owner, repo, pull_number } = await params;

  const allFiles: any[] = [];
  let url: string | null =
    `/repos/${owner}/${repo}/pulls/${pull_number}/files?per_page=100`;
  let lastHeaders: Headers = new Headers();

  // Paginate through all pages
  while (url) {
    const { data, status, headers } = await githubFetch(
      url,
      session.githubToken,
      { cacheTtl: 30_000 },
    );

    lastHeaders = headers;

    if (status !== 200) {
      return buildProxyResponse(
        classifyGitHubError(status, headers, data),
        status,
        headers,
      );
    }

    allFiles.push(...(data as any[]));
    url = parseLinkHeader(headers.get("link"));
  }

  // Filter to markdown files only
  const mdFiles = allFiles
    .filter((f) => /\.mdx?$/i.test(f.filename))
    .map((f) => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch ?? null,
      sha: f.sha,
    }));

  return buildProxyResponse({ files: mdFiles }, 200, lastHeaders);
}

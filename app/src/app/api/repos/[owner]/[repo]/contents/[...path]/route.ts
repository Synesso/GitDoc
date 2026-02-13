import { requireAuth } from "@/lib/session";
import {
  githubFetch,
  classifyGitHubError,
  buildProxyResponse,
} from "@/lib/github";

type RouteParams = {
  params: Promise<{ owner: string; repo: string; path: string[] }>;
};

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
  ".ico",
  ".bmp",
]);

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".bmp": "image/bmp",
};

function getExtension(filePath: string): string {
  const dot = filePath.lastIndexOf(".");
  return dot === -1 ? "" : filePath.slice(dot).toLowerCase();
}

export async function GET(request: Request, { params }: RouteParams) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { owner, repo, path: pathSegments } = await params;
  const filePath = pathSegments.join("/");

  const ref = new URL(request.url).searchParams.get("ref");
  if (!ref) {
    return buildProxyResponse(
      { error: "ref query parameter is required", category: "validation" },
      400,
      new Headers(),
    );
  }

  const ext = getExtension(filePath);
  const isImage = IMAGE_EXTENSIONS.has(ext);

  if (isImage) {
    // Image proxy: fetch raw bytes and stream with correct Content-Type
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${ref}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${session.githubToken}`,
        Accept: "application/vnd.github.raw+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      return buildProxyResponse(
        classifyGitHubError(res.status, res.headers, data),
        res.status,
        res.headers,
      );
    }

    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    const body = await res.arrayBuffer();

    const responseHeaders = new Headers();
    responseHeaders.set("Content-Type", contentType);
    responseHeaders.set(
      "Cache-Control",
      "public, max-age=31536000, immutable",
    );
    const rlRemaining = res.headers.get("x-ratelimit-remaining");
    const rlReset = res.headers.get("x-ratelimit-reset");
    if (rlRemaining)
      responseHeaders.set("x-ratelimit-remaining", rlRemaining);
    if (rlReset) responseHeaders.set("x-ratelimit-reset", rlReset);

    return new Response(body, { status: 200, headers: responseHeaders });
  }

  // Text content: fetch via Contents API (returns base64), decode to UTF-8
  const cacheKey = `contents:${owner}/${repo}/${ref}/${filePath}`;
  const { data, status, headers } = await githubFetch(
    `/repos/${owner}/${repo}/contents/${filePath}?ref=${ref}`,
    session.githubToken,
    { cacheKey }, // Immutable — no TTL, stays until LRU eviction
  );

  if (status !== 200) {
    return buildProxyResponse(
      classifyGitHubError(status, headers, data),
      status,
      headers,
    );
  }

  const file = data as { content?: string; sha?: string; encoding?: string };

  let content: string;
  if (file.encoding === "base64" && file.content) {
    content = Buffer.from(file.content, "base64").toString("utf-8");
  } else if (file.content) {
    content = file.content;
  } else {
    return buildProxyResponse(
      { error: "File has no content", category: "validation" },
      422,
      headers,
    );
  }

  return buildProxyResponse(
    { content, sha: file.sha, encoding: "utf-8" },
    200,
    headers,
  );
}

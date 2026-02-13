import { LRUCache } from "lru-cache";

interface CacheEntry {
  data: unknown;
  etag?: string;
  timestamp: number;
}

const cache = new LRUCache<string, CacheEntry>({
  max: 500,
  maxSize: 50_000_000, // ~50MB
  sizeCalculation: (value) => JSON.stringify(value.data).length,
  ttl: 1000 * 60 * 60, // 1h default, overridden per-entry
});

const GITHUB_API_BASE = "https://api.github.com";

/**
 * Fetch from the GitHub API with Authorization, ETag caching, and rate-limit
 * header forwarding.  For GET requests the response is cached in an in-memory
 * LRU cache and subsequent requests send `If-None-Match` so that 304 responses
 * (which don't count against the rate limit) reuse the cached data.
 */
export async function githubFetch(
  url: string,
  token: string,
  options?: {
    method?: string;
    body?: unknown;
    cacheTtl?: number; // 0 = no cache
    cacheKey?: string; // Override the default URL-based key
  },
): Promise<{ data: unknown; status: number; headers: Headers }> {
  const method = options?.method ?? "GET";
  const key = options?.cacheKey ?? url;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  // ETag conditional request (GET only)
  if (method === "GET") {
    const cached = cache.get(key);
    if (cached?.etag) {
      headers["If-None-Match"] = cached.etag;
    }
  }

  const fetchOptions: RequestInit = { method, headers };
  if (options?.body) {
    headers["Content-Type"] = "application/json";
    fetchOptions.body = JSON.stringify(options.body);
  }

  const res = await fetch(
    url.startsWith("http") ? url : `${GITHUB_API_BASE}${url}`,
    fetchOptions,
  );

  // 304 Not Modified — return cached data (free request)
  if (res.status === 304) {
    const cached = cache.get(key);
    if (cached) return { data: cached.data, status: 200, headers: res.headers };
  }

  // Non-JSON responses (e.g. 204 No Content) — return empty
  const contentType = res.headers.get("content-type") ?? "";
  const data = contentType.includes("application/json")
    ? await res.json()
    : null;

  // Cache successful GET responses
  if (method === "GET" && res.ok) {
    const etag = res.headers.get("etag") ?? undefined;
    const ttl = options?.cacheTtl;
    cache.set(key, { data, etag, timestamp: Date.now() }, { ttl });
  }

  return { data, status: res.status, headers: res.headers };
}

/** Classify a GitHub API error response into our standard format. */
export function classifyGitHubError(
  status: number,
  headers: Headers,
  data: unknown,
): {
  error: string;
  category: "validation" | "auth" | "rate_limit" | "transient" | "unknown";
  retryAfter?: number;
  details?: unknown;
} {
  // Rate limit — primary (403 with remaining=0)
  const remaining = headers.get("x-ratelimit-remaining");
  if (status === 403 && remaining === "0") {
    const reset = headers.get("x-ratelimit-reset");
    const retryAfter = reset
      ? Math.max(0, Number(reset) - Math.floor(Date.now() / 1000))
      : undefined;
    return { error: "Rate limit exceeded", category: "rate_limit", retryAfter };
  }

  // Rate limit — secondary (429)
  if (status === 429) {
    const retryAfter = Number(headers.get("retry-after")) || undefined;
    return {
      error: "Secondary rate limit exceeded",
      category: "rate_limit",
      retryAfter,
    };
  }

  // SAML SSO
  const ssoHeader = headers.get("x-github-sso");
  if (status === 403 && ssoHeader) {
    const urlMatch = ssoHeader.match(/url=([^\s;]+)/);
    return {
      error: "SAML SSO required",
      category: "auth",
      details: { ssoUrl: urlMatch?.[1] },
    };
  }

  // Auth
  if (status === 401 || status === 403) {
    return { error: "Authentication failed", category: "auth" };
  }

  // Validation
  if (status === 422) {
    return { error: "Validation failed", category: "validation", details: data };
  }

  // Not found
  if (status === 404) {
    return { error: "Not found", category: "validation" };
  }

  // Transient
  if (status >= 500) {
    return {
      error: `GitHub server error (${status})`,
      category: "transient",
    };
  }

  return { error: `HTTP ${status}`, category: "unknown" };
}

/**
 * Build a Next.js JSON Response from a GitHub API proxy result.
 * Forwards `x-ratelimit-remaining` and `x-ratelimit-reset` headers so the
 * frontend can monitor rate-limit usage.
 */
export function buildProxyResponse(
  data: unknown,
  status: number,
  upstreamHeaders: Headers,
): Response {
  const responseHeaders = new Headers();
  responseHeaders.set("Content-Type", "application/json");

  const rlRemaining = upstreamHeaders.get("x-ratelimit-remaining");
  const rlReset = upstreamHeaders.get("x-ratelimit-reset");
  if (rlRemaining) responseHeaders.set("x-ratelimit-remaining", rlRemaining);
  if (rlReset) responseHeaders.set("x-ratelimit-reset", rlReset);

  return new Response(JSON.stringify(data), { status, headers: responseHeaders });
}

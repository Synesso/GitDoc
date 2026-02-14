import { ApiError, parseApiError, parseRetryAfter } from "./api-error";

export interface PostCommentParams {
  body: string;
  path: string;
  line: number;
  startLine?: number;
  commitId: string;
}

export interface PostCommentResult {
  id: number;
  body: string;
  user: { login: string; avatarUrl: string };
  path: string;
  line: number;
  startLine?: number;
  createdAt: string;
}

const MAX_ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Post a PR review comment with retry logic.
 *
 * - 3 attempts with exponential backoff (1s, 2s, 4s) for transient (5xx) and
 *   network errors.
 * - Immediate throw for non-retryable errors: 422 (validation), 401 (auth),
 *   404 (not found).
 * - Rate-limit errors (429, 403 with remaining=0) throw immediately with
 *   `retryAfter` metadata so the UI can show a countdown.
 */
export async function postComment(
  baseUrl: string,
  params: PostCommentParams,
): Promise<PostCommentResult> {
  let lastError: ApiError | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(baseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });

      if (res.ok) {
        return await res.json();
      }

      const error = parseApiError(res);

      // Non-retryable errors: stop immediately
      if (
        error.status === 422 ||
        error.status === 401 ||
        error.status === 404
      ) {
        throw error;
      }

      // Rate limit: throw with metadata for special handling
      if (error.isRateLimit) {
        error.retryAfter = parseRetryAfter(res);
        throw error;
      }

      // Transient (5xx) or unknown: retry with backoff
      lastError = error;
      if (attempt < MAX_ATTEMPTS - 1) {
        await sleep(Math.pow(2, attempt) * 1000);
      }
    } catch (e) {
      if (e instanceof ApiError) throw e; // re-throw classified errors

      // Network error: retry with backoff
      lastError = new ApiError(
        0,
        e instanceof Error ? e.message : "Network error",
        "network",
      );
      if (attempt < MAX_ATTEMPTS - 1) {
        await sleep(Math.pow(2, attempt) * 1000);
      }
    }
  }

  throw lastError ?? new ApiError(0, "Unknown error", "unknown");
}

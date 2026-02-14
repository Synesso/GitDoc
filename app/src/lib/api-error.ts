/**
 * Categorised error class for GitHub API interactions.
 *
 * Used by `postComment()` and consumed by the UI to show appropriate feedback
 * per error category.
 */
export class ApiError extends Error {
  status: number;
  category:
    | "validation"
    | "auth"
    | "rate_limit"
    | "transient"
    | "network"
    | "unknown";
  isRateLimit: boolean;
  retryAfter?: number; // seconds until rate limit resets

  constructor(
    status: number,
    message: string,
    category: ApiError["category"],
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.category = category;
    this.isRateLimit = category === "rate_limit";
  }
}

/**
 * Classify an HTTP response into an `ApiError` based on status code and
 * rate-limit headers.
 */
export function parseApiError(res: Response): ApiError {
  const rateLimitRemaining = res.headers.get("x-ratelimit-remaining");
  if (res.status === 403 && rateLimitRemaining === "0") {
    return new ApiError(403, "Rate limit exceeded", "rate_limit");
  }
  if (res.status === 429) {
    return new ApiError(429, "Secondary rate limit exceeded", "rate_limit");
  }
  if (res.status === 422) {
    return new ApiError(422, "Validation failed", "validation");
  }
  if (res.status === 401 || res.status === 403) {
    return new ApiError(res.status, "Authentication error", "auth");
  }
  if (res.status >= 500) {
    return new ApiError(res.status, "Server error", "transient");
  }
  return new ApiError(res.status, `HTTP ${res.status}`, "unknown");
}

/**
 * Extract `retryAfter` (in seconds) from the response headers.
 * Handles both primary rate limits (`x-ratelimit-reset` as UTC epoch) and
 * secondary rate limits (`Retry-After` as seconds).
 */
export function parseRetryAfter(res: Response): number | undefined {
  // Primary rate limit: x-ratelimit-reset is UTC epoch seconds
  const reset = res.headers.get("x-ratelimit-reset");
  if (reset)
    return Math.max(0, Number(reset) - Math.floor(Date.now() / 1000));
  // Secondary rate limit: Retry-After is seconds
  const retryAfter = res.headers.get("retry-after");
  if (retryAfter) return Number(retryAfter);
  return undefined;
}

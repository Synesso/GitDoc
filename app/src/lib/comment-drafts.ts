const PREFIX = "gitdoc:draft:";
const EXPIRY_MS = 3_600_000; // 1 hour

interface DraftData {
  body: string;
  savedAt: number;
}

function buildKey(
  prNumber: number,
  filePath: string,
  lineRange: string,
): string {
  return `${PREFIX}${prNumber}:${filePath}:${lineRange}`;
}

/**
 * Build a consistent line-range string from start/end lines.
 * Single-line: "42", multi-line: "10-15".
 */
export function lineRangeKey(startLine: number, endLine: number): string {
  return startLine === endLine
    ? `${startLine}`
    : `${startLine}-${endLine}`;
}

/**
 * Save a comment draft to sessionStorage.
 * Keyed by `{prNumber}:{filePath}:{lineRange}`.
 */
export function saveDraft(
  prNumber: number,
  filePath: string,
  lineRange: string,
  body: string,
): void {
  try {
    const key = buildKey(prNumber, filePath, lineRange);
    if (!body.trim()) {
      sessionStorage.removeItem(key);
      return;
    }
    const data: DraftData = { body, savedAt: Date.now() };
    sessionStorage.setItem(key, JSON.stringify(data));
  } catch {
    // sessionStorage may be unavailable (private browsing, quota exceeded)
  }
}

/**
 * Load a comment draft from sessionStorage.
 * Returns `null` if no draft exists or it has expired (>1 hour).
 */
export function loadDraft(
  prNumber: number,
  filePath: string,
  lineRange: string,
): string | null {
  try {
    const key = buildKey(prNumber, filePath, lineRange);
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const data: DraftData = JSON.parse(raw);
    if (Date.now() - data.savedAt > EXPIRY_MS) {
      sessionStorage.removeItem(key);
      return null;
    }
    return data.body;
  } catch {
    return null;
  }
}

/**
 * Remove a saved draft (e.g., after successful submission).
 */
export function clearDraft(
  prNumber: number,
  filePath: string,
  lineRange: string,
): void {
  try {
    const key = buildKey(prNumber, filePath, lineRange);
    sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}

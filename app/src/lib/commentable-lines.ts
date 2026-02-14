import parseDiff from "parse-diff";

/**
 * Represents a file where commenting is possible, with the set of
 * commentable line numbers (lines that appear in the PR diff).
 */
export interface CommentableResult {
  readOnly: false;
  lines: Set<number>;
}

/**
 * Represents a file where commenting is not possible, with a
 * human-readable reason string.
 */
export interface ReadOnlyResult {
  readOnly: true;
  reason: string;
}

export type CommentableLinesResult = CommentableResult | ReadOnlyResult;

/** The shape of a file object returned by our files API route. */
export interface PrFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch: string | null;
  sha: string;
}

/**
 * Extract the set of commentable line numbers from a PR file's diff patch.
 *
 * Commentable lines are those that appear on the RIGHT side of the diff
 * (the head-ref / new version of the file):
 * - `add` changes → `ln` (new-file line number)
 * - `normal` (context) changes → `ln2` (new-file line number)
 *
 * Returns a `ReadOnlyResult` when the file cannot receive comments
 * (absent patch, binary file, deleted file, etc.).
 */
export function getCommentableLines(file: PrFile): CommentableLinesResult {
  // Deleted files don't exist on head-ref — nothing to render or comment on
  if (file.status === "removed") {
    return { readOnly: true, reason: "File was deleted in this PR" };
  }

  // No patch field — could be a binary file, too-large diff, or renamed with no changes
  if (file.patch == null) {
    if (file.additions === 0 && file.deletions === 0) {
      return {
        readOnly: true,
        reason: "File was renamed with no content changes",
      };
    }
    return {
      readOnly: true,
      reason: "Diff is too large or file is binary — cannot comment inline",
    };
  }

  // parse-diff expects a full unified diff with a header line.
  // GitHub's `patch` field contains only the hunks (starting with @@),
  // so we prepend a minimal diff header.
  const diffString = `--- a/${file.filename}\n+++ b/${file.filename}\n${file.patch}`;
  const parsed = parseDiff(diffString);

  const lines = new Set<number>();

  for (const diffFile of parsed) {
    for (const chunk of diffFile.chunks) {
      for (const change of chunk.changes) {
        if (change.type === "add") {
          lines.add(change.ln);
        } else if (change.type === "normal") {
          lines.add(change.ln2);
        }
        // 'del' changes are old-file lines — not relevant for head-ref commenting
      }
    }
  }

  return { readOnly: false, lines };
}

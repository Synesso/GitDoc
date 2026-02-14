import { defaultUrlTransform } from "react-markdown";
import type { Element } from "hast";

/**
 * Creates a URL transform function for react-markdown that rewrites relative
 * URLs in rendered markdown to resolve against the GitHub repository.
 *
 * - Relative image paths → raw.githubusercontent.com/{owner}/{repo}/{headSha}/...
 * - Relative .md/.mdx links → github.com/{owner}/{repo}/blob/{headSha}/...
 * - Absolute URLs, data URIs, and anchor-only URLs are passed through unchanged.
 */
export function makeUrlTransform(
  owner: string,
  repo: string,
  headSha: string,
  filePath: string,
) {
  // Directory of the current markdown file, e.g., "docs/" or ""
  const lastSlash = filePath.lastIndexOf("/");
  const dir = lastSlash >= 0 ? filePath.substring(0, lastSlash + 1) : "";

  return (url: string, key: string, node: Readonly<Element>): string => {
    // Let the default transform handle safety checks first
    const safe = defaultUrlTransform(url);
    if (!safe) return "";

    // Pass through absolute URLs, data URIs, and anchor-only links
    if (/^(https?:\/\/|data:|#)/.test(safe)) {
      return safe;
    }

    // Resolve the relative path against the file's directory
    let resolved: string;
    if (safe.startsWith("/")) {
      // Repo-root-relative: /images/foo.png → images/foo.png
      resolved = safe.slice(1);
    } else {
      // Directory-relative: ./images/foo.png or ../assets/bar.png
      // Use URL constructor for proper path resolution (handles .. traversal)
      const base = `https://raw.githubusercontent.com/${owner}/${repo}/${headSha}/${dir}`;
      const full = new URL(safe, base);
      // Extract the path after /{owner}/{repo}/{headSha}/
      resolved = full.pathname.split("/").slice(4).join("/");
    }

    // Rewrite .md/.mdx links to GitHub blob view (rendered on GitHub)
    if (/\.mdx?(\?.*)?$/.test(resolved)) {
      return `https://github.com/${owner}/${repo}/blob/${headSha}/${resolved}`;
    }

    // Everything else (images, etc.) → raw content URL
    return `https://raw.githubusercontent.com/${owner}/${repo}/${headSha}/${resolved}`;
  };
}

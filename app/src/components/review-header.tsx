"use client";

import { ChevronDown, ExternalLink, FileText, GitPullRequest } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** A changed markdown file in the PR */
export interface PrFileEntry {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
}

export interface ReviewHeaderProps {
  /** Repository owner */
  owner: string;
  /** Repository name */
  repo: string;
  /** PR number */
  prNumber: number;
  /** PR title */
  prTitle: string;
  /** Whether the PR is a draft */
  draft?: boolean;
  /** List of changed markdown files in the PR */
  files: PrFileEntry[];
  /** Currently selected file path */
  currentFile?: string;
  /** Called when the user selects a different file */
  onFileSelect?: (filename: string) => void;
}

/**
 * Header bar for the document review page.
 *
 * Desktop: horizontal bar with breadcrumb (owner/repo#number), PR title,
 * file selector dropdown, and "Open in GitHub" link.
 *
 * Mobile (<md): condensed — PR title truncated, file selector as full-width
 * dropdown, breadcrumb hidden.
 */
export function ReviewHeader({
  owner,
  repo,
  prNumber,
  prTitle,
  draft = false,
  files,
  currentFile,
  onFileSelect,
}: ReviewHeaderProps) {
  const currentFileName = currentFile
    ? currentFile.split("/").pop()
    : undefined;

  const githubPrUrl = `https://github.com/${owner}/${repo}/pull/${prNumber}`;

  return (
    <header className="flex items-center justify-between gap-2 border-b px-4 py-2" role="banner">
      {/* Left section: breadcrumb + PR title */}
      <div className="flex items-center gap-2 min-w-0">
        <GitPullRequest className="size-4 shrink-0 text-muted-foreground" />

        {/* Breadcrumb — hidden on mobile */}
        <nav aria-label="Breadcrumb" className="hidden md:flex items-center gap-1 text-sm text-muted-foreground shrink-0">
          <a
            href={`https://github.com/${owner}/${repo}`}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground transition-colors"
          >
            {owner}/{repo}
          </a>
          <span aria-hidden="true">/</span>
          <a
            href={githubPrUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground transition-colors"
          >
            #{prNumber}
          </a>
        </nav>

        {/* PR number on mobile (replaces breadcrumb) */}
        <span className="md:hidden text-sm text-muted-foreground shrink-0">
          #{prNumber}
        </span>

        <span className="hidden md:inline text-muted-foreground" aria-hidden="true">·</span>

        <h1 className="text-sm font-medium truncate">{prTitle}</h1>

        {draft && (
          <Badge variant="secondary" className="shrink-0 text-[10px] px-1.5 py-0">
            Draft
          </Badge>
        )}
      </div>

      {/* Right section: file selector + GitHub link */}
      <div className="flex items-center gap-2 shrink-0">
        {/* File selector dropdown */}
        {files.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5 max-w-[200px]">
                <FileText className="size-3.5 shrink-0" />
                <span className="truncate text-xs">
                  {currentFileName ?? "Select file"}
                </span>
                <ChevronDown className="size-3 shrink-0 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-w-[320px]">
              {files.map((file) => (
                <DropdownMenuItem
                  key={file.filename}
                  onClick={() => onFileSelect?.(file.filename)}
                  className={file.filename === currentFile ? "bg-accent" : ""}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <FileStatusIndicator status={file.status} />
                    <span className="truncate text-xs">{file.filename}</span>
                    <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                      {file.additions > 0 && (
                        <span className="text-green-600 dark:text-green-400">+{file.additions}</span>
                      )}
                      {file.additions > 0 && file.deletions > 0 && " "}
                      {file.deletions > 0 && (
                        <span className="text-red-600 dark:text-red-400">−{file.deletions}</span>
                      )}
                    </span>
                  </div>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Open in GitHub link — icon-only on mobile */}
        <a
          href={githubPrUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Open pull request in GitHub"
        >
          <ExternalLink className="size-3.5" />
          <span className="hidden md:inline">GitHub</span>
        </a>
      </div>
    </header>
  );
}

/** Small colored dot indicating file status (added/modified/removed/renamed) */
function FileStatusIndicator({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    added: "bg-green-500",
    modified: "bg-yellow-500",
    removed: "bg-red-500",
    renamed: "bg-blue-500",
    copied: "bg-purple-500",
  };

  return (
    <span
      className={`size-2 rounded-full shrink-0 ${colorMap[status] ?? "bg-muted-foreground"}`}
      title={status}
      aria-label={`File ${status}`}
    />
  );
}

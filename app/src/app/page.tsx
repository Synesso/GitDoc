"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { GitPullRequest, LogIn, ArrowRight } from "lucide-react";

function parsePrUrl(url: string): { owner: string; repo: string; pull: string } | null {
  const match = url.match(
    /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/,
  );
  if (!match) return null;
  return { owner: match[1], repo: match[2], pull: match[3] };
}

export default function Home() {
  const router = useRouter();
  const [prUrl, setPrUrl] = useState("");
  const [error, setError] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parsePrUrl(prUrl.trim());
    if (!parsed) {
      setError("Please enter a valid GitHub PR URL (e.g. https://github.com/owner/repo/pull/123)");
      return;
    }
    setError("");
    router.push(`/${parsed.owner}/${parsed.repo}/pull/${parsed.pull}`);
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <main className="flex flex-col items-center gap-8 text-center max-w-lg w-full">
        <div className="flex flex-col items-center gap-3">
          <GitPullRequest className="size-10 text-muted-foreground" />
          <h1 className="text-4xl font-semibold tracking-tight">GitDoc</h1>
          <p className="text-lg text-muted-foreground">
            Review markdown changes in GitHub PRs with a rendered document view.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="w-full flex flex-col gap-3">
          <label htmlFor="pr-url" className="text-sm font-medium text-left">
            Paste a GitHub PR URL to get started
          </label>
          <div className="flex gap-2">
            <input
              id="pr-url"
              type="url"
              value={prUrl}
              onChange={(e) => {
                setPrUrl(e.target.value);
                setError("");
              }}
              placeholder="https://github.com/owner/repo/pull/123"
              className="flex-1 h-9 rounded-md border bg-background px-3 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring"
            />
            <Button type="submit" size="default">
              <ArrowRight className="size-4" />
              <span className="sr-only">Go</span>
            </Button>
          </div>
          {error && (
            <p className="text-sm text-destructive text-left">{error}</p>
          )}
        </form>

        <div className="flex items-center gap-4 w-full">
          <div className="flex-1 border-t" />
          <span className="text-xs text-muted-foreground">or</span>
          <div className="flex-1 border-t" />
        </div>

        <Button variant="outline" size="lg" asChild>
          <a href="/api/auth/login">
            <LogIn className="size-4" />
            Sign in with GitHub
          </a>
        </Button>

        <p className="text-xs text-muted-foreground max-w-sm">
          Sign in to leave review comments directly from the rendered view. 
          Comments are saved as GitHub PR line comments.
        </p>
      </main>
    </div>
  );
}

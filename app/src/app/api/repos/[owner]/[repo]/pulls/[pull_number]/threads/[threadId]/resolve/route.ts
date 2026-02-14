import { requireAuth } from "@/lib/session";
import { buildProxyResponse } from "@/lib/github";
import { githubGraphQL, GitHubGraphQLError } from "@/lib/graphql";

type RouteParams = {
  params: Promise<{
    owner: string;
    repo: string;
    pull_number: string;
    threadId: string;
  }>;
};

const RESOLVE_THREAD = `
mutation ResolveThread($threadId: ID!) {
  resolveReviewThread(input: { threadId: $threadId }) {
    thread {
      id
      isResolved
      resolvedBy {
        login
        avatarUrl
      }
    }
  }
}
`;

interface ResolveResponse {
  resolveReviewThread: {
    thread: {
      id: string;
      isResolved: boolean;
      resolvedBy: { login: string; avatarUrl: string } | null;
    };
  };
}

export async function POST(_request: Request, { params }: RouteParams) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { threadId } = await params;

  try {
    const result = await githubGraphQL<ResolveResponse>(
      session.githubToken,
      RESOLVE_THREAD,
      { threadId },
    );

    const thread = result.resolveReviewThread.thread;
    return buildProxyResponse(
      {
        graphqlId: thread.id,
        isResolved: thread.isResolved,
        resolvedBy: thread.resolvedBy ?? undefined,
      },
      200,
      new Headers(),
    );
  } catch (err) {
    if (err instanceof GitHubGraphQLError) {
      return buildProxyResponse(
        { error: err.message, category: "validation", details: err.errors },
        422,
        new Headers(),
      );
    }
    if (err instanceof Error && err.message.includes("HTTP 401")) {
      return buildProxyResponse(
        { error: "Authentication failed", category: "auth" },
        401,
        new Headers(),
      );
    }
    if (err instanceof Error && err.message.includes("HTTP 403")) {
      return buildProxyResponse(
        { error: "Forbidden — check repository access", category: "auth" },
        403,
        new Headers(),
      );
    }
    throw err;
  }
}

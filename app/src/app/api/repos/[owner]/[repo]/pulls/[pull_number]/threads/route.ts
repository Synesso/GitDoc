import { requireAuth } from "@/lib/session";
import { buildProxyResponse } from "@/lib/github";
import { githubGraphQL, GitHubGraphQLError } from "@/lib/graphql";

type RouteParams = {
  params: Promise<{ owner: string; repo: string; pull_number: string }>;
};

const GET_PR_REVIEW_THREADS = `
query GetPrReviewThreads($owner: String!, $repo: String!, $prNumber: Int!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $prNumber) {
      reviewThreads(first: 100, after: $cursor) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          isResolved
          isOutdated
          isCollapsed
          path
          line
          originalLine
          startLine
          originalStartLine
          diffSide
          startDiffSide
          subjectType
          resolvedBy {
            login
            avatarUrl
          }
          viewerCanResolve
          viewerCanUnresolve
          comments(first: 100) {
            nodes {
              databaseId
              fullDatabaseId
              body
              createdAt
              outdated
              author {
                login
                avatarUrl
              }
              line
              originalLine
              startLine
              originalStartLine
              path
              diffHunk
            }
          }
        }
      }
    }
  }
}
`;

interface GraphQLThreadNode {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  isCollapsed: boolean;
  path: string;
  line: number | null;
  originalLine: number | null;
  startLine: number | null;
  originalStartLine: number | null;
  diffSide: "LEFT" | "RIGHT";
  startDiffSide: "LEFT" | "RIGHT" | null;
  subjectType: "LINE" | "FILE";
  resolvedBy: { login: string; avatarUrl: string } | null;
  viewerCanResolve: boolean;
  viewerCanUnresolve: boolean;
  comments: {
    nodes: GraphQLCommentNode[];
  };
}

interface GraphQLCommentNode {
  databaseId: number;
  fullDatabaseId: string;
  body: string;
  createdAt: string;
  outdated: boolean;
  author: { login: string; avatarUrl: string } | null;
  line: number | null;
  originalLine: number | null;
  startLine: number | null;
  originalStartLine: number | null;
  path: string;
  diffHunk: string;
}

interface GraphQLResponse {
  repository: {
    pullRequest: {
      reviewThreads: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: GraphQLThreadNode[];
      };
    };
  };
}

function mapThread(node: GraphQLThreadNode) {
  const firstComment = node.comments.nodes[0];
  return {
    graphqlId: node.id,
    topLevelCommentId: firstComment?.databaseId ?? null,
    isResolved: node.isResolved,
    resolvedBy: node.resolvedBy ?? undefined,
    viewerCanResolve: node.viewerCanResolve,
    viewerCanUnresolve: node.viewerCanUnresolve,
    isOutdated: node.isOutdated,
    path: node.path,
    line: node.line,
    startLine: node.startLine,
    originalLine: node.originalLine,
    diffSide: node.diffSide,
    subjectType: node.subjectType,
    comments: node.comments.nodes.map((c) => ({
      databaseId: c.databaseId,
      body: c.body,
      createdAt: c.createdAt,
      outdated: c.outdated,
      author: c.author ?? { login: "ghost", avatarUrl: "" },
      diffHunk: c.diffHunk,
    })),
  };
}

export async function GET(request: Request, { params }: RouteParams) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { owner, repo, pull_number } = await params;
  const prNumber = parseInt(pull_number, 10);
  if (isNaN(prNumber)) {
    return buildProxyResponse(
      { error: "Invalid pull request number", category: "validation" },
      400,
      new Headers(),
    );
  }

  const pathFilter = new URL(request.url).searchParams.get("path");

  try {
    // Paginate through all review threads
    const allThreads: GraphQLThreadNode[] = [];
    let cursor: string | null = null;
    let hasNextPage = true;

    while (hasNextPage) {
      const result: GraphQLResponse = await githubGraphQL(
        session.githubToken,
        GET_PR_REVIEW_THREADS,
        { owner, repo, prNumber, cursor },
      );

      const connection = result.repository.pullRequest.reviewThreads;
      allThreads.push(...connection.nodes);
      hasNextPage = connection.pageInfo.hasNextPage;
      cursor = connection.pageInfo.endCursor;
    }

    let threads = allThreads.map(mapThread);

    // Server-side filter by path if requested
    if (pathFilter) {
      threads = threads.filter((t) => t.path === pathFilter);
    }

    return buildProxyResponse({ threads }, 200, new Headers());
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

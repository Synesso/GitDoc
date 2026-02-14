const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";

export interface GraphQLError {
  message: string;
  type?: string;
  path?: (string | number)[];
  locations?: { line: number; column: number }[];
}

export class GitHubGraphQLError extends Error {
  readonly errors: GraphQLError[];

  constructor(errors: GraphQLError[]) {
    const message = errors.map((e) => e.message).join("; ");
    super(message);
    this.name = "GitHubGraphQLError";
    this.errors = errors;
  }
}

/**
 * Execute a GitHub GraphQL API query or mutation.
 *
 * Uses `POST https://api.github.com/graphql` with Bearer token auth.
 * Throws `GitHubGraphQLError` if the response contains an `errors` array.
 */
export async function githubGraphQL<T>(
  token: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const res = await fetch(GITHUB_GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`GitHub GraphQL request failed with HTTP ${res.status}`);
  }

  const json = await res.json();

  if (json.errors) {
    throw new GitHubGraphQLError(json.errors);
  }

  return json.data as T;
}

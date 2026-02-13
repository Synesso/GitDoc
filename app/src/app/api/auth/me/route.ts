import { getSession } from "@/lib/session";

export async function GET() {
  const session = await getSession();

  if (!session.githubToken) {
    return Response.json(
      { error: "Unauthorized", category: "auth" },
      { status: 401 },
    );
  }

  return Response.json({
    login: session.githubLogin ?? null,
    avatarUrl: session.avatarUrl ?? null,
    name: session.name ?? null,
  });
}

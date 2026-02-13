import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { env } from "./env";

export interface SessionData {
  githubToken?: string;
  githubLogin?: string;
  avatarUrl?: string;
  name?: string;
}

function getSessionOptions() {
  return {
    password: env.SESSION_SECRET,
    cookieName: "gitdoc_session",
    ttl: 60 * 60 * 24 * 30, // 30 days
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
    },
  };
}

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), getSessionOptions());
}

/** Returns the session if authenticated, or a 401 Response. */
export async function requireAuth(): Promise<
  | { session: SessionData & { githubToken: string }; error?: never }
  | { session?: never; error: Response }
> {
  const session = await getSession();
  if (!session.githubToken) {
    return {
      error: Response.json(
        { error: "Unauthorized", category: "auth" },
        { status: 401 },
      ),
    };
  }
  return { session: session as SessionData & { githubToken: string } };
}

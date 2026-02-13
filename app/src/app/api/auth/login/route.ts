import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";

export async function GET(request: NextRequest) {
  const state = crypto.randomUUID();

  // Store returnTo path so we can redirect back after callback
  const returnTo = request.nextUrl.searchParams.get("returnTo") || "/";

  // Store state + returnTo in a short-lived cookie for CSRF validation in the callback
  const cookieStore = await cookies();
  cookieStore.set("oauth_state", JSON.stringify({ state, returnTo }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 10, // 10 minutes — enough time to complete the OAuth flow
    path: "/",
  });

  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("scope", "repo");
  authorizeUrl.searchParams.set(
    "redirect_uri",
    `${env.NEXT_PUBLIC_APP_URL}/api/auth/callback`,
  );

  return NextResponse.redirect(authorizeUrl.toString());
}

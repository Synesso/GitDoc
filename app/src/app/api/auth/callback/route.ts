import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getSession } from "@/lib/session";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");

  if (!code || !state) {
    return NextResponse.redirect(
      `${env.NEXT_PUBLIC_APP_URL}/?error=missing_params`,
    );
  }

  // Validate state against the oauth_state cookie to prevent CSRF
  const cookieStore = await cookies();
  const oauthStateCookie = cookieStore.get("oauth_state");

  if (!oauthStateCookie) {
    return NextResponse.redirect(
      `${env.NEXT_PUBLIC_APP_URL}/?error=missing_state`,
    );
  }

  let storedState: string;
  let returnTo: string;
  try {
    const parsed = JSON.parse(oauthStateCookie.value);
    storedState = parsed.state;
    returnTo = parsed.returnTo || "/";
  } catch {
    return NextResponse.redirect(
      `${env.NEXT_PUBLIC_APP_URL}/?error=invalid_state`,
    );
  }

  if (state !== storedState) {
    return NextResponse.redirect(
      `${env.NEXT_PUBLIC_APP_URL}/?error=state_mismatch`,
    );
  }

  // Exchange code for access token
  const tokenResponse = await fetch(
    "https://github.com/login/oauth/access_token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
      }),
    },
  );

  if (!tokenResponse.ok) {
    return NextResponse.redirect(
      `${env.NEXT_PUBLIC_APP_URL}/?error=token_exchange_failed`,
    );
  }

  const tokenData = await tokenResponse.json();

  if (tokenData.error) {
    return NextResponse.redirect(
      `${env.NEXT_PUBLIC_APP_URL}/?error=${tokenData.error}`,
    );
  }

  const accessToken: string = tokenData.access_token;

  // Fetch user profile to store login and avatar
  const userResponse = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
    },
  });

  let githubLogin: string | undefined;
  let avatarUrl: string | undefined;

  if (userResponse.ok) {
    const userData = await userResponse.json();
    githubLogin = userData.login;
    avatarUrl = userData.avatar_url;
  }

  // Store token and user info in the encrypted session cookie
  const session = await getSession();
  session.githubToken = accessToken;
  session.githubLogin = githubLogin;
  session.avatarUrl = avatarUrl;
  await session.save();

  // Clear the oauth_state cookie
  cookieStore.delete("oauth_state");

  return NextResponse.redirect(`${env.NEXT_PUBLIC_APP_URL}${returnTo}`);
}

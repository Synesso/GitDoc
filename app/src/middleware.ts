import { NextRequest, NextResponse } from "next/server";

export const config = {
  matcher: ["/api/repos/:path*"],
};

export function middleware(request: NextRequest) {
  const sessionCookie = request.cookies.get("gitdoc_session");
  if (!sessionCookie?.value) {
    return NextResponse.json(
      { error: "Unauthorized", category: "auth" },
      { status: 401 },
    );
  }
  return NextResponse.next();
}

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySession, SESSION_COOKIE } from "@/lib/auth";

// Gate the entire app behind a session cookie. Unauthenticated page requests
// redirect to /login; unauthenticated API requests get a 401. The matcher
// below already excludes /login, /api/auth/*, Next internals and static files.
export async function middleware(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const user = await verifySession(token);
  if (user) return NextResponse.next();

  const { pathname, search } = req.nextUrl;
  if (pathname.startsWith("/api/")) {
    return new NextResponse(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("from", pathname + search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/((?!login|api/auth|_next/static|_next/image|favicon.ico|resihome-logo.png|resihome-wordmark.png|.*\\.(?:png|jpg|jpeg|svg|gif|ico|css|js|map|woff|woff2)).*)",
  ],
};

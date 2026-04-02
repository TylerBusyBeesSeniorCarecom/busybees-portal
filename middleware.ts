import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const isLoggedIn =
    request.cookies.get("next-auth.session-token") ||
    request.cookies.get("__Secure-next-auth.session-token");

  const { pathname } = request.nextUrl;

  // ✅ Allow public routes (login page + auth + assets)
  if (
    pathname === "/" ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon.ico")
  ) {
    return NextResponse.next();
  }

  // 🔒 Redirect if NOT logged in
  if (!isLoggedIn) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  // ✅ Allow access if logged in
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Protect everything except static files
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
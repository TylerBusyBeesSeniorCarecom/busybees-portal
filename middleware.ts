import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

import { buildCorsHeaders, buildPreflightCorsHeaders, getAllowedCorsOrigin } from "@/lib/cors";

const PUBLIC_PATHS = new Set(["/"]);
const ROUTE_LEVEL_AUTH_API_PATHS = new Set([
  "/api/firebase-custom-token",
  "/api/availability",
  "/api/caregivers",
  "/api/client-history",
  "/api/clients",
  "/api/current-week",
  "/api/drive-time",
  "/api/next-week",
  "/api/schedule",
  "/api/schedule-edit-log",
]);

function isPublicPath(pathname: string) {
  if (PUBLIC_PATHS.has(pathname)) return true;
  if (pathname.startsWith("/api/auth")) return true;
  if (pathname === "/api/firebase-custom-token") return true;
  if (pathname.startsWith("/_next")) return true;
  if (pathname === "/favicon.ico") return true;
  return false;
}

function isApiPath(pathname: string) {
  return pathname.startsWith("/api/");
}

function isNextAuthApiPath(pathname: string) {
  return pathname.startsWith("/api/auth");
}

function withCors(request: NextRequest, response: NextResponse) {
  const origin = request.headers.get("origin");
  if (!getAllowedCorsOrigin(origin)) {
    return response;
  }

  const headers = buildCorsHeaders(origin);
  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value);
  }
  response.headers.set("Access-Control-Allow-Private-Network", "true");

  return response;
}

function jsonAuthError(
  request: NextRequest,
  body: Record<string, unknown>,
  status: number
) {
  return withCors(
    request,
    NextResponse.json(body, {
      status,
    })
  );
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const origin = request.headers.get("origin");

  if (isApiPath(pathname) && !isNextAuthApiPath(pathname)) {
    if (request.method === "OPTIONS") {
      const headers = buildPreflightCorsHeaders(origin);
      if (Object.keys(headers).length > 0) {
        if (headers instanceof Headers) {
          headers.set("Access-Control-Allow-Private-Network", "true");
        } else if (Array.isArray(headers)) {
          headers.push(["Access-Control-Allow-Private-Network", "true"]);
        } else {
          headers["Access-Control-Allow-Private-Network"] = "true";
        }
        return new NextResponse(null, {
          status: 204,
          headers,
        });
      }
    }

    if (!ROUTE_LEVEL_AUTH_API_PATHS.has(pathname)) {
      if (isPublicPath(pathname)) {
        return withCors(request, NextResponse.next());
      }

      const token = await getToken({
        req: request,
        secret: process.env.NEXTAUTH_SECRET,
      });

      if (!token) {
        return jsonAuthError(request, { error: "not_signed_in" }, 401);
      }

      if (typeof token.role !== "string" || token.role.toLowerCase() !== "admin") {
        return jsonAuthError(request, { error: "forbidden" }, 403);
      }
    }

    return withCors(request, NextResponse.next());
  }

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });

  if (!token) {
    const loginUrl = new URL("/", request.url);
    if (pathname !== "/") {
      loginUrl.searchParams.set("callbackUrl", `${pathname}${search}`);
    }

    const response = NextResponse.redirect(loginUrl);
    response.cookies.delete("next-auth.session-token");
    response.cookies.delete("__Secure-next-auth.session-token");
    return response;
  }

  if (typeof token.role !== "string" || token.role.toLowerCase() !== "admin") {
    const response = NextResponse.redirect(new URL("/", request.url));
    response.cookies.delete("next-auth.session-token");
    response.cookies.delete("__Secure-next-auth.session-token");
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

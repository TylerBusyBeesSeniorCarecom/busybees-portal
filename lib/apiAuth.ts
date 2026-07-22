import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { resolveSession } from "@/lib/authResolver";
import { buildCorsHeaders } from "@/lib/cors";

export function buildApiJsonResponse(
  request: NextRequest,
  body: unknown,
  status: number
) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...buildCorsHeaders(request.headers.get("origin")),
    },
  });
}

export async function requireAdminSession(request: NextRequest) {
  const session = await resolveSession(request);

  if (!session) {
    return {
      session: null,
      response: buildApiJsonResponse(request, { error: "not_signed_in" }, 401),
    };
  }

  const role = String(session.role || "").trim().toLowerCase();
  if (role !== "admin") {
    return {
      session: null,
      response: buildApiJsonResponse(request, { error: "forbidden" }, 403),
    };
  }

  return { session, response: null };
}

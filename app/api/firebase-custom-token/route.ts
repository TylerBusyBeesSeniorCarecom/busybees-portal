import { NextRequest, NextResponse } from "next/server";
import type { Session } from "next-auth";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { buildCorsHeaders } from "@/lib/cors";
import { adminAuth } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function buildJsonResponse(
  request: NextRequest,
  body: Record<string, unknown>,
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

function methodNotAllowed(request: NextRequest) {
  return buildJsonResponse(request, { error: "method_not_allowed" }, 405);
}

function getSessionRole(session: Session | null) {
  return String(session?.user?.role || "").trim().toLowerCase();
}

function getSessionCaregiverId(session: Session | null) {
  return String(session?.user?.caregiverId || "").trim();
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Cache-Control": "no-store",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type",
      ...buildCorsHeaders(request.headers.get("origin")),
    },
  });
}

export async function GET(request: NextRequest) {
  return methodNotAllowed(request);
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return buildJsonResponse(request, { error: "not_signed_in" }, 401);
    }

    const role = getSessionRole(session);
    if (role !== "admin") {
      return buildJsonResponse(request, { error: "forbidden" }, 403);
    }

    const uid = getSessionCaregiverId(session);
    if (!uid) {
      return buildJsonResponse(request, { error: "missing_caregiver_id" }, 400);
    }

    const expiresAt = Date.now() + 55 * 60 * 1000;
    const token = await adminAuth.createCustomToken(uid, {
      role,
      caregiverId: uid,
    });

    console.info("Minted Firebase custom token", { uid, expiresAt });

    return buildJsonResponse(request, { token, expiresAt }, 200);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to mint Firebase token";
    return buildJsonResponse(request, { error: message }, 500);
  }
}

export async function PUT(request: NextRequest) {
  return methodNotAllowed(request);
}

export async function PATCH(request: NextRequest) {
  return methodNotAllowed(request);
}

export async function DELETE(request: NextRequest) {
  return methodNotAllowed(request);
}

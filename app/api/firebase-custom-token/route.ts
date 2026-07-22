import { NextRequest, NextResponse } from "next/server";
import type { Session } from "next-auth";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { buildCorsHeaders } from "@/lib/cors";
import { adminAuth } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const ALLOWED_PORTAL_ROLES = new Set(["admin", "scheduler", "beekeeper"]);

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;

  try {
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function buildJsonResponse(
  request: NextRequest,
  body: Record<string, unknown>,
  status: number
) {
  const corsHeaders = buildCorsHeaders(request.headers.get("origin"));
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...corsHeaders,
    },
  });
}

function methodNotAllowed(request: NextRequest) {
  return buildJsonResponse(request, { error: "method_not_allowed" }, 405);
}

function getSessionRole(session: Session | null) {
  return String(session?.user?.role || "").trim().toLowerCase();
}

function getSessionUid(session: Session | null) {
  return String(session?.user?.uid || session?.user?.caregiverId || "").trim();
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
    const origin = request.headers.get("origin");
    const corsHeaders = buildCorsHeaders(origin);
    const allowedOrigin =
      corsHeaders instanceof Headers
        ? corsHeaders.get("Access-Control-Allow-Origin")
        : Array.isArray(corsHeaders)
          ? corsHeaders.find(([key]) => key.toLowerCase() === "access-control-allow-origin")?.[1]
          : corsHeaders["Access-Control-Allow-Origin"];
    const allowCredentials =
      corsHeaders instanceof Headers
        ? corsHeaders.get("Access-Control-Allow-Credentials")
        : Array.isArray(corsHeaders)
          ? corsHeaders.find(([key]) => key.toLowerCase() === "access-control-allow-credentials")?.[1]
          : corsHeaders["Access-Control-Allow-Credentials"];

    const session = await getServerSession(authOptions);
    console.info("[firebase-custom-token] request received", {
      origin,
      allowedOrigin,
      allowCredentials,
      hasSession: Boolean(session),
    });

    if (!session) {
      console.warn("[firebase-custom-token] session missing for request", { origin });
      return buildJsonResponse(request, { error: "not_signed_in" }, 401);
    }

    const role = getSessionRole(session);
    if (!ALLOWED_PORTAL_ROLES.has(role)) {
      return buildJsonResponse(request, { error: "forbidden" }, 403);
    }

    const uid = getSessionUid(session);
    if (!uid) {
      return buildJsonResponse(request, { error: "missing_uid" }, 400);
    }

    const expiresAt = Date.now() + 55 * 60 * 1000;
    const token = await adminAuth.createCustomToken(uid, {
      role,
      caregiverId: String(session.user.caregiverId || uid).trim() || uid,
    });
    const decoded = decodeJwtPayload(token);
    const claims =
      decoded && typeof decoded.claims === "object" && decoded.claims !== null
        ? (decoded.claims as Record<string, unknown>)
        : {};

    console.info("[firebase-custom-token] Minted Firebase custom token", {
      uid,
      expiresAt,
      role,
      decodedClaims: claims,
    });

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

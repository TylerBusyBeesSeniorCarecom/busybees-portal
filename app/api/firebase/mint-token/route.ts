import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_PORTAL_ROLES = new Set(["admin", "scheduler", "beekeeper"]);
const GOOGLE_WORKSPACE_DOMAIN =
  (process.env.GOOGLE_WORKSPACE_DOMAIN || "busybeesseniorcare.com").trim().toLowerCase();
const TOKENINFO_CACHE_TTL_MS = 5 * 60 * 1000;

type GoogleTokenInfo = {
  email?: string;
  email_verified?: string;
  hd?: string;
};

type MintSubject = {
  uid: string;
  caregiverId: string;
  role: string;
};

const tokenInfoCache = new Map<
  string,
  {
    expiresAt: number;
    value: GoogleTokenInfo;
  }
>();

function getSessionRole(session: any): string {
  return String(session?.user?.role || "").trim().toLowerCase();
}

function getSessionUid(session: any): string {
  return String(session?.user?.uid || session?.user?.caregiverId || "").trim();
}

function pruneTokenInfoCache(now = Date.now()) {
  for (const [token, entry] of tokenInfoCache.entries()) {
    if (entry.expiresAt <= now) {
      tokenInfoCache.delete(token);
    }
  }
}

async function readTokenInfo(accessToken: string): Promise<GoogleTokenInfo> {
  const now = Date.now();
  pruneTokenInfoCache(now);

  const cached = tokenInfoCache.get(accessToken);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const url =
    "https://oauth2.googleapis.com/tokeninfo?" +
    new URLSearchParams({ access_token: accessToken }).toString();
  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Invalid Google access token");
  }

  const value = (await response.json()) as GoogleTokenInfo;
  tokenInfoCache.set(accessToken, {
    expiresAt: now + TOKENINFO_CACHE_TTL_MS,
    value,
  });
  return value;
}

async function resolveGoogleBearerSubject(
  request: NextRequest
): Promise<MintSubject | "missing" | "unauthorized" | "forbidden"> {
  const authHeader = request.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return "missing";
  }

  const accessToken = authHeader.slice("Bearer ".length).trim();
  if (!accessToken) {
    return "missing";
  }

  const tokenInfo = await readTokenInfo(accessToken);
  const hostedDomain = String(tokenInfo.hd || "").trim().toLowerCase();
  const emailVerified = String(tokenInfo.email_verified || "").trim().toLowerCase();
  const email = String(tokenInfo.email || "").trim().toLowerCase();

  if (!email) {
    console.log("[mint-token] rejected: no email in tokeninfo", tokenInfo);
    return "unauthorized";
  }

  if (emailVerified !== "true") {
    console.log("[mint-token] rejected: email_verified is", emailVerified);
    return "unauthorized";
  }

  if (hostedDomain !== GOOGLE_WORKSPACE_DOMAIN) {
    console.log(
      "[mint-token] rejected: hd mismatch, got",
      hostedDomain,
      "expected",
      GOOGLE_WORKSPACE_DOMAIN
    );
    return "unauthorized";
  }

  const snapshot = await adminDb
    .collection("users")
    .where("workspaceEmail", "==", email)
    .limit(1)
    .get();

  if (snapshot.empty) {
    console.log("[mint-token] rejected: no /users doc with workspaceEmail ==", email);
    return "unauthorized";
  }

  const doc = snapshot.docs[0];
  const data = doc.data() as Record<string, unknown>;
  const role = String(data.role || "").trim().toLowerCase();

  if (!ALLOWED_PORTAL_ROLES.has(role)) {
    return "forbidden";
  }

  const caregiverId = String(data.caregiverId || doc.id).trim() || doc.id;

  return {
    uid: doc.id,
    caregiverId,
    role,
  };
}

async function resolveMintSubject(request: NextRequest): Promise<MintSubject | NextResponse> {
  const session = await getServerSession(authOptions);

  if (session) {
    const role = getSessionRole(session);
    if (!ALLOWED_PORTAL_ROLES.has(role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const uid = getSessionUid(session);
    if (!uid) {
      return NextResponse.json({ error: "Missing uid on session" }, { status: 400 });
    }

    return {
      uid,
      caregiverId: String(session.user.caregiverId || uid).trim() || uid,
      role,
    };
  }

  const bearerSubject = await resolveGoogleBearerSubject(request);
  if (bearerSubject === "missing" || bearerSubject === "unauthorized") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (bearerSubject === "forbidden") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return bearerSubject;
}

export async function POST(request: NextRequest) {
  try {
    const subject = await resolveMintSubject(request);
    if (subject instanceof NextResponse) {
      return subject;
    }

    const expiresAt = Date.now() + 55 * 60 * 1000;
    const token = await adminAuth.createCustomToken(subject.uid, {
      role: subject.role,
      caregiverId: subject.caregiverId,
    });

    return NextResponse.json({ token, expiresAt });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to mint Firebase token";
    const status = message === "Invalid Google access token" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

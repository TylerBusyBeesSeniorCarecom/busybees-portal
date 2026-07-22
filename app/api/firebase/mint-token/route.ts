import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { adminAuth } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const ALLOWED_PORTAL_ROLES = new Set(["admin", "scheduler", "beekeeper"]);

function getSessionRole(session: any): string {
  return String(session?.user?.role || "").trim().toLowerCase();
}

function getSessionUid(session: any): string {
  return String(session?.user?.uid || session?.user?.caregiverId || "").trim();
}

export async function POST() {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const role = getSessionRole(session);
    if (!ALLOWED_PORTAL_ROLES.has(role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const uid = getSessionUid(session);
    if (!uid) {
      return NextResponse.json({ error: "Missing uid on session" }, { status: 400 });
    }

    const token = await adminAuth.createCustomToken(uid, {
      role,
      caregiverId: String(session.user.caregiverId || uid).trim() || uid,
    });

    return NextResponse.json({ token });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to mint Firebase token";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

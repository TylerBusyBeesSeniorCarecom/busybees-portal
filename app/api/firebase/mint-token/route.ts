import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { adminAuth } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getSessionRole(session: any): string {
  return String(session?.user?.role || "").trim().toLowerCase();
}

function getSessionCaregiverId(session: any): string {
  return String(session?.user?.caregiverId || "").trim();
}

export async function POST() {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (getSessionRole(session) !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const caregiverId = getSessionCaregiverId(session);
    if (!caregiverId) {
      return NextResponse.json({ error: "Missing caregiverId on session" }, { status: 400 });
    }

    const token = await adminAuth.createCustomToken(caregiverId, {
      role: "admin",
      caregiverId,
    });

    return NextResponse.json({ token });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to mint Firebase token";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

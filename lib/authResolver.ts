import { getServerSession } from "next-auth";
import type { NextRequest } from "next/server";

import { authOptions } from "@/lib/auth";
import { adminAuth } from "@/lib/firebaseAdmin";

export interface ResolvedSession {
  caregiverId: string;
  role: string;
  source: "nextauth" | "bearer";
}

export async function resolveSession(
  request: NextRequest
): Promise<ResolvedSession | null> {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token) {
      try {
        const decoded = await adminAuth.verifyIdToken(token);
        return {
          caregiverId: String(decoded.caregiverId ?? decoded.uid ?? "").trim(),
          role: String(decoded.role ?? "admin").trim() || "admin",
          source: "bearer",
        };
      } catch {
        // Fall through to NextAuth cookie auth when the bearer token is missing or invalid.
      }
    }
  }

  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return null;
  }

  return {
    caregiverId: String(session.user.caregiverId ?? "").trim(),
    role: String(session.user.role ?? "").trim() || "admin",
    source: "nextauth",
  };
}

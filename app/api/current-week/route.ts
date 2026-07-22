import type { NextRequest } from "next/server";

import { buildApiJsonResponse, requireAdminSession } from "@/lib/apiAuth";

export const dynamic = "force-dynamic";

function getBase() {
  const base = process.env.CURRENT_WEEK_API_URL;
  if (!base) throw new Error("Missing CURRENT_WEEK_API_URL");
  return base;
}

export async function GET(request: NextRequest) {
  try {
    const { response } = await requireAdminSession(request);
    if (response) return response;

    const base = getBase();
    const url = new URL(request.url);
    const action = url.searchParams.get("action") || "getCurrentWeekGrid";

    const r = await fetch(`${base}?action=${encodeURIComponent(action)}`, {
      cache: "no-store",
    });

    const text = await r.text();
    // Apps Script always returns JSON, but keep this safe:
    const data = text ? JSON.parse(text) : null;

    return buildApiJsonResponse(request, data ?? {}, r.ok ? 200 : 500);
  } catch (err: any) {
    return buildApiJsonResponse(
      request,
      { ok: false, error: err?.message ?? "Unknown error" },
      500
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { response } = await requireAdminSession(request);
    if (response) return response;

    const base = getBase();
    const body = await request.json();

    const r = await fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const text = await r.text();
    const data = text ? JSON.parse(text) : null;

    return buildApiJsonResponse(request, data ?? {}, r.ok ? 200 : 500);
  } catch (err: any) {
    return buildApiJsonResponse(
      request,
      { ok: false, error: err?.message ?? "Unknown error" },
      500
    );
  }
}

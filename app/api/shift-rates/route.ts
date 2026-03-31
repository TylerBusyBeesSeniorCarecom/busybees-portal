import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function getAppsScriptBaseUrl() {
  const url = process.env.SHIFT_RATE_APPS_SCRIPT_URL;
  if (!url) {
    throw new Error("Missing SHIFT_RATE_APPS_SCRIPT_URL");
  }
  return url;
}

function getAppsScriptToken() {
  const token = process.env.SHIFT_RATE_APPS_SCRIPT_TOKEN;
  if (!token) {
    throw new Error("Missing SHIFT_RATE_APPS_SCRIPT_TOKEN");
  }
  return token;
}

async function fetchAppsScriptJson(url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });

  const text = await res.text();

  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    throw new Error(
      data?.error ||
        data?.message ||
        `Apps Script request failed with status ${res.status}`
    );
  }

  if (data?.ok === false) {
    throw new Error(data?.error || "Apps Script returned ok:false");
  }

  return data;
}

/**
 * GET /api/shift-rates?dateFrom=2026-03-22&dateTo=2026-03-28
 * GET /api/shift-rates?shiftId=abc123
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const dateFrom = searchParams.get("dateFrom") || "";
    const dateTo = searchParams.get("dateTo") || "";
    const shiftId = searchParams.get("shiftId") || "";

    const baseUrl = getAppsScriptBaseUrl();
    const qs = new URLSearchParams({
      action: "getShiftRates",
      token: getAppsScriptToken(),
    });

    if (dateFrom) qs.set("dateFrom", dateFrom);
    if (dateTo) qs.set("dateTo", dateTo);
    if (shiftId) qs.set("shiftId", shiftId);

    const data = await fetchAppsScriptJson(`${baseUrl}?${qs.toString()}`, {
      method: "GET",
    });

    return NextResponse.json(data);
  } catch (error: any) {
    console.error("[shift-rates][GET] failed:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Failed to fetch shift rates",
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/shift-rates
 * Body:
 * {
 *   "action": "updateShiftRate",
 *   "shiftId": "...",
 *   "newRate": 18,
 *   "updatedBy": "Kristin",
 *   "reason": "Manual override"
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const action = body?.action;
    if (!action) {
      return NextResponse.json(
        { ok: false, error: "Missing action" },
        { status: 400 }
      );
    }

    const baseUrl = getAppsScriptBaseUrl();

    const data = await fetchAppsScriptJson(baseUrl, {
      method: "POST",
      body: JSON.stringify({
        ...body,
        token: getAppsScriptToken(),
      }),
    });

    return NextResponse.json(data);
  } catch (error: any) {
    console.error("[shift-rates][POST] failed:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Failed to update shift rate",
      },
      { status: 500 }
    );
  }
}
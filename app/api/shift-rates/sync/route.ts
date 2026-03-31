import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function getAppsScriptBaseUrl() {
  const url = process.env.SHIFT_RATE_SYNC_APPS_SCRIPT_URL;
  if (!url) {
    throw new Error("Missing SHIFT_RATE_SYNC_APPS_SCRIPT_URL");
  }
  return url;
}

function getAppsScriptToken() {
  const token = process.env.SHIFT_RATE_SYNC_APPS_SCRIPT_TOKEN;
  if (!token) {
    throw new Error("Missing SHIFT_RATE_SYNC_APPS_SCRIPT_TOKEN");
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
        `Apps Script request failed (${res.status})`
    );
  }

  if (!data?.ok) {
    throw new Error(
      data?.error || data?.message || "Apps Script returned an error"
    );
  }

  return data;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const dateFrom = body?.dateFrom ?? "";
    const dateTo = body?.dateTo ?? "";

    const baseUrl = getAppsScriptBaseUrl();
    const token = getAppsScriptToken();

    const data = await fetchAppsScriptJson(baseUrl, {
      method: "POST",
      body: JSON.stringify({
        action: "syncShiftRatesFromAllShifts",
        token,
        dateFrom,
        dateTo,
      }),
    });

    return NextResponse.json({
      ok: true,
      message: data?.message || "Shift rates synced successfully.",
      spreadsheetId: data?.spreadsheetId ?? null,
      created: data?.created ?? 0,
      updated: data?.updated ?? 0,
      skippedLocked: data?.skippedLocked ?? 0,
      processed: data?.processed ?? 0,
      data,
    });
  } catch (error: any) {
    console.error("[shift-rates/sync] POST failed:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Failed to sync shift rates",
      },
      { status: 500 }
    );
  }
}
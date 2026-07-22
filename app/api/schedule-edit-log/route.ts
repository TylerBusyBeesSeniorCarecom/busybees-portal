import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { buildApiJsonResponse, requireAdminSession } from "@/lib/apiAuth";

export const dynamic = "force-dynamic";

function getBase() {
  const base = process.env.SCHEDULE_EDIT_LOG_API_URL;

  console.log("[ScheduleEditLog] Checking env variable SCHEDULE_EDIT_LOG_API_URL");

  if (!base) {
    console.error("[ScheduleEditLog] ❌ ENV VARIABLE MISSING");
    throw new Error("Missing SCHEDULE_EDIT_LOG_API_URL");
  }

  console.log("[ScheduleEditLog] ✅ Using Apps Script endpoint:", base);
  return base;
}

async function parseJsonResponse(r: Response, context: string) {
  const text = await r.text();

  console.log(`[ScheduleEditLog] Raw Apps Script response for ${context}:`);
  console.log(text);

  let data: any = null;

  try {
    data = text ? JSON.parse(text.trim()) : null;
  } catch {
    console.error(`[ScheduleEditLog] ❌ Failed to parse JSON response for ${context}`);
    return {
      ok: false,
      response: NextResponse.json(
        {
          ok: false,
          error: "Apps Script returned invalid JSON",
          rawResponse: text,
        },
        { status: 500 }
      ),
    };
  }

  console.log(`[ScheduleEditLog] Parsed response for ${context}:`);
  console.log(JSON.stringify(data, null, 2));

  return {
    ok: true,
    data,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { response } = await requireAdminSession(request);
    if (response) return response;

    console.log("--------------------------------------------------");
    console.log("[ScheduleEditLog] Incoming GET request");

    const base = getBase();
    const { searchParams } = new URL(request.url);

    const weekType = searchParams.get("weekType") || "";
    const weekOf = searchParams.get("weekOf") || "";
    const cell = searchParams.get("cell") || "";
    const client = searchParams.get("client") || "";

    const qs = new URLSearchParams({
      action: "getScheduleEditLog",
    });

    if (weekType) qs.set("weekType", weekType);
    if (weekOf) qs.set("weekOf", weekOf);
    if (cell) qs.set("cell", cell);
    if (client) qs.set("client", client);

    const url = `${base}${base.includes("?") ? "&" : "?"}${qs.toString()}`;

    console.log("[ScheduleEditLog] GET url:");
    console.log(url);

    const r = await fetch(url, {
      method: "GET",
      cache: "no-store",
      redirect: "follow",
    });

    console.log("[ScheduleEditLog] Apps Script GET response status:", r.status);

    const parsed = await parseJsonResponse(r, "GET");
    if (!parsed.ok) return parsed.response;

    return buildApiJsonResponse(request, parsed.data, r.ok ? 200 : 500);
  } catch (err: any) {
    console.error("[ScheduleEditLog] ❌ GET ERROR OCCURRED:");
    console.error(err);

    return buildApiJsonResponse(
      request,
      {
        ok: false,
        error: err?.message ?? "Unknown error",
      },
      500
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { response } = await requireAdminSession(request);
    if (response) return response;

    console.log("--------------------------------------------------");
    console.log("[ScheduleEditLog] Incoming POST request");

    const base = getBase();
    const body = await request.json();

    console.log("[ScheduleEditLog] Request payload received:");
    console.log(JSON.stringify(body, null, 2));

    const payload = {
      action: "appendScheduleEditLog",
      ...body,
    };

    console.log("[ScheduleEditLog] Payload being sent to Apps Script:");
    console.log(JSON.stringify(payload, null, 2));

    const r = await fetch(base, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      redirect: "follow",
    });

    console.log("[ScheduleEditLog] Apps Script response status:", r.status);

    const parsed = await parseJsonResponse(r, "POST");
    if (!parsed.ok) return parsed.response;

    return buildApiJsonResponse(request, parsed.data, r.ok ? 200 : 500);
  } catch (err: any) {
    console.error("[ScheduleEditLog] ❌ ERROR OCCURRED:");
    console.error(err);

    return buildApiJsonResponse(
      request,
      {
        ok: false,
        error: err?.message ?? "Unknown error",
      },
      500
    );
  }
}

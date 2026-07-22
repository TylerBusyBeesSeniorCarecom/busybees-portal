// app/api/availability/route.ts
import type { NextRequest } from "next/server";
import { google } from "googleapis";

import { buildApiJsonResponse, requireAdminSession } from "@/lib/apiAuth";

async function getSheetsClient() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

  console.log("[availability] GOOGLE_SERVICE_ACCOUNT_KEY exists:", Boolean(raw));
  console.log(
    "[availability] GOOGLE_SERVICE_ACCOUNT_KEY length:",
    raw ? raw.length : 0
  );
  console.log(
    "[availability] GOOGLE_SERVICE_ACCOUNT_KEY preview:",
    raw ? raw.slice(0, 80) : "(missing)"
  );

  if (!raw) {
    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_KEY");
  }

  let credentials: any;
  try {
    credentials = JSON.parse(raw);
  } catch (e: any) {
    console.error("[availability] Failed to parse GOOGLE_SERVICE_ACCOUNT_KEY:", e);
    throw new Error(
      `Invalid GOOGLE_SERVICE_ACCOUNT_KEY JSON: ${e?.message ?? "parse failed"}`
    );
  }

  console.log(
    "[availability] Parsed credentials client_email:",
    credentials?.client_email ?? "(missing)"
  );
  console.log(
    "[availability] Parsed credentials project_id:",
    credentials?.project_id ?? "(missing)"
  );

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  return google.sheets({
    version: "v4",
    auth,
  });
}

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { response } = await requireAdminSession(request);
    if (response) return response;

    const spreadsheetId = process.env.TEST_SHEET_ID;
    console.log("[availability] TEST_SHEET_ID exists:", Boolean(spreadsheetId));

    if (!spreadsheetId) {
      throw new Error("Missing TEST_SHEET_ID");
    }

    const url = new URL(request.url);
    const week = (url.searchParams.get("week") || "cw").toLowerCase();

    const cwTab = process.env.CW_AVAIL_TAB_NAME || "CW Availability";
    const nwTab = process.env.NW_AVAIL_TAB_NAME || "NW Availability";
    const tabName = week === "nw" ? nwTab : cwTab;

    console.log("[availability] week:", week);
    console.log("[availability] tabName:", tabName);

    const sheets = await getSheetsClient();
    const range = `'${tabName}'!A1:L500`;

    console.log("[availability] range:", range);

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
      valueRenderOption: "FORMATTED_VALUE",
    });

    console.log(
      "[availability] rows returned:",
      res.data.values ? res.data.values.length : 0
    );

    return buildApiJsonResponse(
      request,
      {
        ok: true,
        week,
        tabName,
        values: res.data.values ?? [],
      },
      200
    );
  } catch (err: any) {
    console.error("[availability] Route error:", err);

    return buildApiJsonResponse(
      request,
      { ok: false, error: err?.message ?? "Unknown error" },
      500
    );
  }
}

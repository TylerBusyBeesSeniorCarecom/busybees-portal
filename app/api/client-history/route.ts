// app/api/client-history/route.ts
import type { NextRequest } from "next/server";
import { google } from "googleapis";

import { buildApiJsonResponse, requireAdminSession } from "@/lib/apiAuth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ClientHistoryItem = {
  caregiverName: string;
  count: number;
  lastDate?: string | null;
};

function norm(v: any) {
  return (v ?? "").toString().trim();
}
function idx(headers: string[], name: string) {
  return headers.findIndex((h) => norm(h).toLowerCase() === name.toLowerCase());
}
function toInt(v: string | null, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : fallback;
}

async function getSheetsClient() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_KEY");

  const credentials = JSON.parse(raw);

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  return google.sheets({ version: "v4", auth });
}

export async function GET(request: NextRequest) {
  try {
    const { response } = await requireAdminSession(request);
    if (response) return response;

    const spreadsheetId = process.env.SCHEDULE_SPREADSHEET_ID;
    if (!spreadsheetId) throw new Error("Missing SCHEDULE_SPREADSHEET_ID");

    const url = new URL(request.url);
    const client = norm(url.searchParams.get("client"));
    if (!client) {
      return buildApiJsonResponse(request, { ok: false, error: "Missing client" }, 400);
    }

    const tailWeeks = toInt(url.searchParams.get("tailWeeks"), 26);
    const limit = toInt(url.searchParams.get("limit"), 20000);

    const tabName = process.env.HISTORICAL_DATA_TAB_NAME || "Historical Data";
    const maxCols = process.env.HISTORICAL_DATA_MAX_COLS || "K";
    const rowsPerWeek = toInt(process.env.HIST_ROWS_PER_WEEK || "275", 275);
    const bufferRows = toInt(process.env.HIST_TAIL_BUFFER_ROWS || "500", 500);

    const tailRows = tailWeeks > 0 ? tailWeeks * rowsPerWeek + bufferRows : 0;

    const sheets = await getSheetsClient();

    const headerResp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${tabName}!A1:${maxCols}1`,
      valueRenderOption: "FORMATTED_VALUE",
    });

    const headerVals = (headerResp.data.values || []) as string[][];
    const headers = (headerVals[0] || []).map(norm);
    if (headers.length === 0) throw new Error(`No headers found in ${tabName}`);

    const iDate = idx(headers, "Date");
    const iClient = idx(headers, "Client");
    const iCaregiver = idx(headers, "Caregiver");

    if (iDate < 0 || iClient < 0 || iCaregiver < 0) {
      throw new Error(
        `Missing required columns in ${tabName}. Need Date, Client, Caregiver. Found: ${headers.join(", ")}`
      );
    }

    let endRow = toInt(process.env.HISTORICAL_DATA_MAX_ROWS || "50000", 50000);
    let startRow = 2;

    try {
      const meta = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: "sheets(properties(title,gridProperties(rowCount)))",
      });

      const found = (meta.data.sheets || []).find(
        (s: any) => s?.properties?.title === tabName
      );
      const rowCount = found?.properties?.gridProperties?.rowCount;

      if (typeof rowCount === "number" && rowCount > 0) {
        endRow = Math.min(rowCount, endRow);
        if (tailRows > 0) startRow = Math.max(2, endRow - tailRows + 1);
      } else {
        if (tailRows > 0) startRow = Math.max(2, endRow - tailRows + 1);
      }
    } catch {
      if (tailRows > 0) startRow = Math.max(2, endRow - tailRows + 1);
    }

    const dataResp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${tabName}!A${startRow}:${maxCols}${endRow}`,
      valueRenderOption: "FORMATTED_VALUE",
      dateTimeRenderOption: "FORMATTED_STRING",
    });

    const rows = (dataResp.data.values || []) as string[][];
    const clientKey = client.toLowerCase();

    const map = new Map<string, { count: number; lastDate: string }>();

    for (const r of rows) {
      if (limit > 0 && map.size > 5000) {
        // safety guard placeholder
      }

      const rClient = norm(r[iClient]);
      if (!rClient) continue;
      if (rClient.toLowerCase() !== clientKey) continue;

      const cg = norm(r[iCaregiver]);
      if (!cg) continue;

      const date = norm(r[iDate]) || "";

      const existing = map.get(cg);
      if (!existing) {
        map.set(cg, { count: 1, lastDate: date });
      } else {
        existing.count += 1;
        if (date && (!existing.lastDate || date > existing.lastDate)) {
          existing.lastDate = date;
        }
      }
    }

    const items: ClientHistoryItem[] = Array.from(map.entries())
      .map(([caregiverName, v]) => ({
        caregiverName,
        count: v.count,
        lastDate: v.lastDate || null,
      }))
      .sort((a, b) => b.count - a.count || a.caregiverName.localeCompare(b.caregiverName));

    return buildApiJsonResponse(
      request,
      {
        ok: true,
        clientName: client,
        meta: {
          tabName,
          startRow,
          endRow,
          tailWeeks,
        },
        items,
      },
      200
    );
  } catch (e: any) {
    return buildApiJsonResponse(
      request,
      { ok: false, error: e?.message || "Unknown error" },
      500
    );
  }
}

// app/api/client-history/route.ts
import { NextResponse } from "next/server";
import { google } from "googleapis";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // ✅ important when using googleapis

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
  // mirrors your other routes
  const auth = new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  return google.sheets({ version: "v4", auth });
}

export async function GET(req: Request) {
  try {
    const spreadsheetId = process.env.SCHEDULE_SPREADSHEET_ID;
    if (!spreadsheetId) throw new Error("Missing SCHEDULE_SPREADSHEET_ID");

    const url = new URL(req.url);
    const client = norm(url.searchParams.get("client"));
    if (!client) return NextResponse.json({ ok: false, error: "Missing client" }, { status: 400 });

    // tune these if needed
    const tailWeeks = toInt(url.searchParams.get("tailWeeks"), 26); // default: last ~26 weeks
    const limit = toInt(url.searchParams.get("limit"), 20000);

    const tabName = process.env.HISTORICAL_DATA_TAB_NAME || "Historical Data";
    const maxCols = process.env.HISTORICAL_DATA_MAX_COLS || "K";
    const rowsPerWeek = toInt(process.env.HIST_ROWS_PER_WEEK || "275", 275);
    const bufferRows = toInt(process.env.HIST_TAIL_BUFFER_ROWS || "500", 500);

    const tailRows = tailWeeks > 0 ? tailWeeks * rowsPerWeek + bufferRows : 0;

    const sheets = await getSheetsClient();

    // header row
    const headerResp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${tabName}!A1:${maxCols}1`,
      valueRenderOption: "FORMATTED_VALUE",
    });

    const headerVals = (headerResp.data.values || []) as string[][];
    const headers = (headerVals[0] || []).map(norm);
    if (headers.length === 0) throw new Error(`No headers found in ${tabName}`);

    // columns
    const iDate = idx(headers, "Date");
    const iClient = idx(headers, "Client");
    const iCaregiver = idx(headers, "Caregiver");

    if (iDate < 0 || iClient < 0 || iCaregiver < 0) {
      throw new Error(
        `Missing required columns in ${tabName}. Need Date, Client, Caregiver. Found: ${headers.join(", ")}`
      );
    }

    // determine how many rows exist (optional but helps)
    let endRow = toInt(process.env.HISTORICAL_DATA_MAX_ROWS || "50000", 50000);
    let startRow = 2;

    try {
      const meta = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: "sheets(properties(title,gridProperties(rowCount)))",
      });
      const found = (meta.data.sheets || []).find((s: any) => s?.properties?.title === tabName);
      const rowCount = found?.properties?.gridProperties?.rowCount;
      if (typeof rowCount === "number" && rowCount > 0) {
        endRow = Math.min(rowCount, endRow);
        if (tailRows > 0) startRow = Math.max(2, endRow - tailRows + 1);
      } else {
        if (tailRows > 0) startRow = Math.max(2, endRow - tailRows + 1);
      }
    } catch {
      // if metadata read fails, just fall back to bounded range
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

    // group by caregiver
    const map = new Map<string, { count: number; lastDate: string }>();

    for (const r of rows) {
      if (limit > 0 && map.size > 5000) {
        // safety guard; doesn’t cap counts, just prevents runaway if something is weird
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
        // string compare is usually OK for YYYY-MM-DD; if you have M/D/YYYY this is “best effort”
        if (date && (!existing.lastDate || date > existing.lastDate)) existing.lastDate = date;
      }
    }

    const items: ClientHistoryItem[] = Array.from(map.entries())
      .map(([caregiverName, v]) => ({
        caregiverName,
        count: v.count,
        lastDate: v.lastDate || null,
      }))
      .sort((a, b) => b.count - a.count || a.caregiverName.localeCompare(b.caregiverName));

    return NextResponse.json({
      ok: true,
      clientName: client,
      meta: {
        tabName,
        startRow,
        endRow,
        tailWeeks,
      },
      items,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Unknown error" }, { status: 500 });
  }
}

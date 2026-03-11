// app/api/historical-data/route.ts
import { NextResponse } from "next/server";
import { google } from "googleapis";

export const dynamic = "force-dynamic";

type HistoricalRow = {
  shiftId: string;
  date: string;
  client: string;
  caregiver: string;
  caregiverId: string;
  startTime: string;
  endTime: string;
  status: string;
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

function toDateSafe(dateStr: string): Date | null {
  const raw = norm(dateStr);
  if (!raw) return null;

  const d0 = new Date(raw);
  if (!Number.isNaN(d0.getTime())) return d0;

  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const mm = parseInt(m[1], 10);
  const dd = parseInt(m[2], 10);
  const yyyy = parseInt(m[3], 10);
  const d = new Date(yyyy, mm - 1, dd);
  return Number.isNaN(d.getTime()) ? null : d;
}
function startOfSundayWeekKey(dateStr: string): string {
  const d = toDateSafe(dateStr);
  if (!d) return "";
  const ws = new Date(d);
  ws.setHours(0, 0, 0, 0);
  ws.setDate(ws.getDate() - ws.getDay());
  const yyyy = ws.getFullYear();
  const mm = String(ws.getMonth() + 1).padStart(2, "0");
  const dd = String(ws.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

async function getSheetsClient() {
  const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!keyFile) throw new Error("Missing GOOGLE_APPLICATION_CREDENTIALS");

  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  return google.sheets({ version: "v4", auth });
}

async function getSheetRowCount(sheets: any, spreadsheetId: string, tabName: string): Promise<number> {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(title,gridProperties(rowCount)))",
  });

  const found = (meta.data.sheets || []).find((s: any) => s?.properties?.title === tabName);
  const rowCount = found?.properties?.gridProperties?.rowCount;
  return typeof rowCount === "number" && rowCount > 0 ? rowCount : 0;
}

export async function GET(req: Request) {
  try {
    const spreadsheetId = process.env.SCHEDULE_SPREADSHEET_ID;
    if (!spreadsheetId) throw new Error("Missing SCHEDULE_SPREADSHEET_ID");

    const url = new URL(req.url);

    const weekStart = norm(url.searchParams.get("weekStart")); // YYYY-MM-DD
    const limit = toInt(url.searchParams.get("limit"), 5000);

    // tail logic
    const tailWeeks = toInt(url.searchParams.get("tailWeeks"), 0);
    const tailRowsParam = url.searchParams.get("tailRows");
    const rowsPerWeek = toInt(process.env.HIST_ROWS_PER_WEEK || "275", 275);
    const bufferRows = toInt(process.env.HIST_TAIL_BUFFER_ROWS || "500", 500);

    // If tailRows is provided, it wins.
    // If tailWeeks is provided (>0), compute tailRows from weeks.
    // If neither is provided, we read "full" range (bounded by a max range).
    const tailRows =
      tailRowsParam != null
        ? toInt(tailRowsParam, 0)
        : tailWeeks > 0
        ? tailWeeks * rowsPerWeek + bufferRows
        : 0;

    const sheets = await getSheetsClient();

    const tabName = process.env.HISTORICAL_DATA_TAB_NAME || "Historical Data";
    const maxCols = process.env.HISTORICAL_DATA_MAX_COLS || "K"; // safe upper bound
    const maxRowsHardCap = toInt(process.env.HISTORICAL_DATA_MAX_ROWS || "50000", 50000);

    // Always fetch header row separately so tail slices still map columns correctly
    const headerResp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${tabName}!A1:${maxCols}1`,
      valueRenderOption: "FORMATTED_VALUE",
    });

    const headerVals = (headerResp.data.values || []) as string[][];
    const headers = (headerVals[0] || []).map(norm);
    if (headers.length === 0) throw new Error(`No headers found in ${tabName}`);

    // column indices (match your sheet headers)
    const iShiftId = idx(headers, "Shift ID");
    const iDate = idx(headers, "Date");
    const iClient = idx(headers, "Client");
    const iCaregiver = idx(headers, "Caregiver");
    const iCaregiverId = idx(headers, "Caregiver ID");
    const iStart = idx(headers, "Start Time");
    const iEnd = idx(headers, "End Time");
    const iStatus = idx(headers, "Status");

    // Determine the range we will read
    let startRow = 2;
    let endRow = maxRowsHardCap;

    const rowCount = await getSheetRowCount(sheets, spreadsheetId, tabName);
    if (rowCount > 0) {
      endRow = Math.min(rowCount, maxRowsHardCap);
      if (tailRows > 0) {
        startRow = Math.max(2, endRow - tailRows + 1);
      }
    } else {
      // fallback: still read a bounded range
      startRow = tailRows > 0 ? Math.max(2, maxRowsHardCap - tailRows + 1) : 2;
      endRow = maxRowsHardCap;
    }

    const dataResp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${tabName}!A${startRow}:${maxCols}${endRow}`,
      valueRenderOption: "FORMATTED_VALUE",
    });

    const vals = (dataResp.data.values || []) as string[][];
    const out: HistoricalRow[] = [];

    for (const r of vals) {
      const date = iDate >= 0 ? norm(r[iDate]) : "";
      if (!date) continue;

      if (weekStart) {
        const wsKey = startOfSundayWeekKey(date);
        if (wsKey !== weekStart) continue;
      }

      out.push({
        shiftId: iShiftId >= 0 ? norm(r[iShiftId]) : "",
        date,
        client: iClient >= 0 ? norm(r[iClient]) : "",
        caregiver: iCaregiver >= 0 ? norm(r[iCaregiver]) : "",
        caregiverId: iCaregiverId >= 0 ? norm(r[iCaregiverId]) : "",
        startTime: iStart >= 0 ? norm(r[iStart]) : "",
        endTime: iEnd >= 0 ? norm(r[iEnd]) : "",
        status: iStatus >= 0 ? norm(r[iStatus]) : "",
      });

      if (limit > 0 && out.length >= limit) break;
    }

    return NextResponse.json({
      ok: true,
      meta: {
        tabName,
        startRow,
        endRow,
        rowCount,
        tailRows,
        tailWeeks,
        filteredWeekStart: weekStart || null,
      },
      rows: out,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Unknown error" }, { status: 500 });
  }
}

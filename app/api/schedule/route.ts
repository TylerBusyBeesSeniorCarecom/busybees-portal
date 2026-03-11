import { NextResponse } from "next/server";
import { google } from "googleapis";
import path from "path";

async function getSheetsClient() {
  const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!keyFile) throw new Error("Missing GOOGLE_APPLICATION_CREDENTIALS");

  const auth = new google.auth.GoogleAuth({
    keyFile: path.resolve(process.cwd(), keyFile),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  return google.sheets({ version: "v4", auth });
}

export const dynamic = "force-dynamic";

type ClockEntry = {
  clockInTime: string | null;
  clockOutTime: string | null;
};

type LocationEntry = {
  clockIn: { timestamp: string | null; verdict: string | null };
  clockOut: { timestamp: string | null; verdict: string | null };
};

function normHeader(h: any): string {
  return String(h ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function findHeaderIndex(headers: any[], target: string): number {
  const t = normHeader(target);
  return headers.findIndex((h) => normHeader(h) === t);
}

// Google Sheets date serial -> ms since epoch (UTC-ish)
// Sheets serial is days since 1899-12-30
function sheetsSerialToMs(serial: number): number {
  return Math.round((serial - 25569) * 86400 * 1000);
}

function parseTimestampToMs(raw: any): number | null {
  if (raw == null) return null;

  if (typeof raw === "number" && Number.isFinite(raw)) {
    return sheetsSerialToMs(raw);
  }

  const s = String(raw).trim();
  if (!s) return null;

  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

export async function GET(req: Request) {
  try {
    const spreadsheetId = process.env.TEST_SHEET_ID;
    if (!spreadsheetId) throw new Error("Missing TEST_SHEET_ID");

    const url = new URL(req.url);
    const week = (url.searchParams.get("week") || "cw").toLowerCase();

    const cwTab = process.env.CW_SCHEDULE_TAB_NAME || "All Shifts";
    const nwTab = process.env.NW_SCHEDULE_TAB_NAME || "NW All Shifts";
    const tabName = week === "nw" ? nwTab : cwTab;

    const appTabName = process.env.APP_DATA_TAB_NAME || "App Data";
    const locationTabName = process.env.LOCATION_EVENTS_TAB_NAME || "Location Events";

    const sheets = await getSheetsClient();

    const scheduleRange = `'${tabName}'!A1:I5000`;
    const scheduleRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: scheduleRange,
      valueRenderOption: "FORMATTED_VALUE",
    });

    const values = scheduleRes.data.values ?? [];

    let shiftIds: string[] = [];
    if (values.length > 1) {
      const headers = values[0] ?? [];
      const idxShiftId = findHeaderIndex(headers, "Shift ID");

      if (idxShiftId >= 0) {
        const ids: string[] = [];
        for (let i = 1; i < values.length; i++) {
          const row = values[i] ?? [];
          const sid = String(row[idxShiftId] ?? "").trim();
          if (sid) ids.push(sid);
        }
        shiftIds = Array.from(new Set(ids));
      }
    }

    const wanted = shiftIds.length > 0 ? new Set(shiftIds) : null;

    const appRange = `'${appTabName}'!A1:I50000`;
    const appRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: appRange,
      valueRenderOption: "FORMATTED_VALUE",
    });

    const appValues = appRes.data.values ?? [];
    const clockMap: Record<string, ClockEntry> = {};

    if (appValues.length > 1) {
      const appHeaders = appValues[0] ?? [];
      const idxAppShiftId = findHeaderIndex(appHeaders, "Shift ID");
      const idxClockIn = findHeaderIndex(appHeaders, "Clock In Time");
      const idxClockOut = findHeaderIndex(appHeaders, "Clock Out Time");

      if (idxAppShiftId >= 0) {
        for (let i = 1; i < appValues.length; i++) {
          const row = appValues[i] ?? [];
          const sid = String(row[idxAppShiftId] ?? "").trim();
          if (!sid) continue;
          if (wanted && !wanted.has(sid)) continue;

          const clockInRaw = idxClockIn >= 0 ? String(row[idxClockIn] ?? "").trim() : "";
          const clockOutRaw = idxClockOut >= 0 ? String(row[idxClockOut] ?? "").trim() : "";

          const prev = clockMap[sid];
          clockMap[sid] = {
            clockInTime: clockInRaw || prev?.clockInTime || null,
            clockOutTime: clockOutRaw || prev?.clockOutTime || null,
          };
        }
      }
    }

    const locationRange = `'${locationTabName}'!A:R`;
    const locRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: locationRange,
      valueRenderOption: "UNFORMATTED_VALUE",
      dateTimeRenderOption: "SERIAL_NUMBER",
    });

    const locValues = locRes.data.values ?? [];
    const locationMap: Record<string, LocationEntry> = {};

    if (locValues.length > 1) {
      const headers = locValues[0] ?? [];

      const idxTimestamp = findHeaderIndex(headers, "Timestamp");
      const idxAction = findHeaderIndex(headers, "Action");
      const idxShiftId = findHeaderIndex(headers, "Shift ID");
      const idxVerdict = findHeaderIndex(headers, "Verdict");

      const ensure = (sid: string) => {
        if (!locationMap[sid]) {
          locationMap[sid] = {
            clockIn: { timestamp: null, verdict: null },
            clockOut: { timestamp: null, verdict: null },
          };
        }
        return locationMap[sid];
      };

      const latestInMs: Record<string, number> = {};
      const latestOutMs: Record<string, number> = {};

      for (let i = 1; i < locValues.length; i++) {
        const row = locValues[i] ?? [];

        const sid = idxShiftId >= 0 ? String(row[idxShiftId] ?? "").trim() : "";
        if (!sid) continue;
        if (wanted && !wanted.has(sid)) continue;

        const action = idxAction >= 0 ? String(row[idxAction] ?? "").trim().toLowerCase() : "";
        if (action !== "clock_in" && action !== "clock_out") continue;

        const tsRaw = idxTimestamp >= 0 ? row[idxTimestamp] : null;
        const verdictRaw = idxVerdict >= 0 ? row[idxVerdict] : null;

        const tsMs = parseTimestampToMs(tsRaw);
        const tsStr =
          typeof tsRaw === "number" && Number.isFinite(tsRaw)
            ? new Date(sheetsSerialToMs(tsRaw)).toISOString()
            : String(tsRaw ?? "").trim();

        const verdict = String(verdictRaw ?? "").trim() || null;

        const entry = ensure(sid);

        if (action === "clock_in") {
          const prev = latestInMs[sid];
          if (tsMs != null && (prev == null || tsMs > prev)) {
            latestInMs[sid] = tsMs;
            entry.clockIn = { timestamp: tsStr || null, verdict };
          } else if (prev == null && !entry.clockIn.timestamp && tsStr) {
            entry.clockIn = { timestamp: tsStr || null, verdict };
          }
        } else {
          const prev = latestOutMs[sid];
          if (tsMs != null && (prev == null || tsMs > prev)) {
            latestOutMs[sid] = tsMs;
            entry.clockOut = { timestamp: tsStr || null, verdict };
          } else if (prev == null && !entry.clockOut.timestamp && tsStr) {
            entry.clockOut = { timestamp: tsStr || null, verdict };
          }
        }
      }
    }

    return NextResponse.json({
      ok: true,
      week,
      tabName,
      appTabName,
      locationTabName,
      values,
      clockMap,
      locationMap,
      debug: {
        scheduleShiftIdCount: shiftIds.length,
        clockMapCount: Object.keys(clockMap).length,
        locationMapCount: Object.keys(locationMap).length,
        locationMapWithAnyVerdictCount: Object.values(locationMap).filter(
          (e) => !!e.clockIn.verdict || !!e.clockOut.verdict
        ).length,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
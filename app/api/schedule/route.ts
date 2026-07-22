import type { NextRequest } from "next/server";
import { google } from "googleapis";

import { buildApiJsonResponse, requireAdminSession } from "@/lib/apiAuth";
import { adminDb } from "@/lib/firebaseAdmin";

const EMPTY_SCHEDULE_REASON = "The schedule for this week has not been created yet.";

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

function isEmptyScheduleRangeError(err: any) {
  const code = Number(err?.code || err?.status || 0);
  const message = String(err?.message ?? "").toLowerCase();
  return (
    code === 400 &&
    (message.includes("the number of rows in the range must be at least 1") ||
      message.includes("unable to parse range"))
  );
}

async function getSheetRowCount(
  sheets: Awaited<ReturnType<typeof getSheetsClient>>,
  spreadsheetId: string,
  tabName: string
) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(title,gridProperties(rowCount)))",
  });
  const match = meta.data.sheets?.find(
    (sheet) => String(sheet.properties?.title ?? "").trim() === tabName
  );
  return match?.properties?.gridProperties?.rowCount ?? null;
}

function buildEmptyScheduleResponse(args: {
  request: NextRequest;
  week: string;
  tabName: string;
  appTabName: string;
  locationTabName: string;
}) {
  return buildApiJsonResponse(
    args.request,
    {
      ok: true,
      week: args.week,
      tabName: args.tabName,
      appTabName: args.appTabName,
      locationTabName: args.locationTabName,
      values: [],
      shifts: [],
      rowCount: 0,
      empty: true,
      emptyReason: EMPTY_SCHEDULE_REASON,
      clockMap: {},
      clockSourceMap: {},
      locationMap: {},
      debug: {
        scheduleShiftIdCount: 0,
        clockMapCount: 0,
        locationMapCount: 0,
        locationMapWithAnyVerdictCount: 0,
        firebaseClockCount: 0,
        firebaseLocationCount: 0,
      },
    },
    200
  );
}

export const dynamic = "force-dynamic";

type ClockEntry = {
  clockInTime: string | null;
  clockOutTime: string | null;
};

type ClockSource = "google_sheets" | "firebase";

type ClockSourceEntry = {
  clockInSource: ClockSource | null;
  clockOutSource: ClockSource | null;
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

function toIsoString(raw: any): string | null {
  if (raw == null) return null;

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const parsed = Date.parse(trimmed);
    return Number.isNaN(parsed) ? trimmed : new Date(parsed).toISOString();
  }

  if (typeof raw === "number" && Number.isFinite(raw)) {
    return new Date(raw).toISOString();
  }

  if (typeof raw?.toDate === "function") {
    try {
      return raw.toDate().toISOString();
    } catch {
      return null;
    }
  }

  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? null : raw.toISOString();
  }

  return null;
}

function ensureLocationEntry(
  locationMap: Record<string, LocationEntry>,
  sid: string
) {
  if (!locationMap[sid]) {
    locationMap[sid] = {
      clockIn: { timestamp: null, verdict: null },
      clockOut: { timestamp: null, verdict: null },
    };
  }
  return locationMap[sid];
}

async function overlayFirebaseClockAndLocationData(args: {
  shiftIds: string[];
  clockMap: Record<string, ClockEntry>;
  clockSourceMap: Record<string, ClockSourceEntry>;
  locationMap: Record<string, LocationEntry>;
}) {
  const { shiftIds, clockMap, clockSourceMap, locationMap } = args;
  if (!shiftIds.length) return { firebaseClockCount: 0, firebaseLocationCount: 0 };

  const chunkSize = 30;
  const chunks: string[][] = [];
  for (let i = 0; i < shiftIds.length; i += chunkSize) {
    chunks.push(shiftIds.slice(i, i + chunkSize));
  }

  let firebaseClockCount = 0;
  for (const chunk of chunks) {
    const snapshot = await adminDb
      .collection("timeEntries")
      .where("shiftID", "in", chunk)
      .get();

    for (const doc of snapshot.docs) {
      const row = doc.data();
      const shiftId = String(row?.shiftID ?? row?.shiftId ?? doc.id ?? "").trim();
      if (!shiftId) continue;

      const clockInTime =
        toIsoString(row?.clockInOverrideTime) ??
        toIsoString(row?.clockInTime);
      const clockOutTime =
        toIsoString(row?.clockOutOverrideTime) ??
        toIsoString(row?.clockOutTime);

      if (!clockInTime && !clockOutTime) continue;

      firebaseClockCount += 1;
      clockMap[shiftId] = {
        clockInTime: clockInTime ?? clockMap[shiftId]?.clockInTime ?? null,
        clockOutTime: clockOutTime ?? clockMap[shiftId]?.clockOutTime ?? null,
      };
      clockSourceMap[shiftId] = {
        clockInSource:
          clockInTime != null
            ? "firebase"
            : clockSourceMap[shiftId]?.clockInSource ?? null,
        clockOutSource:
          clockOutTime != null
            ? "firebase"
            : clockSourceMap[shiftId]?.clockOutSource ?? null,
      };
    }
  }

  const latestInMs: Record<string, number> = {};
  const latestOutMs: Record<string, number> = {};
  let firebaseLocationCount = 0;

  for (const chunk of chunks) {
    const snapshot = await adminDb
      .collection("locationEvents")
      .where("shiftID", "in", chunk)
      .get();

    for (const doc of snapshot.docs) {
      const row = doc.data();
      const shiftId = String(row?.shiftID ?? row?.shiftId ?? "").trim();
      if (!shiftId) continue;

      const action = String(row?.action ?? "").trim().toLowerCase();
      if (action !== "clock_in" && action !== "clock_out") continue;

      const timestamp = toIsoString(row?.timestamp);
      const timestampMs = parseTimestampToMs(timestamp);
      const verdict = String(row?.verdict ?? "").trim() || null;
      const entry = ensureLocationEntry(locationMap, shiftId);

      firebaseLocationCount += 1;

      if (action === "clock_in") {
        const prev = latestInMs[shiftId];
        if (timestampMs != null && (prev == null || timestampMs >= prev)) {
          latestInMs[shiftId] = timestampMs;
          entry.clockIn = { timestamp, verdict };
        } else if (prev == null && !entry.clockIn.timestamp && timestamp) {
          entry.clockIn = { timestamp, verdict };
        }
      } else {
        const prev = latestOutMs[shiftId];
        if (timestampMs != null && (prev == null || timestampMs >= prev)) {
          latestOutMs[shiftId] = timestampMs;
          entry.clockOut = { timestamp, verdict };
        } else if (prev == null && !entry.clockOut.timestamp && timestamp) {
          entry.clockOut = { timestamp, verdict };
        }
      }
    }
  }

  return { firebaseClockCount, firebaseLocationCount };
}

export async function GET(request: NextRequest) {
  try {
    const { response } = await requireAdminSession(request);
    if (response) return response;

    const spreadsheetId = process.env.TEST_SHEET_ID;
    if (!spreadsheetId) throw new Error("Missing TEST_SHEET_ID");

    const url = new URL(request.url);
    const week = (url.searchParams.get("week") || "cw").toLowerCase();

    const cwTab = process.env.CW_SCHEDULE_TAB_NAME || "All Shifts";
    const nwTab = process.env.NW_SCHEDULE_TAB_NAME || "NW All Shifts";
    const tabName = week === "nw" ? nwTab : cwTab;

    const appTabName = process.env.APP_DATA_TAB_NAME || "App Data";
    const locationTabName = process.env.LOCATION_EVENTS_TAB_NAME || "Location Events";

    const sheets = await getSheetsClient();

    const scheduleRange = `'${tabName}'!A1:I5000`;
    const scheduleRowCount = await getSheetRowCount(sheets, spreadsheetId, tabName);
    if (scheduleRowCount != null && scheduleRowCount < 2) {
      return buildEmptyScheduleResponse({
        request,
        week,
        tabName,
        appTabName,
        locationTabName,
      });
    }

    let scheduleRes;
    try {
      scheduleRes = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: scheduleRange,
        valueRenderOption: "FORMATTED_VALUE",
      });
    } catch (err: any) {
      if (isEmptyScheduleRangeError(err)) {
        return buildEmptyScheduleResponse({
          request,
          week,
          tabName,
          appTabName,
          locationTabName,
        });
      }
      throw err;
    }

    const values = scheduleRes.data.values ?? [];
    if (values.length === 0) {
      return buildEmptyScheduleResponse({
        request,
        week,
        tabName,
        appTabName,
        locationTabName,
      });
    }

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
    const clockSourceMap: Record<string, ClockSourceEntry> = {};

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
          clockSourceMap[sid] = {
            clockInSource:
              clockInRaw
                ? "google_sheets"
                : clockSourceMap[sid]?.clockInSource ?? null,
            clockOutSource:
              clockOutRaw
                ? "google_sheets"
                : clockSourceMap[sid]?.clockOutSource ?? null,
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

        const entry = ensureLocationEntry(locationMap, sid);

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

    const firebaseDebug = await overlayFirebaseClockAndLocationData({
      shiftIds,
      clockMap,
      clockSourceMap,
      locationMap,
    });

    return buildApiJsonResponse(
      request,
      {
        ok: true,
        week,
        tabName,
        appTabName,
        locationTabName,
        values,
        clockMap,
        clockSourceMap,
        locationMap,
        debug: {
          scheduleShiftIdCount: shiftIds.length,
          clockMapCount: Object.keys(clockMap).length,
          locationMapCount: Object.keys(locationMap).length,
          locationMapWithAnyVerdictCount: Object.values(locationMap).filter(
            (e) => !!e.clockIn.verdict || !!e.clockOut.verdict
          ).length,
          ...firebaseDebug,
        },
      },
      200
    );
  } catch (err: any) {
    return buildApiJsonResponse(
      request,
      { ok: false, error: err?.message ?? "Unknown error" },
      500
    );
  }
}

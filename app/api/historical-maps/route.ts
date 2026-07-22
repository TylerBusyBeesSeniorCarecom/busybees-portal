// app/api/historical-maps/route.ts
import { NextResponse } from "next/server";
import { google } from "googleapis";

import { adminDb } from "@/lib/firebaseAdmin";

export const dynamic = "force-dynamic";

type ClockSource = "google_sheets" | "firebase";

type ClockSourceEntry = {
  clockInSource: ClockSource | null;
  clockOutSource: ClockSource | null;
};

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

function norm(v: any) {
  return (v ?? "").toString().trim();
}
function idx(headers: string[], name: string) {
  return headers.findIndex((h) => norm(h).toLowerCase() === name.toLowerCase());
}

function parseTimestampToMs(raw: any): number | null {
  if (raw == null) return null;
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

export async function GET(req: Request) {
  try {
    const spreadsheetId = process.env.SCHEDULE_SPREADSHEET_ID;
    if (!spreadsheetId) throw new Error("Missing SCHEDULE_SPREADSHEET_ID");

    const url = new URL(req.url);
    const origin = url.origin;

    const weekStart = norm(url.searchParams.get("weekStart"));
    if (!weekStart) throw new Error("Missing weekStart");

    const histRes = await fetch(
      `${origin}/api/historical-data?weekStart=${encodeURIComponent(weekStart)}&limit=5000`,
      {
        cache: "no-store",
        headers: {
          cookie: req.headers.get("cookie") || "",
        },
      }
    );
    const hist = await histRes.json();
    if (!histRes.ok || !hist?.ok) {
      throw new Error(hist?.error || `Failed to load historical-data (${histRes.status})`);
    }

    const shiftIds = new Set<string>(
      (hist.rows || []).map((r: any) => norm(r.shiftId)).filter(Boolean)
    );
    if (shiftIds.size === 0) {
      return NextResponse.json({ ok: true, clockMap: {}, clockSourceMap: {}, locationMap: {} });
    }

    const shiftIdList = Array.from(shiftIds);

    const sheets = await getSheetsClient();

    const appDataTab = process.env.APP_DATA_TAB_NAME || "App Data";
    const appDataRange = process.env.APP_DATA_RANGE || "A1:K50000";

    const appResp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${appDataTab}!${appDataRange}`,
      valueRenderOption: "FORMATTED_VALUE",
    });

    const appVals = (appResp.data.values || []) as string[][];
    const appHeaders = (appVals[0] || []).map(norm);
    const appRows = appVals.slice(1);

    const iShift = idx(appHeaders, "Shift ID");
    const iCin = idx(appHeaders, "Clock In Time");
    const iCout = idx(appHeaders, "Clock Out Time");

    const clockMap: Record<string, { clockInTime: string | null; clockOutTime: string | null }> = {};
    const clockSourceMap: Record<string, ClockSourceEntry> = {};

    for (const r of appRows) {
      const sid = iShift >= 0 ? norm(r[iShift]) : "";
      if (!sid || !shiftIds.has(sid)) continue;

      const clockInTime = iCin >= 0 ? norm(r[iCin]) || null : null;
      const clockOutTime = iCout >= 0 ? norm(r[iCout]) || null : null;
      clockMap[sid] = {
        clockInTime,
        clockOutTime,
      };
      clockSourceMap[sid] = {
        clockInSource: clockInTime ? "google_sheets" : null,
        clockOutSource: clockOutTime ? "google_sheets" : null,
      };
    }

    const locTab = process.env.LOCATION_EVENTS_TAB_NAME || "Location Events";
    const locRange = process.env.LOCATION_EVENTS_RANGE || "A1:K50000";

    const locResp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${locTab}!${locRange}`,
      valueRenderOption: "FORMATTED_VALUE",
    });

    const locVals = (locResp.data.values || []) as string[][];
    const locHeaders = (locVals[0] || []).map(norm);
    const locRows = locVals.slice(1);

    const iTS = idx(locHeaders, "Timestamp");
    const iShift2 = idx(locHeaders, "Shift ID");
    const iAction = idx(locHeaders, "Action");
    const iVerdict = idx(locHeaders, "Verdict");

    const locationMap: Record<
      string,
      {
        clockIn: { timestamp: string | null; verdict: string | null };
        clockOut: { timestamp: string | null; verdict: string | null };
      }
    > = {};

    function ensure(sid: string) {
      if (!locationMap[sid]) {
        locationMap[sid] = {
          clockIn: { timestamp: null, verdict: null },
          clockOut: { timestamp: null, verdict: null },
        };
      }
      return locationMap[sid];
    }

    for (const r of locRows) {
      const sid = iShift2 >= 0 ? norm(r[iShift2]) : "";
      if (!sid || !shiftIds.has(sid)) continue;

      const action = iAction >= 0 ? norm(r[iAction]).toLowerCase() : "";
      const verdict = iVerdict >= 0 ? norm(r[iVerdict]) || null : null;
      const ts = iTS >= 0 ? norm(r[iTS]) || null : null;

      const entry = ensure(sid);
      if (action === "clock_in" || action === "clockin") {
        entry.clockIn = { timestamp: ts, verdict };
      }
      if (action === "clock_out" || action === "clockout") {
        entry.clockOut = { timestamp: ts, verdict };
      }
    }

    const chunkSize = 30;
    const latestInMs: Record<string, number> = {};
    const latestOutMs: Record<string, number> = {};

    for (let i = 0; i < shiftIdList.length; i += chunkSize) {
      const chunk = shiftIdList.slice(i, i + chunkSize);

      const timeSnapshot = await adminDb
        .collection("timeEntries")
        .where("shiftID", "in", chunk)
        .get();

      for (const doc of timeSnapshot.docs) {
        const row = doc.data();
        const sid = norm(row?.shiftID ?? row?.shiftId ?? doc.id);
        if (!sid) continue;

        const clockInTime =
          toIsoString(row?.clockInOverrideTime) ??
          toIsoString(row?.clockInTime);
        const clockOutTime =
          toIsoString(row?.clockOutOverrideTime) ??
          toIsoString(row?.clockOutTime);

        if (!clockInTime && !clockOutTime) continue;

        clockMap[sid] = {
          clockInTime: clockInTime ?? clockMap[sid]?.clockInTime ?? null,
          clockOutTime: clockOutTime ?? clockMap[sid]?.clockOutTime ?? null,
        };
        clockSourceMap[sid] = {
          clockInSource:
            clockInTime != null
              ? "firebase"
              : clockSourceMap[sid]?.clockInSource ?? null,
          clockOutSource:
            clockOutTime != null
              ? "firebase"
              : clockSourceMap[sid]?.clockOutSource ?? null,
        };
      }

      const locSnapshot = await adminDb
        .collection("locationEvents")
        .where("shiftID", "in", chunk)
        .get();

      for (const doc of locSnapshot.docs) {
        const row = doc.data();
        const sid = norm(row?.shiftID ?? row?.shiftId);
        if (!sid) continue;

        const action = norm(row?.action).toLowerCase();
        if (action !== "clock_in" && action !== "clock_out") continue;

        const verdict = norm(row?.verdict) || null;
        const timestamp = toIsoString(row?.timestamp);
        const tsMs = parseTimestampToMs(timestamp);
        const entry = ensure(sid);

        if (action === "clock_in") {
          const prev = latestInMs[sid];
          if (tsMs != null && (prev == null || tsMs >= prev)) {
            latestInMs[sid] = tsMs;
            entry.clockIn = { timestamp, verdict };
          } else if (prev == null && !entry.clockIn.timestamp && timestamp) {
            entry.clockIn = { timestamp, verdict };
          }
        } else {
          const prev = latestOutMs[sid];
          if (tsMs != null && (prev == null || tsMs >= prev)) {
            latestOutMs[sid] = tsMs;
            entry.clockOut = { timestamp, verdict };
          } else if (prev == null && !entry.clockOut.timestamp && timestamp) {
            entry.clockOut = { timestamp, verdict };
          }
        }
      }
    }

    return NextResponse.json({ ok: true, clockMap, clockSourceMap, locationMap });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Unknown error" },
      { status: 500 }
    );
  }
}

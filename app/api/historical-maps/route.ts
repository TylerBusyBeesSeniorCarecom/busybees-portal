// app/api/historical-maps/route.ts
import { NextResponse } from "next/server";
import { google } from "googleapis";

export const dynamic = "force-dynamic";

async function getSheetsClient() {
  const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!keyFile) throw new Error("Missing GOOGLE_APPLICATION_CREDENTIALS");

  const auth = new google.auth.GoogleAuth({
    keyFile,
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

export async function GET(req: Request) {
  try {
    const spreadsheetId = process.env.SCHEDULE_SPREADSHEET_ID;
    if (!spreadsheetId) throw new Error("Missing SCHEDULE_SPREADSHEET_ID");

    const url = new URL(req.url);
    const origin = url.origin;

    const weekStart = norm(url.searchParams.get("weekStart"));
    if (!weekStart) throw new Error("Missing weekStart");

    // ✅ ABSOLUTE internal fetch
    const histRes = await fetch(
      `${origin}/api/historical-data?weekStart=${encodeURIComponent(weekStart)}&limit=5000`,
      { cache: "no-store" }
    );
    const hist = await histRes.json();
    if (!histRes.ok || !hist?.ok) throw new Error(hist?.error || `Failed to load historical-data (${histRes.status})`);

    const shiftIds = new Set<string>((hist.rows || []).map((r: any) => norm(r.shiftId)).filter(Boolean));
    if (shiftIds.size === 0) return NextResponse.json({ ok: true, clockMap: {}, locationMap: {} });

    const sheets = await getSheetsClient();

    // --- CLOCKS (App Data) ---
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

    for (const r of appRows) {
      const sid = iShift >= 0 ? norm(r[iShift]) : "";
      if (!sid || !shiftIds.has(sid)) continue;

      clockMap[sid] = {
        clockInTime: iCin >= 0 ? (norm(r[iCin]) || null) : null,
        clockOutTime: iCout >= 0 ? (norm(r[iCout]) || null) : null,
      };
    }

    // --- LOCATION VERDICTS (Location Events) ---
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
      const verdict = iVerdict >= 0 ? (norm(r[iVerdict]) || null) : null;
      const ts = iTS >= 0 ? (norm(r[iTS]) || null) : null;

      const entry = ensure(sid);
      if (action === "clock_in" || action === "clockin") entry.clockIn = { timestamp: ts, verdict };
      if (action === "clock_out" || action === "clockout") entry.clockOut = { timestamp: ts, verdict };
    }

    return NextResponse.json({ ok: true, clockMap, locationMap });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Unknown error" }, { status: 500 });
  }
}

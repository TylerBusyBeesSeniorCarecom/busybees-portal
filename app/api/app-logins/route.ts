// app/api/app-logins/route.ts
import { NextResponse } from "next/server";
import { google } from "googleapis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AppLoginRow = {
  timestampUtc: string;
  localTimeEt: string;
  caregiverId: string;
  nameOnSchedule: string;
  email: string;
  role: string;
  device: string;
  os: string;
  osVersion: string;
  appVersion: string;
  timeZone: string;
  result: string;
  message: string;
  sessionId: string;
};

type AppLoginSummary = {
  caregiverId: string;
  nameOnSchedule: string;
  email: string;
  role: string;
  hasLoggedIntoApp: boolean;
  loginCount: number;
  firstLoginUtc: string;
  lastLoginUtc: string;
  firstLoginEt: string;
  lastLoginEt: string;
  latestDevice: string;
  latestOs: string;
  latestOsVersion: string;
  latestAppVersion: string;
  latestTimeZone: string;
  latestResult: string;
  latestMessage: string;
};

function norm(v: any): string {
  return (v ?? "").toString().trim();
}

function normalizeKey(v: any): string {
  return norm(v).toLowerCase().replace(/\s+/g, " ");
}

async function getSheetsClient() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_KEY");

  const credentials = JSON.parse(raw);

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  return google.sheets({
    version: "v4",
    auth,
  });
}

function parseUtcMs(value: string): number {
  const s = norm(value);
  if (!s) return Number.NaN;
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? t : Number.NaN;
}

function parseRows(values: string[][]): AppLoginRow[] {
  if (!values.length) return [];

  const headers = values[0].map((h) => norm(h));
  const rows = values.slice(1);

  const idx = (name: string) =>
    headers.findIndex((h) => normalizeKey(h) === normalizeKey(name));

  const iTimestampUtc = idx("Timestamp (UTC)");
  const iLocalTimeEt = idx("Local Time (ET)");
  const iCaregiverId = idx("Caregiver ID");
  const iNameOnSchedule = idx("Name on Schedule");
  const iEmail = idx("Email");
  const iRole = idx("Role");
  const iDevice = idx("Device");
  const iOs = idx("OS");
  const iOsVersion = idx("OS Version");
  const iAppVersion = idx("App Version");
  const iTimeZone = idx("Time Zone");
  const iResult = idx("Result");
  const iMessage = idx("Message");
  const iSessionId = idx("Session ID");

  return rows
    .filter((r) => r.some((cell) => norm(cell) !== ""))
    .map((r) => ({
      timestampUtc: iTimestampUtc >= 0 ? norm(r[iTimestampUtc]) : "",
      localTimeEt: iLocalTimeEt >= 0 ? norm(r[iLocalTimeEt]) : "",
      caregiverId: iCaregiverId >= 0 ? norm(r[iCaregiverId]) : "",
      nameOnSchedule: iNameOnSchedule >= 0 ? norm(r[iNameOnSchedule]) : "",
      email: iEmail >= 0 ? norm(r[iEmail]) : "",
      role: iRole >= 0 ? norm(r[iRole]) : "",
      device: iDevice >= 0 ? norm(r[iDevice]) : "",
      os: iOs >= 0 ? norm(r[iOs]) : "",
      osVersion: iOsVersion >= 0 ? norm(r[iOsVersion]) : "",
      appVersion: iAppVersion >= 0 ? norm(r[iAppVersion]) : "",
      timeZone: iTimeZone >= 0 ? norm(r[iTimeZone]) : "",
      result: iResult >= 0 ? norm(r[iResult]) : "",
      message: iMessage >= 0 ? norm(r[iMessage]) : "",
      sessionId: iSessionId >= 0 ? norm(r[iSessionId]) : "",
    }));
}

function summarizeLogins(rows: AppLoginRow[]): AppLoginSummary[] {
  const byCaregiver = new Map<string, AppLoginSummary>();

  const sortedRows = [...rows].sort((a, b) => {
    const at = parseUtcMs(a.timestampUtc);
    const bt = parseUtcMs(b.timestampUtc);

    if (!Number.isFinite(at) && !Number.isFinite(bt)) return 0;
    if (!Number.isFinite(at)) return 1;
    if (!Number.isFinite(bt)) return -1;
    return at - bt;
  });

  for (const row of sortedRows) {
    const caregiverId = norm(row.caregiverId);
    if (!caregiverId) continue;

    const existing = byCaregiver.get(caregiverId);

    if (!existing) {
      byCaregiver.set(caregiverId, {
        caregiverId,
        nameOnSchedule: row.nameOnSchedule,
        email: row.email,
        role: row.role,
        hasLoggedIntoApp: true,
        loginCount: 1,
        firstLoginUtc: row.timestampUtc,
        lastLoginUtc: row.timestampUtc,
        firstLoginEt: row.localTimeEt,
        lastLoginEt: row.localTimeEt,
        latestDevice: row.device,
        latestOs: row.os,
        latestOsVersion: row.osVersion,
        latestAppVersion: row.appVersion,
        latestTimeZone: row.timeZone,
        latestResult: row.result,
        latestMessage: row.message,
      });
      continue;
    }

    existing.loginCount += 1;

    if (!existing.nameOnSchedule && row.nameOnSchedule) {
      existing.nameOnSchedule = row.nameOnSchedule;
    }
    if (!existing.email && row.email) {
      existing.email = row.email;
    }
    if (!existing.role && row.role) {
      existing.role = row.role;
    }

    const existingFirst = parseUtcMs(existing.firstLoginUtc);
    const existingLast = parseUtcMs(existing.lastLoginUtc);
    const rowTime = parseUtcMs(row.timestampUtc);

    if (Number.isFinite(rowTime)) {
      if (!Number.isFinite(existingFirst) || rowTime < existingFirst) {
        existing.firstLoginUtc = row.timestampUtc;
        existing.firstLoginEt = row.localTimeEt;
      }

      if (!Number.isFinite(existingLast) || rowTime >= existingLast) {
        existing.lastLoginUtc = row.timestampUtc;
        existing.lastLoginEt = row.localTimeEt;
        existing.latestDevice = row.device;
        existing.latestOs = row.os;
        existing.latestOsVersion = row.osVersion;
        existing.latestAppVersion = row.appVersion;
        existing.latestTimeZone = row.timeZone;
        existing.latestResult = row.result;
        existing.latestMessage = row.message;
      }
    }
  }

  return Array.from(byCaregiver.values()).sort((a, b) =>
    (a.nameOnSchedule || a.caregiverId).localeCompare(
      b.nameOnSchedule || b.caregiverId
    )
  );
}

export async function GET() {
  try {
    const spreadsheetId = process.env.SCHEDULE_SPREADSHEET_ID;
    if (!spreadsheetId) {
      throw new Error("Missing SCHEDULE_SPREADSHEET_ID");
    }

    const tabName = process.env.APP_LOGINS_TAB_NAME || "App Logins";
    const range = `'${tabName}'!A1:N5000`;

    const sheets = await getSheetsClient();

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
      valueRenderOption: "FORMATTED_VALUE",
    });

    const values = (res.data.values ?? []) as string[][];
    const rows = parseRows(values);
    const summaries = summarizeLogins(rows);

    const byCaregiverId: Record<string, AppLoginSummary> = {};
    for (const item of summaries) {
      if (item.caregiverId) {
        byCaregiverId[item.caregiverId] = item;
      }
    }

    return NextResponse.json({
      ok: true,
      tabName,
      rowCount: rows.length,
      caregiverCount: summaries.length,
      logins: summaries,
      byCaregiverId,
    });
  } catch (err: any) {
    console.error("[app-logins] Route failed:", err);

    return NextResponse.json(
      {
        ok: false,
        error: err?.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}
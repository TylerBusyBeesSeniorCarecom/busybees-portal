// app/api/all-shifts/route.ts
import { NextResponse } from "next/server";
import { google } from "googleapis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const EMPTY_SCHEDULE_REASON = "The schedule for this week has not been created yet.";

type ShiftRow = {
  shiftId: string;
  date: string;
  client: string;
  caregiver: string;
  caregiverId: string;
  startTime: string;
  endTime: string;
  status: string;
  conflict: string;
};

type ScheduledCaregiver = {
  caregiverId: string;
  caregiver: string;
  dates: string[];
  statuses: string[];
  shiftCount: number;
};

function norm(v: any): string {
  return (v ?? "").toString().trim();
}

function normalizeKey(v: any): string {
  return norm(v).toLowerCase().replace(/\s+/g, " ");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableGoogleError(err: any): boolean {
  const code = Number(err?.code || err?.status || 0);
  const message = norm(err?.message).toLowerCase();

  return (
    code === 409 ||
    code === 429 ||
    code === 500 ||
    code === 502 ||
    code === 503 ||
    code === 504 ||
    message.includes("operation was aborted") ||
    message.includes("deadline exceeded") ||
    message.includes("timeout")
  );
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

function isEmptyScheduleRangeError(err: any) {
  const code = Number(err?.code || err?.status || 0);
  const message = norm(err?.message).toLowerCase();
  return (
    code === 400 &&
    (message.includes("the number of rows in the range must be at least 1") ||
      message.includes("unable to parse range"))
  );
}

async function getSheetRowCount(sheets: any, spreadsheetId: string, tabName: string) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(title,gridProperties(rowCount)))",
  });
  const match = meta.data.sheets?.find(
    (sheet: any) => String(sheet.properties?.title ?? "").trim() === tabName
  );
  return match?.properties?.gridProperties?.rowCount ?? null;
}

function parseRows(values: string[][]): ShiftRow[] {
  if (!values.length) return [];

  const headers = values[0].map((h) => norm(h));
  const rows = values.slice(1);

  const idx = (name: string) =>
    headers.findIndex((h) => normalizeKey(h) === normalizeKey(name));

  const iShiftId = idx("Shift ID");
  const iDate = idx("Date");
  const iClient = idx("Client");
  const iCaregiver = idx("Caregiver");
  const iCaregiverId = idx("Caregiver ID");
  const iStartTime = idx("Start Time");
  const iEndTime = idx("End Time");
  const iStatus = idx("Status");
  const iConflict = idx("Conflict");

  return rows
    .filter((r) => r.some((cell) => norm(cell) !== ""))
    .map((r) => ({
      shiftId: iShiftId >= 0 ? norm(r[iShiftId]) : "",
      date: iDate >= 0 ? norm(r[iDate]) : "",
      client: iClient >= 0 ? norm(r[iClient]) : "",
      caregiver: iCaregiver >= 0 ? norm(r[iCaregiver]) : "",
      caregiverId: iCaregiverId >= 0 ? norm(r[iCaregiverId]) : "",
      startTime: iStartTime >= 0 ? norm(r[iStartTime]) : "",
      endTime: iEndTime >= 0 ? norm(r[iEndTime]) : "",
      status: iStatus >= 0 ? norm(r[iStatus]) : "",
      conflict: iConflict >= 0 ? norm(r[iConflict]) : "",
    }));
}

function isScheduledStatus(status: string): boolean {
  const s = normalizeKey(status);
  if (!s) return false;

  return (
    s.includes("filled") ||
    s.includes("offered") ||
    s.includes("consider") ||
    s.includes("pending")
  );
}

function summarizeScheduledCaregivers(rows: ShiftRow[]): ScheduledCaregiver[] {
  const byKey = new Map<string, ScheduledCaregiver>();

  for (const row of rows) {
    if (!isScheduledStatus(row.status)) continue;

    const caregiverId = norm(row.caregiverId);
    const caregiver = norm(row.caregiver);

    if (!caregiverId && !caregiver) continue;

    const key = caregiverId || `name:${normalizeKey(caregiver)}`;
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, {
        caregiverId,
        caregiver,
        dates: row.date ? [row.date] : [],
        statuses: row.status ? [row.status] : [],
        shiftCount: 1,
      });
      continue;
    }

    existing.shiftCount += 1;

    if (row.date && !existing.dates.includes(row.date)) {
      existing.dates.push(row.date);
    }

    if (row.status && !existing.statuses.includes(row.status)) {
      existing.statuses.push(row.status);
    }

    if (!existing.caregiver && caregiver) existing.caregiver = caregiver;
    if (!existing.caregiverId && caregiverId) existing.caregiverId = caregiverId;
  }

  return Array.from(byKey.values()).sort((a, b) =>
    (a.caregiver || a.caregiverId).localeCompare(b.caregiver || b.caregiverId)
  );
}

async function readTabWithRetry(
  sheets: any,
  spreadsheetId: string,
  tabName: string,
  rangeSuffix = "A1:I1000",
  maxAttempts = 3
): Promise<{ values: string[][]; empty: boolean; emptyReason?: string }> {
  const range = `'${tabName}'!${rangeSuffix}`;
  let lastErr: any = null;
  const rowCount = await getSheetRowCount(sheets, spreadsheetId, tabName);
  if (rowCount != null && rowCount < 2) {
    return { values: [], empty: true, emptyReason: EMPTY_SCHEDULE_REASON };
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(
        `[all-shifts] Reading tab "${tabName}" (attempt ${attempt}/${maxAttempts}) range=${range}`
      );

      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range,
        valueRenderOption: "FORMATTED_VALUE",
      });

      const values = (res.data.values ?? []) as string[][];
      console.log(
        `[all-shifts] ✅ Success reading "${tabName}" on attempt ${attempt}. Rows returned: ${values.length}`
      );

      return {
        values,
        empty: values.length === 0,
        emptyReason: values.length === 0 ? EMPTY_SCHEDULE_REASON : undefined,
      };
    } catch (err: any) {
      lastErr = err;

      if (isEmptyScheduleRangeError(err)) {
        console.warn(`[all-shifts] Treating "${tabName}" as empty schedule tab`, {
          code: err?.code,
          status: err?.status,
          message: err?.message,
        });
        return { values: [], empty: true, emptyReason: EMPTY_SCHEDULE_REASON };
      }

      console.error(
        `[all-shifts] ❌ Failed reading "${tabName}" on attempt ${attempt}/${maxAttempts}`,
        {
          code: err?.code,
          status: err?.status,
          message: err?.message,
        }
      );

      if (!isRetryableGoogleError(err) || attempt === maxAttempts) {
        break;
      }

      const delay = attempt * 700;
      console.log(
        `[all-shifts] Retrying "${tabName}" in ${delay}ms because the error looks retryable...`
      );
      await sleep(delay);
    }
  }

  throw new Error(
    `Failed to read tab "${tabName}": ${lastErr?.message || "Unknown error"}`
  );
}

export async function GET() {
  try {
    const spreadsheetId = process.env.SCHEDULE_SPREADSHEET_ID;
    if (!spreadsheetId) {
      throw new Error("Missing SCHEDULE_SPREADSHEET_ID");
    }

    const cwTab = process.env.CW_SCHEDULE_TAB_NAME || "All Shifts";
    const nwTab = process.env.NW_SCHEDULE_TAB_NAME || "NW All Shifts";

    console.log("[all-shifts] Starting route...");
    console.log("[all-shifts] Current week tab:", cwTab);
    console.log("[all-shifts] Next week tab:", nwTab);

    const sheets = await getSheetsClient();

    // Read sequentially instead of Promise.all to reduce transient API abort/conflict issues
    const cwSchedule = await readTabWithRetry(sheets, spreadsheetId, cwTab);
    const nwSchedule = await readTabWithRetry(sheets, spreadsheetId, nwTab);
    const cwValues = cwSchedule.values;
    const nwValues = nwSchedule.values;

    const currentWeekRows = parseRows(cwValues);
    const nextWeekRows = parseRows(nwValues);

    const currentWeekScheduled = summarizeScheduledCaregivers(currentWeekRows);
    const nextWeekScheduled = summarizeScheduledCaregivers(nextWeekRows);

    return NextResponse.json({
      ok: true,
      tabs: {
        currentWeek: cwTab,
        nextWeek: nwTab,
      },
      currentWeek: {
        rowCount: currentWeekRows.length,
        empty: cwSchedule.empty,
        emptyReason: cwSchedule.emptyReason || null,
        scheduledCount: currentWeekScheduled.length,
        caregivers: currentWeekScheduled,
        rows: currentWeekRows,
      },
      nextWeek: {
        rowCount: nextWeekRows.length,
        empty: nwSchedule.empty,
        emptyReason: nwSchedule.emptyReason || null,
        scheduledCount: nextWeekScheduled.length,
        caregivers: nextWeekScheduled,
        rows: nextWeekRows,
      },
    });
  } catch (err: any) {
    console.error("[all-shifts] Route failed:", {
      message: err?.message,
      code: err?.code,
      status: err?.status,
    });

    return NextResponse.json(
      {
        ok: false,
        error: err?.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}

// app/api/service-requests/route.ts
import { NextResponse } from "next/server";
import { google } from "googleapis";
import path from "path";

const SHEET_NAME = "Service Requests";
const RANGE_A1 = `${SHEET_NAME}!A1:Z5000`;

function normHeader(s: string) {
  return (s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
}

function normClient(s: string) {
  return (s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function isLikelyIsoTimestamp(v: string) {
  return (
    typeof v === "string" &&
    /^\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}z$/i.test(v.trim())
  );
}

function parseTimeSlot(slot: string) {
  const s = (slot || "").trim();
  if (!s) return { start: "", end: "" };

  const parts = s
    .split(/–|—|-/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length >= 2) return { start: parts[0], end: parts[1] };
  return { start: s, end: "" };
}

// --- display grouping key (matches your UI grouping) ---
function toNYDateKey(input: string) {
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return "";

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(d);

  const mm = parts.find((p) => p.type === "month")?.value;
  const dd = parts.find((p) => p.type === "day")?.value;
  const yy = parts.find((p) => p.type === "year")?.value;

  if (!mm || !dd || !yy) return "";
  return `${Number(mm)}/${Number(dd)}/${yy}`;
}

// ---- week filter helpers (NY-correct, string based) ----
function isYmd(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test((s || "").trim());
}

function parseWeekStartYmd(weekStart: string) {
  const s = (weekStart || "").trim();
  return isYmd(s) ? s : null;
}

/**
 * Convert any parseable date string into YYYY-MM-DD in America/New_York.
 * This avoids UTC day shifting and DST edge cases.
 */
function toNYYmd(input: string) {
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return "";

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);

  const yy = parts.find((p) => p.type === "year")?.value;
  const mm = parts.find((p) => p.type === "month")?.value;
  const dd = parts.find((p) => p.type === "day")?.value;

  if (!yy || !mm || !dd) return "";
  return `${yy}-${mm}-${dd}`;
}

/**
 * Add days to a YYYY-MM-DD safely using a UTC-midday anchor.
 * (We only need consistent day stepping for weekEnd calculation.)
 */
function addDaysYmd(ymd: string, n: number) {
  if (!isYmd(ymd)) return "";
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
// ---- end helpers ----

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

type ReqItem = {
  clientName: string;
  rawDate: string;
  dateKey: string;
  start: string;
  end: string;
  preferredCaregiver: string;
  notes: string;
  status: string;
  timestamp: string;
};

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const qClientNameRaw = (searchParams.get("clientName") || "").trim();
    const qClientName = normClient(qClientNameRaw);

    const qWeekStart = (searchParams.get("weekStart") || "").trim();
    const onlyPending = (searchParams.get("onlyPending") || "1") === "1";

    const weekStartYmd = parseWeekStartYmd(qWeekStart);
    const weekEndYmd = weekStartYmd ? addDaysYmd(weekStartYmd, 6) : null;

    const spreadsheetId =
      process.env.SERVICE_REQUESTS_SHEET_ID ||
      process.env.SCHEDULE_SPREADSHEET_ID ||
      process.env.TEST_SHEET_ID;

    if (!spreadsheetId) {
      throw new Error(
        "Missing SERVICE_REQUESTS_SHEET_ID (or SCHEDULE_SPREADSHEET_ID / TEST_SHEET_ID)"
      );
    }

    const sheets = await getSheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: RANGE_A1,
      valueRenderOption: "FORMATTED_VALUE",
    });

    const values = (res.data.values || []) as string[][];
    if (values.length < 2) {
      return NextResponse.json({
        ok: true,
        meta: {
          sheet: SHEET_NAME,
          fetchedAt: new Date().toISOString(),
          beforeCount: 0,
          count: 0,
          clientName: qClientNameRaw || null,
          weekStart: weekStartYmd || null,
          weekEnd: weekEndYmd || null,
          onlyPending,
        },
        requests: [],
      });
    }

    const headerRow = values[0] || [];
    const headerLen = headerRow.length;

    const headerMap = new Map<string, number>();
    headerRow.forEach((h, idx) => {
      const key = normHeader(String(h || ""));
      if (key) headerMap.set(key, idx);
    });

    const idxClient = headerMap.get("client name") ?? 0;
    const idxDate = headerMap.get("date") ?? 1;
    const idxTimeSlot = headerMap.get("time slot") ?? 2;
    const idxPreferred = headerMap.get("preferred caregiver") ?? 3;
    const idxNotes = headerMap.get("additional notes") ?? 4;

    /**
     * You observed the sheet has a "Timestamp" header but some data exports include:
     *   index 5 = Status (e.g., Pending)
     *   index 6 = Timestamp ISO
     *
     * We handle BOTH:
     * - if row is longer than header, treat headerTimestamp as status and headerTimestamp+1 as timestamp
     * - otherwise, look for a "status" header, and use "timestamp" header if present
     * - final fallback: scan row tail for an ISO timestamp
     */
    const idxTimestampHeader = headerMap.get("timestamp");

    const parsed: ReqItem[] = values.slice(1).map((row) => {
      const get = (i: number) => String(row[i] ?? "").trim();

      const clientName = get(idxClient);
      const rawDate = get(idxDate);
      const timeSlot = get(idxTimeSlot);
      const preferredCaregiver = get(idxPreferred);
      const notes = get(idxNotes);

      let status = "";
      let timestamp = "";

      if (row.length > headerLen && idxTimestampHeader != null) {
        status = get(idxTimestampHeader);
        timestamp = get(idxTimestampHeader + 1);
      } else {
        const idxStatus = headerMap.get("status");
        status = idxStatus != null ? get(idxStatus) : "";

        timestamp = idxTimestampHeader != null ? get(idxTimestampHeader) : "";

        if (!timestamp) {
          for (let i = row.length - 1; i >= 0; i--) {
            const v = String(row[i] ?? "").trim();
            if (isLikelyIsoTimestamp(v)) {
              timestamp = v;
              break;
            }
          }
        }
      }

      const { start, end } = parseTimeSlot(timeSlot);
      const dateKey = toNYDateKey(rawDate) || rawDate;

      return {
        clientName,
        rawDate,
        dateKey,
        start,
        end,
        preferredCaregiver,
        notes,
        status,
        timestamp,
      };
    });

    parsed.sort((a, b) => {
      const ad = new Date(a.rawDate).getTime();
      const bd = new Date(b.rawDate).getTime();
      if (ad !== bd) return ad - bd;
      return (a.start || "").localeCompare(b.start || "");
    });

    const beforeCount = parsed.length;

    const requests = parsed.filter((r) => {
      if (!r.clientName || !r.rawDate || !r.start) return false;

      if (onlyPending) {
        if (normHeader(r.status) !== "pending") return false;
      }

      if (qClientName) {
        if (normClient(r.clientName) !== qClientName) return false;
      }

      if (weekStartYmd && weekEndYmd) {
        const reqYmdNY = toNYYmd(r.rawDate) || toNYYmd(r.dateKey);
        if (!reqYmdNY) return false;
        if (reqYmdNY < weekStartYmd || reqYmdNY > weekEndYmd) return false;
      }

      return true;
    });

    return NextResponse.json({
      ok: true,
      meta: {
        sheet: SHEET_NAME,
        fetchedAt: new Date().toISOString(),
        beforeCount,
        count: requests.length,
        clientName: qClientNameRaw || null,
        weekStart: weekStartYmd || null,
        weekEnd: weekEndYmd || null,
        onlyPending,
      },
      requests,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type WeekKind = "cw" | "nw";

type Cell = {
  a1: string;
  value: string;
  fontColor: string;
};

type GridRow = {
  row: number;
  clientName: string;
  clientA1: string;
  cells: Cell[];
};

type GridResponse = {
  ok: boolean;
  headers: {
    dayHeaders: string[];
    dateHeaders: string[];
  };
  body: {
    startRow: number;
    endRow: number;
    rows: GridRow[];
  };
  error?: string;
};

type PublishedShiftRow = {
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

type AllShiftsResponse = {
  ok: boolean;
  currentWeek?: {
    rows: PublishedShiftRow[];
  };
  nextWeek?: {
    rows: PublishedShiftRow[];
  };
  error?: string;
};

type ParsedGridShift = {
  client: string;
  date: string;
  caregiver: string;
  startTime: string;
  endTime: string;
  status: string;
  a1: string;
  raw: string;
};

type CellPublishState =
  | "empty"
  | "published"
  | "unpublished"
  | "changed"
  | "published_only";

type CellPublishStatus = {
  a1: string;
  clientName: string;
  date: string;
  dayLabel: string;
  state: CellPublishState;
  currentShiftCount: number;
  publishedShiftCount: number;
  currentKeys: string[];
  publishedKeys: string[];
  currentShifts: ParsedGridShift[];
  publishedShifts: PublishedShiftRow[];
};

function norm(v: unknown): string {
  return String(v ?? "").trim();
}

function normalizeKey(v: unknown): string {
  return norm(v).toLowerCase().replace(/\s+/g, " ");
}

function normalizeCellText(raw: unknown): string {
  return String(raw ?? "").replace(/[“”]/g, '"').trim();
}

function dateKey(dateStr: string): string {
  const raw = norm(dateStr);
  if (!raw) return "";

  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const mm = m[1].padStart(2, "0");
    const dd = m[2].padStart(2, "0");
    const yyyy = m[3];
    return `${yyyy}-${mm}-${dd}`;
  }

  return raw;
}

function normalizeTimeToken(raw: string): string {
  const s = norm(raw)
    .replace(/\s+/g, "")
    .toUpperCase();

  const m = s.match(/^(\d{1,2}):(\d{2})(AM|PM)$/);
  if (!m) return s;

  return `${m[1]}:${m[2]}${m[3]}`;
}

function makeShiftLookupKey(args: {
  client: string;
  date: string;
  caregiver: string;
  startTime: string;
  endTime: string;
}): string {
  return [
    normalizeKey(args.client),
    dateKey(args.date),
    normalizeKey(args.caregiver || "open"),
    normalizeTimeToken(args.startTime),
    normalizeTimeToken(args.endTime),
  ].join("__");
}

function inferStatusFromShiftText(raw: string): string {
  const s = normalizeCellText(raw);
  if (!s) return "";
  if (s.includes("*")) return "Canceled";
  if (s.includes("$")) return "Pending Client Confirmation";
  if (s.includes("^")) return "Offered";
  if (s.includes('"')) return "Offered";
  if (s.includes("(")) return "Considering";

  const filledRegex =
    /^[^,*\$\(\)\^"]+,\s?\d{1,2}:\d{2}\s?[APMapm]{2}-\d{1,2}:\d{2}\s?[APMapm]{2}.*$/;
  const openRegex =
    /^\d{1,2}:\d{2}\s?[APMapm]{2}-\d{1,2}:\d{2}\s?[APMapm]{2}.*$/;

  if (filledRegex.test(s)) return "Filled";
  if (openRegex.test(s)) return "Open";
  return "Unknown";
}

function extractTimeRange(raw: string): { startTime: string; endTime: string } | null {
  const s = normalizeCellText(raw);
  const m = s.match(
    /(\d{1,2}:\d{2}\s?[APMapm]{2})\s*-\s*(\d{1,2}:\d{2}\s?[APMapm]{2})/
  );
  if (!m) return null;

  return {
    startTime: normalizeTimeToken(m[1]),
    endTime: normalizeTimeToken(m[2]),
  };
}

function extractCaregiver(raw: string): string {
  const s = normalizeCellText(raw);
  if (!s) return "";

  const pending = s.match(/^\$([^,]+),/);
  if (pending?.[1]) return norm(pending[1]);

  const offering = s.match(/^\^([^,]+),/);
  if (offering?.[1]) return norm(offering[1]);

  const offeredNew = s.match(/^"([^,]+),/);
  if (offeredNew?.[1]) return norm(offeredNew[1]);

  const offeredOld = s.match(/^"([^"]+)"/);
  if (offeredOld?.[1]) return norm(offeredOld[1]);

  const consideringNew = s.match(/^\(([^,]+),/);
  if (consideringNew?.[1]) return norm(consideringNew[1]);

  const consideringOld = s.match(/^\(([^)]+)\)/);
  if (consideringOld?.[1]) return norm(consideringOld[1]);

  const filled = s.match(/^([^,*\$\(\)\^"]+),\s*\d{1,2}:\d{2}\s?[APMapm]{2}/);
  if (filled?.[1]) return norm(filled[1]);

  return "Open";
}

function splitCellIntoShiftSegments(raw: string): string[] {
  const s = normalizeCellText(raw);
  if (!s) return [];

  return s
    .split(/\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseGridCellShifts(args: {
  cellValue: string;
  clientName: string;
  date: string;
  a1: string;
}): ParsedGridShift[] {
  const { cellValue, clientName, date, a1 } = args;
  const segments = splitCellIntoShiftSegments(cellValue);
  const out: ParsedGridShift[] = [];

  for (const segment of segments) {
    if (!segment || segment.includes("*")) continue;

    const timeRange = extractTimeRange(segment);
    if (!timeRange) continue;

    out.push({
      client: clientName,
      date,
      caregiver: extractCaregiver(segment) || "Open",
      startTime: timeRange.startTime,
      endTime: timeRange.endTime,
      status: inferStatusFromShiftText(segment),
      a1,
      raw: segment,
    });
  }

  return out;
}

function keysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const aa = [...a].sort();
  const bb = [...b].sort();
  for (let i = 0; i < aa.length; i++) {
    if (aa[i] !== bb[i]) return false;
  }
  return true;
}

async function fetchInternalJson<T>(req: Request, path: string): Promise<T> {
  const url = new URL(req.url);
  const origin = url.origin;

  const res = await fetch(`${origin}${path}`, {
    cache: "no-store",
  });

  const text = await res.text();
  let data: any = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Non-JSON response from ${path}: ${text.slice(0, 200)}`);
  }

  if (!res.ok) {
    throw new Error(data?.error || `Request failed for ${path}`);
  }

  return data as T;
}

function buildPublishedGroupMap(rows: PublishedShiftRow[]) {
  const map = new Map<string, PublishedShiftRow[]>();

  for (const row of rows) {
    const client = norm(row.client);
    const date = norm(row.date);
    if (!client || !date) continue;

    const key = `${normalizeKey(client)}__${dateKey(date)}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(row);
  }

  return map;
}

function buildCurrentCellStatuses(args: {
  grid: GridResponse;
  publishedRows: PublishedShiftRow[];
}): Record<string, CellPublishStatus> {
  const { grid, publishedRows } = args;
  const out: Record<string, CellPublishStatus> = {};
  const publishedByClientDate = buildPublishedGroupMap(publishedRows);

  const dayHeaders = grid.headers?.dayHeaders ?? [];
  const dateHeaders = grid.headers?.dateHeaders ?? [];
  const rows = grid.body?.rows ?? [];

  for (const row of rows) {
    const clientName = norm(row.clientName);
    if (!clientName) continue;

    for (let dow = 0; dow < 7; dow++) {
      const cell = row.cells?.[dow];
      if (!cell?.a1) continue;

      const a1 = cell.a1;
      const dayLabel = norm(dayHeaders[dow + 1]);
      const date = norm(dateHeaders[dow + 1]);
      const currentShifts = parseGridCellShifts({
        cellValue: norm(cell.value),
        clientName,
        date,
        a1,
      });

      const groupKey = `${normalizeKey(clientName)}__${dateKey(date)}`;
      const publishedShifts = (publishedByClientDate.get(groupKey) ?? []).filter((shift) => {
        const shiftKey = makeShiftLookupKey({
          client: shift.client,
          date: shift.date,
          caregiver: shift.caregiver || "Open",
          startTime: shift.startTime,
          endTime: shift.endTime,
        });

        return shiftKey.length > 0;
      });

      const currentKeys = currentShifts.map((shift) =>
        makeShiftLookupKey({
          client: shift.client,
          date: shift.date,
          caregiver: shift.caregiver,
          startTime: shift.startTime,
          endTime: shift.endTime,
        })
      );

      const publishedKeys = publishedShifts.map((shift) =>
        makeShiftLookupKey({
          client: shift.client,
          date: shift.date,
          caregiver: shift.caregiver || "Open",
          startTime: shift.startTime,
          endTime: shift.endTime,
        })
      );

      let state: CellPublishState = "empty";

      if (currentKeys.length === 0 && publishedKeys.length === 0) {
        state = "empty";
      } else if (currentKeys.length === 0 && publishedKeys.length > 0) {
        state = "published_only";
      } else if (currentKeys.length > 0 && publishedKeys.length === 0) {
        state = "unpublished";
      } else if (keysEqual(currentKeys, publishedKeys)) {
        state = "published";
      } else {
        state = "changed";
      }

      out[a1] = {
        a1,
        clientName,
        date,
        dayLabel,
        state,
        currentShiftCount: currentKeys.length,
        publishedShiftCount: publishedKeys.length,
        currentKeys,
        publishedKeys,
        currentShifts,
        publishedShifts,
      };
    }
  }

  return out;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const week = (url.searchParams.get("week") || "cw").toLowerCase() as WeekKind;

    if (week !== "cw" && week !== "nw") {
      return NextResponse.json(
        { ok: false, error: "Invalid week. Expected 'cw' or 'nw'." },
        { status: 400 }
      );
    }

    const gridPath =
      week === "cw"
        ? "/api/current-week?action=getCurrentWeekGrid"
        : "/api/next-week?action=getNextWeekGrid";

    const [grid, allShifts] = await Promise.all([
      fetchInternalJson<GridResponse>(req, gridPath),
      fetchInternalJson<AllShiftsResponse>(req, "/api/all-shifts"),
    ]);

    if (!grid?.ok) {
      throw new Error(grid?.error || "Failed to load week grid.");
    }

    if (!allShifts?.ok) {
      throw new Error(allShifts?.error || "Failed to load All Shifts.");
    }

    const publishedRows =
      week === "cw"
        ? allShifts.currentWeek?.rows ?? []
        : allShifts.nextWeek?.rows ?? [];

    const cellStatuses = buildCurrentCellStatuses({
      grid,
      publishedRows,
    });

    const counts = {
      published: 0,
      unpublished: 0,
      changed: 0,
      published_only: 0,
      empty: 0,
    };

    for (const status of Object.values(cellStatuses)) {
      counts[status.state] += 1;
    }

    return NextResponse.json({
      ok: true,
      week,
      counts,
      cellStatuses,
    });
  } catch (err: any) {
    console.error("[publish-status] Route failed:", err);
    return NextResponse.json(
      {
        ok: false,
        error: err?.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}
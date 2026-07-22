"use client";

import type { ShiftConflictMatch } from "@/app/schedule/utils/shiftSaveFeedback";
import { parseScheduleShiftCell } from "@/app/schedule/utils/scheduleShiftStatus";

export type WeekKind = "cw" | "nw";

export type Cell = { a1: string; value: string; fontColor: string };
export type GridRow = {
  row: number;
  clientName: string;
  clientA1: string;
  cells: Cell[];
};

export type GridResponse = {
  ok: boolean;
  apiVersion?: string;
  meta?: { sheet?: string; fetchedAt?: string };
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

export type CaregiverProfile = {
  caregiverId: string;
  nameOnSchedule: string;
  name: string;
  status: string;
  certification: string;
  role: string;
  email: string;
  phone: string;
};

export type CaregiversApiResponse = {
  ok: boolean;
  caregivers?: CaregiverProfile[];
  byId?: Record<string, CaregiverProfile>;
  idByNameOnSchedule?: Record<string, string>;
  error?: string;
};

export type RawValues = string[][];

export type ClockMap = Record<
  string,
  {
    clockInTime: string | null;
    clockOutTime: string | null;
  }
>;

export type LocationMap = Record<
  string,
  {
    clockIn: { timestamp: string | null; verdict: string | null };
    clockOut: { timestamp: string | null; verdict: string | null };
  }
>;

export type ShiftRow = {
  shiftId: string;
  date: string;
  client: string;
  caregiver: string;
  caregiverId: string;
  startTime: string;
  endTime: string;
  status: string;
  conflict: string;
  dow: number;
};

export type SaveToast = {
  id: number;
  kind: "success" | "warning" | "error" | "loading";
  title: string;
  lines: string[];
  actions?: Array<{
    label: string;
    onClick: () => void;
    variant?: "primary" | "secondary";
  }>;
};

export type CellEditHistoryPresenceMap = Record<string, boolean>;

export type ShiftStatus =
  | "filled"
  | "offered"
  | "offering"
  | "considering"
  | "open"
  | "canceled"
  | "pending"
  | "requested"
  | "none";

export type RecommendationStatusFilter =
  | "all"
  | "open"
  | "filled"
  | "considering"
  | "offered"
  | "pending";

export type PopupShiftTarget = {
  shiftId: string;
  dateStr: string;
  clientName: string;
  caregiverName: string;
  caregiverId?: string;
  startTime: string;
  endTime: string;
  status: ShiftStatus;
};

export const UI = {
  pageBg: "#f3f4f6",
  panelBg: "#ffffff",
  headerBg: "#f9fafb",
  border: "#d1d5db",
  borderSoft: "#e5e7eb",
  text: "#111827",
  textDim: "#6b7280",
  accent: "#f4b400",
  accentSoft: "#fff7d6",
  accentText: "#7a4b00",
};

export const SHEET_COLORS: Record<ShiftStatus, string> = {
  filled: "#1f7a3a",
  offered: "#2b6fd6",
  offering: "#49c9f2",
  considering: "#d08a1a",
  open: "#d64545",
  canceled: "#000000",
  pending: "#7a3db8",
  requested: "#111827",
  none: "#111827",
};

export function norm(value: unknown): string {
  return String(value ?? "").trim();
}

export function normalizeKey(value: string): string {
  return norm(value).toLowerCase();
}

export function parseWeek(value: string | null): WeekKind {
  return value === "nw" ? "nw" : "cw";
}

export function normalizeCellText(raw: unknown): string {
  return String(raw ?? "").replace(/[“”]/g, '"');
}

export function parseDateToDow(dateStr: string): number {
  const d = toDateSafe(dateStr);
  if (!d) return 0;
  return d.getDay();
}

export function parseFirstTimeRange(cellValue: string): { start: string; end: string } | null {
  const s = normalizeCellText(cellValue);
  const match = s.match(
    /(\d{1,2}:\d{2}\s?[APMapm]{2})\s*-\s*(\d{1,2}:\d{2}\s?[APMapm]{2})/
  );
  if (!match) return null;

  return {
    start: match[1].replace(/\s+/g, ""),
    end: match[2].replace(/\s+/g, ""),
  };
}

export function statusFromCellValue(raw: unknown): ShiftStatus {
  const cellValue = normalizeCellText(raw).trim();
  if (!cellValue) return "none";
  if (cellValue.includes("*")) return "canceled";
  if (cellValue.includes("$")) return "pending";
  if (cellValue.includes("^")) return "offering";
  if (cellValue.includes('"')) return "offered";
  if (cellValue.includes("(")) return "considering";

  const filledRegex =
    /^[^,*\$\(\)\^"]+,\s?\d{1,2}:\d{2}\s?[APMapm]{2}-\d{1,2}:\d{2}\s?[APMapm]{2}.*$/;
  const openRegex = /^\d{1,2}:\d{2}\s?[APMapm]{2}-\d{1,2}:\d{2}\s?[APMapm]{2}.*$/;

  if (filledRegex.test(cellValue)) return "filled";
  if (openRegex.test(cellValue)) return "open";
  return "none";
}

export function parseCaregiverFromCell(cellValue: string): string {
  const v = norm(cellValue);
  if (!v) return "";

  const s = normalizeCellText(v);
  const consideringOpenOnly = s.match(/^\(([^,]+),\s*\d{1,2}:\d{2}\s?[APMapm]{2}/);
  if (consideringOpenOnly?.[1]) {
    const caregiver = norm(consideringOpenOnly[1]);
    return caregiver.toLowerCase() === "open" ? "" : caregiver;
  }

  const consideringOld = s.match(/^\(([^)]+)\)\s*\d{1,2}:\d{2}\s?[APMapm]{2}/);
  if (consideringOld?.[1]) {
    const caregiver = norm(consideringOld[1]);
    return caregiver.toLowerCase() === "open" ? "" : caregiver;
  }

  const idx = s.indexOf(",");
  if (idx === -1) return "";

  const caregiver = s.slice(0, idx).replace(/[(")\^$]/g, "").trim();
  if (!caregiver) return "";
  return caregiver.toLowerCase() === "open" ? "" : caregiver;
}

export function parseCaregiverNameFromAnyShiftText(cellValue: string): string {
  const v = norm(cellValue);
  if (!v) return "";
  if (statusFromCellValue(v) === "canceled") return "";

  const s = normalizeCellText(v);
  const filled = s.match(/^([^,*\$\(\)\^"]+)\s*,\s*\d{1,2}:\d{2}\s?[APMapm]{2}/);
  if (filled?.[1]) return norm(filled[1]);

  const consideringOpenOnly = s.match(/^\(([^,]+),\s*\d{1,2}:\d{2}\s?[APMapm]{2}/);
  if (consideringOpenOnly?.[1]) return norm(consideringOpenOnly[1]);

  const consideringOld = s.match(/^\(([^)]+)\)\s*\d{1,2}:\d{2}\s?[APMapm]{2}/);
  if (consideringOld?.[1]) return norm(consideringOld[1]);

  const offeredOpenOnly = s.match(/^"([^,]+),\s*\d{1,2}:\d{2}\s?[APMapm]{2}/);
  if (offeredOpenOnly?.[1]) return norm(offeredOpenOnly[1]);

  const offeredOld = s.match(/^"([^"]+)"\s*\d{1,2}:\d{2}\s?[APMapm]{2}/);
  if (offeredOld?.[1]) return norm(offeredOld[1]);

  const offering = s.match(/^\^([^,]+),\s*\d{1,2}:\d{2}\s?[APMapm]{2}/);
  if (offering?.[1]) return norm(offering[1]);

  const pending = s.match(/^\$([^,]+),\s*\d{1,2}:\d{2}\s?[APMapm]{2}/);
  if (pending?.[1]) return norm(pending[1]);

  return "";
}

export function toDateSafe(dateStr: string): Date | null {
  const raw = norm(dateStr);
  if (!raw) return null;

  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) return direct;

  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+.*)?$/);
  if (!match) return null;

  const month = parseInt(match[1], 10);
  const day = parseInt(match[2], 10);
  const year = parseInt(match[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const parsed = new Date(year, month - 1, day);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function ymdFromDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function startOfLocalWeek(date: Date = new Date()): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  next.setDate(next.getDate() - next.getDay());
  return next;
}

export function getWeekStartYmd(week: WeekKind, referenceDate: Date = new Date()): string {
  const start = startOfLocalWeek(referenceDate);
  if (week === "nw") {
    start.setDate(start.getDate() + 7);
  }
  return ymdFromDate(start);
}

export function toYmd(dateStr: string): string {
  const d = toDateSafe(dateStr);
  if (!d) return "";
  return ymdFromDate(d);
}

export function dateKey(dateStr: string): string {
  const d = toDateSafe(dateStr);
  if (!d) return norm(dateStr);
  return ymdFromDate(d);
}

export function weekLabel(week: WeekKind) {
  return week === "cw" ? "Current Week" : "Next Week";
}

export function gridRouteForWeek(week: WeekKind) {
  return week === "cw" ? "/api/current-week" : "/api/next-week";
}

export function gridActionForWeek(week: WeekKind) {
  return week === "cw" ? "getCurrentWeekGrid" : "getNextWeekGrid";
}

async function parseJsonResponse<T>(res: Response, urlLabel: string): Promise<T | null> {
  const contentType = res.headers.get("content-type") || "";
  const text = await res.text();
  const trimmed = text.trim();

  if (!contentType.includes("application/json")) {
    const redirectedTo = res.redirected ? ` redirected to ${res.url}` : "";
    throw new Error(
      `Expected JSON from ${urlLabel} but received ${contentType || "unknown content-type"} (${res.status})${redirectedTo}. Body: ${trimmed.slice(
        0,
        200
      )}`
    );
  }

  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    throw new Error(
      `Invalid JSON from ${urlLabel} (${res.status}). Body: ${trimmed.slice(0, 200)}`
    );
  }
}

export function splitCellIntoShiftStrings(value: string): string[] {
  return norm(value)
    .split(/\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function makeShiftLookupKey(args: {
  client: string;
  date: string;
  start: string;
  end: string;
  caregiver: string;
}) {
  const client = normalizeKey(args.client);
  const date = dateKey(args.date);
  const start = norm(args.start).replace(/\s+/g, "").toUpperCase();
  const end = norm(args.end).replace(/\s+/g, "").toUpperCase();
  const caregiver = normalizeKey(args.caregiver.replace(/[()"]/g, "").trim());
  return `${client}__${date}__${start}__${end}__${caregiver}`;
}

export function makeCellEditHistoryKey(args: {
  week: WeekKind;
  a1: string;
  clientName: string;
  dateStr: string;
}) {
  return [
    args.week,
    normalizeKey(args.a1),
    normalizeKey(args.clientName),
    dateKey(args.dateStr),
  ].join("__");
}

export async function fetchGrid(week: WeekKind): Promise<GridResponse> {
  const route = gridRouteForWeek(week);
  const action = gridActionForWeek(week);
  const res = await fetch(`${route}?action=${encodeURIComponent(action)}`, {
    cache: "no-store",
  });
  const data = await parseJsonResponse<GridResponse>(
    res,
    `${route}?action=${encodeURIComponent(action)}`
  );

  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  if (!data?.ok) throw new Error(data?.error || `Failed to load ${weekLabel(week)} grid`);
  return data;
}

export async function updateCell(week: WeekKind, a1: string, value: string) {
  const status = statusFromCellValue(value);
  const fontColor = SHEET_COLORS[status] || "#111827";
  const payload = { action: "updateCellByA1", a1, value, fontColor };
  const url = gridRouteForWeek(week);
  console.log("[BulkEditConfirm] updateCell request", {
    url,
    method: "POST",
    payload,
  });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  const contentType = res.headers.get("content-type") || "";
  const text = await res.text();
  const trimmed = text.trim();
  console.log("[BulkEditConfirm] updateCell response", {
    status: res.status,
    ok: res.ok,
    contentType,
    body: trimmed.slice(0, 500),
  });

  if (!contentType.includes("application/json")) {
    throw new Error(
      `Expected JSON from ${url} but received ${contentType || "unknown content-type"} (${res.status}). Body: ${trimmed.slice(
        0,
        200
      )}`
    );
  }

  const data = trimmed ? JSON.parse(trimmed) : null;
  console.log("[BulkEditConfirm] updateCell parsed", {
    success: data?.success,
    ok: data?.ok,
    updated: data?.updated,
    warnings: data?.warnings,
    error: data?.error,
  });

  if (!res.ok) throw new Error(data?.error || `Update failed (${res.status})`);
  if (!data?.ok) throw new Error(data?.error || "Update failed");
  return data;
}

export async function logAndSaveScheduleEdit(args: {
  timestamp: string;
  user: string;
  userEmail: string;
  actionType: string;
  weekType: WeekKind;
  weekOf?: string;
  date: string;
  client: string;
  oldValue: string;
  newValue: string;
  cell: string;
  day: string;
  oldStatus: string;
  newStatus: string;
  oldCaregiver: string;
  newCaregiver: string;
  oldStartTime: string;
  newStartTime: string;
  oldEndTime: string;
  newEndTime: string;
  notes: string;
  accessPoint: string;
}) {
  const url = "/api/schedule-edit-log";
  console.log("[BulkEditConfirm] scheduleEditLog request", {
    url,
    method: "POST",
    payload: args,
  });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });

  const contentType = res.headers.get("content-type") || "";
  const text = await res.text();
  let data: any = null;

  console.log("[BulkEditConfirm] scheduleEditLog response", {
    status: res.status,
    ok: res.ok,
    contentType,
    body: text.trim().slice(0, 500),
  });

  try {
    data = text ? JSON.parse(text.trim()) : null;
  } catch {
    throw new Error(`Schedule edit log save failed (${res.status})`);
  }

  console.log("[BulkEditConfirm] scheduleEditLog parsed", {
    success: data?.success,
    ok: data?.ok,
    updated: data?.updated,
    warnings: data?.warnings,
    error: data?.error,
  });

  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || `Schedule edit log save failed (${res.status})`);
  }

  return data;
}

export async function fetchScheduleMaps(week: WeekKind): Promise<{
  values: RawValues;
  clockMap: ClockMap;
  locationMap: LocationMap;
}> {
  const res = await fetch(`/api/schedule?week=${encodeURIComponent(week)}`, {
    cache: "no-store",
  });
  const data = await parseJsonResponse<any>(res, `/api/schedule?week=${encodeURIComponent(week)}`);

  if (!res.ok) throw new Error(data?.error || `Schedule request failed (${res.status})`);
  if (!data?.ok) throw new Error(data?.error || "Failed to load schedule maps");

  return {
    values: data.values ?? [],
    clockMap: data.clockMap ?? {},
    locationMap: data.locationMap ?? {},
  };
}

export function normalizeScheduleValues(values: RawValues): ShiftRow[] {
  if (!values?.length) return [];
  const headers = values[0].map((h) => norm(h));
  const rows = values.slice(1);

  const idx = (name: string) => headers.findIndex((h) => h.toLowerCase() === name.toLowerCase());

  const iShiftId = idx("Shift ID");
  const iDate = idx("Date");
  const iClient = idx("Client");
  const iCaregiver = idx("Caregiver");
  const iCaregiverId = idx("Caregiver ID");
  const iStart = idx("Start Time");
  const iEnd = idx("End Time");
  const iStatus = idx("Status");
  const iConflict = idx("Conflict");

  return rows
    .filter((row) => row.some((cell) => norm(cell) !== ""))
    .map((row) => {
      const date = norm(row[iDate]);
      return {
        shiftId: norm(row[iShiftId]),
        date,
        client: norm(row[iClient]),
        caregiver: norm(row[iCaregiver]),
        caregiverId: norm(row[iCaregiverId]),
        startTime: norm(row[iStart]),
        endTime: norm(row[iEnd]),
        status: norm(row[iStatus]),
        conflict: norm(row[iConflict]),
        dow: parseDateToDow(date),
      };
    });
}

export function buildShiftLookupFromRows(rows: ShiftRow[]) {
  const lookup: Record<string, string> = {};
  for (const shift of rows) {
    const key = makeShiftLookupKey({
      client: shift.client,
      date: shift.date,
      start: shift.startTime,
      end: shift.endTime,
      caregiver: shift.caregiver || "",
    });
    if (shift.shiftId) lookup[key] = shift.shiftId;
  }
  return lookup;
}

function buildShiftRowsFromCellValue(args: {
  value: string;
  clientName: string;
  dateStr: string;
  idByNameOnSchedule: Record<string, string>;
  preferredShiftIds?: string[];
}): ShiftRow[] {
  const lines = splitCellIntoShiftStrings(args.value);
  const out: ShiftRow[] = [];
  let preferredIndex = 0;

  for (const line of lines) {
    const parsed = parseScheduleShiftCell(line);
    if (!parsed.startTime || !parsed.endTime) continue;

    const caregiverName =
      norm(parsed.caregiverName) || (parsed.baseStatus === "Open" ? "Open" : "");
    const caregiverId = caregiverName
      ? args.idByNameOnSchedule[normalizeKey(caregiverName)] || ""
      : "";

    out.push({
      shiftId: args.preferredShiftIds?.[preferredIndex] || "",
      date: args.dateStr,
      client: args.clientName,
      caregiver: caregiverName,
      caregiverId,
      startTime: parsed.startTime,
      endTime: parsed.endTime,
      status: parsed.baseStatus,
      conflict: "",
      dow: parseDateToDow(args.dateStr),
    });

    preferredIndex += 1;
  }

  return out;
}

export function reconcileScheduleRowsForCell(args: {
  currentRows: ShiftRow[];
  clientName: string;
  dateStr: string;
  oldValue: string;
  newValue: string;
  idByNameOnSchedule: Record<string, string>;
  preserveShiftIds?: string[];
}) {
  const oldRows = buildShiftRowsFromCellValue({
    value: args.oldValue,
    clientName: args.clientName,
    dateStr: args.dateStr,
    idByNameOnSchedule: args.idByNameOnSchedule,
  });

  const nextRows = buildShiftRowsFromCellValue({
    value: args.newValue,
    clientName: args.clientName,
    dateStr: args.dateStr,
    idByNameOnSchedule: args.idByNameOnSchedule,
    preferredShiftIds: args.preserveShiftIds,
  });

  const oldKeyBag = new Map<string, number>();
  for (const row of oldRows) {
    const key = makeShiftLookupKey({
      client: row.client,
      date: row.date,
      start: row.startTime,
      end: row.endTime,
      caregiver: row.caregiver || "",
    });
    oldKeyBag.set(key, (oldKeyBag.get(key) ?? 0) + 1);
  }

  const survivingRows = args.currentRows.filter((row) => {
    if (normalizeKey(row.client) !== normalizeKey(args.clientName)) return true;
    if (dateKey(row.date) !== dateKey(args.dateStr)) return true;

    const rowKey = makeShiftLookupKey({
      client: row.client,
      date: row.date,
      start: row.startTime,
      end: row.endTime,
      caregiver: row.caregiver || "",
    });
    const count = oldKeyBag.get(rowKey) ?? 0;
    if (count <= 0) return true;
    oldKeyBag.set(rowKey, count - 1);
    return false;
  });

  return [...survivingRows, ...nextRows];
}

export function timeLabelToMinutes(value: string): number {
  const raw = norm(value).toUpperCase().replace(/\s+/g, "");
  const match = raw.match(/^(\d{1,2}):(\d{2})(AM|PM)$/);
  if (!match) return Number.POSITIVE_INFINITY;

  let hours = parseInt(match[1], 10) % 12;
  const minutes = parseInt(match[2], 10);
  if (match[3] === "PM") hours += 12;
  return hours * 60 + minutes;
}

export function formatRecommendationsDateLabel(dateStr: string): string {
  const d = toDateSafe(dateStr);
  if (!d) return norm(dateStr);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "numeric",
    day: "numeric",
  });
}

export function recommendationStatusLabel(status: ShiftStatus): string {
  if (status === "filled") return "Filled";
  if (status === "considering") return "Considering";
  if (status === "offered") return "Offered";
  if (status === "offering") return "Offering";
  if (status === "pending") return "Pending";
  if (status === "open") return "Open";
  return "Unknown";
}

export function buildConflictSummary(conflicts: ShiftConflictMatch[]) {
  return conflicts
    .map(
      (match) =>
        `${match.client} ${match.startTime}-${match.endTime}${
          match.shiftId ? ` (${match.shiftId})` : ""
        }`
    )
    .join(" | ");
}

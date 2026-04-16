"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

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

type ClientsApiResponse =
  | { ok: true; meta: any; headers: string[]; rows: string[][]; clients?: ClientProfile[] }
  | { ok: false; error: string };

type ClientHistoryResponse = {
  ok: boolean;
  clientName?: string;
  items?: Array<{ caregiverName: string; count: number; lastDate?: string | null }>;
  error?: string;
};

type ClientProfile = {
  name: string;
  location?: string | null;
  description?: string | null;
  rate?: string | null;
  address?: string | null;
};

type AvailabilityRow = {
  caregiverName: string;
  caregiverId: string;
  desiredHours: string;
  byDow: Record<number, string>;
};

type CaregiverProfile = {
  caregiverId: string;
  nameOnSchedule: string;
  name: string;
  status?: string;
  certifications?: string | string[] | null;
};

type ScheduleShiftRow = {
  shiftId: string;
  date: string;
  client: string;
  caregiver: string;
  caregiverId: string;
  startTime: string;
  endTime: string;
  status: string;
  dow: number;
};

type ParsedShift = {
  baseStatus: "Open" | "Filled" | "Offered" | "Considering" | "PendingClientApproval" | "Unknown";
  isCancelled: boolean;
  caregiverName: string | null;
  startTime: string | null;
  endTime: string | null;
};

type ShiftStatusLabel =
  | "Needs Attention"
  | "Considering"
  | "Offered"
  | "Pending Client Approval"
  | "Scheduled"
  | "Finished"
  | "Cancelled"
  | "Unknown";

type ShiftInsightCandidate = {
  key: string;
  caregiverId: string;
  caregiverName: string;
  availabilityRaw: string;
  availabilityLabel: string;
  desiredHours: string;
  totalHours: number;
  dayShiftCount: number;
  historyCount: number;
  conflictMinutes: number;
  totalScore: number;
  breakdown: {
    availability: number;
    conflict: number;
    history: number;
    drive_time: number;
    desired_hours: number;
    hours_penalty: number;
  };
};

type ShiftListItem = {
  key: string;
  clientName: string;
  dateLabel: string;
  dayLabel: string;
  startTime: string;
  endTime: string;
  hours: number;
  statusLabel: ShiftStatusLabel;
  caregiverName: string | null;
  overlapCount: number;
  avgScore: number | null;
  topScore: number | null;
  candidateCount: number;
  candidates: ShiftInsightCandidate[];
};

type Props = {
  open: boolean;
  onClose: () => void;
  week: WeekKind;
  onWeekChange?: (week: WeekKind) => void;
};

const UI = {
  border: "#d1d5db",
  borderSoft: "#e5e7eb",
  text: "#111827",
  textDim: "#6b7280",
  beeGold: "#f4c542",
  beeGoldDark: "#c79200",
  navy: "#16253f",
  red: "#dc2626",
  green: "#1f7a3a",
  orange: "#d08a1a",
  blue: "#2b6fd6",
  purple: "#7a3db8",
};

function norm(v: any) {
  return (v ?? "").toString().trim();
}

function normalizeKey(v: any) {
  return norm(v).toLowerCase();
}

function headerIndex(headers: string[], candidates: string[]) {
  const hs = headers.map((h) => norm(h).toLowerCase());
  for (const candidate of candidates) {
    const i = hs.findIndex((h) => h === candidate.toLowerCase());
    if (i !== -1) return i;
  }
  for (const candidate of candidates) {
    const i = hs.findIndex((h) => h.includes(candidate.toLowerCase()));
    if (i !== -1) return i;
  }
  return -1;
}

function parseTimeToMinutes(raw: string): number | null {
  const value = norm(raw).replace(/\s+/g, " ").replace(/([AP]M)$/i, " $1").trim();
  const m = value.match(/^(\d{1,2})(?::(\d{2}))?\s*([AP]M)$/i);
  if (!m) return null;

  let hh = parseInt(m[1], 10);
  const mm = m[2] ? parseInt(m[2], 10) : 0;
  const ap = m[3].toUpperCase();
  if (hh < 1 || hh > 12 || mm < 0 || mm > 59) return null;

  if (ap === "AM") {
    if (hh === 12) hh = 0;
  } else if (hh !== 12) {
    hh += 12;
  }

  return hh * 60 + mm;
}

function timeRangeToMinutes(startTime: string, endTime: string): { start: number; end: number } | null {
  const s = parseTimeToMinutes(startTime);
  const e0 = parseTimeToMinutes(endTime);
  if (s == null || e0 == null) return null;
  let e = e0;
  if (e <= s) e += 24 * 60;
  return { start: s, end: e };
}

function overlapMinutes(a: { start: number; end: number }, b: { start: number; end: number }) {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

function durationHours(startTime: string, endTime: string): number {
  const range = timeRangeToMinutes(startTime, endTime);
  if (!range) return 0;
  return Math.max(0, (range.end - range.start) / 60);
}

function toDateSafe(dateStr: string): Date | null {
  const raw = norm(dateStr);
  if (!raw) return null;
  const d0 = new Date(raw);
  if (!Number.isNaN(d0.getTime())) return d0;
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+.*)?$/);
  if (!m) return null;
  const mm = parseInt(m[1], 10);
  const dd = parseInt(m[2], 10);
  let yyyy = parseInt(m[3], 10);
  if (yyyy < 100) yyyy += 2000;
  const d = new Date(yyyy, mm - 1, dd);
  return Number.isNaN(d.getTime()) ? null : d;
}

function buildScheduledDate(dateStr: string, timeStr: string): Date | null {
  const base = toDateSafe(dateStr);
  const mins = parseTimeToMinutes(timeStr);
  if (!base || mins == null) return null;
  const d = new Date(base);
  d.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
  return d;
}

function addDays(d: Date, days: number) {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

function fullNameSortKey(fullName: string) {
  const s = norm(fullName).replace(/\s+/g, " ").trim();
  const parts = s.split(" ").filter(Boolean);
  const first = parts[0] || "";
  const last = parts.length > 1 ? parts[parts.length - 1] : first;
  return `${normalizeKey(last)}__${normalizeKey(first)}__${normalizeKey(s)}`;
}

function buildClientsByName(payload: Extract<ClientsApiResponse, { ok: true }>) {
  if (Array.isArray(payload.clients) && payload.clients.length) {
    const map: Record<string, ClientProfile> = {};
    for (const client of payload.clients) {
      const name = norm(client.name);
      if (!name) continue;
      map[normalizeKey(name)] = {
        name,
        location: norm(client.location || client.address) || null,
        description: norm(client.description) || null,
        rate: norm(client.rate) || null,
        address: norm(client.address || client.location) || null,
      };
    }
    return map;
  }

  const headers = (payload.headers || []).map((h) => norm(h));
  const rows = payload.rows || [];
  const iName = headerIndex(headers, ["client name", "name", "client"]);
  const iLoc = headerIndex(headers, ["location", "address", "street address"]);
  const iDesc = headerIndex(headers, ["description", "notes", "client description"]);
  const iRate = headerIndex(headers, ["rate", "hourly rate", "bill rate", "billing rate"]);

  const map: Record<string, ClientProfile> = {};
  for (const row of rows) {
    const name = iName >= 0 ? norm(row[iName]) : "";
    if (!name) continue;
    const address = iLoc >= 0 ? norm(row[iLoc]) : "";
    map[normalizeKey(name)] = {
      name,
      location: address || null,
      description: iDesc >= 0 ? norm(row[iDesc]) || null : null,
      rate: iRate >= 0 ? norm(row[iRate]) || null : null,
      address: address || null,
    };
  }
  return map;
}

function parseDateToDow(dateStr: string): number {
  const d = toDateSafe(dateStr);
  return d ? d.getDay() : -1;
}

function normalizeSchedule(values: string[][]): ScheduleShiftRow[] {
  if (!values?.length) return [];
  const headers = values[0].map((h) => norm(h));
  const rows = values.slice(1);
  const iShiftId = headerIndex(headers, ["shift id"]);
  const iDate = headerIndex(headers, ["date"]);
  const iClient = headerIndex(headers, ["client"]);
  const iCaregiver = headerIndex(headers, ["caregiver"]);
  const iCaregiverId = headerIndex(headers, ["caregiver id"]);
  const iStart = headerIndex(headers, ["start time"]);
  const iEnd = headerIndex(headers, ["end time"]);
  const iStatus = headerIndex(headers, ["status"]);

  return rows
    .filter((row) => row.some((cell) => norm(cell)))
    .map((row) => {
      const date = iDate >= 0 ? norm(row[iDate]) : "";
      return {
        shiftId: iShiftId >= 0 ? norm(row[iShiftId]) : "",
        date,
        client: iClient >= 0 ? norm(row[iClient]) : "",
        caregiver: iCaregiver >= 0 ? norm(row[iCaregiver]) : "",
        caregiverId: iCaregiverId >= 0 ? norm(row[iCaregiverId]) : "",
        startTime: iStart >= 0 ? norm(row[iStart]) : "",
        endTime: iEnd >= 0 ? norm(row[iEnd]) : "",
        status: iStatus >= 0 ? norm(row[iStatus]) : "",
        dow: parseDateToDow(date),
      };
    });
}

function collapseSpaces(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function looksLikeTimePart(value: string) {
  return /^(\d{1,2})(:\d{2})?\s*(AM|PM)?\s*-\s*(\d{1,2})(:\d{2})?\s*(AM|PM)?$/i.test(
    collapseSpaces(value)
  );
}

function removeTrailingCancelledMarker(value: string) {
  const s = value.trim();
  if (!s.endsWith("*")) return { text: s, isCancelled: false };
  return { text: s.slice(0, -1).trimEnd(), isCancelled: true };
}

function stripOuterDoubleQuotes(value: string) {
  let s = value.trim();
  while (s.startsWith('"')) s = s.slice(1).trimStart();
  return s;
}

function stripOuterDollar(value: string) {
  let s = value.trim();
  while (s.startsWith("$")) s = s.slice(1).trimStart();
  return s;
}

function stripOuterParens(value: string) {
  let s = value.trim();
  if (s.startsWith("(")) s = s.slice(1).trimStart();
  if (s.endsWith(")")) s = s.slice(0, -1).trimEnd();
  return s.trim();
}

function detectBaseStatus(rawTextWithoutCancelled: string): {
  baseStatus: ParsedShift["baseStatus"];
  unwrappedText: string;
} {
  const s = rawTextWithoutCancelled.trim();
  if (!s) return { baseStatus: "Unknown", unwrappedText: s };
  if (s.startsWith("(")) return { baseStatus: "Considering", unwrappedText: stripOuterParens(s) };
  if (s.startsWith('"')) return { baseStatus: "Offered", unwrappedText: stripOuterDoubleQuotes(s) };
  if (s.startsWith("$")) return { baseStatus: "PendingClientApproval", unwrappedText: stripOuterDollar(s) };
  if (looksLikeTimePart(s)) return { baseStatus: "Open", unwrappedText: s };
  if (s.includes(",")) return { baseStatus: "Filled", unwrappedText: s };
  return { baseStatus: "Unknown", unwrappedText: s };
}

function splitNameAndTime(value: string): {
  caregiverName: string | null;
  timeText: string | null;
} {
  const s = collapseSpaces(value);
  if (looksLikeTimePart(s)) return { caregiverName: null, timeText: s };
  const commaIndex = s.lastIndexOf(",");
  if (commaIndex === -1) return { caregiverName: null, timeText: null };
  const left = collapseSpaces(s.slice(0, commaIndex));
  const right = collapseSpaces(s.slice(commaIndex + 1));
  if (!left || !right || !looksLikeTimePart(right)) return { caregiverName: null, timeText: null };
  return { caregiverName: left, timeText: right };
}

function splitTimeRange(timeText: string | null) {
  const s = norm(timeText);
  if (!s) return { startTime: null, endTime: null };
  const parts = s.split("-");
  if (parts.length !== 2) return { startTime: null, endTime: null };
  return {
    startTime: collapseSpaces(parts[0]) || null,
    endTime: collapseSpaces(parts[1]) || null,
  };
}

function parseScheduleShiftCell(rawText: string): ParsedShift {
  const trimmed = String(rawText ?? "").trim();
  if (!trimmed) {
    return {
      baseStatus: "Unknown",
      isCancelled: false,
      caregiverName: null,
      startTime: null,
      endTime: null,
    };
  }
  const cancelledInfo = removeTrailingCancelledMarker(trimmed);
  const statusInfo = detectBaseStatus(cancelledInfo.text);
  const split = splitNameAndTime(statusInfo.unwrappedText);
  const time = splitTimeRange(split.timeText);
  return {
    baseStatus: statusInfo.baseStatus,
    isCancelled: cancelledInfo.isCancelled,
    caregiverName: split.caregiverName,
    startTime: time.startTime,
    endTime: time.endTime,
  };
}

function splitCellIntoShiftStrings(value: string) {
  return norm(value)
    .split(/\n+/)
    .map((part: string) => part.trim())
    .filter(Boolean);
}

function statusLabelFromParsedShift(parsed: ParsedShift, isPast: boolean): ShiftStatusLabel {
  if (parsed.isCancelled) return "Cancelled";
  switch (parsed.baseStatus) {
    case "Open":
      return "Needs Attention";
    case "Considering":
      return "Considering";
    case "Offered":
      return "Offered";
    case "PendingClientApproval":
      return "Pending Client Approval";
    case "Filled":
      return isPast ? "Finished" : "Scheduled";
    default:
      return "Unknown";
  }
}

function statusColors(status: ShiftStatusLabel) {
  if (status === "Needs Attention") return { bg: "#fef2f2", color: "#991b1b", border: "#fecaca" };
  if (status === "Considering") return { bg: "#fff7ed", color: "#c2410c", border: "#fed7aa" };
  if (status === "Offered") return { bg: "#eff6ff", color: "#1d4ed8", border: "#bfdbfe" };
  if (status === "Pending Client Approval") return { bg: "#faf5ff", color: "#7e22ce", border: "#d8b4fe" };
  if (status === "Finished" || status === "Scheduled") {
    return { bg: "#ecfdf5", color: "#065f46", border: "#a7f3d0" };
  }
  if (status === "Cancelled") return { bg: "#f3f4f6", color: "#6b7280", border: "#d1d5db" };
  return { bg: "#ffffff", color: UI.text, border: UI.borderSoft };
}

function safeNumber(n: any) {
  const x = typeof n === "number" ? n : parseFloat((n ?? "").toString());
  return Number.isFinite(x) ? x : 0;
}

type DesiredHoursMeta = {
  raw: string;
  wantsMax: boolean;
  min: number | null;
  max: number | null;
};

function isAsManyAsPossible(raw: string) {
  const v = norm(raw).toLowerCase();
  return v.includes("as many as possible") || v.includes("as much as possible") || v.includes("as many as");
}

function parseDesiredHours(raw: string): DesiredHoursMeta {
  const v = norm(raw);
  if (!v) return { raw: v, wantsMax: false, min: null, max: null };
  if (isAsManyAsPossible(v)) return { raw: v, wantsMax: true, min: null, max: null };
  const range = v.match(/(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)/);
  if (range) {
    return { raw: v, wantsMax: false, min: safeNumber(range[1]), max: safeNumber(range[2]) };
  }
  const single = safeNumber(v);
  if (single > 0) return { raw: v, wantsMax: false, min: 0, max: single };
  return { raw: v, wantsMax: false, min: null, max: null };
}

function desiredHoursFitScore(meta: DesiredHoursMeta, weeklyBefore: number, shiftHours: number) {
  if (meta.wantsMax) return 10;
  if (meta.max == null) return 0;
  const weeklyAfter = weeklyBefore + shiftHours;
  if (weeklyBefore < meta.max) return 10;
  if (meta.min != null && weeklyBefore >= meta.min && weeklyBefore <= meta.max) return 10;
  if (meta.min != null && weeklyAfter >= meta.min && weeklyAfter <= meta.max) return 10;
  return 0;
}

function fortyHourPenalty(weeklyBefore: number, shiftHours: number) {
  if (weeklyBefore > 40) return -5;
  if (weeklyBefore + shiftHours > 40) return -5;
  return 0;
}

function normalizeAvailabilityText(raw: string) {
  return norm(raw)
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function isUnavailableAvailability(raw: string) {
  const v = normalizeAvailabilityText(raw);
  return (
    !v ||
    v === "—" ||
    v === "off" ||
    v === "none" ||
    v === "n/a" ||
    v === "na" ||
    v === "no" ||
    v === "0" ||
    v === "ns" ||
    v === "x" ||
    v.includes("off please") ||
    v.includes("not available") ||
    v.includes("unavailable") ||
    v.includes("no hours")
  );
}

function isOpenAvailability(raw: string) {
  const v = normalizeAvailabilityText(raw);
  return (
    v === "any" ||
    v === "open" ||
    v === "available" ||
    v === "all day" ||
    v === "any time" ||
    v === "anytime" ||
    v.includes("12am to 11:59pm") ||
    v.includes("12:00am to 11:59pm")
  );
}

function shiftCrossesMidnight(startTime: string, endTime: string) {
  const range = timeRangeToMinutes(startTime, endTime);
  return !!range && range.end > 24 * 60;
}

function getBroadAvailabilityWindow(raw: string) {
  const v = normalizeAvailabilityText(raw);
  if (v.includes("morning")) return { start: 6 * 60, end: 12 * 60 };
  if (v.includes("afternoon") || v.includes("day time") || v.includes("daytime")) return { start: 12 * 60, end: 18 * 60 };
  if (v.includes("evening")) return { start: 18 * 60, end: 23 * 60 };
  return null;
}

function isOvernightAvailability(raw: string) {
  return normalizeAvailabilityText(raw).includes("overnight");
}

function inferMeridiemTime(value: string, otherSide?: string, side: "start" | "end" = "start") {
  const v = norm(value).toLowerCase().replace(/\s+/g, "");
  if (/[ap]m$/.test(v)) return v.toUpperCase();
  const other = norm(otherSide).toLowerCase().replace(/\s+/g, "");
  const n = safeNumber(v.replace(/[^\d:]/g, "").split(":")[0]);
  if (/[ap]m$/.test(other)) {
    if (other.endsWith("pm") && n >= 1 && n <= 11) return `${v}PM`.toUpperCase();
    if (other.endsWith("am") && n >= 1 && n <= 11) return `${v}AM`.toUpperCase();
  }
  if (n >= 6 && n <= 11) return `${v}AM`.toUpperCase();
  if (n === 12) return `${v}${side === "start" ? "PM" : "PM"}`.toUpperCase();
  return `${v}PM`.toUpperCase();
}

function parseAvailabilityWindows(raw: string) {
  const text = normalizeAvailabilityText(raw);
  if (!text) return [] as Array<{ start: number; end: number }>;
  const cleaned = text
    .replace(/\buntil\b/g, "to")
    .replace(/\btil\b/g, "to")
    .replace(/\./g, " ")
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const matches: RegExpMatchArray[] = Array.from(
    cleaned.matchAll(
      /(\d{1,2}(?::\d{2})?\s*[ap]m?|\d{1,2}(?::\d{2})?)\s*(?:-|to)\s*(\d{1,2}(?::\d{2})?\s*[ap]m?|\d{1,2}(?::\d{2})?)/gi
    )
  );
  const windows: Array<{ start: number; end: number }> = [];
  for (const match of matches) {
    const left = inferMeridiemTime(match[1], match[2], "start");
    const right = inferMeridiemTime(match[2], match[1], "end");
    const range = timeRangeToMinutes(left, right);
    if (range) windows.push(range);
  }
  return windows;
}

function scorePostedAvailability(raw: string, shiftStart: string, shiftEnd: string) {
  const v = normalizeAvailabilityText(raw);
  const shiftRange = timeRangeToMinutes(shiftStart, shiftEnd);
  if (!shiftRange) return { type: "none", score: 0, label: "No match" };
  if (isUnavailableAvailability(v)) return { type: "none", score: 0, label: "No match" };
  if (isOpenAvailability(v)) return { type: "exact", score: 40, label: "Exact match" };

  const windows = parseAvailabilityWindows(v);
  for (const window of windows) {
    if (window.start <= shiftRange.start && window.end >= shiftRange.end) {
      return { type: "exact", score: 40, label: "Exact match" };
    }
  }

  const broad = getBroadAvailabilityWindow(v);
  if (broad && broad.start <= shiftRange.start && broad.end >= shiftRange.end) {
    return { type: "strong", score: 30, label: "Strong match" };
  }

  if (isOvernightAvailability(v) && shiftCrossesMidnight(shiftStart, shiftEnd)) {
    return { type: "strong", score: 30, label: "Strong match" };
  }

  let bestOverlap = 0;
  for (const window of windows) bestOverlap = Math.max(bestOverlap, overlapMinutes(shiftRange, window));
  if (bestOverlap > 0) return { type: "partial", score: 20, label: "Partial match" };

  if (
    v.includes("after ") ||
    v.includes("before ") ||
    v.includes("leave by") ||
    v.includes("until ") ||
    v.includes("til ")
  ) {
    return { type: "unclear", score: 10, label: "Needs review" };
  }

  return { type: "none", score: 0, label: "No match" };
}

function historyScore(historyCount: number) {
  if (historyCount >= 5) return 15;
  if (historyCount >= 3) return 10;
  if (historyCount >= 1) return 5;
  return 0;
}

function conflictScoreFromMinutes(mins: number) {
  if (mins === 0) return 20;
  if (mins < 30) return 10;
  if (mins < 60) return 5;
  return 0;
}

function buildAverageScore(candidates: ShiftInsightCandidate[]) {
  if (!candidates.length) return null;
  const head = candidates.slice(0, Math.min(5, candidates.length));
  const sum = head.reduce((acc, item) => acc + item.totalScore, 0);
  return sum / head.length;
}

async function fetchGrid(week: WeekKind): Promise<GridResponse> {
  const route = week === "cw" ? "/api/current-week" : "/api/next-week";
  const action = week === "cw" ? "getCurrentWeekGrid" : "getNextWeekGrid";
  const res = await fetch(`${route}?action=${encodeURIComponent(action)}`, { cache: "no-store" });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as GridResponse) : null;
  if (!res.ok) throw new Error(data?.error || `Failed to load grid (${res.status})`);
  if (!data?.ok) throw new Error(data?.error || "Failed to load grid");
  return data;
}

async function fetchClients(): Promise<ClientsApiResponse> {
  const res = await fetch("/api/clients", { cache: "no-store" });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as ClientsApiResponse) : null;
  if (!res.ok) throw new Error((data as any)?.error || `Failed to load clients (${res.status})`);
  return data as ClientsApiResponse;
}

async function fetchAvailability(week: WeekKind) {
  const res = await fetch(`/api/availability?week=${encodeURIComponent(week)}`, { cache: "no-store" });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error || `Failed to load availability (${res.status})`);
  if (!data?.ok) throw new Error(data?.error || "Failed to load availability");
  return Array.isArray(data?.values) ? (data.values as string[][]) : [];
}

async function fetchCaregivers() {
  const res = await fetch(`/api/caregivers`, { cache: "no-store", headers: { Accept: "application/json" } });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error || `Failed to load caregivers (${res.status})`);
  if (!data?.ok) throw new Error(data?.error || "Failed to load caregivers");
  const arr = Array.isArray(data?.caregivers) ? data.caregivers : [];
  return arr.map((item: any) => ({
    caregiverId: norm(item?.caregiverId),
    nameOnSchedule: norm(item?.nameOnSchedule),
    name: norm(item?.name),
    status: norm(item?.status),
    certifications: item?.certifications ?? null,
  })) as CaregiverProfile[];
}

async function fetchSchedule(week: WeekKind) {
  const res = await fetch(`/api/schedule?week=${encodeURIComponent(week)}`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error || `Failed to load schedule (${res.status})`);
  if (!data?.ok) throw new Error(data?.error || "Failed to load schedule");
  return normalizeSchedule(Array.isArray(data?.values) ? data.values : []);
}

async function fetchClientHistory(clientName: string) {
  const qs = new URLSearchParams({ client: clientName, tailWeeks: "26" });
  const res = await fetch(`/api/client-history?${qs.toString()}`, { cache: "no-store" });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as ClientHistoryResponse) : null;
  if (!res.ok) throw new Error(data?.error || `Failed to load client history (${res.status})`);
  if (!data?.ok) throw new Error(data?.error || "Failed to load client history");
  return Array.isArray(data?.items) ? data.items : [];
}

function weekPill(active: boolean): React.CSSProperties {
  return {
    border: `1px solid ${active ? UI.navy : UI.border}`,
    background: active ? UI.navy : "rgba(255,255,255,0.92)",
    color: active ? "#fff" : UI.text,
    borderRadius: 999,
    padding: "8px 10px",
    fontWeight: 900,
    cursor: "pointer",
    fontSize: 12,
    lineHeight: 1,
  };
}

function ghostButtonStyle(active: boolean): React.CSSProperties {
  return {
    border: `1px solid ${active ? UI.beeGoldDark : UI.border}`,
    background: active ? UI.beeGold : "rgba(255,255,255,0.92)",
    color: active ? UI.navy : UI.text,
    borderRadius: 999,
    padding: "8px 10px",
    fontWeight: 900,
    cursor: "pointer",
    fontSize: 12,
    lineHeight: 1,
  };
}

function PanelMessage({
  children,
  danger,
  isGhost,
}: {
  children: React.ReactNode;
  danger?: boolean;
  isGhost?: boolean;
}) {
  return (
    <div
      style={{
        background: danger ? (isGhost ? "rgba(254,242,242,0.18)" : "#fef2f2") : isGhost ? "rgba(255,255,255,0.16)" : "#fff",
        color: danger ? UI.red : UI.textDim,
        border: `1px solid ${danger ? "#fecaca" : UI.border}`,
        borderRadius: 14,
        padding: 16,
        fontWeight: 800,
      }}
    >
      {children}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        minWidth: 0,
        border: `1px solid ${UI.borderSoft}`,
        borderRadius: 12,
        padding: "10px 11px",
        background: "rgba(255,255,255,0.86)",
      }}
    >
      <div style={{ fontSize: 10.5, color: UI.textDim, fontWeight: 900, textTransform: "uppercase" }}>{label}</div>
      <div style={{ marginTop: 4, fontSize: 18, fontWeight: 1000, color: UI.text }}>{value}</div>
    </div>
  );
}

export default function SupraesophagealGanglionPanel({
  open,
  onClose,
  week,
  onWeekChange,
}: Props) {
  const [gridData, setGridData] = useState<GridResponse | null>(null);
  const [clientsData, setClientsData] = useState<ClientsApiResponse | null>(null);
  const [availabilityValues, setAvailabilityValues] = useState<string[][]>([]);
  const [caregiverProfiles, setCaregiverProfiles] = useState<CaregiverProfile[]>([]);
  const [scheduleRows, setScheduleRows] = useState<ScheduleShiftRow[]>([]);
  const [historyByClient, setHistoryByClient] = useState<Record<string, ClientHistoryResponse["items"]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [peekMode, setPeekMode] = useState(false);
  const [selectedShiftKey, setSelectedShiftKey] = useState<string | null>(null);
  const [panelPos, setPanelPos] = useState({ x: 930, y: 92 });
  const panelSize = { width: 760, height: 800 };

  const dragRef = useRef<{ dragging: boolean; offsetX: number; offsetY: number }>({
    dragging: false,
    offsetX: 0,
    offsetY: 0,
  });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError("");
        const [grid, clients, availability, caregivers, schedule] = await Promise.all([
          fetchGrid(week),
          fetchClients(),
          fetchAvailability(week),
          fetchCaregivers(),
          fetchSchedule(week),
        ]);
        if (cancelled) return;
        setGridData(grid);
        setClientsData(clients);
        setAvailabilityValues(availability);
        setCaregiverProfiles(caregivers);
        setScheduleRows(schedule);
        setHistoryByClient({});
      } catch (err: any) {
        if (!cancelled) setError(err?.message || "Failed to load workpad.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [open, week]);

  useEffect(() => {
    if (!open) return;
    function onMouseMove(e: MouseEvent) {
      if (!dragRef.current.dragging) return;
      const nextX = e.clientX - dragRef.current.offsetX;
      const nextY = e.clientY - dragRef.current.offsetY;
      const maxX = Math.max(12, window.innerWidth - panelSize.width - 12);
      const maxY = Math.max(12, window.innerHeight - panelSize.height - 12);
      setPanelPos({
        x: Math.min(Math.max(12, nextX), maxX),
        y: Math.min(Math.max(12, nextY), maxY),
      });
    }
    function onMouseUp() {
      dragRef.current.dragging = false;
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [open]);

  function beginDrag(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement | null;
    if (target?.closest("button") || target?.closest("input")) return;
    dragRef.current.dragging = true;
    dragRef.current.offsetX = e.clientX - panelPos.x;
    dragRef.current.offsetY = e.clientY - panelPos.y;
    e.preventDefault();
  }

  const availabilityRows = useMemo(() => {
    const headers = (availabilityValues?.[0] ?? []).map((h) => norm(h));
    const rows = availabilityValues?.length ? availabilityValues.slice(1) : [];
    const iName = headerIndex(headers, ["caregiver name"]);
    const iId = headerIndex(headers, ["caregiver id"]);
    const iDesired = headerIndex(headers, ["desired hours"]);
    const dayColumns = headers
      .map((header, idx) => ({ idx, dow: (() => {
        const raw = header.toLowerCase().split("(")[0].trim();
        const map: Record<string, number> = {
          sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2,
          wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4,
          friday: 5, fri: 5, saturday: 6, sat: 6,
        };
        const first = raw.split(/\s+/)[0];
        return map[first] ?? null;
      })() }))
      .filter((item) => item.dow != null) as Array<{ idx: number; dow: number }>;

    return rows
      .map((row) => {
        const caregiverName = iName >= 0 ? norm(row[iName]) : "";
        const caregiverId = iId >= 0 ? norm(row[iId]) : "";
        if (!caregiverName && !caregiverId) return null;
        const byDow: Record<number, string> = { 0: "—", 1: "—", 2: "—", 3: "—", 4: "—", 5: "—", 6: "—" };
        for (const item of dayColumns) byDow[item.dow] = norm(row[item.idx]) || "—";
        return {
          caregiverName,
          caregiverId,
          desiredHours: iDesired >= 0 ? norm(row[iDesired]) : "",
          byDow,
        } as AvailabilityRow;
      })
      .filter(Boolean) as AvailabilityRow[];
  }, [availabilityValues]);

  useEffect(() => {
    if (!open || !gridData?.body?.rows?.length) return;
    const clients = Array.from(
      new Set(
        gridData.body.rows
          .map((row) => norm(row.clientName))
          .filter(Boolean)
      )
    );
    if (!clients.length) return;
    let cancelled = false;
    Promise.allSettled(clients.map((client) => fetchClientHistory(client)))
      .then((results) => {
        if (cancelled) return;
        const next: Record<string, ClientHistoryResponse["items"]> = {};
        clients.forEach((client, index) => {
          const result = results[index];
          if (result?.status === "fulfilled") next[normalizeKey(client)] = result.value;
        });
        setHistoryByClient(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, gridData]);

  const clientsByName = useMemo(
    () => (clientsData && clientsData.ok ? buildClientsByName(clientsData) : {}),
    [clientsData]
  );

  const availabilityById = useMemo(() => {
    const map: Record<string, AvailabilityRow> = {};
    for (const row of availabilityRows) {
      if (row.caregiverId) map[normalizeKey(row.caregiverId)] = row;
    }
    return map;
  }, [availabilityRows]);

  const availabilityByName = useMemo(() => {
    const map: Record<string, AvailabilityRow> = {};
    for (const row of availabilityRows) {
      if (row.caregiverName) map[normalizeKey(row.caregiverName)] = row;
    }
    return map;
  }, [availabilityRows]);

  const caregiverProfileByKey = useMemo(() => {
    const map: Record<string, CaregiverProfile> = {};
    for (const profile of caregiverProfiles) {
      if (profile.caregiverId) map[normalizeKey(profile.caregiverId)] = profile;
      if (profile.name) map[normalizeKey(profile.name)] = profile;
      if (profile.nameOnSchedule) map[normalizeKey(profile.nameOnSchedule)] = profile;
    }
    return map;
  }, [caregiverProfiles]);

  const scheduleMapByCaregiver = useMemo(() => {
    const map: Record<string, Record<number, ScheduleShiftRow[]>> = {};
    for (const row of scheduleRows) {
      const key = norm(row.caregiverId || row.caregiver);
      if (!key || normalizeKey(key) === "open") continue;
      if (!map[key]) map[key] = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
      map[key][row.dow]?.push(row);
    }
    return map;
  }, [scheduleRows]);

  const totalHoursByCaregiver = useMemo(() => {
    const map: Record<string, number> = {};
    for (const row of scheduleRows) {
      const key = norm(row.caregiverId || row.caregiver);
      if (!key || normalizeKey(key) === "open") continue;
      map[key] = (map[key] || 0) + durationHours(row.startTime, row.endTime);
    }
    return map;
  }, [scheduleRows]);

  const shifts = useMemo<ShiftListItem[]>(() => {
    const rows = gridData?.body?.rows ?? [];
    const dayHeaders = gridData?.headers?.dayHeaders ?? [];
    const dateHeaders = gridData?.headers?.dateHeaders ?? [];
    const now = Date.now();
    const rawShifts: Array<Omit<ShiftListItem, "overlapCount" | "avgScore" | "topScore" | "candidateCount" | "candidates">> = [];

    for (const row of rows) {
      const clientName = norm(row.clientName);
      if (!clientName) continue;
      for (let cellIndex = 0; cellIndex < row.cells.length; cellIndex++) {
        const cell = row.cells[cellIndex];
        const dayLabel = dayHeaders[cellIndex + 1] || "";
        const dateLabel = dateHeaders[cellIndex + 1] || "";
        const shiftStrings = splitCellIntoShiftStrings(cell.value);

        shiftStrings.forEach((shiftText: string, shiftIndex: number) => {
          const parsed = parseScheduleShiftCell(shiftText);
          if (parsed.isCancelled || !parsed.startTime || !parsed.endTime || !dateLabel) return;

          const hours = durationHours(parsed.startTime, parsed.endTime);
          let scheduledEnd = buildScheduledDate(dateLabel, parsed.endTime);
          const range = timeRangeToMinutes(parsed.startTime, parsed.endTime);
          if (scheduledEnd && range && range.end > 24 * 60) scheduledEnd = addDays(scheduledEnd, 1);
          const isPast = !!scheduledEnd && scheduledEnd.getTime() < now;

          rawShifts.push({
            key: `${clientName}-${cell.a1}-${shiftIndex}-${parsed.startTime}-${parsed.endTime}`,
            clientName,
            dateLabel,
            dayLabel,
            startTime: parsed.startTime,
            endTime: parsed.endTime,
            hours,
            statusLabel: statusLabelFromParsedShift(parsed, isPast),
            caregiverName: parsed.caregiverName,
          });
        });
      }
    }

    const searchLower = search.trim().toLowerCase();
    const activeCandidates = new Set<string>();
    for (const row of scheduleRows) {
      const key = norm(row.caregiverId || row.caregiver);
      if (!key || normalizeKey(key) === "open") continue;
      activeCandidates.add(key);
    }
    for (const row of availabilityRows) {
      const key = norm(row.caregiverId || row.caregiverName);
      if (key) activeCandidates.add(key);
    }
    for (const profile of caregiverProfiles) {
      const key = norm(profile.caregiverId || profile.nameOnSchedule || profile.name);
      if (key) activeCandidates.add(key);
    }

    const built = rawShifts
      .filter((shift) => {
        if (!searchLower) return true;
        return (
          shift.clientName.toLowerCase().includes(searchLower) ||
          shift.statusLabel.toLowerCase().includes(searchLower) ||
          norm(shift.caregiverName).toLowerCase().includes(searchLower) ||
          shift.dayLabel.toLowerCase().includes(searchLower) ||
          shift.dateLabel.toLowerCase().includes(searchLower)
        );
      })
      .map((shift) => {
        const shiftRange = timeRangeToMinutes(shift.startTime, shift.endTime);
        const shiftDow = parseDateToDow(shift.dateLabel);
        const historyItems = historyByClient[normalizeKey(shift.clientName)] || [];
        const historyByCaregiverName: Record<string, number> = {};
        for (const item of historyItems) historyByCaregiverName[normalizeKey(item?.caregiverName)] = Number(item?.count) || 0;

        const candidates = Array.from(activeCandidates)
          .map((candidateKey) => {
            let caregiverName = candidateKey;
            let caregiverId = "";

            const scheduleHit =
              scheduleRows.find((row) => norm(row.caregiverId) === candidateKey) ||
              scheduleRows.find((row) => norm(row.caregiver) === candidateKey) ||
              null;
            if (scheduleHit) {
              caregiverName = norm(scheduleHit.caregiver) || caregiverName;
              caregiverId = norm(scheduleHit.caregiverId) || caregiverId;
            }

            const profile =
              caregiverProfileByKey[normalizeKey(caregiverId)] ||
              caregiverProfileByKey[normalizeKey(caregiverName)] ||
              caregiverProfileByKey[normalizeKey(candidateKey)];
            if (profile) {
              caregiverName = norm(profile.name || profile.nameOnSchedule) || caregiverName;
              caregiverId = norm(profile.caregiverId) || caregiverId;
            }

            const availability =
              (caregiverId ? availabilityById[normalizeKey(caregiverId)] : undefined) ||
              availabilityByName[normalizeKey(caregiverName)] ||
              availabilityByName[normalizeKey(candidateKey)];

            const availabilityRaw = availability?.byDow?.[shiftDow] || "";
            const availabilityResult = scorePostedAvailability(availabilityRaw, shift.startTime, shift.endTime);
            const desiredMeta = parseDesiredHours(availability?.desiredHours || "");

            const scheduleKey = caregiverId || caregiverName || candidateKey;
            const dayShifts = scheduleMapByCaregiver[scheduleKey]?.[shiftDow] ?? [];
            let conflictMinutes = 0;
            if (shiftRange) {
              for (const scheduled of dayShifts) {
                if (
                  normalizeKey(scheduled.client) === normalizeKey(shift.clientName) &&
                  normalizeKey(scheduled.date) === normalizeKey(shift.dateLabel) &&
                  normalizeKey(scheduled.startTime) === normalizeKey(shift.startTime) &&
                  normalizeKey(scheduled.endTime) === normalizeKey(shift.endTime)
                ) {
                  continue;
                }
                const scheduledRange = timeRangeToMinutes(scheduled.startTime, scheduled.endTime);
                if (!scheduledRange) continue;
                conflictMinutes += overlapMinutes(shiftRange, scheduledRange);
              }
            }

            const totalHours = totalHoursByCaregiver[scheduleKey] || 0;
            const historyCount =
              historyByCaregiverName[normalizeKey(caregiverName)] ||
              historyByCaregiverName[normalizeKey(profile?.nameOnSchedule)] ||
              historyByCaregiverName[normalizeKey(profile?.name)] ||
              0;

            const breakdown = {
              availability: availabilityResult.score,
              conflict: conflictScoreFromMinutes(conflictMinutes),
              history: historyScore(historyCount),
              drive_time: 0,
              desired_hours: desiredHoursFitScore(desiredMeta, totalHours, shift.hours),
              hours_penalty: fortyHourPenalty(totalHours, shift.hours),
            };
            const totalScore =
              breakdown.availability +
              breakdown.conflict +
              breakdown.history +
              breakdown.drive_time +
              breakdown.desired_hours +
              breakdown.hours_penalty;

            return {
              key: `${shift.key}-${scheduleKey}`,
              caregiverId,
              caregiverName,
              availabilityRaw,
              availabilityLabel: availabilityResult.label,
              desiredHours: availability?.desiredHours || "",
              totalHours,
              dayShiftCount: dayShifts.length,
              historyCount,
              conflictMinutes,
              totalScore,
              breakdown,
            } as ShiftInsightCandidate;
          })
          .filter((candidate) => norm(candidate.caregiverName))
          .sort((a, b) => b.totalScore - a.totalScore || fullNameSortKey(a.caregiverName).localeCompare(fullNameSortKey(b.caregiverName)));

        const overlapCount = rawShifts.filter((other) => {
          if (other.key === shift.key) return false;
          if (normalizeKey(other.dateLabel) !== normalizeKey(shift.dateLabel)) return false;
          const otherRange = timeRangeToMinutes(other.startTime, other.endTime);
          if (!shiftRange || !otherRange) return false;
          return overlapMinutes(shiftRange, otherRange) > 0;
        }).length;

        return {
          ...shift,
          overlapCount,
          avgScore: buildAverageScore(candidates),
          topScore: candidates.length ? candidates[0].totalScore : null,
          candidateCount: candidates.length,
          candidates,
        };
      })
      .sort((a, b) => {
        const aNeeds = a.statusLabel === "Needs Attention" ? 0 : 1;
        const bNeeds = b.statusLabel === "Needs Attention" ? 0 : 1;
        if (aNeeds !== bNeeds) return aNeeds - bNeeds;
        const da = buildScheduledDate(a.dateLabel, a.startTime)?.getTime() ?? 0;
        const db = buildScheduledDate(b.dateLabel, b.startTime)?.getTime() ?? 0;
        if (da !== db) return da - db;
        return fullNameSortKey(a.clientName).localeCompare(fullNameSortKey(b.clientName));
      });

    return built;
  }, [
    gridData,
    search,
    availabilityRows,
    caregiverProfiles,
    scheduleRows,
    historyByClient,
    availabilityById,
    availabilityByName,
    caregiverProfileByKey,
    scheduleMapByCaregiver,
    totalHoursByCaregiver,
  ]);

  useEffect(() => {
    if (!shifts.length) {
      setSelectedShiftKey(null);
      return;
    }
    setSelectedShiftKey((prev) => (prev && shifts.some((shift) => shift.key === prev) ? prev : shifts[0].key));
  }, [shifts]);

  const selectedShift = useMemo(
    () => shifts.find((shift) => shift.key === selectedShiftKey) || null,
    [shifts, selectedShiftKey]
  );
  const selectedClientProfile = useMemo(
    () => (selectedShift ? clientsByName[normalizeKey(selectedShift.clientName)] || null : null),
    [clientsByName, selectedShift]
  );

  const overallAverage = useMemo(() => {
    const vals = shifts.map((shift) => shift.avgScore).filter((value): value is number => value != null);
    if (!vals.length) return null;
    return vals.reduce((sum, value) => sum + value, 0) / vals.length;
  }, [shifts]);

  if (!open) return null;

  const isGhost = peekMode;
  const bodyBg = isGhost
    ? "linear-gradient(180deg, rgba(255,224,138,0.20) 0%, rgba(255,210,77,0.14) 100%)"
    : "linear-gradient(180deg, #ffe08a 0%, #ffd24d 100%)";
  const panelGlassBg = isGhost ? "rgba(255, 248, 219, 0.18)" : bodyBg;
  const panelHeaderBg = isGhost
    ? "linear-gradient(180deg, rgba(255,255,255,0.24) 0%, rgba(255,248,219,0.18) 100%)"
    : "linear-gradient(180deg, rgba(255,255,255,0.78) 0%, rgba(255,248,219,0.95) 100%)";

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(17,24,39,0.10)",
          zIndex: 1200,
        }}
      />

      <aside
        style={{
          position: "fixed",
          top: panelPos.y,
          left: panelPos.x,
          width: panelSize.width,
          height: panelSize.height,
          background: panelGlassBg,
          border: `2px solid ${UI.beeGoldDark}`,
          borderRadius: 20,
          boxShadow: isGhost ? "0 20px 60px rgba(22,37,63,0.20)" : "0 24px 80px rgba(22,37,63,0.28)",
          zIndex: 1201,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          onMouseDown={beginDrag}
          style={{
            padding: 12,
            borderBottom: `2px solid rgba(22,37,63,0.12)`,
            background: panelHeaderBg,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            cursor: "move",
            userSelect: "none",
          }}
        >
          <div>
            <div style={{ fontSize: 17, fontWeight: 1000, color: UI.text }}>🧠 Supraesophageal Ganglion</div>
            <div style={{ marginTop: 2, fontSize: 12, color: UI.textDim, fontWeight: 700 }}>
              Shift workpad with scoring insight
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={() => setPeekMode((v) => !v)} style={ghostButtonStyle(peekMode)}>
              {peekMode ? "Solid" : "Glass"}
            </button>
            <button type="button" onClick={() => onWeekChange?.("cw")} style={weekPill(week === "cw")}>
              CW
            </button>
            <button type="button" onClick={() => onWeekChange?.("nw")} style={weekPill(week === "nw")}>
              NW
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{
                border: `1px solid ${UI.border}`,
                background: "#fff",
                color: UI.text,
                borderRadius: 10,
                padding: "8px 10px",
                fontWeight: 900,
                cursor: "pointer",
              }}
            >
              Close
            </button>
          </div>
        </div>

        <div style={{ padding: "10px 10px 0 10px", borderBottom: `1px solid ${UI.borderSoft}`, display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
            <MiniStat label="Shifts" value={String(shifts.length)} />
            <MiniStat
              label="Open"
              value={String(shifts.filter((shift) => shift.statusLabel === "Needs Attention").length)}
            />
            <MiniStat label="Avg Score" value={overallAverage == null ? "—" : overallAverage.toFixed(1)} />
            <MiniStat label="Selected" value={selectedShift ? selectedShift.clientName : "—"} />
          </div>

          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search shifts, client, caregiver, status..."
            style={{
              width: "100%",
              border: `1px solid ${UI.border}`,
              borderRadius: 14,
              padding: "10px 12px",
              fontSize: 13,
              fontWeight: 700,
              outline: "none",
              color: UI.text,
              background: isGhost ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.92)",
            }}
          />
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.08fr) minmax(0, 0.92fr)",
            gap: 0,
          }}
        >
          <div
            style={{
              minHeight: 0,
              overflowY: "auto",
              padding: 10,
              display: "grid",
              gap: 8,
              borderRight: `1px solid ${UI.borderSoft}`,
            }}
          >
            {loading ? (
              <PanelMessage isGhost={isGhost}>Loading shift workpad…</PanelMessage>
            ) : error ? (
              <PanelMessage isGhost={isGhost} danger>{error}</PanelMessage>
            ) : !shifts.length ? (
              <PanelMessage isGhost={isGhost}>No shifts found for this week.</PanelMessage>
            ) : (
              shifts.map((shift) => {
                const statusTone = statusColors(shift.statusLabel);
                const active = selectedShiftKey === shift.key;
                return (
                  <button
                    key={shift.key}
                    type="button"
                    onClick={() => setSelectedShiftKey(shift.key)}
                    style={{
                      textAlign: "left",
                      cursor: "pointer",
                      border: `1px solid ${active ? UI.beeGoldDark : statusTone.border}`,
                      background: active ? "rgba(255,255,255,0.96)" : statusTone.bg,
                      borderRadius: 14,
                      padding: "12px 13px",
                      display: "grid",
                      gap: 9,
                      boxShadow: active ? "0 0 0 2px rgba(244,197,66,0.20)" : "none",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 15,
                            fontWeight: 1000,
                            color: UI.text,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {shift.clientName}
                        </div>
                        <div style={{ marginTop: 3, fontSize: 12, color: UI.textDim, fontWeight: 800 }}>
                          {[shift.dayLabel, shift.dateLabel].filter(Boolean).join(" • ")}
                        </div>
                      </div>

                      <span
                        style={{
                          background: "#fff",
                          color: statusTone.color,
                          borderRadius: 999,
                          padding: "4px 8px",
                          fontWeight: 950,
                          fontSize: 10.5,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {shift.statusLabel}
                      </span>
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(0, 1fr) repeat(5, auto)",
                        gap: 10,
                        alignItems: "center",
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 1000, color: statusTone.color }}>
                          {shift.startTime} - {shift.endTime}
                        </div>
                        <div
                          style={{
                            marginTop: 2,
                            fontSize: 12,
                            fontWeight: 800,
                            color: UI.textDim,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {shift.caregiverName || "Open shift"}
                        </div>
                      </div>

                      <MetricPill label="Hours" value={shift.hours.toFixed(1)} />
                      <MetricPill label="Overlap" value={String(shift.overlapCount)} />
                      <MetricPill label="Avg" value={shift.avgScore == null ? "—" : shift.avgScore.toFixed(1)} />
                      <MetricPill label="Top" value={shift.topScore == null ? "—" : String(shift.topScore)} />
                      <MetricPill label="Fits" value={String(shift.candidateCount)} />
                    </div>
                  </button>
                );
              })
            )}
          </div>

          <div
            style={{
              minHeight: 0,
              overflowY: "auto",
              padding: 10,
              display: "grid",
              gap: 10,
            }}
          >
            {!selectedShift ? (
              <PanelMessage isGhost={isGhost}>Select a shift to see the fit breakdown.</PanelMessage>
            ) : (
              <>
                <section style={detailCardStyle(isGhost)}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 20, lineHeight: 1.1, fontWeight: 1000, color: UI.text }}>
                        {selectedShift.clientName}
                      </div>
                      <div style={{ marginTop: 5, fontSize: 12.5, color: UI.textDim, fontWeight: 800 }}>
                        {[selectedShift.dayLabel, selectedShift.dateLabel].filter(Boolean).join(" • ")}
                      </div>
                    </div>
                    <span
                      style={{
                        background: statusColors(selectedShift.statusLabel).bg,
                        color: statusColors(selectedShift.statusLabel).color,
                        borderRadius: 999,
                        padding: "5px 9px",
                        fontWeight: 950,
                        fontSize: 11,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {selectedShift.statusLabel}
                    </span>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
                    <MiniStat label="Start" value={selectedShift.startTime} />
                    <MiniStat label="End" value={selectedShift.endTime} />
                    <MiniStat label="Hours" value={selectedShift.hours.toFixed(1)} />
                  </div>

                  <div style={{ display: "grid", gap: 6 }}>
                    <InfoRow label="Current caregiver" value={selectedShift.caregiverName || "Open"} />
                    <InfoRow label="Other shifts at same time" value={String(selectedShift.overlapCount)} />
                    <InfoRow label="Average fit score" value={selectedShift.avgScore == null ? "—" : selectedShift.avgScore.toFixed(1)} />
                    <InfoRow label="Location" value={norm(selectedClientProfile?.location) || "—"} />
                    <InfoRow label="Rate" value={norm(selectedClientProfile?.rate) || "—"} />
                  </div>

                  {norm(selectedClientProfile?.description) ? (
                    <div style={{ fontSize: 12.5, color: UI.textDim, fontWeight: 700, lineHeight: 1.45 }}>
                      {selectedClientProfile?.description}
                    </div>
                  ) : null}
                </section>

                <section style={detailCardStyle(isGhost)}>
                  <div style={{ fontSize: 13, fontWeight: 1000, color: UI.text, textTransform: "uppercase", letterSpacing: 0.2 }}>
                    Best fit breakdown
                  </div>

                  {!selectedShift.candidates.length ? (
                    <div style={{ fontSize: 12.5, color: UI.textDim, fontWeight: 700 }}>
                      No caregiver candidates were available for this shift.
                    </div>
                  ) : (
                    <div style={{ display: "grid", gap: 8 }}>
                      {selectedShift.candidates.slice(0, 12).map((candidate, index) => (
                        <div
                          key={candidate.key}
                          style={{
                            border: `1px solid ${index === 0 ? "rgba(244,197,66,0.50)" : UI.borderSoft}`,
                            background: index === 0 ? "rgba(255,247,214,0.78)" : "rgba(255,255,255,0.86)",
                            borderRadius: 12,
                            padding: "10px 11px",
                            display: "grid",
                            gap: 8,
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 14, fontWeight: 1000, color: UI.text }}>
                                {index + 1}. {candidate.caregiverName}
                              </div>
                              <div style={{ marginTop: 2, fontSize: 11.5, color: UI.textDim, fontWeight: 800 }}>
                                {candidate.dayShiftCount} shift{candidate.dayShiftCount === 1 ? "" : "s"} that day • {candidate.totalHours.toFixed(1)}h this week
                              </div>
                            </div>
                            <div
                              style={{
                                minWidth: 54,
                                textAlign: "center",
                                borderRadius: 999,
                                background: "#fff",
                                border: `1px solid ${UI.border}`,
                                padding: "5px 8px",
                                fontSize: 13,
                                fontWeight: 1000,
                                color: UI.navy,
                              }}
                            >
                              {candidate.totalScore}
                            </div>
                          </div>

                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                            <ScoreToken label={`Availability ${candidate.breakdown.availability}`} tone={candidate.breakdown.availability >= 30 ? "good" : candidate.breakdown.availability > 0 ? "warn" : "bad"} />
                            <ScoreToken label={`Conflict ${candidate.breakdown.conflict}`} tone={candidate.conflictMinutes === 0 ? "good" : "bad"} />
                            <ScoreToken label={`History ${candidate.breakdown.history}`} tone={candidate.historyCount > 0 ? "good" : "neutral"} />
                            <ScoreToken label={`Desired ${candidate.breakdown.desired_hours}`} tone={candidate.breakdown.desired_hours > 0 ? "good" : "neutral"} />
                            <ScoreToken label={`40+ ${candidate.breakdown.hours_penalty}`} tone={candidate.breakdown.hours_penalty < 0 ? "bad" : "neutral"} />
                          </div>

                          <div style={{ display: "grid", gap: 4 }}>
                            <InfoRow label="Availability match" value={candidate.availabilityLabel} compact />
                            <InfoRow label="Posted availability" value={candidate.availabilityRaw || "—"} compact />
                            <InfoRow label="Client history" value={`${candidate.historyCount} prior shift${candidate.historyCount === 1 ? "" : "s"}`} compact />
                            <InfoRow label="Conflict overlap" value={`${candidate.conflictMinutes} min`} compact />
                            <InfoRow label="Desired hours" value={candidate.desiredHours || "—"} compact />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section style={detailCardStyle(isGhost)}>
                  <div style={{ fontSize: 13, fontWeight: 1000, color: UI.text, textTransform: "uppercase", letterSpacing: 0.2 }}>
                    Workpad notes
                  </div>
                  <div style={{ fontSize: 12.5, color: UI.textDim, fontWeight: 700, lineHeight: 1.45 }}>
                    This first pass makes the ganglion panel shift-first and pulls in the same scoring categories used in the shift popup for availability, conflicts, history, desired hours, and weekly load. Drive time is not yet included in this panel’s score.
                  </div>
                </section>
              </>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

function detailCardStyle(isGhost: boolean): React.CSSProperties {
  return {
    background: isGhost ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.92)",
    border: `1px solid ${isGhost ? "rgba(22,37,63,0.12)" : UI.borderSoft}`,
    borderRadius: 14,
    padding: 12,
    display: "grid",
    gap: 10,
  };
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        minWidth: 58,
        borderRadius: 10,
        border: `1px solid ${UI.borderSoft}`,
        background: "rgba(255,255,255,0.90)",
        padding: "6px 7px",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 10, color: UI.textDim, fontWeight: 900, textTransform: "uppercase" }}>{label}</div>
      <div style={{ marginTop: 2, fontSize: 12.5, color: UI.text, fontWeight: 1000 }}>{value}</div>
    </div>
  );
}

function InfoRow({
  label,
  value,
  compact,
}: {
  label: string;
  value: string;
  compact?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: compact ? "center" : "flex-start",
        gap: 10,
        fontSize: compact ? 11.5 : 12.5,
      }}
    >
      <div style={{ color: UI.textDim, fontWeight: 900 }}>{label}</div>
      <div style={{ color: UI.text, fontWeight: 800, textAlign: "right" }}>{value}</div>
    </div>
  );
}

function ScoreToken({
  label,
  tone,
}: {
  label: string;
  tone: "good" | "warn" | "bad" | "neutral";
}) {
  let background = "rgba(248,250,252,0.96)";
  let border = "rgba(148,163,184,0.18)";
  let color = "#475569";
  if (tone === "good") {
    background = "rgba(240,253,244,0.96)";
    border = "rgba(34,197,94,0.18)";
    color = "#166534";
  } else if (tone === "warn") {
    background = "rgba(255,251,235,0.96)";
    border = "rgba(245,158,11,0.18)";
    color = "#92400e";
  } else if (tone === "bad") {
    background = "rgba(254,242,242,0.96)";
    border = "rgba(239,68,68,0.18)";
    color = "#991b1b";
  }
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        minHeight: 30,
        padding: "6px 9px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 900,
        lineHeight: 1.1,
        whiteSpace: "nowrap",
        background,
        border: `1px solid ${border}`,
        color,
      }}
    >
      {label}
    </div>
  );
}

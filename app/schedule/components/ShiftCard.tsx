// app/schedule/components/ShiftCard.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import FloatingPanel from "@/app/schedule/components/FloatingPanel";

/** Keep this type local so CWWebSchedule doesn’t need to import from this file */
export type ShiftStatus =
  | "filled"
  | "offered"
  | "offering"
  | "considering"
  | "open"
  | "canceled"
  | "pending"
  | "none"
  | "requested"; // ✅ ghost/service-request outline

type WeekKind = "cw" | "nw";

type PopupShiftTarget = {
  shiftId: string;
  dateStr: string;
  clientName: string;
  caregiverName: string;
  caregiverId?: string;
  startTime: string;
  endTime: string;
  status: ShiftStatus;
};

export type EditHistoryOpenPayload = {
  shiftId: string;
  a1Key: string;
  clientName: string;
  dateStr: string;
  caregiverName: string;
  startTime: string;
  endTime: string;
  status: ShiftStatus;
  week: WeekKind;
};
type ClockEval = {
  state: "good" | "bad" | "none";
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  clockIn: Date | null;
  clockOut: Date | null;
  diffInMin: number | null;
  diffOutMin: number | null;
  reasons: string[];
};

type ShiftTimeState = "future" | "in_progress" | "past" | "unknown";

/**
 * Minimal interface for the shiftInfo engine.
 * ✅ Added OPTIONAL caregiverId so availability can match by ID when available.
 */
type ShiftInfoEngine = {
  getGridShiftInfo: (args: {
    clientName: string;
    dateStr: string;
    startTime: string;
    endTime: string;
    caregiverName: string;
    caregiverId?: string;
    isCancelled: boolean;
  }) => {
    // IDs + clocks
    shiftId?: string;
    clockEval?: ClockEval;
    timeState?: ShiftTimeState;
    inVerdict?: string | null;
    outVerdict?: string | null;

    // flags
    hasLocationIssue?: boolean;
    hasClockIssue?: boolean;
    isPastNoClocks?: boolean;
    isVerified?: boolean;
    showFlag?: boolean;

    // optional enrichments
    caregiverCertifications?: string[] | string | null;
    caregiverAvailabilityLabel?: string | null;
    caregiverAvailabilitySource?: string | null;

    // NOTE: We no longer rely on shiftInfo for drive time inside the Shift Menu.
    driveTimeText?: string | null;
    driveTimeMinutes?: number | null;

    weekHours?: number | null;
  } | null;
};

/** ---------- Messaging hook/interface (provided by parent or context) ---------- */
type MessagesUI = {
  openPanel: () => void;
  closePanel: () => void;

  openCompose: (req: {
    caregiverId: string;
    caregiverName?: string;
    category?: "General" | "Scheduling" | "Payroll";
    text?: string;
    replaceText?: boolean;
    focusComposer?: boolean;
  }) => void;
};

// ✅ Service Request "ghost shift" payload (from /api/service-requests)
type ServiceRequestGhost = {
  start: string;
  end: string;
  preferredCaregiver?: string;
  notes?: string;
  status?: string; // usually "Pending"
  timestamp?: string;
};

/** -------- Client History types (fetched by ShiftCard) -------- */
type ClientHistoryItem = {
  caregiverName: string;
  count: number;
  lastDate?: string | null;
};
type ClientHistoryResponse = {
  ok: boolean;
  clientName?: string;
  items?: ClientHistoryItem[];
  error?: string;
};

/** -------- Schedule fetching types (fetched by ShiftCard) -------- */
type RawValues = string[][];
type ScheduleShiftRow = {
  shiftId: string;
  date: string;
  client: string;
  caregiver: string;
  caregiverId: string;
  startTime: string;
  endTime: string;
  status: string;
  dow: number; // 0=Sun ... 6=Sat
};

/** -------- Availability fetching types (fetched by ShiftCard) -------- */
type AvailabilityApiResponse = {
  ok: boolean;
  values?: RawValues;
  tabName?: string;
  error?: string;
};

/** -------- Caregivers + Clients (for drive time) -------- */
type CaregiverProfile = {
  caregiverId: string;
  nameOnSchedule: string;
  name: string;
  status?: string;
  certification?: string | null;
  certifications?: string | string[] | null;
  address?: string | null;
};
type CaregiversApiResponse = {
  ok: boolean;
  caregivers?: CaregiverProfile[];
  error?: string;
};

type ClientProfile = {
  name: string;
  address?: string | null;
  location?: string | null;
  description?: string | null;
  rate?: string | null;
};
type ClientsApiResponse = {
  ok: boolean;

  headers?: string[];
  rows?: string[][];
  meta?: any;

  clients?: ClientProfile[];

  error?: string;
};

/** `/api/drive-time` current shape supports: { ok, minutes, durationText, ... } */
type DriveTimeApiResponse = {
  ok: boolean;
  minutes?: number | null;
  durationText?: string | null;
  text?: string | null;
  error?: string;
};

/** -------- Small in-memory caches so we don’t refetch endlessly -------- */
const clientHistoryCache = new Map<string, { ts: number; data: ClientHistoryItem[] }>();
const CLIENT_HISTORY_CACHE_MS = 5 * 60 * 1000;

const scheduleCache = new Map<string, { ts: number; data: ScheduleShiftRow[] }>();
const SCHEDULE_CACHE_MS = 2 * 60 * 1000;

const availabilityCache = new Map<string, { ts: number; data: { values: RawValues; tabName: string } }>();
const AVAILABILITY_CACHE_MS = 2 * 60 * 1000;

const caregiversCache = new Map<string, { ts: number; data: CaregiverProfile[] }>();
const CAREGIVERS_CACHE_MS = 5 * 60 * 1000;

const clientsCache = new Map<string, { ts: number; data: ClientProfile[] }>();
const CLIENTS_CACHE_MS = 10 * 60 * 1000;

// key = `${origin}|${destination}` (normalized)
const driveTimeCache = new Map<string, { ts: number; minutes: number | null; text: string | null }>();
const DRIVE_CACHE_MS = 30 * 60 * 1000;

function norm(v: any) {
  return (v ?? "").toString().trim();
}
function normalizeKey(v: any) {
  return norm(v).toLowerCase();
}
function containsCI(haystack: string, needle: string) {
  const h = (haystack || "").toLowerCase();
  const n = (needle || "").toLowerCase().trim();
  if (!n) return true;
  return h.includes(n);
}
function normalizeCellText(raw: unknown): string {
  const s = String(raw ?? "");
  return s.replace(/[“”]/g, '"');
}

function sanitizeCertificationValue(raw: string | string[] | null | undefined): string {
  const parts: string[] = Array.isArray(raw)
    ? raw.map((item: string) => norm(item))
    : norm(raw)
        .split(",")
        .map((item: string) => norm(item));

  return parts
    .filter(Boolean)
    .filter((item: string) => {
      const lowered = item.toLowerCase();
      return lowered !== "none" && lowered !== "n/a" && lowered !== "na" && lowered !== "no";
    })
    .join(", ");
}

/** Parse "Name, 7:00AM-10:00AM" or "7:00AM-10:00AM" */
function parseCaregiverFromCell(cellValue: string): string {
  const v = norm(cellValue);
  if (!v) return "";
  const s = normalizeCellText(v);
  const idx = s.indexOf(",");
  if (idx === -1) return "";
  const cg = s.slice(0, idx).replace(/[(")]/g, "").trim();
  if (!cg) return "";
  if (cg.toLowerCase() === "open") return "";
  return cg;
}

/** Pull the first time range found: 7:00AM-10:00AM */
function parseFirstTimeRange(cellValue: string): { start: string; end: string } | null {
  const s = normalizeCellText(cellValue);
  const m = s.match(/(\d{1,2}:\d{2}\s?[APMapm]{2})\s*-\s*(\d{1,2}:\d{2}\s?[APMapm]{2})/);
  if (!m) return null;
  return { start: m[1].replace(/\s+/g, ""), end: m[2].replace(/\s+/g, "") };
}

function parseCaregiverAndTime(value: string): { caregiver: string; timeLabel: string; start: string; end: string } | null {
  const v = norm(value);
  if (!v) return null;
  const tr = parseFirstTimeRange(v);
  if (!tr) return null;
  const caregiver = parseCaregiverFromCell(v);
  const timeLabel = `${tr.start}-${tr.end}`;
  return { caregiver, timeLabel, start: tr.start, end: tr.end };
}

function fmtNiceTime(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
function clockDisplayLabelForPastOrProgress(which: "in" | "out", state: ShiftTimeState, clockEval: ClockEval): string {
  if (which === "in") {
    if (clockEval.clockIn) return fmtNiceTime(clockEval.clockIn);
    return "No Clock In";
  }
  if (clockEval.clockOut) return fmtNiceTime(clockEval.clockOut);
  if (state === "in_progress") return "In progress";
  return "No Clock Out";
}

/** ---------- Verdict helpers (local to card) ---------- */
function normVerdict(v: any) {
  return norm(v).toLowerCase();
}
function verdictLabel(v: string) {
  const x = normVerdict(v);
  if (!x) return "";
  if (x === "on_site" || x === "onsite" || x === "on site") return "On site";
  if (x === "off_site" || x === "offsite" || x === "off site") return "Off site";
  if (x === "no_geofence") return "No geofence";
  if (x === "location_unavailable") return "Location unavailable";
  if (x === "unknown") return "Unknown";
  return v;
}
function isBadVerdict(v: string | null) {
  const x = normVerdict(v);
  if (!x) return false;
  return x === "off_site" || x === "offsite" || x === "no_geofence" || x === "location_unavailable";
}
function isUnderTimeVerdict(v: string | null) {
  const x = normVerdict(v);
  return x === "location_unavailable" || x === "unknown";
}
function isOffSite(v: string | null) {
  const x = normVerdict(v);
  return x === "off_site" || x === "offsite" || x === "off site";
}

function VerdictChip({ verdict }: { verdict: string | null }) {
  if (!verdict) return null;
  if (isUnderTimeVerdict(verdict)) return null;

  const label = verdictLabel(verdict);
  if (!label) return null;

  const offsite = isOffSite(verdict);
  const bad = isBadVerdict(verdict) || offsite;

  const bg = offsite
    ? "rgba(239,68,68,0.42)"
    : bad
      ? "rgba(245,158,11,0.28)"
      : "rgba(255,255,255,0.22)";

  const border = offsite
    ? "1px solid rgba(255,255,255,0.75)"
    : bad
      ? "1px solid rgba(255,255,255,0.55)"
      : "1px solid rgba(255,255,255,0.35)";

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        marginLeft: 4,
        padding: "1px 6px",
        borderRadius: 999,
        fontSize: 9.5,
        fontWeight: 950,
        lineHeight: 1.05,
        background: bg,
        border,
        color: "#fff",
        flex: "0 1 auto",
        minWidth: 0,
        maxWidth: "100%",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
      title={verdict || undefined}
    >
      {label}
    </span>
  );
}

function UnderTimeVerdictLine({ verdict }: { verdict: string | null }) {
  if (!verdict) return null;
  if (!isUnderTimeVerdict(verdict)) return null;

  return (
    <div
      style={{
        marginTop: 2,
        fontSize: 10.5,
        fontWeight: 900,
        opacity: 0.95,
        whiteSpace: "nowrap",
      }}
    >
      {verdictLabel(verdict)}
    </div>
  );
}

function ClockLine({ label, timeText, verdict }: { label: "IN" | "OUT"; timeText: string; verdict: string | null }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", flexWrap: "wrap", gap: 4, minWidth: 0, maxWidth: "100%" }}>
      <span style={{ display: "inline-flex", alignItems: "center", whiteSpace: "nowrap" }}>
        <strong style={{ marginRight: 4 }}>{label}:</strong> {timeText}
        <VerdictChip verdict={verdict} />
      </span>
      <UnderTimeVerdictLine verdict={verdict} />
    </span>
  );
}

/** ---------- Card sizing ---------- */
const CARD_COLLAPSED_HEIGHT = 35;
const CARD_EXPANDED_MIN_HEIGHT = 84;
const EMPTY_CELL_HEIGHT = 20;

/** ---------- Small UI bits ---------- */
function Pill({ children, clearMode = false }: { children: React.ReactNode; clearMode?: boolean }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        border: clearMode
          ? "1px solid rgba(255,255,255,0.16)"
          : "1px solid rgba(17,24,39,0.12)",
        borderRadius: 999,
        padding: "4px 10px",
        fontSize: 12,
        fontWeight: 900,
        color: "#111827",
        background: clearMode ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.85)",
        lineHeight: 1.1,
        whiteSpace: "nowrap",
        backdropFilter: clearMode ? "blur(4px)" : "none",
        WebkitBackdropFilter: clearMode ? "blur(4px)" : "none",
      }}
    >
      {children}
    </span>
  );
}

function Section({ title, right, children }: { title: React.ReactNode; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div
      style={{
        border: "1px solid rgba(17,24,39,0.10)",
        borderRadius: 14,
        padding: 12,
        background: "rgba(249,250,251,0.85)",
        color: "#111827",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 950, color: "#111827" }}>{title}</div>
        {right ?? null}
      </div>
      <div style={{ marginTop: 10 }}>{children}</div>
    </div>
  );
}

function TinySpinner({ label }: { label?: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span
        aria-hidden="true"
        style={{
          width: 14,
          height: 14,
          borderRadius: 999,
          border: "2px solid rgba(17,24,39,0.22)",
          borderTopColor: "rgba(17,24,39,0.65)",
          animation: "bbspin 0.9s linear infinite",
          display: "inline-block",
        }}
      />
      {label ? <span style={{ fontWeight: 900, opacity: 0.8, color: "#111827" }}>{label}</span> : null}
      <style>{`@keyframes bbspin{to{transform:rotate(360deg)}}`}</style>
    </span>
  );
}

function SkeletonLine({ w = "70%" }: { w?: string }) {
  return (
    <div
      style={{
        height: 10,
        width: w,
        borderRadius: 999,
        background: "linear-gradient(90deg, rgba(15,23,42,0.06), rgba(15,23,42,0.12), rgba(15,23,42,0.06))",
        backgroundSize: "220% 100%",
        animation: "bbsheen 1.1s ease-in-out infinite",
      }}
    >
      <style>{`@keyframes bbsheen{0%{background-position:0% 0}100%{background-position:220% 0}}`}</style>
    </div>
  );
}

function formatMaybeDateLabel(v: string | null | undefined) {
  const s = norm(v);
  if (!s) return "—";
  return s;
}

/** ---------- Schedule normalization helpers ---------- */
function parseDateToDow(dateStr: string): number {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return 0;
  return d.getDay();
}

function normalizeClientsFromHeadersRows(headers: string[], rows: string[][]): ClientProfile[] {
  const H = (headers || []).map((h) => norm(h));
  const idx = (name: string) => H.findIndex((h) => h.toLowerCase() === name.toLowerCase());

  const iName = idx("Name");
  const iLocation = idx("Location"); // address lives here
  const iDescription = idx("Description");
  const iRate = idx("Rate");

  return (rows || [])
    .filter((r) => r.some((cell) => norm(cell) !== ""))
    .map((r) => {
      const name = norm(r[iName]);
      const address = norm(r[iLocation]) || null;

      return {
        name,
        address,
        location: address,
        description: norm(r[iDescription]) || null,
        rate: norm(r[iRate]) || null,
      };
    })
    .filter((c) => norm(c.name));
}

function normalizeSchedule(values: RawValues): ScheduleShiftRow[] {
  if (!values || values.length === 0) return [];
  const headers = values[0].map((h) => (h || "").trim());
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

  return rows
    .filter((r) => r.some((cell) => (cell || "").trim() !== ""))
    .map((r) => {
      const date = (r[iDate] ?? "").trim();
      return {
        shiftId: (r[iShiftId] ?? "").trim(),
        date,
        client: (r[iClient] ?? "").trim(),
        caregiver: (r[iCaregiver] ?? "").trim(),
        caregiverId: (r[iCaregiverId] ?? "").trim(),
        startTime: (r[iStart] ?? "").trim(),
        endTime: (r[iEnd] ?? "").trim(),
        status: (r[iStatus] ?? "").trim(),
        dow: parseDateToDow(date),
      };
    });
}

function dateKeyLoose(s: string): string {
  const raw = norm(s);
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;

  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** status string -> ShiftStatus */
function normalizeShiftStatusFromText(s: string): ShiftStatus {
  const x = norm(s).toLowerCase();

  if (x.includes("pending")) return "pending";
  if (x.includes("consider")) return "considering";
  if (x.includes("offer")) return "offered";
  if (x.includes("cancel")) return "canceled";
  if (x.includes("open")) return "open";
  if (x.includes("fill")) return "filled";

  if (x === "filled") return "filled";
  if (x === "offered") return "offered";
  if (x === "offering") return "offering";
  if (x === "considering") return "considering";
  if (x === "pending") return "pending";
  if (x === "canceled") return "canceled";
  if (x === "open") return "open";
  return "none";
}

/** ---- hours calc (handles overnight) ---- */
function parseTimeToMinutes(t: string): number | null {
  const raw = (t || "").trim();
  if (!raw) return null;

  const normalized = raw.replace(/\s+/g, " ").replace(/([AP]M)$/i, " $1").trim();
  const m = normalized.match(/^(\d{1,2})(?::(\d{2}))?\s*([AP]M)$/i);
  if (!m) return null;

  let hh = parseInt(m[1], 10);
  const mm = m[2] ? parseInt(m[2], 10) : 0;
  const ap = m[3].toUpperCase();

  if (hh < 1 || hh > 12 || mm < 0 || mm > 59) return null;

  if (ap === "AM") {
    if (hh === 12) hh = 0;
  } else {
    if (hh !== 12) hh += 12;
  }

  return hh * 60 + mm;
}

function shiftDurationHours(startTime: string, endTime: string): number {
  const start = parseTimeToMinutes(startTime);
  const end0 = parseTimeToMinutes(endTime);
  if (start == null || end0 == null) return 0;
  let end = end0;
  if (end <= start) end += 24 * 60;
  return Math.max(0, (end - start) / 60);
}

function safeNumber(n: any): number {
  const x = typeof n === "number" ? n : parseFloat((n ?? "").toString());
  return Number.isFinite(x) ? x : 0;
}

/** ---------- Desired Hours handling ---------- */
function isAsManyAsPossible(raw: string): boolean {
  const v = norm(raw).toLowerCase();
  return (
    v === "as many as possible" ||
    v.includes("as many as possible") ||
    v.includes("as much as possible") ||
    v.includes("as many as")
  );
}

type DesiredHoursMeta = {
  raw: string;
  wantsMax: boolean;
  min: number | null;
  max: number | null;
};

function parseDesiredHours(raw: string): DesiredHoursMeta {
  const v = norm(raw);

  if (!v) {
    return { raw: v, wantsMax: false, min: null, max: null };
  }

  if (isAsManyAsPossible(v)) {
    return { raw: v, wantsMax: true, min: null, max: null };
  }

  const range = v.match(/(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)/);
  if (range) {
    const min = safeNumber(range[1]);
    const max = safeNumber(range[2]);
    return {
      raw: v,
      wantsMax: false,
      min: Number.isFinite(min) ? min : null,
      max: Number.isFinite(max) ? max : null,
    };
  }

  const single = safeNumber(v);
  if (Number.isFinite(single) && single > 0) {
    return { raw: v, wantsMax: false, min: 0, max: single };
  }

  return { raw: v, wantsMax: false, min: null, max: null };
}

function desiredHoursFitScore(meta: DesiredHoursMeta, weeklyBefore: number, shiftHours: number): number {
  if (meta.wantsMax) return 10;
  if (meta.max == null) return 0;

  const weeklyAfter = weeklyBefore + shiftHours;

  // under desired max
  if (weeklyBefore < meta.max) return 10;

  // already within target window
  if (meta.min != null && weeklyBefore >= meta.min && weeklyBefore <= meta.max) return 10;

  // this shift puts them into the desired range
  if (meta.min != null && weeklyAfter >= meta.min && weeklyAfter <= meta.max) return 10;

  // already over desired max
  return 0;
}

function fortyHourPenalty(weeklyBefore: number, shiftHours: number): number {
  if (weeklyBefore > 40) return -5;
  if (weeklyBefore + shiftHours > 40) return -5;
  return 0;
}

/** ---------- Availability helpers ---------- */
function dayHeaderToDow(h: string): number | null {
  const raw = (h || "").trim().toLowerCase();
  if (!raw) return null;

  const cleaned = raw.split("(")[0].trim();
  const firstWord = cleaned.split(/\s+/)[0].trim();

  const map: Record<string, number> = {
    sunday: 0,
    sun: 0,
    monday: 1,
    mon: 1,
    tuesday: 2,
    tue: 2,
    tues: 2,
    wednesday: 3,
    wed: 3,
    thursday: 4,
    thu: 4,
    thur: 4,
    thurs: 4,
    friday: 5,
    fri: 5,
    saturday: 6,
    sat: 6,
  };

  return map[firstWord] ?? map[cleaned] ?? null;
}

type AvailabilityMatchType =
  | "exact"
  | "strong"
  | "partial"
  | "close"
  | "unclear"
  | "none";

type AvailabilityScoreResult = {
  type: AvailabilityMatchType;
  score: number;
  label: string;
};

function normalizeAvailabilityText(raw: string): string {
  return norm(raw)
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function isUnavailableAvailability(raw: string): boolean {
  const v = normalizeAvailabilityText(raw);
  if (!v) return true;

  return (
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

function isOpenAvailability(raw: string): boolean {
  const v = normalizeAvailabilityText(raw);
  if (!v) return false;

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

function shiftCrossesMidnight(startTime: string, endTime: string): boolean {
  const r = timeRangeToMinutes(startTime, endTime);
  if (!r) return false;
  return r.end > 24 * 60;
}

function getBroadAvailabilityWindow(raw: string): { start: number; end: number } | null {
  const v = normalizeAvailabilityText(raw);

  if (v.includes("morning")) {
    return { start: 6 * 60, end: 12 * 60 };
  }
  if (v.includes("afternoon") || v.includes("day time") || v.includes("daytime")) {
    return { start: 12 * 60, end: 18 * 60 };
  }
  if (v.includes("evening")) {
    return { start: 18 * 60, end: 23 * 60 };
  }

  return null;
}

function isOvernightAvailability(raw: string): boolean {
  const v = normalizeAvailabilityText(raw);
  return v.includes("overnight");
}

function parseAvailabilityWindows(raw: string): Array<{ start: number; end: number }> {
  const text = normalizeAvailabilityText(raw);
  if (!text) return [];

  const cleaned = text
    .replace(/\buntil\b/g, "to")
    .replace(/\btil\b/g, "to")
    .replace(/\./g, " ")
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const matches = Array.from(
    cleaned.matchAll(
      /(\d{1,2}(?::\d{2})?\s*[ap]m?|\d{1,2}(?::\d{2})?)\s*(?:-|to)\s*(\d{1,2}(?::\d{2})?\s*[ap]m?|\d{1,2}(?::\d{2})?)/gi
    )
  );

  const windows: Array<{ start: number; end: number }> = [];

  for (const m of matches) {
    const left = inferMeridiemTime(m[1], m[2], "start");
    const right = inferMeridiemTime(m[2], m[1], "end");
    const range = timeRangeToMinutes(left, right);
    if (range) windows.push(range);
  }

  return windows;
}

function inferMeridiemTime(value: string, otherSide?: string, side: "start" | "end" = "start"): string {
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

function scorePostedAvailability(raw: string, shiftStart: string, shiftEnd: string): AvailabilityScoreResult {
  const v = normalizeAvailabilityText(raw);
  const shiftRange = timeRangeToMinutes(shiftStart, shiftEnd);

  if (!shiftRange) {
    return { type: "none", score: 0, label: "No match" };
  }

  if (isUnavailableAvailability(v)) {
    return { type: "none", score: 0, label: "No match" };
  }

  if (isOpenAvailability(v)) {
    return { type: "exact", score: 40, label: "Exact match" };
  }

  const windows = parseAvailabilityWindows(v);
  for (const w of windows) {
    if (w.start <= shiftRange.start && w.end >= shiftRange.end) {
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
  for (const w of windows) {
    bestOverlap = Math.max(bestOverlap, overlapMinutes(shiftRange, w));
  }

  if (bestOverlap > 0) {
    if (bestOverlap >= shiftRange.end - shiftRange.start) {
      return { type: "exact", score: 40, label: "Exact match" };
    }
    return { type: "partial", score: 20, label: "Partial match" };
  }

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
function desiredHoursTarget(meta: DesiredHoursMeta): number | null {
  if (meta.wantsMax) return 40;
  if (meta.max != null) return meta.max;
  if (meta.min != null) return meta.min;
  return null;
}
function needsAvailabilityReview(matchType: AvailabilityMatchType, raw: string): boolean {
  if (matchType === "unclear") return true;

  const v = normalizeAvailabilityText(raw);
  return (
    v.includes("after ") ||
    v.includes("before ") ||
    v.includes("leave by") ||
    v.includes("until ") ||
    v.includes("til ")
  );
}
function isAvailabilityFilled(raw: string): boolean {
  const v = normalizeAvailabilityText(raw);
  if (!v) return false;
  if (isUnavailableAvailability(v)) return false;
  return true;
}

function availCategory(raw: string): "has_avail" | "no_avail" | "not_avail" {
  const v = normalizeAvailabilityText(raw);
  if (!v) return "no_avail";
  if (isUnavailableAvailability(v)) return "not_avail";
  return "has_avail";
}
function AvailabilityCell({ value }: { value: string }) {
  const v = (value || "").trim();
  if (!v || v === "—") {
    return <span style={{ color: "#94a3b8", fontWeight: 800 }}>—</span>;
  }

  const lower = v.toLowerCase();
  const isOff = lower === "off" || lower.includes("not available") || lower.includes("unavailable");
  const isOpen = lower === "open" || lower.includes("anytime") || lower.includes("available all day");

  let color = "#111827";
  let text = v;

  if (isOff) {
    color = "#991b1b";
    text = "Not available";
  } else if (isOpen) {
    color = "#166534";
    text = "Open";
  }

  return (
    <span
      style={{
        fontSize: 12,
        fontWeight: 850,
        color,
        whiteSpace: "pre-wrap",
        lineHeight: 1.25,
      }}
    >
      {text}
    </span>
  );
}

function AvailabilityPill({ label, source }: { label: string; source?: string }) {
  const hasLabel = Boolean(norm(label));
  const hasSource = Boolean(norm(source));

  if (!hasLabel && !hasSource) return null;

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 10,
        marginTop: 4,
        fontSize: 11,
        fontWeight: 800,
        color: "#64748b",
        lineHeight: 1.25,
      }}
    >
      {hasLabel ? (
        <span>
          <span style={{ color: "#475569", fontWeight: 950 }}>Match:</span> {label}
        </span>
      ) : null}

      {hasSource ? (
        <span>
          <span style={{ color: "#475569", fontWeight: 950 }}>Source:</span> {source}
        </span>
      ) : null}
    </div>
  );
}
function ScoreChip({
  label,
  tone = "neutral",
  title,
}: {
  label: string;
  tone?: "good" | "warn" | "bad" | "neutral";
  title?: string;
}) {
  let background = "rgba(248,250,252,0.96)";
  let border = "1px solid rgba(148,163,184,0.18)";
  let color = "#475569";

  if (tone === "good") {
    background = "rgba(240,253,244,0.96)";
    border = "1px solid rgba(34,197,94,0.18)";
    color = "#166534";
  } else if (tone === "warn") {
    background = "rgba(255,251,235,0.96)";
    border = "1px solid rgba(245,158,11,0.18)";
    color = "#92400e";
  } else if (tone === "bad") {
    background = "rgba(254,242,242,0.96)";
    border = "1px solid rgba(239,68,68,0.18)";
    color = "#991b1b";
  }

  return (
    <div
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        minHeight: 32,
        padding: "6px 10px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 900,
        lineHeight: 1.1,
        whiteSpace: "nowrap",
        background,
        border,
        color,
      }}
    >
      {label}
    </div>
  );
}
function buildScoreTooltip(cg: {
  availabilityMatchLabel: string;
  scoreBreakdown: {
    availability: number;
    conflict: number;
    history: number;
    drive_time: number;
    desired_hours: number;
    hours_penalty: number;
  };
  historyCount: number;
  driveTimeMinutes: number | null;
  driveTimeText?: string | null;
  totalHours: number;
}) {
  const driveText =
    cg.driveTimeMinutes != null
      ? `${Math.round(cg.driveTimeMinutes)} min`
      : norm(cg.driveTimeText) || "—";

  return [
    `Availability: ${cg.availabilityMatchLabel} (${cg.scoreBreakdown.availability})`,
    `Conflict: ${cg.scoreBreakdown.conflict}`,
    `History: ${cg.historyCount} visit(s) (${cg.scoreBreakdown.history})`,
    `Drive time: ${driveText} (${cg.scoreBreakdown.drive_time})`,
    `Desired hours: ${cg.scoreBreakdown.desired_hours}`,
    `40+ hours penalty: ${cg.scoreBreakdown.hours_penalty}`,
    `Current total hours: ${cg.totalHours.toFixed(1)}h`,
  ].join(" • ");
}
function MetaField({
  label,
  value,
  clearMode,
  multiline = false,
}: {
  label: string;
  value: React.ReactNode;
  clearMode: boolean;
  multiline?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: multiline ? "flex-start" : "center",
        justifyContent: "space-between",
        gap: 8,
        minHeight: multiline ? 44 : 36,
        padding: "7px 10px",
        borderRadius: 10,
        border: "1px solid rgba(17,24,39,0.08)",
        background: clearMode ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.62)",
        backdropFilter: clearMode ? "blur(1px)" : "none",
        WebkitBackdropFilter: clearMode ? "blur(1px)" : "none",
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 950,
          color: "#64748b",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>

      <div
        style={{
          minWidth: 0,
          flex: "1 1 auto",
          textAlign: "right",
          fontSize: 12,
          fontWeight: 850,
          color: "#111827",
          lineHeight: 1.25,
        }}
      >
        {value}
      </div>
    </div>
  );
}
/** ---------- Overlap + scoring helpers ---------- */
function timeRangeToMinutes(startTime: string, endTime: string): { start: number; end: number } | null {
  const s = parseTimeToMinutes(startTime);
  const e0 = parseTimeToMinutes(endTime);
  if (s == null || e0 == null) return null;
  let e = e0;
  if (e <= s) e += 24 * 60;
  return { start: s, end: e };
}
function overlapMinutes(a: { start: number; end: number }, b: { start: number; end: number }): number {
  const latestStart = Math.max(a.start, b.start);
  const earliestEnd = Math.min(a.end, b.end);
  return Math.max(0, earliestEnd - latestStart);
}
function historyScore(historyCount: number): number {
  if (historyCount >= 5) return 15;
  if (historyCount >= 3) return 10;
  if (historyCount >= 1) return 5;
  return 0;
}

function conflictScoreFromMinutes(mins: number): number {
  if (mins === 0) return 20;
  if (mins < 30) return 10;
  if (mins < 60) return 5;
  return 0;
}

function driveScoreFromMinutes(mins: number | null): number {
  if (mins == null || !Number.isFinite(mins)) return 0;
  if (mins <= 10) return 15;
  if (mins <= 20) return 10;
  if (mins <= 30) return 5;
  return 0;
}

/** ---------- Drive time helpers ---------- */
function driveCacheKey(origin: string, destination: string) {
  return `${normalizeKey(origin)}|${normalizeKey(destination)}`;
}

async function fetchDriveTime(
  endpoint: string,
  origin: string,
  destination: string,
  signal?: AbortSignal
): Promise<{ minutes: number | null; text: string | null }> {
  const o = norm(origin);
  const d = norm(destination);
  if (!o || !d) return { minutes: null, text: null };

  const key = driveCacheKey(o, d);
  const cached = driveTimeCache.get(key);
  if (cached && Date.now() - cached.ts < DRIVE_CACHE_MS) {
    return { minutes: cached.minutes, text: cached.text };
  }

  const qs = new URLSearchParams({ origin: o, destination: d });
  const url = `${endpoint}?${qs.toString()}`;

  const res = await fetch(url, {
    method: "GET",
    cache: "no-store",
    signal,
    headers: { Accept: "application/json" },
  });
  const rawText = await res.text();

  let json: DriveTimeApiResponse | any = null;
  try {
    json = rawText ? JSON.parse(rawText) : null;
  } catch {
    throw new Error(`Non-JSON response (${res.status}) from ${url}: ${rawText.slice(0, 180)}`);
  }

  if (!res.ok) throw new Error(json?.error || `Drive time request failed (${res.status})`);
  if (!json?.ok) throw new Error(json?.error || "Drive time request failed");

  const minutes = typeof json.minutes === "number" && Number.isFinite(json.minutes) ? json.minutes : null;
  const label = norm(json.durationText) || norm(json.text) || (minutes != null ? `${Math.round(minutes)} min` : null);

  driveTimeCache.set(key, { ts: Date.now(), minutes, text: label });
  return { minutes, text: label };
}

function MessageBubbleIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M20 14.5c0 1.4-1.1 2.5-2.5 2.5H9l-4 3v-3H6.5C5.1 17 4 15.9 4 14.5V7.5C4 6.1 5.1 5 6.5 5h11C19 5 20 6.1 20 7.5v7z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function InfoCircleIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M12 10.25v5.25"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="12" cy="7.25" r="1.15" fill="currentColor" />
    </svg>
  );
}

function LightbulbIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 18h6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M10 21h4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M8.8 14.8C7.7 13.9 7 12.5 7 11a5 5 0 1 1 10 0c0 1.5-.7 2.9-1.8 3.8-.7.6-1.2 1.3-1.5 2.2h-3.4c-.3-.9-.8-1.6-1.5-2.2Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function formatFriendlyDate(raw: string): string {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;

  const weekday = d.toLocaleDateString(undefined, { weekday: "long" });
  const day = d.getDate();

  function ordinal(n: number) {
    if (n > 3 && n < 21) return "th";
    switch (n % 10) {
      case 1:
        return "st";
      case 2:
        return "nd";
      case 3:
        return "rd";
      default:
        return "th";
    }
  }

  return `${weekday} the ${day}${ordinal(day)}`;
}

/** ---------- Component ---------- */
export default function ShiftCard({
  a1Key,
  value: rawValue,
  status: rawStatus,
  disabled,
  onRequestEdit,
  expanded,
  onToggleExpanded,
  dateStrForDow: rawDateStrForDow,
  clientName: rawClientName,
  shiftInfo,
  rowIsEmpty,
  cellBg,
  sheetColors,
  week,

   // ✅ history/rate affordance
// The parent can still pass hasEditHistory if needed, but the actual button
// visibility is now driven by whether this is a real shift with a shiftId.
hasEditHistory = false,
onOpenEditHistory,
  // ✅ new: ghost request payload(s) (only used when status === "requested")
  requests,

  messagesUI,
  defaultMessageCategory = "Scheduling",
  clientHistoryEndpoint = "/api/client-history",
  scheduleEndpoint = "/api/schedule",
  availabilityEndpoint = "/api/availability",
  caregiversEndpoint = "/api/caregivers",
  clientsEndpoint = "/api/clients",
  driveTimeEndpoint = "/api/drive-time",

  clientDescription = "",
  unpublishedCount = 0,
  popupOnly = false,
  popupTarget = null,
  onPopupOnlyClose,
  panelStorageKey,
  panelInitial,
}: {
  a1Key: string;
  value: string;
  status: ShiftStatus;
  disabled?: boolean;
  onRequestEdit: () => void;

  expanded: boolean;
  onToggleExpanded: () => void;

  dateStrForDow: string;
  clientName: string;

  shiftInfo: ShiftInfoEngine;

  rowIsEmpty: boolean;
  cellBg: string;

  sheetColors: Record<string, string>;
  week: WeekKind;

    hasEditHistory?: boolean;
  onOpenEditHistory?: (payload: EditHistoryOpenPayload) => void;

  requests?: ServiceRequestGhost[];
  messagesUI?: MessagesUI;

  defaultMessageCategory?: string;

  clientHistoryEndpoint?: string;
  scheduleEndpoint?: string;
  availabilityEndpoint?: string;

  caregiversEndpoint?: string;
  clientsEndpoint?: string;
  driveTimeEndpoint?: string;

  clientDescription?: string;
  unpublishedCount?: number;
  popupOnly?: boolean;
  popupTarget?: PopupShiftTarget | null;
  onPopupOnlyClose?: () => void;
  panelStorageKey?: string;
  panelInitial?: Partial<{ x: number; y: number; w: number; h: number }>;
}) {
const [showHoverHistoryIcon, setShowHoverHistoryIcon] = useState(false);
const value =
  popupOnly && popupTarget
    ? `${popupTarget.caregiverName || "Open"}, ${popupTarget.startTime}-${popupTarget.endTime}`
    : rawValue;
const status = popupOnly && popupTarget ? popupTarget.status : rawStatus;
const dateStrForDow = popupOnly && popupTarget ? popupTarget.dateStr : rawDateStrForDow;
const clientName = popupOnly && popupTarget ? popupTarget.clientName : rawClientName;

   const isRequested = status === "requested";

const v = norm(value);

// ✅ normalize request list (supports multiple requests in same cell)
const requestList = isRequested ? (Array.isArray(requests) ? requests : []) : [];
const firstReq = requestList[0] ?? null;

// ✅ requested-empty means: status=requested but no payload
const isRequestedEmpty = isRequested && requestList.length === 0;

// ✅ requested shifts are NOT "empty" visually even if value is blank,
// BUT if we have no request payload at all, treat as empty.
const isEmpty = (!v && !isRequested) || isRequestedEmpty;

// ✅ requested shifts use request payload for start/end (first request drives summary + matching)
const parsed = isRequested ? null : isEmpty ? null : parseCaregiverAndTime(v);

const start = isRequested ? norm(firstReq?.start) : parsed?.start ?? "";
const end = isRequested ? norm(firstReq?.end) : parsed?.end ?? "";

// For normal shifts, parsed.timeLabel is fine.
// For requested shifts, show first range + (+N) if multiple.
const timeLabel = isRequested
  ? start && end
    ? `${start}-${end}${requestList.length > 1 ? ` (+${requestList.length - 1})` : ""}`
    : ""
  : parsed?.timeLabel ?? "";

const caregiver = isRequested ? norm(firstReq?.preferredCaregiver) : parsed?.caregiver ?? "";
  const displayTime = timeLabel || "—";

// ✅ for ghost shifts show Pref if provided, else Requested
const displayCaregiver = isRequested ? (caregiver || "Requested") : caregiver ? caregiver : "Open";
 const isCancelled = status === "canceled";
const canBuildInfo = !isRequestedEmpty && Boolean(norm(start) && norm(end));

const info = canBuildInfo
  ? shiftInfo.getGridShiftInfo({
      clientName,
      dateStr: dateStrForDow,
      startTime: start,
      endTime: end,
      caregiverName: caregiver || "",
      isCancelled,
      // caregiverId: undefined,
    })
  : null;

const shiftId = norm(info?.shiftId);
  const clockEval =
    info?.clockEval ??
    ({
      state: "none",
      scheduledStart: null,
      scheduledEnd: null,
      clockIn: null,
      clockOut: null,
      diffInMin: null,
      diffOutMin: null,
      reasons: [],
    } as ClockEval);

  const tState = info?.timeState ?? "unknown";
  const inVerdict = info?.inVerdict ?? null;
  const outVerdict = info?.outVerdict ?? null;

  const hasLocationIssue = Boolean(info?.hasLocationIssue);
  const hasClockIssue = Boolean(info?.hasClockIssue);
  const isPastNoClocks = Boolean(info?.isPastNoClocks);

  // ✅ Future shifts should not show ✓ or 🚩
  const isVerified = Boolean(info?.isVerified) && tState !== "future";
  const showFlag = Boolean(info?.showFlag) && tState !== "future";

   // ✅ show the lightbulb shift-menu button for:
// - future real shifts
// - requested/ghost shifts that have usable times
const showInfoIcon =
  !isEmpty &&
  !isCancelled &&
  (tState === "future" || isRequested) &&
  !isRequestedEmpty &&
  Boolean(norm(start) && norm(end));

   // Base colors
  let bg = sheetColors[status] || "#111827";
  let fg = "#ffffff";

  if (isEmpty) {
    bg = cellBg;
    fg = "#9ca3af";
  }

  if (!isCancelled && !isEmpty && status === "filled" && tState === "future") {
    bg = "#16a34a";
  }

  if (isCancelled) {
    bg = "#e5e7eb";
    fg = "#111827";
  }

  // ✅ Ghost/requested styling overrides
  if (isRequested) {
    bg = "rgba(255,255,255,0.0)";          // transparent
    fg = "#9a3412";                         // orange-brown text
  }

     const hasClockGood = clockEval.state === "good";

  // Show the history/rate icon on every real shift that can load rate/history data.
// We do not require pre-existing edit history anymore because every real shift
// should be able to open the combined history + rate modal.
const showHistoryIcon =
  !isEmpty &&
  !isRequestedEmpty &&
  !isCancelled &&
  Boolean(shiftId);
  const isUnpublished = unpublishedCount > 0 && !isEmpty && !isCancelled && !isRequested;
   const border = isEmpty
    ? "none"
    : isRequested
      ? "2px dashed rgba(234,88,12,0.85)" // ✅ dashed outline
      : isCancelled
        ? "1px solid #cbd5e1"
        : isUnpublished
          ? "3px solid #1d4ed8"
        : hasLocationIssue || hasClockIssue || isPastNoClocks
          ? "2px solid #ef4444"
          : hasClockGood
            ? "2px solid #22c55e"
            : "1px solid rgba(255,255,255,0.35)";
  const shadow = isEmpty
    ? "none"
    : isRequested
      ? "0 0 0 2px rgba(234,88,12,0.10)" // ✅ subtle glow
      : isCancelled
        ? "0 1px 0 rgba(0,0,0,0.06)"
        : isUnpublished
          ? "0 0 0 3px rgba(37,99,235,0.28), 0 0 18px rgba(59,130,246,0.18)"
        : hasLocationIssue || hasClockIssue || isPastNoClocks
          ? "0 0 0 2px rgba(239,68,68,0.18)"
          : hasClockGood
            ? "0 0 0 2px rgba(34,197,94,0.18)"
            : "0 1px 0 rgba(0,0,0,0.08)";

  const inText = clockDisplayLabelForPastOrProgress("in", tState, clockEval);
  const outText = clockDisplayLabelForPastOrProgress("out", tState, clockEval);

const showClockRow = expanded && !isEmpty && !isCancelled && tState !== "future" && tState !== "unknown";
  const showCombinedNoClock = !isEmpty && !isCancelled && tState === "past" && !clockEval.clockIn && !clockEval.clockOut;

 /** ---------- Shift Menu (FloatingPanel) state ---------- */
const [menuOpen, setMenuOpen] = useState(Boolean(popupOnly));
const [popupWindows, setPopupWindows] = useState<
  Array<{ id: string; target: PopupShiftTarget; initial?: Partial<{ x: number; y: number; w: number; h: number }> }>
>([]);
const [showDesc, setShowDesc] = useState(false);
const [clearMode, setClearMode] = useState(false);
const currentPanelStorageKey = panelStorageKey ?? `shift-menu:${week}:${a1Key}`;

const isGlass = clearMode;

const popupShellBg = isGlass
  ? "rgba(255,255,255,0.01)"
  : "#f8fbff";

const popupSectionBg = isGlass
  ? "rgba(255,255,255,0.02)"
  : "rgba(255,255,255,0.92)";

const popupSoftBg = isGlass
  ? "rgba(255,255,255,0.03)"
  : "rgba(255,255,255,0.62)";

const popupButtonBg = isGlass
  ? "rgba(255,255,255,0.035)"
  : "rgba(255,255,255,0.82)";

const popupCardBg = isGlass
  ? "rgba(255,255,255,0.035)"
  : "#ffffff";

const popupBorder = isGlass
  ? "1px solid rgba(255,255,255,0.14)"
  : "1px solid rgba(15,23,42,0.10)";

const popupStrongBorder = isGlass
  ? "1px solid rgba(255,255,255,0.18)"
  : "1px solid rgba(17,24,39,0.10)";

const popupShadow = isGlass
  ? "0 8px 24px rgba(15,23,42,0.08)"
  : "0 6px 18px rgba(15,23,42,0.06)";

// Reduced blur for better visibility through the panel
const popupBlur = isGlass ? "blur(.01px)" : "none";
const popupLightBlur = isGlass ? "none" : "none";
  // Client history
  const [histLoading, setHistLoading] = useState(false);
  const [histError, setHistError] = useState<string>("");
  const [histItems, setHistItems] = useState<ClientHistoryItem[]>([]);

  // Week schedule
  const [weekSchedLoading, setWeekSchedLoading] = useState(false);
  const [weekSchedError, setWeekSchedError] = useState<string>("");
  const [weekSchedule, setWeekSchedule] = useState<ScheduleShiftRow[]>([]);

  // Availability
  const [availLoading, setAvailLoading] = useState(false);
  const [availError, setAvailError] = useState("");
  const [availValues, setAvailValues] = useState<RawValues>([]);
  const [availTabName, setAvailTabName] = useState<string>("");

  // Caregivers (for address/certs/name normalization)
  const [cgLoading, setCgLoading] = useState(false);
  const [cgError, setCgError] = useState("");
  const [caregiverProfiles, setCaregiverProfiles] = useState<CaregiverProfile[]>([]);

  // Clients (for destination address)
  const [clientsLoading, setClientsLoading] = useState(false);
  const [clientsError, setClientsError] = useState("");
  const [clientProfiles, setClientProfiles] = useState<ClientProfile[]>([]);

  // Drive time (explicit)
  const [driveLoading, setDriveLoading] = useState(false);
  const [driveError, setDriveError] = useState("");
  const [driveByCaregiverKey, setDriveByCaregiverKey] = useState<Record<string, { minutes: number | null; text: string | null }>>({});

  // Search + sorting
  const [caregiverSearch, setCaregiverSearch] = useState("");
  type SortMode =
    | "smart"
    | "cert_desc"
    | "history_desc"
    | "drive_asc"
    | "name_asc"
    | "avail_filled_desc"
    | "desired_desc"
    | "total_asc"
    | "gap_desc";
  const [sortMode, setSortMode] = useState<SortMode>("smart");

  // ✅ IMPORTANT UPDATE:
  // We ALWAYS show ALL ACTIVE caregivers (anyone on the schedule this week),
  // even if they have never been to this client, and even if they didn’t submit availability.
    const canOpenShiftMenu =
  !disabled &&
  !isEmpty &&
  !isCancelled &&
  !isRequestedEmpty &&
  ((tState === "future" && Boolean(parsed)) || (isRequested && Boolean(norm(start) && norm(end))));

   const shiftSummary = useMemo(() => {
  const hasTimes = !isRequestedEmpty && Boolean(norm(start) && norm(end));
  if (!hasTimes) return null;

  const requestedCount = isRequested ? requestList.length : 0;

  return {
    dateStr: dateStrForDow,
    time: `${start}-${end}${isRequested && requestedCount > 1 ? ` (+${requestedCount - 1})` : ""}`,
    caregiver: isRequested ? (caregiver || "Requested") : caregiver || "Open",
    client: clientName,
    start,
    end,

    // ✅ extra info for ghost shifts (multi)
    requestedCount,
    requestedStatus: isRequested ? (norm(firstReq?.status) || "Pending") : "",
    requestedNotes: isRequested
      ? requestList
          .map((r) => norm(r?.notes))
          .filter(Boolean)
          .join("\n\n")
      : "",
    requestedTimestamps: isRequested
      ? requestList
          .map((r) => norm(r?.timestamp))
          .filter(Boolean)
          .join(", ")
      : "",
  };
}, [start, end, caregiver, clientName, dateStrForDow, isRequested, isRequestedEmpty, requestList, firstReq]);

  function buildPrefillMessage(args: { caregiverName: string; caregiverId: string; note?: string }) {
    const { caregiverName, caregiverId, note } = args;

    const client = shiftSummary?.client ?? clientName;
    const rawDate = shiftSummary?.dateStr ?? dateStrForDow;
    const day = formatFriendlyDate(rawDate);

    const startTime = shiftSummary?.start ?? start;
    const endTime = shiftSummary?.end ?? end;

    let text = `Hi- are you available for a shift with ${client} on ${day} from ${startTime} to ${endTime}?`;
    if (note) text += `\n\n${note}`;

    return { caregiverId, caregiverName, category: defaultMessageCategory, text };
  }

  function openMessageToCaregiver(cg: { id: string; name: string }, note?: string) {
    if (!messagesUI) return;

    const caregiverId = norm(cg.id);
    const caregiverName = norm(cg.name) || "Caregiver";
    if (!caregiverId) return;

    const draft = buildPrefillMessage({ caregiverId, caregiverName, note });

    messagesUI.openCompose({
      caregiverId: draft.caregiverId,
      caregiverName: draft.caregiverName,
      category: (draft.category as any) || "Scheduling",
      text: draft.text,
      replaceText: true,
      focusComposer: true,
    });
  }

  /** ---------- client history fetch ---------- */
  async function loadClientHistory() {
    const key = normalizeKey(clientName);
    if (!key) return;

    const cached = clientHistoryCache.get(key);
    if (cached && Date.now() - cached.ts < CLIENT_HISTORY_CACHE_MS) {
      setHistItems(cached.data);
      setHistError("");
      setHistLoading(false);
      return;
    }

    setHistLoading(true);
    setHistError("");

    try {
      const qs = new URLSearchParams({ client: clientName });
      const endpoint = `${clientHistoryEndpoint}?${qs.toString()}`;

      const res = await fetch(endpoint, { method: "GET", cache: "no-store", headers: { Accept: "application/json" } });
      const text = await res.text();

      let json: ClientHistoryResponse | any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        throw new Error(`Non-JSON response (${res.status}) from ${endpoint}: ${text.slice(0, 180)}`);
      }

      if (!res.ok) throw new Error(json?.error || `Client history request failed (${res.status})`);
      if (!json?.ok) throw new Error(json?.error || "Client history request failed");

      const items = Array.isArray(json.items) ? json.items : [];
const cleaned = items
  .map((x: any) => ({
    caregiverName: norm(x?.caregiverName),
    count: Number(x?.count) || 0,
    lastDate: norm(x?.lastDate) || null,
  }))
  .filter((x: { caregiverName: string }) => Boolean(x.caregiverName));

setHistItems(cleaned);
clientHistoryCache.set(key, { ts: Date.now(), data: cleaned });
    } catch (e: any) {
      setHistError(e?.message || "Failed to load client history");
      setHistItems([]);
    } finally {
      setHistLoading(false);
    }
  }

  /** ---------- schedule fetch (weekly, cached) ---------- */
  async function loadWeekSchedule() {
    const weekKey = week || "cw";
    const cached = scheduleCache.get(weekKey);
    if (cached && Date.now() - cached.ts < SCHEDULE_CACHE_MS) {
      setWeekSchedule(cached.data);
      setWeekSchedError("");
      setWeekSchedLoading(false);
      return;
    }

    setWeekSchedLoading(true);
    setWeekSchedError("");

    try {
      const url = `${scheduleEndpoint}?week=${encodeURIComponent(weekKey)}`;
      const res = await fetch(url, { method: "GET", cache: "no-store", headers: { Accept: "application/json" } });
      const text = await res.text();

      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        throw new Error(`Non-JSON response (${res.status}) from ${url}: ${text.slice(0, 180)}`);
      }

      if (!res.ok) throw new Error(json?.error || `Schedule request failed (${res.status})`);
      if (!json?.ok) throw new Error(json?.error || "Schedule request failed");

      const values: RawValues = Array.isArray(json.values) ? json.values : [];
      const all = normalizeSchedule(values);

      scheduleCache.set(weekKey, { ts: Date.now(), data: all });
      setWeekSchedule(all);
      setWeekSchedError("");
    } catch (e: any) {
      setWeekSchedError(e?.message || "Failed to load schedule");
      setWeekSchedule([]);
    } finally {
      setWeekSchedLoading(false);
    }
  }

  /** ---------- availability fetch (cached) ---------- */
  async function loadAvailability() {
    const weekKey = week || "cw";
    const cached = availabilityCache.get(weekKey);
    if (cached && Date.now() - cached.ts < AVAILABILITY_CACHE_MS) {
      setAvailValues(cached.data.values);
      setAvailTabName(cached.data.tabName);
      setAvailError("");
      setAvailLoading(false);
      return;
    }

    setAvailLoading(true);
    setAvailError("");

    try {
      const url = `${availabilityEndpoint}?week=${encodeURIComponent(weekKey)}`;
      const res = await fetch(url, { method: "GET", cache: "no-store" });
      const text = await res.text();

      let json: AvailabilityApiResponse | any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        throw new Error(`Non-JSON response (${res.status}) from ${url}: ${text.slice(0, 180)}`);
      }

      if (!res.ok) throw new Error(json?.error || `Availability request failed (${res.status})`);
      if (!json?.ok) throw new Error(json?.error || "Failed to load availability");

      const values: RawValues = Array.isArray(json.values) ? json.values : [];
      const tabName = norm(json.tabName) || (weekKey === "cw" ? "CW Availability" : "NW Availability");

      setAvailValues(values);
      setAvailTabName(tabName);
      availabilityCache.set(weekKey, { ts: Date.now(), data: { values, tabName } });
    } catch (e: any) {
      setAvailError(e?.message || "Failed to load availability");
      setAvailValues([]);
      setAvailTabName("");
    } finally {
      setAvailLoading(false);
    }
  }

  /** ---------- caregivers fetch ---------- */
  async function loadCaregivers() {
    const key = "all";
    const cached = caregiversCache.get(key);
    if (cached && Date.now() - cached.ts < CAREGIVERS_CACHE_MS) {
      setCaregiverProfiles(cached.data);
      setCgError("");
      setCgLoading(false);
      return;
    }

    setCgLoading(true);
    setCgError("");

    try {
      const res = await fetch(caregiversEndpoint, { method: "GET", cache: "no-store", headers: { Accept: "application/json" } });
      const text = await res.text();

      let json: CaregiversApiResponse | any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        throw new Error(`Non-JSON response (${res.status}) from ${caregiversEndpoint}: ${text.slice(0, 180)}`);
      }

      if (!res.ok) throw new Error(json?.error || `Caregivers request failed (${res.status})`);
      if (!json?.ok) throw new Error(json?.error || "Caregivers request failed");

      const arr = Array.isArray(json.caregivers) ? json.caregivers : [];
      const cleaned: CaregiverProfile[] = arr.map((c: any) => ({
        caregiverId: norm(c?.caregiverId),
        nameOnSchedule: norm(c?.nameOnSchedule),
        name: norm(c?.name),
        status: norm(c?.status),
        certification: norm(c?.certification) || null,
        certifications: c?.certifications ?? c?.certification ?? null,
        address: norm(c?.address) || null,
      }));

      setCaregiverProfiles(cleaned);
      caregiversCache.set(key, { ts: Date.now(), data: cleaned });
    } catch (e: any) {
      setCgError(e?.message || "Failed to load caregivers");
      setCaregiverProfiles([]);
    } finally {
      setCgLoading(false);
    }
  }

  /** ---------- clients fetch ---------- */
  async function loadClients() {
    const key = "all";
    const cached = clientsCache.get(key);
    if (cached && Date.now() - cached.ts < CLIENTS_CACHE_MS) {
      setClientProfiles(cached.data);
      setClientsError("");
      setClientsLoading(false);
      return;
    }

    setClientsLoading(true);
    setClientsError("");

    try {
      const res = await fetch(clientsEndpoint, { method: "GET", cache: "no-store", headers: { Accept: "application/json" } });
      const text = await res.text();

      let json: ClientsApiResponse | any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        throw new Error(`Non-JSON response (${res.status}) from ${clientsEndpoint}: ${text.slice(0, 180)}`);
      }

      if (!res.ok) throw new Error(json?.error || `Clients request failed (${res.status})`);
      if (!json?.ok) throw new Error(json?.error || "Clients request failed");

      let cleaned: ClientProfile[] = [];

      if (Array.isArray(json.headers) && Array.isArray(json.rows)) {
        cleaned = normalizeClientsFromHeadersRows(json.headers, json.rows);
      } else if (Array.isArray(json.clients)) {
        cleaned = json.clients.map((c: any) => {
          const address = norm(c?.address) || norm(c?.location) || null;
          return {
            name: norm(c?.name),
            address,
            location: address,
            description: norm(c?.description) || null,
            rate: norm(c?.rate) || null,
          };
        });
      }

      setClientProfiles(cleaned);
      clientsCache.set(key, { ts: Date.now(), data: cleaned });
    } catch (e: any) {
      setClientsError(e?.message || "Failed to load clients");
      setClientProfiles([]);
    } finally {
      setClientsLoading(false);
    }
  }

  function openShiftMenu() {
  if (!canOpenShiftMenu) return;
  setMenuOpen(true);
}
function readPanelRect(storageKey: string) {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      x: Number(parsed.x) || undefined,
      y: Number(parsed.y) || undefined,
      w: Number(parsed.w) || undefined,
      h: Number(parsed.h) || undefined,
    };
  } catch {
    return null;
  }
}
function openNestedShiftMenu(target: PopupShiftTarget) {
  if (!norm(target.startTime) || !norm(target.endTime)) return;

  const baseRect = readPanelRect(currentPanelStorageKey);
  const baseX = baseRect?.x ?? 40;
  const baseY = baseRect?.y ?? 40;
  const baseW = baseRect?.w ?? 720;
  const baseH = baseRect?.h ?? 520;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1440;
  const childX = Math.min(baseX + baseW + 20, Math.max(12, vw - baseW - 12));

  const normalizedTarget: PopupShiftTarget = {
    shiftId: norm(target.shiftId),
    dateStr: norm(target.dateStr),
    clientName: norm(target.clientName),
    caregiverName: norm(target.caregiverName),
    caregiverId: norm(target.caregiverId) || undefined,
    startTime: norm(target.startTime),
    endTime: norm(target.endTime),
    status: target.status,
  };

  setPopupWindows((prev) => [
    ...prev,
    {
      id: `${Date.now()}-${prev.length + 1}-${normalizedTarget.shiftId || normalizedTarget.clientName}`,
      target: normalizedTarget,
      initial: { x: childX, y: baseY, w: baseW, h: baseH },
    },
  ]);
}

  // Load menu data when menu opens
  useEffect(() => {
  if (!menuOpen) {
    if (popupOnly) onPopupOnlyClose?.();
    return;
  }

  setCaregiverSearch("");
  setShowDesc(false);
  setSortMode("smart");

  loadClientHistory();
  loadWeekSchedule();
  loadAvailability();
  loadCaregivers();
  loadClients();

  setDriveError("");
  setDriveLoading(false);
  setDriveByCaregiverKey({});
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [menuOpen, popupOnly, onPopupOnlyClose, clientName]);

  // ESC closes this panel
useEffect(() => {
  if (!menuOpen) return;

  function onKey(e: KeyboardEvent) {
    if (e.key !== "Escape") return;
    setMenuOpen(false);
  }

  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, [menuOpen]);

  /** ---------- Click / dblclick ---------- */
  const clickTimerRef = useRef<number | null>(null);

  function handleClick() {
    if (disabled) return;
    if (clickTimerRef.current) window.clearTimeout(clickTimerRef.current);

    clickTimerRef.current = window.setTimeout(() => {
      clickTimerRef.current = null;
      onRequestEdit();
    }, 220);
  }

  function handleDoubleClick(e: React.MouseEvent) {
    if (disabled) return;

    e.preventDefault();
    e.stopPropagation();

    if (clickTimerRef.current) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }

    // ✅ Future shifts: open Shift Menu
    if (canOpenShiftMenu) {
      openShiftMenu();
      return;
    }

    // ✅ Past / In-progress: double click toggles clock expansion
    onToggleExpanded();
  }

  const titleText =
    tState === "future" ? "Click to edit • Double click for shift menu" : "Click to edit • Double click to toggle clocks";

      function handleOpenEditHistory(e: React.MouseEvent | React.KeyboardEvent) {
  e.preventDefault();
  e.stopPropagation();

  if (!showHistoryIcon) return;
  if (!onOpenEditHistory) return;
  if (!shiftId) return;

  const safeStart = norm(start);
  const safeEnd = norm(end);
  if (!safeStart || !safeEnd) return;

  onOpenEditHistory({
    shiftId,
    a1Key,
    clientName,
    dateStr: dateStrForDow,
    caregiverName: displayCaregiver,
    startTime: safeStart,
    endTime: safeEnd,
    status,
    week,
  });
}
  /** ---------- Derived data for caregiver list ---------- */
  const histByNameKey = useMemo(() => {
    const m = new Map<string, { count: number; lastDate: string | null }>();
    for (const h of histItems) {
      const k = normalizeKey(h.caregiverName);
      if (!k) continue;
      m.set(k, { count: Number(h.count) || 0, lastDate: norm(h.lastDate) || null });
    }
    return m;
  }, [histItems]);

  const caregiverProfileByAnyKey = useMemo(() => {
    const m: Record<string, CaregiverProfile> = {};
    for (const c of caregiverProfiles) {
      const id = normalizeKey(c.caregiverId);
      const nm = normalizeKey(c.name);
      const nos = normalizeKey(c.nameOnSchedule);

      if (id) m[id] = c;
      if (nm) m[nm] = c;
      if (nos) m[nos] = c;
    }
    return m;
  }, [caregiverProfiles]);

  const histByIdKey = useMemo(() => {
    const m = new Map<string, { count: number; lastDate: string | null }>();
    if (!caregiverProfiles.length) return m;

    const byNameKey: Record<string, CaregiverProfile> = {};
    for (const cg of caregiverProfiles) {
      const id = norm(cg.caregiverId);
      const name = norm(cg.name);
      const nos = norm(cg.nameOnSchedule);

      if (name) byNameKey[normalizeKey(name)] = cg;
      if (nos) byNameKey[normalizeKey(nos)] = cg;
      if (id) byNameKey[normalizeKey(id)] = cg;
    }

    for (const [nameKey, hist] of histByNameKey.entries()) {
      const prof = byNameKey[nameKey];
      const id = prof ? norm(prof.caregiverId) : "";
      if (id) m.set(normalizeKey(id), hist);
    }
    return m;
  }, [histByNameKey, caregiverProfiles]);

  const selectedDow = useMemo(() => parseDateToDow(dateStrForDow), [dateStrForDow]);

  const scheduleMap = useMemo(() => {
    const map: Record<string, Record<number, ScheduleShiftRow[]>> = {};
    for (const s of weekSchedule) {
      const cgId = norm(s.caregiverId);
      const cgName = norm(s.caregiver);

      if (cgId.toLowerCase() === "open") continue;
      if (!cgId && cgName.toLowerCase() === "open") continue;

      const key = (cgId || cgName).trim();
      if (!key) continue;

      if (!map[key]) map[key] = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
      map[key][s.dow].push(s);
    }

    for (const k of Object.keys(map)) {
      for (let d = 0; d <= 6; d++) {
        map[k][d].sort((a, b) => (a.startTime || "").localeCompare(b.startTime || ""));
      }
    }
    return map;
  }, [weekSchedule]);

  const scheduleHoursByCaregiverKey = useMemo(() => {
    const out: Record<string, number> = {};
    for (const s of weekSchedule) {
      const cgId = norm(s.caregiverId);
      const cgName = norm(s.caregiver);
      if (cgId.toLowerCase() === "open") continue;
      if (!cgId && cgName.toLowerCase() === "open") continue;

      const key = (cgId || cgName).trim();
      if (!key) continue;

      out[key] = (out[key] ?? 0) + shiftDurationHours(s.startTime, s.endTime);
    }
    return out;
  }, [weekSchedule]);

  /** ---------- Availability parsing (enrichment only) ---------- */
  const availHeaders = useMemo(() => (availValues?.[0] ?? []).map((h) => norm(h)), [availValues]);
  const availRowsAll = useMemo(() => (availValues?.length ? availValues.slice(1) : []), [availValues]);

  const caregiverNameIdx = useMemo(() => availHeaders.findIndex((h) => h.toLowerCase() === "caregiver name"), [availHeaders]);
  const caregiverIdIdx = useMemo(() => availHeaders.findIndex((h) => h.toLowerCase() === "caregiver id"), [availHeaders]);
  const desiredHoursIdx = useMemo(() => availHeaders.findIndex((h) => h.toLowerCase() === "desired hours"), [availHeaders]);
  const notesIdx = useMemo(
    () => availHeaders.findIndex((h) => h.toLowerCase() === "notes" || h.toLowerCase() === "note"),
    [availHeaders]
  );
  const dayColIndexForSelectedDow = useMemo(() => {
    return availHeaders.findIndex((h) => dayHeaderToDow(h) === selectedDow);
  }, [availHeaders, selectedDow]);

  // ✅ Candidate caregiver keys: anyone on the schedule this week OR present in availability.
  const activeKeys = useMemo(() => {
    const set = new Set<string>();
    for (const s of weekSchedule) {
      const cgId = norm(s.caregiverId);
      const cgName = norm(s.caregiver);
      if (!cgId && !cgName) continue;
      const key = (cgId || cgName).trim();
      if (!key) continue;
      if (key.toLowerCase() === "open") continue;
      set.add(key);
    }

    for (const row of availRowsAll) {
      const cgId = caregiverIdIdx >= 0 ? norm(row[caregiverIdIdx]) : "";
      const cgName = caregiverNameIdx >= 0 ? norm(row[caregiverNameIdx]) : "";
      const key = (cgId || cgName).trim();
      if (!key) continue;
      if (key.toLowerCase() === "open") continue;
      set.add(key);
    }

    return set;
  }, [weekSchedule, availRowsAll, caregiverIdIdx, caregiverNameIdx]);

  const caregiverKeysSig = useMemo(() => {
    return Array.from(activeKeys).map((k) => k.trim()).filter(Boolean).sort().join("|");
  }, [activeKeys]);

  const availabilityRowByAnyKey = useMemo(() => {
    const out: Record<string, { availRaw: string; desiredRaw: string; notes: string; name: string; id: string }> = {};
    if (!availRowsAll.length || caregiverNameIdx < 0) return out;

    for (const r of availRowsAll) {
      const name = caregiverNameIdx >= 0 ? norm(r[caregiverNameIdx]) : "";
      const id = caregiverIdIdx >= 0 ? norm(r[caregiverIdIdx]) : "";
      if (!name && !id) continue;

      const availRaw = dayColIndexForSelectedDow >= 0 ? norm(r[dayColIndexForSelectedDow]) : "";
      const desiredRaw = desiredHoursIdx >= 0 ? norm(r[desiredHoursIdx]) : "";
      const notes = notesIdx >= 0 ? norm(r[notesIdx]) : "";

      if (id) out[normalizeKey(id)] = { availRaw, desiredRaw, notes, name, id };
      if (name) out[normalizeKey(name)] = { availRaw, desiredRaw, notes, name, id };
    }

    return out;
  }, [availRowsAll, caregiverNameIdx, caregiverIdIdx, desiredHoursIdx, notesIdx, dayColIndexForSelectedDow]);

  /** ---------- Client destination address ---------- */
  const clientDestination = useMemo(() => {
    const key = normalizeKey(clientName);
    if (!key) return "";
    const hit =
      clientProfiles.find((c) => normalizeKey(c.name) === key) ||
      clientProfiles.find((c) => normalizeKey(c.name).includes(key)) ||
      null;

    return norm(hit?.address || hit?.location);
  }, [clientProfiles, clientName]);

  /** ---------- Drive-time effect ---------- */
  const driveAbortRef = useRef<AbortController | null>(null);

  /** ---------- Caregiver rows (ONE LIST, always ACTIVE) ---------- */
type CaregiverRow = {
  key: string; // caregiverId || caregiverName (from schedule)
  name: string;
  id: string;
  certification: string;

  desiredMeta: DesiredHoursMeta;
  availRaw: string;
  availLabel: string;
  availNotes: string;
  availSource: string;

  availabilityMatchType: AvailabilityMatchType;
  availabilityMatchLabel: string;

  dayShifts: ScheduleShiftRow[];
  totalHours: number;

  historyCount: number;
  historyLast: string | null;

  driveTimeText: string;
  driveTimeMinutes: number | null;

  conflictMinutes: number;
  hasConflict: boolean;

  scoreTotal: number;
  scoreBreakdown: {
    availability: number;
    conflict: number;
    history: number;
    drive_time: number;
    desired_hours: number;
    hours_penalty: number;
  };
};

  const caregiversBase: CaregiverRow[] = useMemo(() => {
  // ✅ For normal shifts we require parsed time
  // ✅ For requested shifts, parsed is intentionally null, but we still build list using start/end
  if (!parsed && !isRequested) return [];
  if (isRequestedEmpty) return [];

  const reqRange = timeRangeToMinutes(start, end);
  const reqShiftHours = shiftDurationHours(start, end);

  const out: CaregiverRow[] = [];
  const activeList = Array.from(activeKeys).map((k) => k.trim()).filter(Boolean);

  for (const key of activeList) {
      let name = key;
      let id = "";
      let certification = "";

      const hit =
        weekSchedule.find((s) => norm(s.caregiverId) === key) ||
        weekSchedule.find((s) => norm(s.caregiver) === key) ||
        null;

      if (hit) {
        name = norm(hit.caregiver) || name;
        id = norm(hit.caregiverId) || id;
      }

      const prof = caregiverProfileByAnyKey[normalizeKey(id || name || key)];
      if (prof) {
        name = norm(prof.name) || name;
        id = norm(prof.caregiverId) || id;
        certification = sanitizeCertificationValue(prof.certifications || prof.certification);
      }

      const av =
        (id && availabilityRowByAnyKey[normalizeKey(id)]) ||
        availabilityRowByAnyKey[normalizeKey(name)] ||
        availabilityRowByAnyKey[normalizeKey(key)] ||
        null;

     const availRaw = norm(av?.availRaw);
const desiredRaw = norm(av?.desiredRaw);
const availNotes = norm(av?.notes);
const desiredMeta = parseDesiredHours(desiredRaw);

const dayShifts = scheduleMap[key]?.[selectedDow] ?? [];
const totalHours = scheduleHoursByCaregiverKey[key] ?? 0;

const h =
  (id ? histByIdKey.get(normalizeKey(id)) : null) ||
  histByNameKey.get(normalizeKey(name)) ||
  null;

let conflictMins = 0;
if (reqRange) {
  for (const s of dayShifts) {
    const sr = timeRangeToMinutes(s.startTime, s.endTime);
    if (!sr) continue;
    conflictMins += overlapMinutes(reqRange, sr);
  }
}

const keyNorm = normalizeKey(key);
const idNorm = id ? normalizeKey(id) : "";
const nameNorm = name ? normalizeKey(name) : "";

const dt =
  driveByCaregiverKey[key] ||
  (keyNorm ? driveByCaregiverKey[keyNorm] : undefined) ||
  (idNorm ? driveByCaregiverKey[idNorm] : undefined) ||
  (nameNorm ? driveByCaregiverKey[nameNorm] : undefined);

const dtMin = dt?.minutes ?? null;
const dtText = norm(dt?.text);

const availabilityResult = scorePostedAvailability(availRaw, start, end);

const availabilityScorePts = availabilityResult.score;
const conflictScorePts = conflictScoreFromMinutes(conflictMins);
const histScorePts = historyScore(h?.count || 0);
const dtScorePts = driveScoreFromMinutes(dtMin);
const desiredHoursScorePts = desiredHoursFitScore(desiredMeta, totalHours, reqShiftHours);
const hoursPenaltyPts = fortyHourPenalty(totalHours, reqShiftHours);

const total =
  availabilityScorePts +
  conflictScorePts +
  histScorePts +
  dtScorePts +
  desiredHoursScorePts +
  hoursPenaltyPts;
      const i = shiftInfo.getGridShiftInfo({
        clientName,
        dateStr: dateStrForDow,
        startTime: start,
        endTime: end,
        caregiverName: name,
        caregiverId: id || undefined,
        isCancelled: false,
      });

     out.push({
  key,
  name,
  id,
  certification,

  desiredMeta,
  availRaw,
  availLabel: norm(i?.caregiverAvailabilityLabel) || availabilityResult.label,
  availNotes,
  availSource: norm(i?.caregiverAvailabilitySource),

  availabilityMatchType: availabilityResult.type,
  availabilityMatchLabel: availabilityResult.label,

  dayShifts,
  totalHours,

  historyCount: h?.count || 0,
  historyLast: h?.lastDate || null,

  driveTimeText: dtText,
  driveTimeMinutes: dtMin,

  conflictMinutes: conflictMins,
  hasConflict: conflictMins > 0,

  scoreTotal: total,
  scoreBreakdown: {
    availability: availabilityScorePts,
    conflict: conflictScorePts,
    history: histScorePts,
    drive_time: dtScorePts,
    desired_hours: desiredHoursScorePts,
    hours_penalty: hoursPenaltyPts,
  },
});
    }

   
  out.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  return out;
}, [
  parsed,
  isRequested,
  isRequestedEmpty,
  start,
  end,
  selectedDow,
  activeKeys,
  weekSchedule,
  scheduleMap,
  scheduleHoursByCaregiverKey,
  caregiverProfileByAnyKey,
  availabilityRowByAnyKey,
  histByIdKey,
  histByNameKey,
  driveByCaregiverKey,
  shiftInfo,
  clientName,
  dateStrForDow,
]);

  // ✅ Drive-time fetch runs after caregiversBase + clientDestination + caregiver addresses
  useEffect(() => {
    if (!menuOpen) return;
    if (!clientDestination) return;
    if (!caregiversBase.length) return;
    if (!caregiverProfiles.length) return;

    if (driveAbortRef.current) driveAbortRef.current.abort();
    const ac = new AbortController();
    driveAbortRef.current = ac;

    const addrByKey: Record<string, string> = {};
    for (const c of caregiverProfiles) {
      const addr = norm(c.address);
      if (!addr) continue;
      const id = normalizeKey(c.caregiverId);
      const nm = normalizeKey(c.name);
      const nos = normalizeKey(c.nameOnSchedule);
      if (id) addrByKey[id] = addr;
      if (nm) addrByKey[nm] = addr;
      if (nos) addrByKey[nos] = addr;
    }

    const run = async () => {
      setDriveLoading(true);
      setDriveError("");

      try {
        const next: Record<string, { minutes: number | null; text: string | null }> = { ...driveByCaregiverKey };
        const taskFns: Array<() => Promise<void>> = [];
        let failed = 0;

        for (const cg of caregiversBase) {
          const k = cg.key;
          const keyNorm = normalizeKey(k);

          const idKey = cg.id ? normalizeKey(cg.id) : "";
          const nameKey = cg.name ? normalizeKey(cg.name) : "";

          const origin =
            (idKey && addrByKey[idKey]) ||
            (keyNorm && addrByKey[keyNorm]) ||
            (nameKey && addrByKey[nameKey]) ||
            "";

          // ✅ Mark "done" for missing addresses so chips can show "—"
          if (!origin) {
            if (!next[k]) next[k] = { minutes: null, text: null };
            if (cg.id) next[normalizeKey(cg.id)] = { minutes: null, text: null };
            if (cg.name) next[normalizeKey(cg.name)] = { minutes: null, text: null };
            continue;
          }

          const existing = next[k];
          if (existing) continue;

          taskFns.push(async () => {
            const dt = await fetchDriveTime(driveTimeEndpoint, origin, clientDestination, ac.signal);
            next[k] = { minutes: dt.minutes, text: dt.text };
            if (cg.id) next[normalizeKey(cg.id)] = { minutes: dt.minutes, text: dt.text };
            if (cg.name) next[normalizeKey(cg.name)] = { minutes: dt.minutes, text: dt.text };
          });
        }

        if (taskFns.length === 0) {
          setDriveByCaregiverKey((prev) => ({ ...prev, ...next }));
          setDriveLoading(false);
          return;
        }

        const BATCH = 4;
        for (let i = 0; i < taskFns.length; i += BATCH) {
          if (ac.signal.aborted) return;
          const slice = taskFns.slice(i, i + BATCH);

          const results = await Promise.allSettled(slice.map((fn) => fn()));
          failed += results.filter((r) => r.status === "rejected").length;

          setDriveByCaregiverKey((prev) => ({ ...prev, ...next }));
        }

        setDriveByCaregiverKey((prev) => ({ ...prev, ...next }));

        if (failed > 0) {
          setDriveError(
            `Some drive times failed (${failed}/${taskFns.length}). This is usually Google rate-limiting. If this keeps happening, lower BATCH to 2–3.`
          );
        }
      } catch (e: any) {
        if (ac.signal.aborted) return;
        setDriveError(e?.message || "Failed to load drive times");
      } finally {
        if (!ac.signal.aborted) setDriveLoading(false);
      }
    };

    run();
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuOpen, clientDestination, caregiverProfiles, caregiverKeysSig, driveTimeEndpoint]);

  const caregiversFiltered = useMemo(() => {
    const q = caregiverSearch.trim().toLowerCase();
    if (!q) return caregiversBase;
    return caregiversBase.filter((c) => containsCI(`${c.name} ${c.key} ${c.id}`, q));
  }, [caregiversBase, caregiverSearch]);

  const caregivers = useMemo(() => {
    const base = [...caregiversFiltered];

    const gap = (c: CaregiverRow) => {
  const target = desiredHoursTarget(c.desiredMeta);
  if (target == null) return Number.NEGATIVE_INFINITY;
  return target - c.totalHours;
};
    const certRank = (c: CaregiverRow) => (sanitizeCertificationValue(c.certification) ? 1 : 0);

    base.sort((a, b) => {
      const nameA = a.name.toLowerCase();
      const nameB = b.name.toLowerCase();

      if (sortMode === "name_asc") return nameA.localeCompare(nameB);

      if (sortMode === "cert_desc") {
        const aCert = certRank(a);
        const bCert = certRank(b);
        if (bCert !== aCert) return bCert - aCert;
        if (b.scoreTotal !== a.scoreTotal) return b.scoreTotal - a.scoreTotal;
        return nameA.localeCompare(nameB);
      }

      if (sortMode === "history_desc") {
        if (b.historyCount !== a.historyCount) return b.historyCount - a.historyCount;
        if (b.scoreTotal !== a.scoreTotal) return b.scoreTotal - a.scoreTotal;
        return nameA.localeCompare(nameB);
      }

      if (sortMode === "drive_asc") {
        const aVal = a.driveTimeMinutes == null ? Number.POSITIVE_INFINITY : a.driveTimeMinutes;
        const bVal = b.driveTimeMinutes == null ? Number.POSITIVE_INFINITY : b.driveTimeMinutes;
        if (aVal !== bVal) return aVal - bVal;
        if (b.scoreTotal !== a.scoreTotal) return b.scoreTotal - a.scoreTotal;
        return nameA.localeCompare(nameB);
      }

      if (sortMode === "avail_filled_desc") {
        const af = isAvailabilityFilled(a.availRaw) ? 1 : 0;
        const bf = isAvailabilityFilled(b.availRaw) ? 1 : 0;
        if (bf !== af) return bf - af;
        if (b.scoreTotal !== a.scoreTotal) return b.scoreTotal - a.scoreTotal;
        return nameA.localeCompare(nameB);
      }

      if (sortMode === "desired_desc") {
  if (a.desiredMeta.wantsMax !== b.desiredMeta.wantsMax) {
    return a.desiredMeta.wantsMax ? -1 : 1;
  }

  const aTarget = desiredHoursTarget(a.desiredMeta) ?? -1;
  const bTarget = desiredHoursTarget(b.desiredMeta) ?? -1;

  if (bTarget !== aTarget) return bTarget - aTarget;
  return nameA.localeCompare(nameB);
}

      if (sortMode === "total_asc") {
        if (a.totalHours !== b.totalHours) return a.totalHours - b.totalHours;
        return nameA.localeCompare(nameB);
      }

      if (sortMode === "gap_desc") {
        const gA = gap(a);
        const gB = gap(b);
        if (gB !== gA) return gB - gA;
        return nameA.localeCompare(nameB);
      }

      // SMART
      if (b.scoreTotal !== a.scoreTotal) return b.scoreTotal - a.scoreTotal;
      if (a.hasConflict !== b.hasConflict) return a.hasConflict ? 1 : -1;

      const aDrive = a.driveTimeMinutes == null ? Number.POSITIVE_INFINITY : a.driveTimeMinutes;
      const bDrive = b.driveTimeMinutes == null ? Number.POSITIVE_INFINITY : b.driveTimeMinutes;
      if (aDrive !== bDrive) return aDrive - bDrive;

      return nameA.localeCompare(nameB);
    });

    return base;
  }, [caregiversFiltered, sortMode]);

  const stats = useMemo(() => {
    let hasAvail = 0;
    let noAvail = 0;
    let notAvail = 0;
    let zeroShifts = 0;
    let conflicts = 0;

    for (const c of caregiversBase) {
      const cat = availCategory(c.availRaw);
      if (cat === "has_avail") hasAvail += 1;
      else if (cat === "no_avail") noAvail += 1;
      else notAvail += 1;

      if (c.dayShifts.length === 0) zeroShifts += 1;
      if (c.hasConflict) conflicts += 1;
    }

    return { hasAvail, noAvail, notAvail, zeroShifts, total: caregiversBase.length, conflicts };
  }, [caregiversBase]);

  const initialMenuLoading = menuOpen && (weekSchedLoading || availLoading || cgLoading || clientsLoading);

  /** ---------- Render ---------- */
function onKeyDownCard(e: React.KeyboardEvent) {
  if (disabled) return;
  if (e.key === "Enter") {
    e.preventDefault();
    handleClick();
  }
  if (e.key === " ") {
    e.preventDefault();
    handleClick();
  }
}

return (
    <>
     {!popupOnly ? (
     <div
  role="button"
  tabIndex={disabled ? -1 : 0}
  onClick={(e) => {
    if (disabled) return;
    e.preventDefault();
    handleClick();
  }}
  onDoubleClick={(e) => {
    if (disabled) return;
    e.preventDefault();
    handleDoubleClick(e);
  }}
  onMouseEnter={() => setShowHoverHistoryIcon(true)}
  onMouseLeave={() => setShowHoverHistoryIcon(false)}
  onFocus={() => setShowHoverHistoryIcon(true)}
  onBlur={(e) => {
    const nextTarget = e.relatedTarget as Node | null;
    if (nextTarget && e.currentTarget.contains(nextTarget)) return;
    setShowHoverHistoryIcon(false);
  }}
  onKeyDown={onKeyDownCard}
  style={{
    width: "100%",
    textAlign: "left",
    border: "none",
    background: "transparent",
    padding: 0,
    cursor: disabled ? "default" : "pointer",
    userSelect: "none",
  }}
  title={titleText}
  aria-label={`Shift ${a1Key}`}
>
    <div
    style={{
      background: bg,
      color: fg,
      borderRadius: 12,
      padding: isEmpty ? "0px" : "10px 10px",
      boxShadow: shadow,
      opacity: disabled ? 0.6 : 1,
      position: "relative",
      border,
      minHeight: isEmpty
        ? rowIsEmpty
          ? EMPTY_CELL_HEIGHT
          : 34
        : expanded
          ? CARD_EXPANDED_MIN_HEIGHT
          : CARD_COLLAPSED_HEIGHT,
      display: "flex",
      flexDirection: "column",
      justifyContent: "flex-start",
      gap: isEmpty ? 0 : 6,
      overflow: "hidden",
    }}
  >
         {showHistoryIcon && (
  <button
    type="button"
    onClick={handleOpenEditHistory}
    onDoubleClick={(e) => {
      e.preventDefault();
      e.stopPropagation();
    }}
    style={{
      position: "absolute",
      top: 7,
      left: 8,
      width: 22,
      height: 22,
      borderRadius: 999,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 13,
      fontWeight: 950,
      background: "rgba(255,255,255,0.22)",
      color: fg,
      border: "1px solid rgba(255,255,255,0.5)",
      filter: "drop-shadow(0 1px 0 rgba(0,0,0,0.25))",
      cursor: showHoverHistoryIcon ? "pointer" : "default",
      userSelect: "none",
      padding: 0,
      zIndex: 5,
      opacity: showHoverHistoryIcon ? 1 : 0,
      pointerEvents: showHoverHistoryIcon ? "auto" : "none",
      transition: "opacity 120ms ease",
    }}
    aria-label="View edit history and rate"
    title="View edit history and rate"
  >
    <InfoCircleIcon size={13} />
  </button>
)}

          {isEmpty ? (
                       <div
              style={{
                height: "100%",
                minHeight: rowIsEmpty ? EMPTY_CELL_HEIGHT : 34,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 14,
                fontWeight: 900,
                color: "#9ca3af",
                userSelect: "none",
                paddingLeft: showHistoryIcon && showHoverHistoryIcon ? 18 : 0,
              }}
            >
              —
            </div>
          ) : (
            <>
              {isCancelled && <div style={{ fontSize: 12, fontWeight: 950, letterSpacing: 0.2 }}>Cancelled</div>}

              {/* ✅ Future/requested shifts: lightbulb icon for shift suggestions/menu */}
{showInfoIcon && (
  <button
    type="button"
    onClick={(e) => {
      e.preventDefault();
      e.stopPropagation();
      openShiftMenu();
    }}
    style={{
      position: "absolute",
      top: 7,
      right: 8,
      width: 22,
      height: 22,
      borderRadius: 999,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 13,
      fontWeight: 950,
      background: "rgba(255,255,255,0.22)",
      color: fg,
      border: "1px solid rgba(255,255,255,0.5)",
      filter: "drop-shadow(0 1px 0 rgba(0,0,0,0.25))",
      cursor: "pointer",
      userSelect: "none",
      padding: 0,
      zIndex: 5,
    }}
    aria-label="Open shift suggestions and details"
    title="Open shift suggestions and details"
  >
    <LightbulbIcon size={13} />
  </button>
)}

              {/* 🚩 (NOT on future shifts) */}
              {showFlag && (
                <span
                  style={{
                    position: "absolute",
                    top: 8,
                    right: 10,
                    fontSize: 14,
                    lineHeight: 1,
                    color: fg,
                    filter: isCancelled ? undefined : "drop-shadow(0 1px 0 rgba(0,0,0,0.25))",
                  }}
                  aria-label="Flagged shift"
                  title="Flagged shift"
                >
                  🚩
                </span>
              )}

              {/* ✓ (NOT on future shifts) */}
              {isVerified && (
                <span
                  style={{
                    position: "absolute",
                    top: 7,
                    right: 8,
                    width: 22,
                    height: 22,
                    borderRadius: 999,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 14,
                    fontWeight: 950,
                    background: "rgba(236,253,245,0.92)",
                    color: "#065f46",
                    border: "1px solid rgba(167,243,208,0.95)",
                  }}
                  title="Verified"
                  aria-label="Verified"
                >
                  ✓
                </span>
              )}

              <div
                style={{
                  fontSize: 12,
                  fontWeight: 950,
                  letterSpacing: 0.2,
                  paddingLeft: showHistoryIcon && showHoverHistoryIcon ? 22 : 0,
                }}
              >
                {displayTime}
              </div>

              <div
                style={{
                  fontSize: 13,
                  fontWeight: 850,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  paddingLeft: showHistoryIcon && showHoverHistoryIcon ? 22 : 0,
                }}
              >
                {displayCaregiver}
              </div>
            </>
          )}

          {showClockRow && (
            <div
              style={{
                fontSize: 11,
                marginTop: 2,
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
                alignItems: "flex-start",
                opacity: 0.95,
              }}
            >
              {showCombinedNoClock ? (
                <span style={{ whiteSpace: "nowrap" }}>
                  <strong>Clock:</strong> No Clock In/Out
                </span>
              ) : (
                <>
                  <ClockLine label="IN" timeText={inText} verdict={inVerdict} />
                  <ClockLine label="OUT" timeText={outText} verdict={outVerdict} />
                </>
              )}

              {parsed && !shiftId ? (
                <span style={{ whiteSpace: "nowrap", fontWeight: 900, opacity: 0.95 }}>(No Shift ID match)</span>
              ) : null}
            </div>
          )}
              </div>
      </div>
      ) : null}

      {/* ---------- SHIFT MENU (FloatingPanel) ---------- */}
<FloatingPanel
  open={menuOpen}
  onClose={() => {
    setMenuOpen(false);
    if (popupOnly) onPopupOnlyClose?.();
  }}
  title={
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        width: "100%",
        minWidth: 0,
      }}
    >
      <div
        style={{
          minWidth: 0,
          flex: "1 1 auto",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontWeight: 950,
          color: "#111827",
        }}
        title={
          shiftSummary
            ? `Shift Info • ${clientName} • ${shiftSummary.start}-${shiftSummary.end} • ${shiftSummary.caregiver || "Open"}`
            : `Shift Info • ${clientName}`
        }
      >
        {shiftSummary
          ? `Shift Info • ${clientName} • ${shiftSummary.start}-${shiftSummary.end} • ${shiftSummary.caregiver || "Open"}`
          : `Shift Info • ${clientName}`}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flex: "0 0 auto",
          paddingRight: 6,
        }}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setClearMode((v) => !v);
          }}
          style={{
            border: isGlass
              ? "1px solid rgba(255,255,255,0.32)"
              : "1px solid rgba(15,23,42,0.16)",
            background: popupButtonBg,
            borderRadius: 999,
            padding: "7px 11px",
            fontWeight: 950,
            cursor: "pointer",
            color: "#0b1220",
            fontSize: 12,
            whiteSpace: "nowrap",
            backdropFilter: popupLightBlur,
            WebkitBackdropFilter: popupLightBlur,
            boxShadow: isGlass ? "inset 0 1px 0 rgba(255,255,255,0.18)" : "none",
          }}
          title="Toggle clear mode"
        >
          {clearMode ? "Solid mode" : "Clear mode"}
        </button>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setShowDesc((vv) => !vv);
          }}
          style={{
            border: isGlass
              ? "1px solid rgba(255,255,255,0.32)"
              : "1px solid rgba(15,23,42,0.16)",
            background: popupButtonBg,
            borderRadius: 999,
            padding: "7px 11px",
            fontWeight: 950,
            cursor: "pointer",
            color: "#0b1220",
            fontSize: 12,
            whiteSpace: "nowrap",
            backdropFilter: popupLightBlur,
            WebkitBackdropFilter: popupLightBlur,
            boxShadow: isGlass ? "inset 0 1px 0 rgba(255,255,255,0.18)" : "none",
          }}
          title="Toggle description"
        >
          {showDesc ? "Hide description" : "Case description"}
        </button>

        {initialMenuLoading ? <TinySpinner label="Loading…" /> : null}
      </div>
    </div>
  }
  storageKey={currentPanelStorageKey}
  initial={panelInitial ?? { w: 720, h: 520 }}
  clearMode={clearMode}
>
  <div
    style={{
      height: "100%",
      overflowY: "auto",
      overflowX: "hidden",
      padding: 10,
      background: popupShellBg,
      backdropFilter: popupBlur,
      WebkitBackdropFilter: popupBlur,
    }}
  >
    <div style={{ display: "grid", gap: 10 }}>
      {weekSchedError ? <div style={{ fontWeight: 950, color: "#b91c1c" }}>Schedule error: {weekSchedError}</div> : null}
      {availError ? <div style={{ fontWeight: 950, color: "#b91c1c" }}>Availability error: {availError}</div> : null}
      {cgError ? <div style={{ fontWeight: 950, color: "#b91c1c" }}>Caregivers error: {cgError}</div> : null}
      {clientsError ? <div style={{ fontWeight: 950, color: "#b91c1c" }}>Clients error: {clientsError}</div> : null}
      {driveError ? <div style={{ fontWeight: 950, color: "#b91c1c" }}>Drive-time error: {driveError}</div> : null}

      <div
        style={{
          border: popupStrongBorder,
          borderRadius: 14,
          background: popupSectionBg,
          color: "#111827",
          overflow: "hidden",
          boxShadow: popupShadow,
          backdropFilter: popupBlur,
          WebkitBackdropFilter: popupBlur,
        }}
      >
        <div
          style={{
            position: "sticky",
            top: -10,
            zIndex: 20,
            display: "grid",
            gap: 8,
            padding: 10,
            borderBottom: isGlass
              ? "1px solid rgba(255,255,255,0.18)"
              : "1px solid rgba(17,24,39,0.06)",
            background: isGlass
              ? "rgba(255,255,255,0.025)"
              : "#d7eefc",
            backdropFilter: popupBlur,
            WebkitBackdropFilter: popupBlur,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <div style={{ minWidth: 0, flex: "1 1 420px" }}>
              <div style={{ fontSize: 16, fontWeight: 1000, color: "#111827", lineHeight: 1.1 }}>
                {shiftSummary ? shiftSummary.client : "Shift"}
              </div>

              {shiftSummary ? (
                <div
                  style={{
                    marginTop: 6,
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(150px, max-content))",
                    gap: 6,
                    alignItems: "center",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      minHeight: 32,
                      padding: "6px 10px",
                      borderRadius: 10,
                      border: popupStrongBorder,
                      background: popupSoftBg,
                      color: "#0b1220",
                      backdropFilter: popupLightBlur,
                      WebkitBackdropFilter: popupLightBlur,
                      boxShadow: isGlass ? "inset 0 1px 0 rgba(255,255,255,0.16)" : "none",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 10.5,
                        fontWeight: 1000,
                        color: "#64748b",
                        textTransform: "uppercase",
                        letterSpacing: 0.3,
                        whiteSpace: "nowrap",
                      }}
                    >
                      Day
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 950,
                        color: "#0b1220",
                        minWidth: 0,
                      }}
                    >
                      {formatFriendlyDate(shiftSummary.dateStr)}
                    </span>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      minHeight: 32,
                      padding: "6px 10px",
                      borderRadius: 10,
                      border: popupStrongBorder,
                      background: popupSoftBg,
                      color: "#0b1220",
                      backdropFilter: popupLightBlur,
                      WebkitBackdropFilter: popupLightBlur,
                      boxShadow: isGlass ? "inset 0 1px 0 rgba(255,255,255,0.16)" : "none",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 10.5,
                        fontWeight: 1000,
                        color: "#64748b",
                        textTransform: "uppercase",
                        letterSpacing: 0.3,
                        whiteSpace: "nowrap",
                      }}
                    >
                      Time
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 950,
                        color: "#0b1220",
                        minWidth: 0,
                      }}
                    >
                      {shiftSummary.start}-{shiftSummary.end}
                    </span>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      minHeight: 32,
                      padding: "6px 10px",
                      borderRadius: 10,
                      border: popupStrongBorder,
                      background: popupSoftBg,
                      color: "#0b1220",
                      backdropFilter: popupLightBlur,
                      WebkitBackdropFilter: popupLightBlur,
                      boxShadow: isGlass ? "inset 0 1px 0 rgba(255,255,255,0.16)" : "none",
                    }}
                    title="Currently scheduled caregiver for this shift"
                  >
                    <span
                      style={{
                        fontSize: 10.5,
                        fontWeight: 1000,
                        color: "#64748b",
                        textTransform: "uppercase",
                        letterSpacing: 0.3,
                        whiteSpace: "nowrap",
                      }}
                    >
                      Scheduled
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 950,
                        color: "#0b1220",
                        minWidth: 0,
                      }}
                    >
                      {shiftSummary.caregiver || "Open"}
                    </span>
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: 4, opacity: 0.8, fontWeight: 850, color: "#0b1220" }}>
                  (No parsed time range for this cell)
                </div>
              )}

              <div
                style={{
                  marginTop: 8,
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 6,
                  minHeight: 34,
                  padding: "7px 10px",
                  borderRadius: 10,
                  border: popupStrongBorder,
                  background: popupSoftBg,
                  color: "#0b1220",
                  backdropFilter: popupLightBlur,
                  WebkitBackdropFilter: popupLightBlur,
                  boxShadow: isGlass ? "inset 0 1px 0 rgba(255,255,255,0.16)" : "none",
                }}
              >
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 1000,
                    color: "#64748b",
                    textTransform: "uppercase",
                    letterSpacing: 0.3,
                    whiteSpace: "nowrap",
                    paddingTop: 1,
                  }}
                >
                  Destination
                </span>

                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 900,
                    color: "#0b1220",
                    minWidth: 0,
                    whiteSpace: "normal",
                    lineHeight: 1.35,
                  }}
                >
                  {clientsLoading ? (
                    <SkeletonLine w="320px" />
                  ) : clientDestination ? (
                    clientDestination
                  ) : (
                    <span style={{ color: "#b91c1c" }}>Missing client address</span>
                  )}
                </span>
              </div>
            </div>
          </div>

          {showDesc ? (
            <div
              style={{
                border: popupBorder,
                borderRadius: 12,
                padding: 10,
                background: popupSectionBg,
                color: "#0b1220",
                fontWeight: 850,
                whiteSpace: "pre-wrap",
                backdropFilter: popupLightBlur,
                WebkitBackdropFilter: popupLightBlur,
                boxShadow: isGlass ? "inset 0 1px 0 rgba(255,255,255,0.16)" : "none",
              }}
            >
              {norm(clientDescription) ? clientDescription : "No description on file."}
            </div>
          ) : null}

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 950, color: "#111827" }}>
              Caregivers (Active this week)
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
                justifyContent: "flex-end",
              }}
            >
              <input
                value={caregiverSearch}
                onChange={(e) => setCaregiverSearch(e.target.value)}
                placeholder="Search caregivers..."
                style={{
                  width: 170,
                  maxWidth: "100%",
                  border: isGlass
                    ? "1px solid rgba(255,255,255,0.28)"
                    : "1px solid rgba(15,23,42,0.12)",
                  borderRadius: 10,
                  padding: "7px 10px",
                  fontSize: 12,
                  outline: "none",
                  background: popupButtonBg,
                  fontWeight: 800,
                  color: "#111827",
                  backdropFilter: popupLightBlur,
                  WebkitBackdropFilter: popupLightBlur,
                  boxShadow: isGlass ? "inset 0 1px 0 rgba(255,255,255,0.16)" : "none",
                }}
              />

              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as SortMode)}
                style={{
                  border: isGlass
                    ? "1px solid rgba(255,255,255,0.28)"
                    : "1px solid rgba(15,23,42,0.12)",
                  borderRadius: 10,
                  padding: "7px 10px",
                  fontSize: 12,
                  outline: "none",
                  background: popupButtonBg,
                  fontWeight: 850,
                  color: "#111827",
                  minWidth: 170,
                  backdropFilter: popupLightBlur,
                  WebkitBackdropFilter: popupLightBlur,
                  boxShadow: isGlass ? "inset 0 1px 0 rgba(255,255,255,0.16)" : "none",
                }}
              >
                <option value="smart">Smart (score)</option>
                <option value="cert_desc">Certification (yes → no)</option>
                <option value="history_desc">History (high → low)</option>
                <option value="drive_asc">Drive time (low → high)</option>
                <option value="avail_filled_desc">Availability filled (yes → no)</option>
                <option value="desired_desc">Desired Hours (high → low)</option>
                <option value="total_asc">Total Hours (low → high)</option>
                <option value="gap_desc">Desired - Total (high → low)</option>
                <option value="name_asc">Name (A → Z)</option>
              </select>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              alignItems: "center",
            }}
          >
            <Pill clearMode={clearMode}>{caregivers.length} shown</Pill>
            <Pill clearMode={clearMode}>On schedule or availability: {stats.total}</Pill>
            <Pill clearMode={clearMode}>Conflicts: {stats.conflicts}</Pill>
            {availTabName ? <Pill clearMode={clearMode}>Source: {availTabName}</Pill> : null}

            {histLoading ? <TinySpinner label="History…" /> : null}
            {driveLoading ? <TinySpinner label="Drive times…" /> : null}
            {histError ? <span style={{ fontWeight: 950, color: "#b91c1c" }}>{histError}</span> : null}
          </div>

          {availValues.length > 0 && (caregiverNameIdx < 0 || dayColIndexForSelectedDow < 0) ? (
            <div style={{ fontSize: 12, fontWeight: 900, color: "#b45309" }}>
              Heads up: availability headers didn’t match expected columns (Caregiver Name / day columns). We’ll still show caregivers already on the schedule.
            </div>
          ) : null}
        </div>

        <div style={{ padding: 10 }}>
          {(weekSchedLoading || availLoading || cgLoading || clientsLoading) && (
            <div
              style={{
                fontWeight: 900,
                opacity: 0.9,
                color: "#111827",
                display: "flex",
                gap: 10,
                alignItems: "center",
                marginBottom: 10,
              }}
            >
              <TinySpinner />
              <span style={{ opacity: 0.85, fontWeight: 800 }}>
                {weekSchedLoading ? "schedule" : ""}
                {weekSchedLoading && availLoading ? " + " : ""}
                {availLoading ? "availability" : ""}
                {(weekSchedLoading || availLoading) && (cgLoading || clientsLoading) ? " + " : ""}
                {cgLoading ? "caregivers" : ""}
                {cgLoading && clientsLoading ? " + " : ""}
                {clientsLoading ? "clients" : ""}
              </span>
            </div>
          )}

          {initialMenuLoading && caregiversBase.length === 0 ? (
            <div style={{ display: "grid", gap: 10 }}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  style={{
                    background: popupCardBg,
                    borderRadius: 14,
                    border: popupBorder,
                    boxShadow: popupShadow,
                    padding: 12,
                    color: "#111827",
                    backdropFilter: popupLightBlur,
                    WebkitBackdropFilter: popupLightBlur,
                  }}
                >
                  <SkeletonLine w="40%" />
                  <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                    <SkeletonLine w="90px" />
                    <SkeletonLine w="120px" />
                    <SkeletonLine w="110px" />
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <SkeletonLine w="70%" />
                    <div style={{ marginTop: 6 }} />
                    <SkeletonLine w="55%" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {caregivers.map((cg) => {
                const desiredTarget = desiredHoursTarget(cg.desiredMeta);
                const desiredLabel = cg.desiredMeta.wantsMax
                  ? "As many as possible"
                  : cg.desiredMeta.min != null && cg.desiredMeta.max != null
                    ? `${cg.desiredMeta.min}-${cg.desiredMeta.max}h`
                    : desiredTarget != null
                      ? `${desiredTarget}h`
                      : "—";

                const gapValue =
                  cg.desiredMeta.wantsMax || desiredTarget == null
                    ? null
                    : desiredTarget - cg.totalHours;

                const driveLabel =
                  driveLoading && cg.driveTimeMinutes == null && !cg.driveTimeText
                    ? "…"
                    : cg.driveTimeMinutes != null
                      ? `${Math.round(cg.driveTimeMinutes)}m`
                      : "—";

                const showAvailabilityReviewBadge = needsAvailabilityReview(
                  cg.availabilityMatchType,
                  cg.availRaw ?? ""
                );

                return (
                  <div
                    key={cg.key}
                    style={{
                      background: popupCardBg,
                      border: popupBorder,
                      borderRadius: 12,
                      padding: "10px 12px",
                      boxShadow: isGlass
                        ? "inset 0 1px 0 rgba(255,255,255,0.16), 0 8px 20px rgba(15,23,42,0.10)"
                        : "0 3px 10px rgba(15,23,42,0.04)",
                      backdropFilter: popupLightBlur,
                      WebkitBackdropFilter: popupLightBlur,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 10,
                        minWidth: 0,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: "1 1 auto" }}>
                        <div
                          style={{
                            fontSize: 15,
                            fontWeight: 1000,
                            color: "#111827",
                            minWidth: 0,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          title={cg.name}
                        >
                          {cg.name}
                        </div>

                        {sanitizeCertificationValue(cg.certification) ? (
                          <span
                            style={{
                              flex: "0 0 auto",
                              fontSize: 11,
                              fontWeight: 1000,
                              padding: "5px 9px",
                              borderRadius: 999,
                              background: isGlass ? "rgba(139,92,246,0.10)" : "rgba(139,92,246,0.12)",
                              border: isGlass
                                ? "1px solid rgba(255,255,255,0.24)"
                                : "1px solid rgba(139,92,246,0.18)",
                              color: "#6d28d9",
                              whiteSpace: "nowrap",
                              lineHeight: 1,
                              backdropFilter: popupLightBlur,
                              WebkitBackdropFilter: popupLightBlur,
                            }}
                            title={`Certification: ${sanitizeCertificationValue(cg.certification)}`}
                          >
                            {sanitizeCertificationValue(cg.certification)}
                          </span>
                        ) : null}

                        <span
                          style={{
                            flex: "0 0 auto",
                            fontSize: 14,
                            fontWeight: 1000,
                            padding: "6px 12px",
                            borderRadius: 999,
                            background: isGlass ? "rgba(2,132,199,0.10)" : "rgba(2,132,199,0.12)",
                            border: isGlass
                              ? "1px solid rgba(255,255,255,0.24)"
                              : "1px solid rgba(2,132,199,0.18)",
                            color: "#0b1220",
                            whiteSpace: "nowrap",
                            lineHeight: 1,
                            backdropFilter: popupLightBlur,
                            WebkitBackdropFilter: popupLightBlur,
                          }}
                          title={buildScoreTooltip(cg)}
                        >
                          {cg.scoreTotal}
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => openMessageToCaregiver({ id: cg.id, name: cg.name })}
                        disabled={!messagesUI || !norm(cg.id)}
                        title={!messagesUI ? "Messaging unavailable" : !norm(cg.id) ? "Missing caregiverId" : "Message this caregiver"}
                        aria-label="Message this caregiver"
                        style={{
                          flex: "0 0 auto",
                          width: 38,
                          height: 38,
                          borderRadius: 12,
                          border: isGlass
                            ? "1px solid rgba(255,255,255,0.24)"
                            : "1px solid rgba(59,130,246,0.18)",
                          background: isGlass ? "rgba(59,130,246,0.08)" : "rgba(59,130,246,0.10)",
                          color: "#2563eb",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: !messagesUI || !norm(cg.id) ? "not-allowed" : "pointer",
                          opacity: !messagesUI || !norm(cg.id) ? 0.55 : 1,
                          backdropFilter: popupLightBlur,
                          WebkitBackdropFilter: popupLightBlur,
                        }}
                      >
                        <MessageBubbleIcon size={20} />
                      </button>
                    </div>

                    <div
                      style={{
                        marginTop: 8,
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 6,
                        alignItems: "center",
                      }}
                    >
                      {cg.availabilityMatchType === "exact" || cg.availabilityMatchType === "strong" ? (
                        <ScoreChip
                          label="Fits Availability"
                          tone="good"
                          title={`Availability match: ${cg.availabilityMatchLabel}`}
                        />
                      ) : cg.availabilityMatchType === "partial" ? (
                        <ScoreChip
                          label="Partial Availability Match"
                          tone="warn"
                          title={`Availability match: ${cg.availabilityMatchLabel}`}
                        />
                      ) : showAvailabilityReviewBadge ? (
                        <ScoreChip
                          label="Review availability"
                          tone="warn"
                          title={`Posted availability needs human review: ${cg.availRaw || "Unclear entry"}`}
                        />
                      ) : !norm(cg.availRaw) ? (
                        <ScoreChip
                          label="No Availability"
                          tone="bad"
                          title="No availability was posted for this caregiver for this day."
                        />
                      ) : cg.availabilityMatchType === "none" ? (
                        <ScoreChip
                          label="Does not fit availability"
                          tone="bad"
                          title={`Availability match: ${cg.availabilityMatchLabel || "No match"}`}
                        />
                      ) : null}

                      <ScoreChip
                        label={cg.hasConflict ? "Conflict" : "No Conflict"}
                        tone={cg.hasConflict ? "bad" : "good"}
                        title={
                          cg.hasConflict
                            ? `Overlap: ${Math.round(cg.conflictMinutes || 0)} minutes`
                            : "No overlap"
                        }
                      />

                      <ScoreChip
                        label={`History: ${cg.historyCount}`}
                        tone={cg.historyCount > 0 ? "good" : "neutral"}
                        title={
                          cg.historyCount === 1
                            ? "1 prior shift"
                            : `${cg.historyCount} prior shifts`
                        }
                      />

                      <ScoreChip
                        label={`Drive time: ${driveLabel}`}
                        tone={
                          cg.driveTimeMinutes == null
                            ? "neutral"
                            : cg.driveTimeMinutes <= 20
                              ? "good"
                              : cg.driveTimeMinutes <= 30
                                ? "warn"
                                : "bad"
                        }
                        title={
                          cg.driveTimeText ||
                          (cg.driveTimeMinutes != null
                            ? `Drive time: ${cg.driveTimeMinutes} min`
                            : clientDestination
                              ? "Drive time unavailable (missing caregiver address or API returned no result)"
                              : "Drive time unavailable (missing client address)")
                        }
                      />

                      <ScoreChip
                        label={`Desired: ${desiredLabel}`}
                        tone="neutral"
                        title={
                          gapValue == null
                            ? `Desired hours: ${desiredLabel}`
                            : `Desired (${desiredTarget}) - Total (${cg.totalHours.toFixed(1)}) = Gap ${gapValue.toFixed(1)}h`
                        }
                      />

                      <ScoreChip
                        label={`Total hours: ${cg.totalHours.toFixed(1)}`}
                        tone={
                          cg.totalHours > 40
                            ? "bad"
                            : cg.totalHours >= 35
                              ? "warn"
                              : "neutral"
                        }
                        title="Total scheduled hours this week"
                      />

                      {(cg.totalHours > 40 || cg.totalHours + shiftDurationHours(start, end) > 40) ? (
                        <ScoreChip
                          label="Over 40 Hours"
                          tone="bad"
                          title={
                            cg.totalHours > 40
                              ? `Already above 40 hours at ${cg.totalHours.toFixed(1)}h`
                              : `This shift would bring them to ${(cg.totalHours + shiftDurationHours(start, end)).toFixed(1)}h`
                          }
                        />
                      ) : null}
                    </div>

                    <div
                      style={{
                        marginTop: 8,
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                        gap: 8,
                      }}
                    >
                      <MetaField
                        label="Shifts today"
                        value={cg.dayShifts.length}
                        clearMode={clearMode}
                      />
                    </div>

                    <div style={{ marginTop: 8 }}>
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: 950,
                          color: "#64748b",
                          marginBottom: 4,
                        }}
                      >
                        Availability
                      </div>

                      <div
                        style={{
                          border: isGlass
                            ? "1px solid rgba(255,255,255,0.24)"
                            : "1px solid rgba(17,24,39,0.08)",
                          borderRadius: 10,
                          padding: "8px 10px",
                          background: popupSoftBg,
                          backdropFilter: popupLightBlur,
                          WebkitBackdropFilter: popupLightBlur,
                          boxShadow: isGlass ? "inset 0 1px 0 rgba(255,255,255,0.14)" : "none",
                        }}
                      >
                        <AvailabilityCell value={cg.availRaw || "—"} />
                        {(norm(cg.availLabel) || norm(cg.availSource)) && (
                          <AvailabilityPill label={cg.availLabel} source={cg.availSource} />
                        )}
                        {norm(cg.availNotes) ? (
                          <div
                            style={{
                              marginTop: 6,
                              fontSize: 11,
                              lineHeight: 1.35,
                              color: "#475569",
                              whiteSpace: "pre-wrap",
                              wordBreak: "break-word",
                            }}
                          >
                            <span style={{ fontWeight: 950, color: "#334155" }}>Notes:</span> {cg.availNotes}
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div style={{ marginTop: 8 }}>
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: 950,
                          color: "#64748b",
                          marginBottom: 4,
                        }}
                      >
                        Schedule this day
                      </div>

                   {cg.dayShifts.length ? (
  <div style={{ display: "grid", gap: 8 }}>
    {cg.dayShifts.map((s, idx) => {
      const st = normalizeShiftStatusFromText(s.status);

      const target: PopupShiftTarget = {
        shiftId: s.shiftId,
        dateStr: s.date,
        clientName: s.client,
        caregiverName: s.caregiver,
        caregiverId: s.caregiverId || undefined,
        startTime: s.startTime,
        endTime: s.endTime,
        status: st,
      };

      return (
       <div
  key={`${s.shiftId || idx}-${s.client}-${s.startTime}-${s.endTime}`}
  style={{
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    minWidth: 0,
    padding: "9px 12px",
    borderRadius: 12,
    background: isGlass
      ? "rgba(255,255,255,0.035)"
      : "rgba(255,255,255,0.92)",
    border: isGlass
      ? "1px solid rgba(255,255,255,0.18)"
      : "1px solid rgba(17,24,39,0.10)",
    backdropFilter: popupLightBlur,
    WebkitBackdropFilter: popupLightBlur,
    boxShadow: isGlass ? "inset 0 1px 0 rgba(255,255,255,0.14)" : "none",
  }}
>
  <div style={{ minWidth: 0, display: "grid", gap: 2 }}>
    <div
      style={{
        fontSize: 12,
        fontWeight: 950,
        color: "#0b1220",
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
      title={s.client}
    >
      {s.client}
    </div>

    <div
      style={{
        fontSize: 11,
        fontWeight: 850,
        color: "#475569",
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
      }}
    >
      <span>{s.startTime}-{s.endTime}</span>
      <span>•</span>
      <span>{s.status}</span>
    </div>
  </div>

  <button
    type="button"
    onClick={(e) => {
      e.preventDefault();
      e.stopPropagation();
      openNestedShiftMenu(target);
    }}
    style={{
      width: 34,
      height: 34,
      borderRadius: 999,
      border: popupStrongBorder,
      background: popupButtonBg,
      color: "#0b1220",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      cursor: "pointer",
      flex: "0 0 auto",
      backdropFilter: popupLightBlur,
      WebkitBackdropFilter: popupLightBlur,
      boxShadow: popupShadow,
    }}
    title={`Open shift info for ${s.client} ${s.startTime}-${s.endTime}`}
    aria-label={`Open shift info for ${s.client} ${s.startTime}-${s.endTime}`}
  >
    <LightbulbIcon size={15} />
  </button>
</div>
      );
    })}
  </div>
) : (
  <div style={{ fontSize: 12, fontWeight: 850, color: "#64748b" }}>
    No shifts
  </div>
)}
                    </div>
                  </div>
                );
              })}

              {!caregivers.length ? (
                <div style={{ padding: 10, fontWeight: 900, opacity: 0.75, color: "#111827" }}>
                  No caregivers match that search.
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  </div>
</FloatingPanel>
{popupWindows.map((popup, idx) => (
  <ShiftCard
    key={popup.id}
    a1Key={`${a1Key}:popup:${popup.id}`}
    value=""
    status={popup.target.status}
    disabled={true}
    onRequestEdit={() => {}}
    expanded={false}
    onToggleExpanded={() => {}}
    dateStrForDow={popup.target.dateStr}
    clientName={popup.target.clientName}
    shiftInfo={shiftInfo}
    rowIsEmpty={false}
    cellBg={cellBg}
    sheetColors={sheetColors}
    week={week}
    hasEditHistory={false}
    onOpenEditHistory={onOpenEditHistory}
    messagesUI={messagesUI}
    defaultMessageCategory={defaultMessageCategory}
    clientHistoryEndpoint={clientHistoryEndpoint}
    scheduleEndpoint={scheduleEndpoint}
    availabilityEndpoint={availabilityEndpoint}
    caregiversEndpoint={caregiversEndpoint}
    clientsEndpoint={clientsEndpoint}
    driveTimeEndpoint={driveTimeEndpoint}
    clientDescription={clientDescription}
    popupOnly={true}
    popupTarget={popup.target}
    panelStorageKey={`${currentPanelStorageKey}:child:${popup.id}:${idx}`}
    panelInitial={popup.initial}
    onPopupOnlyClose={() => {
      setPopupWindows((prev) => prev.filter((w) => w.id !== popup.id));
    }}
  />
))}
    </>
  );
}

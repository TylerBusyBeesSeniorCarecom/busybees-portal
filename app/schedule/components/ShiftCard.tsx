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
function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        border: "1px solid rgba(17,24,39,0.12)",
        borderRadius: 999,
        padding: "4px 10px",
        fontSize: 12,
        fontWeight: 900,
        color: "#111827",
        background: "rgba(255,255,255,0.85)",
        lineHeight: 1.1,
        whiteSpace: "nowrap",
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
  const v = (raw || "").trim().toLowerCase();
  return v === "as many as possible" || v.includes("as many as possible") || v.includes("as much as possible") || v.includes("as many as");
}
function desiredHoursSortValue(raw: string): { wantsMax: boolean; hours: number } {
  const v = norm(raw);
  const wantsMax = isAsManyAsPossible(v);
  if (wantsMax) return { wantsMax: true, hours: 0 };
  return { wantsMax: false, hours: safeNumber(v) };
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

function availCategory(raw: string): "has_avail" | "no_avail" | "not_avail" {
  const v = (raw || "").trim();
  if (!v || v === "—") return "no_avail";

  const lower = v.toLowerCase();
  const isOff = lower === "off" || lower.includes("not available") || lower.includes("unavailable") || lower === "none";
  if (isOff) return "not_avail";
  return "has_avail";
}
function isAvailabilityFilled(raw: string): boolean {
  const v = (raw || "").trim();
  return Boolean(v) && v !== "—";
}

function AvailabilityCell({ value }: { value: string }) {
  const v = (value || "").trim();
  if (!v || v === "—") return <span style={{ color: "#9ca3af" }}>—</span>;

  const lower = v.toLowerCase();
  const isOff = lower === "off" || lower.includes("not available") || lower.includes("unavailable");
  const isOpen = lower === "open" || lower.includes("anytime") || lower.includes("available all day");

  const chipStyle: React.CSSProperties = {
    display: "inline-block",
    padding: "4px 8px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 900,
    border: "1px solid",
    lineHeight: 1.1,
    whiteSpace: "nowrap",
  };

  if (isOff) {
    return (
      <span style={{ ...chipStyle, background: "#f3f4f6", color: "#6b7280", borderColor: "#e5e7eb" }}>
        Not available
      </span>
    );
  }
  if (isOpen) {
    return (
      <span style={{ ...chipStyle, background: "#ecfdf5", color: "#065f46", borderColor: "#a7f3d0" }}>
        Open
      </span>
    );
  }

  return <span style={{ fontWeight: 750, color: "#111827", whiteSpace: "pre-wrap" }}>{v}</span>;
}

function AvailabilityPill({ label, source }: { label: string; source?: string }) {
  const has = Boolean(norm(label));
  const text = has ? label : "No availability submitted";

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          borderRadius: 999,
          padding: "5px 10px",
          fontSize: 12,
          fontWeight: 950,
          background: has ? "rgba(59,130,246,0.14)" : "rgba(148,163,184,0.18)",
          border: has ? "1px solid rgba(59,130,246,0.30)" : "1px solid rgba(148,163,184,0.30)",
          color: "#0b1220",
          whiteSpace: "nowrap",
        }}
        title={has ? label : "Missing availability submission"}
      >
        {text}
      </span>

      {norm(source) ? (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            borderRadius: 999,
            padding: "5px 10px",
            fontSize: 12,
            fontWeight: 900,
            background: "rgba(2,132,199,0.12)",
            border: "1px solid rgba(2,132,199,0.22)",
            color: "#0b1220",
            whiteSpace: "nowrap",
          }}
          title="Availability source"
        >
          Source: {source}
        </span>
      ) : null}
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
  if (historyCount >= 5) return 30;
  if (historyCount >= 3) return 20;
  if (historyCount >= 1) return 10;
  return 0;
}
function availabilityScoreFromConflictMinutes(mins: number): number {
  if (mins === 0) return 30;
  if (mins <= 30) return 20;
  if (mins <= 60) return 10;
  return 0;
}
function driveScoreFromMinutes(mins: number | null): number {
  if (mins == null || !Number.isFinite(mins)) return 0;
  if (mins <= 10) return 20;
  if (mins <= 20) return 15;
  if (mins <= 30) return 10;
  return 0;
}
function weeklyHoursScore(weeklyBefore: number, shiftHours: number): number {
  if (weeklyBefore > 40) return -5;
  if (weeklyBefore + shiftHours > 40) return 0;
  return 10;
}
function certScore(certs: string[] | string | null | undefined): number {
  if (!certs) return 0;
  const arr = Array.isArray(certs) ? certs : [certs];
  const first = norm(arr[0]);
  if (!first) return 0;
  if (first.toLowerCase() === "none") return 0;
  return 5;
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
  value,
  status,
  disabled,
  onRequestEdit,
  expanded,
  onToggleExpanded,
  dateStrForDow,
  clientName,
  shiftInfo,
  rowIsEmpty,
  cellBg,
  sheetColors,
  week,

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
}) {
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
    })
  : null;

  const shiftId = info?.shiftId ?? "";
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

   // ✅ show "i" for:
  // - future real shifts (existing behavior)
  // - requested/ghost shifts (always, as long as they have times)
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

   const border = isEmpty
    ? "none"
    : isRequested
      ? "2px dashed rgba(234,88,12,0.85)" // ✅ dashed outline
      : isCancelled
        ? "1px solid #cbd5e1"
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [showDesc, setShowDesc] = useState(false);

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
        certifications: c?.certifications ?? null,
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

  // Load menu data when menu opens
  useEffect(() => {
    if (!menuOpen) return;

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
  }, [menuOpen]);

  // ESC closes panel
  useEffect(() => {
    if (!menuOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
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

  // ✅ Active caregiver keys: anyone appearing on schedule this week (non-open)
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
    return set;
  }, [weekSchedule]);

  const caregiverKeysSig = useMemo(() => {
    return Array.from(activeKeys).map((k) => k.trim()).filter(Boolean).sort().join("|");
  }, [activeKeys]);

  /** ---------- Availability parsing (enrichment only) ---------- */
  const availHeaders = useMemo(() => (availValues?.[0] ?? []).map((h) => norm(h)), [availValues]);
  const availRowsAll = useMemo(() => (availValues?.length ? availValues.slice(1) : []), [availValues]);

  const caregiverNameIdx = useMemo(() => availHeaders.findIndex((h) => h.toLowerCase() === "caregiver name"), [availHeaders]);
  const caregiverIdIdx = useMemo(() => availHeaders.findIndex((h) => h.toLowerCase() === "caregiver id"), [availHeaders]);
  const desiredHoursIdx = useMemo(() => availHeaders.findIndex((h) => h.toLowerCase() === "desired hours"), [availHeaders]);
  const dayColIndexForSelectedDow = useMemo(() => {
    return availHeaders.findIndex((h) => dayHeaderToDow(h) === selectedDow);
  }, [availHeaders, selectedDow]);

  const availabilityRowByAnyKey = useMemo(() => {
    const out: Record<string, { availRaw: string; desiredRaw: string; name: string; id: string }> = {};
    if (!availRowsAll.length || caregiverNameIdx < 0) return out;

    for (const r of availRowsAll) {
      const name = caregiverNameIdx >= 0 ? norm(r[caregiverNameIdx]) : "";
      const id = caregiverIdIdx >= 0 ? norm(r[caregiverIdIdx]) : "";
      if (!name && !id) continue;

      const availRaw = dayColIndexForSelectedDow >= 0 ? norm(r[dayColIndexForSelectedDow]) : "";
      const desiredRaw = desiredHoursIdx >= 0 ? norm(r[desiredHoursIdx]) : "";

      if (id) out[normalizeKey(id)] = { availRaw, desiredRaw, name, id };
      if (name) out[normalizeKey(name)] = { availRaw, desiredRaw, name, id };
    }

    return out;
  }, [availRowsAll, caregiverNameIdx, caregiverIdIdx, desiredHoursIdx, dayColIndexForSelectedDow]);

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

    desiredMeta: { wantsMax: boolean; hours: number };
    availRaw: string;
    availLabel: string;
    availSource: string;

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
      history: number;
      availability: number;
      drive_time: number;
      weekly_hours: number;
      tenure: number;
      certification: number;
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
      }

      const av =
        (id && availabilityRowByAnyKey[normalizeKey(id)]) ||
        availabilityRowByAnyKey[normalizeKey(name)] ||
        availabilityRowByAnyKey[normalizeKey(key)] ||
        null;

      const availRaw = norm(av?.availRaw);
      const desiredRaw = norm(av?.desiredRaw);
      const desiredMeta = desiredHoursSortValue(desiredRaw);

      const certs = prof?.certifications ?? null;

      const dayShifts = scheduleMap[key]?.[selectedDow] ?? [];
      const totalHours = scheduleHoursByCaregiverKey[key] ?? 0;

      const h = (id ? histByIdKey.get(normalizeKey(id)) : null) || histByNameKey.get(normalizeKey(name)) || null;

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

      const histScorePts = historyScore(h?.count || 0);
      const availScorePts = availabilityScoreFromConflictMinutes(conflictMins);
      const dtScorePts = driveScoreFromMinutes(dtMin);
      const weeklyScorePts = weeklyHoursScore(totalHours, reqShiftHours);
      const tenureScorePts = 0;
      const certPts = certScore(certs);

      const total = histScorePts + availScorePts + dtScorePts + weeklyScorePts + tenureScorePts + certPts;

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

        desiredMeta,
        availRaw,
        availLabel: norm(i?.caregiverAvailabilityLabel),
        availSource: norm(i?.caregiverAvailabilitySource),

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
          history: histScorePts,
          availability: availScorePts,
          drive_time: dtScorePts,
          weekly_hours: weeklyScorePts,
          tenure: tenureScorePts,
          certification: certPts,
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
      if (c.desiredMeta.wantsMax) return Number.POSITIVE_INFINITY;
      return c.desiredMeta.hours - c.totalHours;
    };

    base.sort((a, b) => {
      const nameA = a.name.toLowerCase();
      const nameB = b.name.toLowerCase();

      if (sortMode === "name_asc") return nameA.localeCompare(nameB);

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
        if (a.desiredMeta.wantsMax !== b.desiredMeta.wantsMax) return a.desiredMeta.wantsMax ? -1 : 1;
        if (b.desiredMeta.hours !== a.desiredMeta.hours) return b.desiredMeta.hours - a.desiredMeta.hours;
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
              }}
            >
              —
            </div>
          ) : (
            <>
              {isCancelled && <div style={{ fontSize: 12, fontWeight: 950, letterSpacing: 0.2 }}>Cancelled</div>}

              {/* ✅ Future shifts: "i" icon */}
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
                    cursor: canOpenShiftMenu ? "pointer" : "default",
                    userSelect: "none",
                    padding: 0,
                  }}
                  aria-label="Shift info"
                  title="Open shift menu"
                >
                  i
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

              <div style={{ fontSize: 12, fontWeight: 950, letterSpacing: 0.2 }}>{displayTime}</div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 850,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
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

      {/* ---------- SHIFT MENU (FloatingPanel) ---------- */}
      <FloatingPanel
  open={menuOpen}
  onClose={() => setMenuOpen(false)}
  title={`Shift Info • ${clientName}`}
  storageKey={`shift-menu:${week}:${a1Key}`}
  initial={{ w: 720, h: 520 }}
>
  <div style={{ display: "grid", gap: 10 }}>
          {shiftSummary ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              <Pill>{shiftSummary.client}</Pill>
              <Pill>{shiftSummary.dateStr}</Pill>
              <Pill>
                {shiftSummary.start}-{shiftSummary.end}
              </Pill>

              <button
                type="button"
                onClick={() => setShowDesc((vv) => !vv)}
                style={{
                  border: "1px solid rgba(15,23,42,0.18)",
                  background: "rgba(255,255,255,0.75)",
                  borderRadius: 999,
                  padding: "6px 10px",
                  fontWeight: 950,
                  cursor: "pointer",
                  color: "#0b1220",
                  fontSize: 12,
                }}
                title="Toggle description"
              >
                {showDesc ? "Hide description" : "Show description"}
              </button>

              {initialMenuLoading ? <TinySpinner label="Loading…" /> : null}
            </div>
          ) : (
            <div style={{ opacity: 0.9, fontWeight: 850, color: "#0b1220" }}>(No parsed time range for this cell)</div>
          )}

          {showDesc ? (
            <div
              style={{
                border: "1px solid rgba(15,23,42,0.14)",
                borderRadius: 12,
                padding: 10,
                background: "rgba(255,255,255,0.86)",
                color: "#0b1220",
                fontWeight: 850,
                whiteSpace: "pre-wrap",
              }}
            >
              {norm(clientDescription) ? clientDescription : "No description on file."}
            </div>
          ) : null}

          <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.85 }}>
            Destination:{" "}
            {clientsLoading ? (
              <SkeletonLine w="420px" />
            ) : clientDestination ? (
              clientDestination
            ) : (
              <span style={{ color: "#b91c1c" }}>Missing client address</span>
            )}
          </div>

          {/* Errors */}
          {weekSchedError ? <div style={{ fontWeight: 950, color: "#b91c1c" }}>Schedule error: {weekSchedError}</div> : null}
          {availError ? <div style={{ fontWeight: 950, color: "#b91c1c" }}>Availability error: {availError}</div> : null}
          {cgError ? <div style={{ fontWeight: 950, color: "#b91c1c" }}>Caregivers error: {cgError}</div> : null}
          {clientsError ? <div style={{ fontWeight: 950, color: "#b91c1c" }}>Clients error: {clientsError}</div> : null}
          {driveError ? <div style={{ fontWeight: 950, color: "#b91c1c" }}>Drive-time error: {driveError}</div> : null}

          <Section
            title={<span>Caregivers (Active this week)</span>}
            right={
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={() => loadWeekSchedule()}
                  style={{
                    border: "1px solid rgba(17,24,39,0.14)",
                    background: "rgba(255,255,255,0.9)",
                    borderRadius: 10,
                    padding: "6px 10px",
                    fontWeight: 950,
                    cursor: "pointer",
                    color: "#111827",
                    fontSize: 12,
                  }}
                >
                  Refresh schedule
                </button>
                <button
                  type="button"
                  onClick={() => loadAvailability()}
                  style={{
                    border: "1px solid rgba(17,24,39,0.14)",
                    background: "rgba(255,255,255,0.9)",
                    borderRadius: 10,
                    padding: "6px 10px",
                    fontWeight: 950,
                    cursor: "pointer",
                    color: "#111827",
                    fontSize: 12,
                  }}
                >
                  Refresh availability
                </button>
                <button
                  type="button"
                  onClick={() => loadClientHistory()}
                  style={{
                    border: "1px solid rgba(17,24,39,0.14)",
                    background: "rgba(255,255,255,0.9)",
                    borderRadius: 10,
                    padding: "6px 10px",
                    fontWeight: 950,
                    cursor: "pointer",
                    color: "#111827",
                    fontSize: 12,
                  }}
                >
                  Refresh history
                </button>
                <button
                  type="button"
                  onClick={() => loadCaregivers()}
                  style={{
                    border: "1px solid rgba(17,24,39,0.14)",
                    background: "rgba(255,255,255,0.9)",
                    borderRadius: 10,
                    padding: "6px 10px",
                    fontWeight: 950,
                    cursor: "pointer",
                    color: "#111827",
                    fontSize: 12,
                  }}
                >
                  Refresh caregivers
                </button>
                <button
                  type="button"
                  onClick={() => loadClients()}
                  style={{
                    border: "1px solid rgba(17,24,39,0.14)",
                    background: "rgba(255,255,255,0.9)",
                    borderRadius: 10,
                    padding: "6px 10px",
                    fontWeight: 950,
                    cursor: "pointer",
                    color: "#111827",
                    fontSize: 12,
                  }}
                >
                  Refresh clients
                </button>
              </div>
            }
          >
            {(weekSchedLoading || availLoading || cgLoading || clientsLoading) && (
              <div style={{ fontWeight: 900, opacity: 0.9, color: "#111827", display: "flex", gap: 10, alignItems: "center" }}>
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

            {/* Search + sort header */}
            <div
              style={{
                marginTop: 10,
                border: "1px solid rgba(17,24,39,0.10)",
                borderRadius: 12,
                background: "rgba(255,255,255,0.92)",
                overflow: "hidden",
              }}
            >
              <div style={{ padding: 10, borderBottom: "1px solid rgba(17,24,39,0.08)", background: "rgba(249,250,251,0.92)" }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 320px", minWidth: 260 }}>
                    <div style={{ fontWeight: 950, color: "#111827", fontSize: 12 }}>Search caregivers</div>
                    <input
                      value={caregiverSearch}
                      onChange={(e) => setCaregiverSearch(e.target.value)}
                      placeholder="Type a name…"
                      style={{
                        marginTop: 8,
                        width: "100%",
                        borderRadius: 10,
                        border: "1px solid rgba(17,24,39,0.14)",
                        padding: "8px 10px",
                        fontWeight: 850,
                        outline: "none",
                        background: "white",
                        color: "#111827",
                      }}
                    />
                  </div>

                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={{ fontSize: 12, fontWeight: 950, color: "rgba(17,24,39,0.70)" }}>Sort</div>
                    <select
                      value={sortMode}
                      onChange={(e) => setSortMode(e.target.value as SortMode)}
                      style={{
                        border: "1px solid rgba(17,24,39,0.14)",
                        borderRadius: 10,
                        padding: "8px 10px",
                        fontSize: 13,
                        outline: "none",
                        background: "white",
                        fontWeight: 850,
                        color: "#111827",
                        minWidth: 260,
                      }}
                    >
                      <option value="smart">Smart (score)</option>
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

                <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                  <Pill>{caregivers.length} shown</Pill>
                  <Pill>Active this week: {stats.total}</Pill>
                  <Pill>Conflicts: {stats.conflicts}</Pill>
                  <Pill>{dateStrForDow}</Pill>
                  {availTabName ? <Pill>Source: {availTabName}</Pill> : null}

                  {histLoading ? (
                    <TinySpinner label="History…" />
                  ) : histError ? (
                    <span style={{ fontWeight: 950, color: "#b91c1c" }}>{histError}</span>
                  ) : null}
                  {driveLoading ? <TinySpinner label="Drive times…" /> : null}
                </div>

                {availValues.length > 0 && (caregiverNameIdx < 0 || dayColIndexForSelectedDow < 0) ? (
                  <div style={{ marginTop: 10, fontSize: 12, fontWeight: 900, color: "#b45309" }}>
                    Heads up: availability headers didn’t match expected columns (Caregiver Name / day columns). We’ll still show all active caregivers.
                  </div>
                ) : null}
              </div>

              {/* Cards */}
              <div style={{ padding: 10, maxHeight: 560, overflow: "auto", background: "#e0f2fe", borderTop: "1px solid rgba(2,132,199,0.18)" }}>
                {initialMenuLoading && caregiversBase.length === 0 ? (
                  <div style={{ display: "grid", gap: 10 }}>
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div
                        key={i}
                        style={{
                          background: "#ffffff",
                          borderRadius: 14,
                          border: "1px solid rgba(15,23,42,0.14)",
                          boxShadow: "0 6px 18px rgba(15,23,42,0.08)",
                          padding: 12,
                          color: "#111827",
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
                      const desiredLabel = cg.desiredMeta.wantsMax ? "As many as possible" : `${cg.desiredMeta.hours}`;
                      const gapValue = cg.desiredMeta.wantsMax ? null : cg.desiredMeta.hours - cg.totalHours;

                      return (
                        <div
                          key={cg.key}
                          style={{
                            background: "#ffffff",
                            borderRadius: 14,
                            border: "1px solid rgba(15,23,42,0.14)",
                            boxShadow: "0 6px 18px rgba(15,23,42,0.08)",
                            padding: 12,
                            color: "#111827",
                          }}
                        >
                          {/* Header row */}
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                            <div style={{ minWidth: 0, flex: "1 1 auto" }}>
                              <div
                                style={{
                                  fontSize: 15,
                                  fontWeight: 1000,
                                  minWidth: 0,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                                title={cg.name}
                              >
                                {cg.name}
                              </div>

                              <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                                <span
                                  style={{
                                    fontSize: 12,
                                    fontWeight: 1000,
                                    padding: "4px 10px",
                                    borderRadius: 999,
                                    background: "rgba(2,132,199,0.10)",
                                    border: "1px solid rgba(2,132,199,0.22)",
                                    color: "#0b1220",
                                    whiteSpace: "nowrap",
                                  }}
                                  title={[
                                    `History: ${cg.scoreBreakdown.history}/30`,
                                    `Availability: ${cg.scoreBreakdown.availability}/30`,
                                    `Drive: ${cg.scoreBreakdown.drive_time}/20`,
                                    `Weekly: ${cg.scoreBreakdown.weekly_hours}/10`,
                                    `Cert: ${cg.scoreBreakdown.certification}/5`,
                                  ].join(" • ")}
                                >
                                  Score: {cg.scoreTotal}
                                </span>

                                {cg.hasConflict ? (
                                  <span
                                    style={{
                                      fontSize: 12,
                                      fontWeight: 1000,
                                      padding: "4px 10px",
                                      borderRadius: 999,
                                      background: "rgba(239,68,68,0.12)",
                                      border: "1px solid rgba(239,68,68,0.22)",
                                      color: "#7f1d1d",
                                      whiteSpace: "nowrap",
                                    }}
                                    title={`Conflicts: ${Math.round(cg.conflictMinutes)} minutes overlap`}
                                  >
                                    Conflict
                                  </span>
                                ) : (
                                  <span
                                    style={{
                                      fontSize: 12,
                                      fontWeight: 950,
                                      padding: "4px 10px",
                                      borderRadius: 999,
                                      background: "rgba(34,197,94,0.10)",
                                      border: "1px solid rgba(34,197,94,0.18)",
                                      color: "#065f46",
                                      whiteSpace: "nowrap",
                                    }}
                                    title="No overlap with today’s schedule"
                                  >
                                    No conflict
                                  </span>
                                )}

                                <span
                                  style={{
                                    fontSize: 12,
                                    fontWeight: 950,
                                    padding: "4px 10px",
                                    borderRadius: 999,
                                    background: "rgba(59,130,246,0.14)",
                                    border: "1px solid rgba(59,130,246,0.25)",
                                    color: "#0b1220",
                                    whiteSpace: "nowrap",
                                  }}
                                  title="Times worked with this client"
                                >
                                  {cg.historyCount}×
                                </span>

                                {cg.historyLast ? (
                                  <span
                                    style={{
                                      fontSize: 12,
                                      fontWeight: 900,
                                      padding: "4px 10px",
                                      borderRadius: 999,
                                      background: "rgba(2,132,199,0.10)",
                                      border: "1px solid rgba(2,132,199,0.20)",
                                      color: "#0b1220",
                                      whiteSpace: "nowrap",
                                    }}
                                    title="Last worked with this client"
                                  >
                                    Last: {formatMaybeDateLabel(cg.historyLast)}
                                  </span>
                                ) : (
                                  <span
                                    style={{
                                      fontSize: 12,
                                      fontWeight: 900,
                                      padding: "4px 10px",
                                      borderRadius: 999,
                                      background: "rgba(148,163,184,0.14)",
                                      border: "1px solid rgba(148,163,184,0.25)",
                                      color: "#0b1220",
                                      whiteSpace: "nowrap",
                                    }}
                                  >
                                    No history
                                  </span>
                                )}
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                openMessageToCaregiver({ id: cg.id, name: cg.name });
                              }}
                              disabled={!messagesUI || !norm(cg.id)}
                              style={{
                                border: "1px solid rgba(59,130,246,0.35)",
                                background: !messagesUI || !norm(cg.id) ? "rgba(148,163,184,0.25)" : "rgba(59,130,246,0.12)",
                                borderRadius: 12,
                                width: 44,
                                height: 44,
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                cursor: !messagesUI || !norm(cg.id) ? "not-allowed" : "pointer",
                                color: !messagesUI || !norm(cg.id) ? "rgba(17,24,39,0.45)" : "#2563eb",
                                flex: "0 0 auto",
                              }}
                              title={!messagesUI ? "Messaging unavailable" : !norm(cg.id) ? "Missing caregiverId" : "Message this caregiver"}
                              aria-label="Message this caregiver"
                            >
                              <MessageBubbleIcon size={22} />
                            </button>
                          </div>

                          {/* Metrics row */}
                          <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8 }}>
                            <span
                              style={{
                                fontSize: 12,
                                fontWeight: 950,
                                padding: "4px 10px",
                                borderRadius: 999,
                                background: "rgba(17,24,39,0.06)",
                                border: "1px solid rgba(17,24,39,0.10)",
                                color: "#0b1220",
                                whiteSpace: "nowrap",
                              }}
                              title="Total scheduled hours this week (from schedule)"
                            >
                              Total: {cg.totalHours.toFixed(1)}h
                            </span>

                            <span
                              style={{
                                fontSize: 12,
                                fontWeight: 950,
                                padding: "4px 10px",
                                borderRadius: 999,
                                background: "rgba(124,58,237,0.10)",
                                border: "1px solid rgba(124,58,237,0.18)",
                                color: "#0b1220",
                                whiteSpace: "nowrap",
                              }}
                              title={
                                gapValue == null
                                  ? "Desired is 'As many as possible'"
                                  : `Gap = Desired (${cg.desiredMeta.hours}) - Total (${cg.totalHours.toFixed(1)})`
                              }
                            >
                              Desired: {desiredLabel}
                              {gapValue == null ? "" : ` • Gap: ${gapValue.toFixed(1)}h`}
                            </span>

                            <span
                              style={{
                                fontSize: 12,
                                fontWeight: 950,
                                padding: "4px 10px",
                                borderRadius: 999,
                                background: "rgba(34,197,94,0.10)",
                                border: "1px solid rgba(34,197,94,0.18)",
                                color: "#0b1220",
                                whiteSpace: "nowrap",
                              }}
                              title="Number of shifts this caregiver has on this day"
                            >
                              Today shifts: {cg.dayShifts.length}
                            </span>

                            {/* Drive time chip */}
                            {driveLoading && cg.driveTimeMinutes == null && !cg.driveTimeText ? (
                              <span
                                style={{
                                  fontSize: 12,
                                  fontWeight: 950,
                                  padding: "4px 10px",
                                  borderRadius: 999,
                                  background: "rgba(245,158,11,0.10)",
                                  border: "1px solid rgba(245,158,11,0.18)",
                                  color: "#78350f",
                                  whiteSpace: "nowrap",
                                }}
                                title="Loading drive time…"
                              >
                                Drive: <span style={{ opacity: 0.75 }}>…</span>
                              </span>
                            ) : cg.driveTimeMinutes != null ? (
                              <span
                                style={{
                                  fontSize: 12,
                                  fontWeight: 950,
                                  padding: "4px 10px",
                                  borderRadius: 999,
                                  background: "rgba(245,158,11,0.12)",
                                  border: "1px solid rgba(245,158,11,0.22)",
                                  color: "#78350f",
                                  whiteSpace: "nowrap",
                                }}
                                title={cg.driveTimeText || `Drive time: ${cg.driveTimeMinutes} min`}
                              >
                                Drive: {Math.round(cg.driveTimeMinutes)}m
                              </span>
                            ) : (
                              <span
                                style={{
                                  fontSize: 12,
                                  fontWeight: 900,
                                  padding: "4px 10px",
                                  borderRadius: 999,
                                  background: "rgba(148,163,184,0.14)",
                                  border: "1px solid rgba(148,163,184,0.25)",
                                  color: "#0b1220",
                                  whiteSpace: "nowrap",
                                }}
                                title={
                                  clientDestination
                                    ? "Drive time unavailable (missing caregiver address or API returned no result)"
                                    : "Drive time unavailable (missing client address)"
                                }
                              >
                                Drive: —
                              </span>
                            )}
                          </div>

                          {/* Availability */}
                          <div style={{ marginTop: 12 }}>
                            <div style={{ fontSize: 11.5, fontWeight: 950, opacity: 0.75 }}>Availability (this day)</div>
                            <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                              <div>
                                <AvailabilityCell value={cg.availRaw || "—"} />
                              </div>

                              {(norm(cg.availLabel) || norm(cg.availSource)) && (
                                <AvailabilityPill label={cg.availLabel} source={cg.availSource} />
                              )}
                            </div>
                          </div>

                          {/* Day schedule */}
                          <div style={{ marginTop: 12 }}>
                            <div style={{ fontSize: 11.5, fontWeight: 950, opacity: 0.75 }}>Schedule for {dateStrForDow}</div>

                            {cg.dayShifts.length ? (
                              <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                                {cg.dayShifts.map((s, idx) => {
                                  const st = normalizeShiftStatusFromText(s.status);
                                  return (
                                    <div
                                      key={`${s.shiftId || idx}-${s.client}-${s.startTime}-${s.endTime}`}
                                      style={{
                                        border: "1px solid rgba(15,23,42,0.12)",
                                        borderRadius: 12,
                                        padding: "8px 10px",
                                        background: "rgba(248,250,252,0.95)",
                                        display: "flex",
                                        justifyContent: "space-between",
                                        gap: 10,
                                        alignItems: "center",
                                      }}
                                    >
                                      <div style={{ minWidth: 0 }}>
                                        <div
                                          style={{
                                            fontWeight: 950,
                                            color: "#111827",
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                            whiteSpace: "nowrap",
                                          }}
                                          title={s.client}
                                        >
                                          {s.client}
                                        </div>
                                        <div style={{ marginTop: 3, fontWeight: 850, opacity: 0.8, fontSize: 12 }}>
                                          {s.startTime}-{s.endTime}{" "}
                                          <span style={{ opacity: 0.8, fontWeight: 900 }}>
                                            • {shiftDurationHours(s.startTime, s.endTime).toFixed(1)}h
                                          </span>
                                        </div>
                                      </div>
                                      {s.status ? (
                                        <span
                                          style={{
                                            display: "inline-flex",
                                            alignItems: "center",
                                            borderRadius: 999,
                                            padding: "4px 10px",
                                            fontSize: 12,
                                            fontWeight: 950,
                                            lineHeight: 1.1,
                                            whiteSpace: "nowrap",
                                            background: "rgba(17,24,39,0.06)",
                                            border: "1px solid rgba(17,24,39,0.12)",
                                            color: "#111827",
                                          }}
                                          title={st}
                                        >
                                          {st}
                                        </span>
                                      ) : null}
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <div style={{ marginTop: 8, fontWeight: 900, opacity: 0.75, color: "#111827" }}>(No shifts)</div>
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
          </Section>
        </div>
      </FloatingPanel>
    </>
  );
}

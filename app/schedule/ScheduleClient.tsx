"use client";

import React, { useEffect, useMemo, useState } from "react";

type RawValues = string[][];
type WeekKind = "cw" | "nw";

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
  dow: number; // 0=Sun ... 6=Sat
};

type ConflictItem = {
  caregiverLabel: string;
  dateLabel: string;
  shiftAKey: string;
  shiftBKey: string;
  messageA: string;
  messageB: string;
};

type ClockEntry = {
  clockInTime: string | null;
  clockOutTime: string | null;
};

type ClockMap = Record<string, ClockEntry>;

// ✅ Location map types
type LocationEntry = {
  clockIn: { timestamp: string | null; verdict: string | null };
  clockOut: { timestamp: string | null; verdict: string | null };
};
type LocationMap = Record<string, LocationEntry>;

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

const DOW_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const UI = {
  pageBg: "#f3f4f6",
  panelBg: "#ffffff",
  headerBg: "#f9fafb",
  rowA: "#ffffff",
  rowB: "#f6f7f9",
  border: "#d1d5db",
  borderSoft: "#e5e7eb",
  text: "#111827",
  textDim: "#6b7280",
};

function norm(v: any) {
  return (v ?? "").toString().trim();
}

function normalizeKey(v: string) {
  return norm(v).toLowerCase();
}

function containsCI(haystack: string, needle: string) {
  const h = (haystack || "").toLowerCase();
  const n = (needle || "").toLowerCase().trim();
  if (!n) return true;
  return h.includes(n);
}

/** ---------- DATE + TIME parsing helpers ---------- */

function toDateSafe(dateStr: string): Date | null {
  const raw = norm(dateStr);
  if (!raw) return null;

  const d0 = new Date(raw);
  if (!Number.isNaN(d0.getTime())) return d0;

  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+.*)?$/);
  if (m) {
    const mm = parseInt(m[1], 10);
    const dd = parseInt(m[2], 10);
    const yyyy = parseInt(m[3], 10);
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      const d = new Date(yyyy, mm - 1, dd);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }

  return null;
}

function parseDateToDow(dateStr: string): number {
  const d = toDateSafe(dateStr);
  if (!d) return 0;
  return d.getDay();
}

function formatHeaderDate(d: Date | null): string {
  if (!d) return "";
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${m}/${day}`;
}

function dateKey(dateStr: string): string {
  const d = toDateSafe(dateStr);
  if (!d) return norm(dateStr);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseTimeToMinutes(t: string): number | null {
  const raw = norm(t);
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

function sortByStartTime(a: ShiftRow, b: ShiftRow): number {
  const am = parseTimeToMinutes(a.startTime);
  const bm = parseTimeToMinutes(b.startTime);
  if (am == null && bm == null) return (a.startTime || "").localeCompare(b.startTime || "");
  if (am == null) return 1;
  if (bm == null) return -1;
  return am - bm;
}

/** ---------- Schedule helpers ---------- */

function statusToColor(statusRaw: string): { bg: string; fg: string; border: string } {
  const s = (statusRaw || "").toLowerCase();
  if (s.includes("filled")) return { bg: "#1f7a3a", fg: "#ffffff", border: "#1f7a3a" };
  if (s.includes("offered")) return { bg: "#2b6fd6", fg: "#ffffff", border: "#2b6fd6" };
  if (s.includes("consider")) return { bg: "#d08a1a", fg: "#111111", border: "#d08a1a" };
  if (s.includes("open")) return { bg: "#d64545", fg: "#ffffff", border: "#d64545" };
  return { bg: "#3a3a3a", fg: "#ffffff", border: "#555" };
}

function scheduleTextColorForStatus(statusRaw: string): string {
  const s = (statusRaw || "").toLowerCase();
  if (s.includes("filled")) return "#16a34a";
  if (s.includes("offered")) return "#2563eb";
  if (s.includes("consider")) return "#d97706";
  if (s.includes("open")) return "#6b7280";
  return "#111827";
}

function normalize(values: RawValues): ShiftRow[] {
  if (!values || values.length === 0) return [];
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
    .filter((r) => r.some((cell) => norm(cell) !== ""))
    .map((r) => {
      const date = norm(r[iDate]);
      const status = norm(r[iStatus]);

      return {
        shiftId: norm(r[iShiftId]),
        date,
        client: norm(r[iClient]),
        caregiver: norm(r[iCaregiver]),
        caregiverId: norm(r[iCaregiverId]),
        startTime: norm(r[iStart]),
        endTime: norm(r[iEnd]),
        status,
        conflict: norm(r[iConflict]),
        dow: parseDateToDow(date),
      };
    });
}

function statusPriorityRank(statusRaw: string): number {
  const s = (statusRaw || "").toLowerCase();
  if (s.includes("open")) return 3;
  if (s.includes("consider")) return 2;
  if (s.includes("offered")) return 1;
  return 0;
}

function clientNameColorFromPriority(rank: number): string {
  if (rank >= 3) return "#d64545";
  if (rank === 2) return "#d08a1a";
  if (rank === 1) return "#2b6fd6";
  return "#111827";
}

function getShiftKey(s: ShiftRow): string {
  return (
    s.shiftId ||
    `${s.caregiverId || s.caregiver || "unknown"}|${s.date}|${s.client}|${s.startTime}|${s.endTime}`
  );
}

/** ---------- Client sorting by last name ---------- */

function clientLastNameKey(client: string): { last: string; first: string } {
  const raw = norm(client);
  if (!raw) return { last: "", first: "" };

  if (raw.includes(",")) {
    const [last, first] = raw.split(",").map((s) => s.trim());
    return { last: (last || "").toLowerCase(), first: (first || "").toLowerCase() };
  }

  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return { last: parts[0].toLowerCase(), first: "" };
  const last = parts[parts.length - 1].toLowerCase();
  const first = parts.slice(0, -1).join(" ").toLowerCase();
  return { last, first };
}

/** ---------- CLOCK VALIDATION ---------- */

function buildScheduledDate(dateStr: string, timeStr: string): Date | null {
  const base = toDateSafe(dateStr);
  const mins = parseTimeToMinutes(timeStr);
  if (!base || mins == null) return null;

  const d = new Date(base);
  const hh = Math.floor(mins / 60);
  const mm = mins % 60;
  d.setHours(hh, mm, 0, 0);
  return d;
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

function minutesDiff(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / 60000);
}

function fmtNiceTime(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function evalClockForShift(s: ShiftRow, clockMap: ClockMap, toleranceMin = 15): ClockEval {
  const entry = s.shiftId ? clockMap[s.shiftId] : undefined;

  const scheduledStart = buildScheduledDate(s.date, s.startTime);
  let scheduledEnd = buildScheduledDate(s.date, s.endTime);

  const startMin = parseTimeToMinutes(s.startTime);
  const endMin = parseTimeToMinutes(s.endTime);
  if (scheduledStart && scheduledEnd && startMin != null && endMin != null && endMin <= startMin) {
    scheduledEnd = addDays(scheduledEnd, 1);
  }

  const clockIn = entry?.clockInTime ? new Date(entry.clockInTime) : null;
  const clockOut = entry?.clockOutTime ? new Date(entry.clockOutTime) : null;

  const reasons: string[] = [];

  if (!entry || (!entry.clockInTime && !entry.clockOutTime)) {
    return {
      state: "none",
      scheduledStart,
      scheduledEnd,
      clockIn,
      clockOut,
      diffInMin: null,
      diffOutMin: null,
      reasons,
    };
  }

  if (!clockIn) reasons.push("Missing Clock In");
  if (!clockOut) reasons.push("Missing Clock Out");

  const diffInMin = clockIn && scheduledStart ? minutesDiff(clockIn, scheduledStart) : null;
  const diffOutMin = clockOut && scheduledEnd ? minutesDiff(clockOut, scheduledEnd) : null;

  if (diffInMin != null && Math.abs(diffInMin) > toleranceMin) reasons.push("Clock In outside 15m");
  if (diffOutMin != null && Math.abs(diffOutMin) > toleranceMin) reasons.push("Clock Out outside 15m");

  const isGood =
    Boolean(clockIn && clockOut && scheduledStart && scheduledEnd) &&
    diffInMin != null &&
    diffOutMin != null &&
    Math.abs(diffInMin) <= toleranceMin &&
    Math.abs(diffOutMin) <= toleranceMin;

  const state: ClockEval["state"] = isGood ? "good" : "bad";

  return {
    state,
    scheduledStart,
    scheduledEnd,
    clockIn,
    clockOut,
    diffInMin,
    diffOutMin,
    reasons: state === "bad" ? (reasons.length ? reasons : ["Clock issue"]) : [],
  };
}

/** ---------- Availability sidebar helpers ---------- */

function dayHeaderToDow(h: string): number | null {
  const raw = norm(h).toLowerCase();
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

function AvailabilityCell({ value }: { value: string }) {
  const v = norm(value);
  if (!v || v === "—") return <span style={{ color: "#9ca3af" }}>—</span>;

  const lower = v.toLowerCase();
  const isOff = lower === "off" || lower.includes("not available") || lower.includes("unavailable");
  const isOpen = lower === "open" || lower.includes("anytime") || lower.includes("available all day");

  const chipStyle: React.CSSProperties = {
    display: "inline-block",
    padding: "4px 8px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 800,
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

  return <span style={{ fontWeight: 700, color: UI.text, whiteSpace: "pre-wrap" }}>{v}</span>;
}

type AvailRow = {
  caregiverName: string;
  caregiverId: string;
  desiredHours: string;
  notes: string;
  byDow: Record<number, string>;
};

function caregiverKeyFromShift(s: ShiftRow): string {
  const cgId = norm(s.caregiverId);
  const cgName = norm(s.caregiver);
  const key = norm(cgId || cgName);
  return normalizeKey(key) === "open" ? "" : key;
}

function caregiverLookupKey(name: string, id: string) {
  return normalizeKey(id || name);
}

function fmtShiftLine(s: ShiftRow): string {
  const time = s.startTime && s.endTime ? `${s.startTime}–${s.endTime}` : "";
  const client = norm(s.client) || "Client";
  return `${time} • ${client}`;
}

/** ---------- Location verdict helpers ---------- */

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

// ✅ We DO NOT want long pills for these (they go under the time instead)
function isUnderTimeVerdict(v: string | null) {
  const x = normVerdict(v);
  return x === "location_unavailable" || x === "unknown";
}

function isOnSite(v: string | null) {
  const x = normVerdict(v);
  return x === "on_site" || x === "onsite" || x === "on site";
}

function isOffSite(v: string | null) {
  const x = normVerdict(v);
  return x === "off_site" || x === "offsite" || x === "off site";
}

/**
 * ✅ Compact verdict chip:
 * - Off site is RED
 * - On site is subtle
 * - No geofence is warning-ish
 * - Location unavailable / Unknown are NOT shown as chips (they render under time)
 */
function VerdictChip({ verdict }: { verdict: string | null }) {
  if (!verdict) return null;
  if (isUnderTimeVerdict(verdict)) return null;

  const label = verdictLabel(verdict);
  if (!label) return null;

  const offsite = isOffSite(verdict);
  const bad = isBadVerdict(verdict) || offsite;

  const bg = offsite
    ? "rgba(239,68,68,0.42)" // red
    : bad
    ? "rgba(245,158,11,0.28)" // warning for other bad-ish
    : "rgba(255,255,255,0.22)"; // normal

  const border = offsite
    ? "1px solid rgba(255,255,255,0.75)"
    : bad
    ? "1px solid rgba(255,255,255,0.55)"
    : "1px solid rgba(255,255,255,0.35)";

  return (
    <span
      style={{
        display: "inline-block",
        marginLeft: 6,
        padding: "2px 7px",
        borderRadius: 999,
        fontSize: 10.5,
        fontWeight: 950,
        lineHeight: 1.15,
        background: bg,
        border,
        color: "#fff",
        whiteSpace: "nowrap",
      }}
      title={verdict || undefined}
    >
      {label}
    </span>
  );
}

/** ---------- ✅ NEW: shift time state + display rules ---------- */

type ShiftTimeState = "future" | "in_progress" | "past" | "unknown";

function shiftTimeState(scheduledStart: Date | null, scheduledEnd: Date | null, nowMs: number): ShiftTimeState {
  if (!scheduledStart || !scheduledEnd) return "unknown";
  const start = scheduledStart.getTime();
  const end = scheduledEnd.getTime();
  if (nowMs < start) return "future";
  if (nowMs >= start && nowMs <= end) return "in_progress";
  return "past";
}

function clockDisplayLabelForPastOrProgress(
  which: "in" | "out",
  state: ShiftTimeState,
  clockEval: ClockEval
): string {
  if (which === "in") {
    if (clockEval.clockIn) return fmtNiceTime(clockEval.clockIn);
    return "No Clock In";
  }

  // OUT
  if (clockEval.clockOut) return fmtNiceTime(clockEval.clockOut);

  if (state === "in_progress") return "In progress";
  return "No Clock Out";
}

/** ---------- ✅ NEW: color helpers ---------- */

// Blend a hex color toward white by t (0..1)
function blendHexWithWhite(hex: string, t: number): string {
  const h = (hex || "").replace("#", "").trim();
  if (h.length !== 6) return hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);

  const rr = Math.round(r + (255 - r) * t);
  const gg = Math.round(g + (255 - g) * t);
  const bb = Math.round(b + (255 - b) * t);

  const out = `#${rr.toString(16).padStart(2, "0")}${gg.toString(16).padStart(2, "0")}${bb
    .toString(16)
    .padStart(2, "0")}`;
  return out;
}

function applyFutureShade(base: { bg: string; fg: string; border: string }, statusRaw: string, tState: ShiftTimeState) {
  const s = (statusRaw || "").toLowerCase();
  if (tState !== "future") return base;

  // Brighter green for future Filled (not washed out)
  if (s.includes("filled")) {
    return {
      ...base,
      bg: "#22c55e",      // brighter green
      border: "#16a34a",  // slightly deeper border
      fg: "#ffffff",
    };
  }

  return base;
}


/** ---------- ✅ NEW: clock + verdict line renderer (keeps cards short) ---------- */

function UnderTimeVerdictLine({ verdict }: { verdict: string | null }) {
  if (!verdict) return null;
  if (!isUnderTimeVerdict(verdict)) return null;

  // Make location unavailable / unknown visible but compact
  return (
    <div style={{ marginTop: 2, fontSize: 10.5, fontWeight: 900, opacity: 0.95, whiteSpace: "nowrap" }}>
      {verdictLabel(verdict)}
    </div>
  );
}

function ClockLine({
  label,
  timeText,
  verdict,
}: {
  label: "IN" | "OUT";
  timeText: string;
  verdict: string | null;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "flex-start",
        whiteSpace: "nowrap",
        flex: "0 0 auto",
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", whiteSpace: "nowrap" }}>
        <strong style={{ marginRight: 4 }}>{label}:</strong> {timeText}
        <VerdictChip verdict={verdict} />
      </span>
      <UnderTimeVerdictLine verdict={verdict} />
    </span>
  );
}

export default function ScheduleClient() {
  const [week, setWeek] = useState<WeekKind>("cw");
  const [tabName, setTabName] = useState<string>("");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<RawValues>([]);
  const [clockMap, setClockMap] = useState<ClockMap>({});
  const [locationMap, setLocationMap] = useState<LocationMap>({});

  const [showConflicts, setShowConflicts] = useState(false);

  const [selectedDow, setSelectedDow] = useState<number | null>(null);
  const [searchText, setSearchText] = useState("");

  const [availOpen, setAvailOpen] = useState(true);
  const [availLoading, setAvailLoading] = useState(false);
  const [availError, setAvailError] = useState<string | null>(null);
  const [availValues, setAvailValues] = useState<RawValues>([]);
  const [availTabName, setAvailTabName] = useState<string>("");
  const [availSearch, setAvailSearch] = useState("");
  const [availSelectedDow, setAvailSelectedDow] = useState<number | null>(null);

  useEffect(() => {
    setShowConflicts(false);
  }, [week]);

  useEffect(() => {
    let alive = true;

    async function run() {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch(`/api/schedule?week=${week}`, { cache: "no-store" });
        const text = await res.text();

        let data: any = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          throw new Error(`Non-JSON response (${res.status}): ${text.slice(0, 200)}`);
        }

        if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
        if (!data?.ok) throw new Error(data?.error || "Failed to load schedule");

        if (alive) {
          setValues(data.values ?? []);
          setTabName(data.tabName ?? "");
          setClockMap(data.clockMap ?? {});
          setLocationMap(data.locationMap ?? {});
        }
      } catch (e: any) {
        if (alive) setError(e?.message ?? "Unknown error");
      } finally {
        if (alive) setLoading(false);
      }
    }

    run();
    return () => {
      alive = false;
    };
  }, [week]);

  useEffect(() => {
    let alive = true;

    async function runAvail() {
      if (!availOpen) return;

      try {
        setAvailLoading(true);
        setAvailError(null);

        const res = await fetch(`/api/availability?week=${week}`, { cache: "no-store" });
        const data = await res.json();

        if (!data?.ok) throw new Error(data?.error || "Failed to load availability");
        if (alive) {
          setAvailValues(data.values ?? []);
          setAvailTabName(data.tabName ?? "");
        }
      } catch (e: any) {
        if (alive) setAvailError(e?.message ?? "Unknown error");
      } finally {
        if (alive) setAvailLoading(false);
      }
    }

    runAvail();
    return () => {
      alive = false;
    };
  }, [availOpen, week]);

  const shiftsAll = useMemo(() => normalize(values), [values]);

  const shifts = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return shiftsAll.filter((s) => {
      if (selectedDow != null && s.dow !== selectedDow) return false;
      if (!q) return true;
      const hay = `${s.client} ${s.caregiver} ${s.caregiverId}`.toLowerCase();
      return hay.includes(q);
    });
  }, [shiftsAll, selectedDow, searchText]);

  const clients = useMemo(() => {
    const set = new Set<string>();
    for (const s of shifts) if (s.client) set.add(s.client);

    const arr = Array.from(set);
    arr.sort((a, b) => {
      const ka = clientLastNameKey(a);
      const kb = clientLastNameKey(b);
      if (ka.last !== kb.last) return ka.last.localeCompare(kb.last);
      if (ka.first !== kb.first) return ka.first.localeCompare(kb.first);
      return a.localeCompare(b);
    });
    return arr;
  }, [shifts]);

  const headerDates = useMemo(() => {
    const byDow: Array<Date | null> = [null, null, null, null, null, null, null];
    for (const s of shifts) {
      const d = toDateSafe(s.date);
      if (!d) continue;
      const dow = s.dow ?? d.getDay();
      const current = byDow[dow];
      if (!current || d.getTime() < current.getTime()) byDow[dow] = d;
    }
    return byDow;
  }, [shifts]);

  const grid = useMemo(() => {
    const map: Record<string, Record<number, ShiftRow[]>> = {};
    for (const client of clients) map[client] = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };

    for (const s of shifts) {
      const client = s.client || "Unknown Client";
      if (!map[client]) map[client] = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
      map[client][s.dow].push(s);
    }

    for (const client of Object.keys(map)) {
      for (let dow = 0; dow <= 6; dow++) {
        map[client][dow].sort(sortByStartTime);
      }
    }
    return map;
  }, [clients, shifts]);

  const clientWorstRank = useMemo(() => {
    const out: Record<string, number> = {};
    for (const client of clients) out[client] = 0;
    for (const s of shifts) {
      const c = s.client || "Unknown Client";
      out[c] = Math.max(out[c] ?? 0, statusPriorityRank(s.status));
    }
    return out;
  }, [clients, shifts]);

  const clientHours = useMemo(() => {
    const out: Record<string, number> = {};
    for (const s of shifts) {
      const c = s.client || "Unknown Client";
      out[c] = (out[c] ?? 0) + shiftDurationHours(s.startTime, s.endTime);
    }
    return out;
  }, [shifts]);

  const totals = useMemo(() => {
    const clientCount = clients.length;
    const caregiverSet = new Set<string>();
    let totalHours = 0;

    for (const s of shifts) {
      totalHours += shiftDurationHours(s.startTime, s.endTime);
      const label = caregiverKeyFromShift(s);
      if (!label) continue;
      caregiverSet.add(caregiverLookupKey(label, ""));
    }

    return { clientCount, caregiverCount: caregiverSet.size, totalHours };
  }, [clients.length, shifts]);

  const { conflictByShiftKey, conflictList } = useMemo(() => {
    const byCaregiverDay: Record<string, ShiftRow[]> = {};

    for (const s of shifts) {
      const cgLabel = caregiverKeyFromShift(s);
      if (!cgLabel) continue;

      const dk = dateKey(s.date);
      const key = `${caregiverLookupKey(cgLabel, "")}__${dk}`;
      if (!byCaregiverDay[key]) byCaregiverDay[key] = [];
      byCaregiverDay[key].push(s);
    }

    const conflictMap: Record<string, string> = {};
    const list: ConflictItem[] = [];

    for (const groupKey of Object.keys(byCaregiverDay)) {
      const group = byCaregiverDay[groupKey];

      const intervals = group
        .map((s) => {
          const start = parseTimeToMinutes(s.startTime);
          const end0 = parseTimeToMinutes(s.endTime);
          if (start == null || end0 == null) return null;

          let end = end0;
          if (end <= start) end += 24 * 60;
          return { s, start, end, key: getShiftKey(s) };
        })
        .filter(Boolean) as Array<{ s: ShiftRow; start: number; end: number; key: string }>;

      intervals.sort((a, b) => a.start - b.start);

      for (let i = 0; i < intervals.length; i++) {
        for (let j = i + 1; j < intervals.length; j++) {
          const a = intervals[i];
          const b = intervals[j];
          if (b.start >= a.end) break;

          const caregiverLabel = norm(a.s.caregiver) || norm(a.s.caregiverId) || "Caregiver";
          const dateLabel = norm(a.s.date) || dateKey(a.s.date);

          const msgA = `Overlaps with: ${b.s.client} — ${norm(b.s.caregiver) || "(No caregiver)"} — ${b.s.startTime}–${b.s.endTime}`;
          const msgB = `Overlaps with: ${a.s.client} — ${norm(a.s.caregiver) || "(No caregiver)"} — ${a.s.startTime}–${a.s.endTime}`;

          conflictMap[a.key] = conflictMap[a.key] ? `${conflictMap[a.key]} | ${msgA}` : msgA;
          conflictMap[b.key] = conflictMap[b.key] ? `${conflictMap[b.key]} | ${msgB}` : msgB;

          list.push({
            caregiverLabel,
            dateLabel,
            shiftAKey: a.key,
            shiftBKey: b.key,
            messageA: msgA,
            messageB: msgB,
          });
        }
      }
    }

    const seen = new Set<string>();
    const deduped: ConflictItem[] = [];
    for (const c of list) {
      const sig = [c.shiftAKey, c.shiftBKey].sort().join("~~");
      if (seen.has(sig)) continue;
      seen.add(sig);
      deduped.push(c);
    }

    return { conflictByShiftKey: conflictMap, conflictList: deduped };
  }, [shifts]);

  const conflictCount = conflictList.length;

  /** ---------- Availability parsing ---------- */

  const availHeaders = useMemo(() => (availValues?.[0] ?? []).map((h) => norm(h)), [availValues]);
  const availRowsAll = useMemo(() => (availValues?.length ? availValues.slice(1) : []), [availValues]);

  const caregiverNameIdx = useMemo(
    () => availHeaders.findIndex((h) => h.toLowerCase() === "caregiver name"),
    [availHeaders]
  );
  const caregiverIdIdx = useMemo(
    () => availHeaders.findIndex((h) => h.toLowerCase() === "caregiver id"),
    [availHeaders]
  );

  const desiredHoursIdx = useMemo(
    () => availHeaders.findIndex((h) => h.toLowerCase() === "desired hours"),
    [availHeaders]
  );

  const notesIdx = useMemo(() => {
    const candidates = ["notes", "note", "caregiver notes", "availability notes"];
    for (const c of candidates) {
      const i = availHeaders.findIndex((h) => h.toLowerCase() === c);
      if (i !== -1) return i;
    }
    return -1;
  }, [availHeaders]);

  const dayCols = useMemo(() => {
    const out: Array<{ colIndex: number; dow: number }> = [];
    availHeaders.forEach((h, colIndex) => {
      const dow = dayHeaderToDow(h);
      if (dow != null) out.push({ colIndex, dow });
    });
    return out;
  }, [availHeaders]);

  const scheduleByCaregiver = useMemo(() => {
    const map: Record<string, { totalHours: number; byDow: Record<number, ShiftRow[]> }> = {};
    for (const s of shiftsAll) {
      const cgLabel = caregiverKeyFromShift(s);
      if (!cgLabel) continue;

      const lookup = caregiverLookupKey(cgLabel, "");

      if (!map[lookup]) {
        map[lookup] = {
          totalHours: 0,
          byDow: { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] },
        };
      }
      map[lookup].totalHours += shiftDurationHours(s.startTime, s.endTime);
      map[lookup].byDow[s.dow].push(s);
    }

    for (const k of Object.keys(map)) {
      for (let d = 0; d <= 6; d++) {
        map[k].byDow[d].sort(sortByStartTime);
      }
    }
    return map;
  }, [shiftsAll]);

  const availCards = useMemo((): AvailRow[] => {
    const out: AvailRow[] = [];

    for (const r of availRowsAll) {
      const caregiverName = caregiverNameIdx >= 0 ? norm(r[caregiverNameIdx]) : "";
      const caregiverId = caregiverIdIdx >= 0 ? norm(r[caregiverIdIdx]) : "";
      const label = caregiverName || caregiverId;
      if (!label) continue;

      const combined = `${caregiverName} ${caregiverId}`;
      if (availSearch.trim() && !containsCI(combined, availSearch)) continue;

      const desiredHours = desiredHoursIdx >= 0 ? norm(r[desiredHoursIdx]) : "";
      const notes = notesIdx >= 0 ? norm(r[notesIdx]) : "";

      const byDow: Record<number, string> = { 0: "—", 1: "—", 2: "—", 3: "—", 4: "—", 5: "—", 6: "—" };
      for (const dc of dayCols) {
        byDow[dc.dow] = norm(r[dc.colIndex]) || "—";
      }

      out.push({ caregiverName, caregiverId, desiredHours, notes, byDow });
    }

    out.sort((a, b) => (a.caregiverName || a.caregiverId).localeCompare(b.caregiverName || b.caregiverId));
    return out;
  }, [availRowsAll, caregiverNameIdx, caregiverIdIdx, dayCols, availSearch, desiredHoursIdx, notesIdx]);

  /** ---------- UI components ---------- */

  const DayChip = ({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) => (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: `1px solid ${active ? "#111827" : UI.border}`,
        background: active ? "#111827" : UI.panelBg,
        color: active ? "#fff" : UI.text,
        borderRadius: 999,
        padding: "6px 10px",
        fontSize: 12,
        cursor: "pointer",
        fontWeight: 900,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );

  return (
    <main
      style={{
        padding: 18,
        maxWidth: 2200,
        margin: "0 auto",
        color: UI.text,
        background: UI.pageBg,
        minHeight: "100vh",
      }}
    >
      <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>Schedule</h1>
          <p style={{ opacity: 0.8, marginTop: 6, fontSize: 13 }}>
            Source: <code>{tabName || (week === "cw" ? "All Shifts" : "NW All Shifts")}</code>
            {availOpen && (
              <span style={{ marginLeft: 10, fontSize: 12, color: UI.textDim }}>
                (Availability: {availLoading ? "loading…" : availError ? "error" : "ready"})
              </span>
            )}
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div
            style={{
              display: "inline-flex",
              border: `1px solid ${UI.border}`,
              background: UI.headerBg,
              borderRadius: 12,
              overflow: "hidden",
            }}
          >
            <button
              type="button"
              onClick={() => setWeek("cw")}
              style={{
                padding: "7px 10px",
                fontSize: 13,
                cursor: "pointer",
                border: "none",
                background: week === "cw" ? "#111827" : "transparent",
                color: week === "cw" ? "#fff" : UI.text,
                fontWeight: 800,
              }}
            >
              This Week
            </button>
            <button
              type="button"
              onClick={() => setWeek("nw")}
              style={{
                padding: "7px 10px",
                fontSize: 13,
                cursor: "pointer",
                border: "none",
                background: week === "nw" ? "#111827" : "transparent",
                color: week === "nw" ? "#fff" : UI.text,
                fontWeight: 800,
              }}
            >
              Next Week
            </button>
          </div>

          <button
            type="button"
            onClick={() => setAvailOpen((v) => !v)}
            style={{
              border: `1px solid ${UI.border}`,
              background: availOpen ? "#111827" : UI.headerBg,
              color: availOpen ? "#fff" : UI.text,
              borderRadius: 10,
              padding: "7px 10px",
              fontSize: 13,
              cursor: "pointer",
              fontWeight: 900,
            }}
            title="Show/hide Availability sidebar"
          >
            Availability: {availOpen ? "ON" : "OFF"}
          </button>

          <button
            type="button"
            onClick={() => setShowConflicts((v) => !v)}
            style={{
              border: `1px solid ${UI.border}`,
              background: conflictCount > 0 ? "#fdecec" : UI.headerBg,
              color: UI.text,
              borderRadius: 10,
              padding: "7px 10px",
              fontSize: 13,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
            title="Show scheduling conflicts"
          >
            <span style={{ fontWeight: 800 }}>Conflicts</span>
            <span
              style={{
                background: conflictCount > 0 ? "#d64545" : "#9ca3af",
                color: "#fff",
                borderRadius: 999,
                padding: "2px 8px",
                fontSize: 12,
                fontWeight: 800,
              }}
            >
              {conflictCount}
            </span>
          </button>

          <a
  href="/schedule/old-school"
  style={{ textDecoration: "underline", opacity: 0.9, fontSize: 13, fontWeight: 800 }}
>
  Old School Grid
</a>

<a href="/availability" style={{ textDecoration: "underline", opacity: 0.9, fontSize: 13 }}>
  Full Availability Page
</a>

<a href="/" style={{ textDecoration: "underline", opacity: 0.9, fontSize: 13 }}>
  Back to Login
</a>

        </div>
      </header>

      <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <DayChip label="All Days" active={selectedDow == null} onClick={() => setSelectedDow(null)} />
          {DOW_LABELS.map((d, idx) => (
            <DayChip key={d} label={d} active={selectedDow === idx} onClick={() => setSelectedDow(idx)} />
          ))}
        </div>

        <input
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="Search client or caregiver…"
          style={{
            marginLeft: "auto",
            width: 280,
            border: `1px solid ${UI.border}`,
            borderRadius: 12,
            padding: "8px 10px",
            fontSize: 13,
            outline: "none",
            background: UI.panelBg,
          }}
        />
      </div>

      <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ background: UI.panelBg, border: `1px solid ${UI.border}`, borderRadius: 12, padding: "8px 10px" }}>
          <div style={{ fontSize: 11, color: UI.textDim, fontWeight: 800 }}>Total Hours</div>
          <div style={{ fontSize: 16, fontWeight: 900 }}>{totals.totalHours.toFixed(1)}</div>
        </div>
        <div style={{ background: UI.panelBg, border: `1px solid ${UI.border}`, borderRadius: 12, padding: "8px 10px" }}>
          <div style={{ fontSize: 11, color: UI.textDim, fontWeight: 800 }}>Clients</div>
          <div style={{ fontSize: 16, fontWeight: 900 }}>{totals.clientCount}</div>
        </div>
        <div style={{ background: UI.panelBg, border: `1px solid ${UI.border}`, borderRadius: 12, padding: "8px 10px" }}>
          <div style={{ fontSize: 11, color: UI.textDim, fontWeight: 800 }}>Caregivers Scheduled</div>
          <div style={{ fontSize: 16, fontWeight: 900 }}>{totals.caregiverCount}</div>
        </div>
      </div>

      {loading && <p style={{ opacity: 0.85, marginTop: 12 }}>Loading…</p>}

      {!loading && error && (
        <pre
          style={{
            whiteSpace: "pre-wrap",
            background: UI.panelBg,
            padding: 12,
            borderRadius: 10,
            color: "salmon",
            marginTop: 12,
          }}
        >
          {error}
        </pre>
      )}

      {!loading && !error && (
        <div style={{ marginTop: 14, display: "flex", gap: 12, alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: availOpen ? 980 : 1200 }}>
            <div style={{ border: `1px solid ${UI.border}`, borderRadius: 12, background: UI.panelBg, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, tableLayout: "fixed" }}>
                <thead>
                  <tr>
                    {/* ✅ Freeze header row + left client col */}
                    <th
                      style={{
                        position: "sticky",
                        top: 0,
                        left: 0,
                        zIndex: 10,
                        background: UI.headerBg,
                        textAlign: "left",
                        padding: "10px 12px",
                        borderBottom: `1px solid ${UI.border}`,
                        width: 230,
                        fontSize: 13,
                        borderRight: `1px solid ${UI.borderSoft}`,
                      }}
                    >
                      Client (hrs)
                    </th>

                    {DOW_LABELS.map((d, i) => (
                      <th
                        key={d}
                        style={{
                          position: "sticky",
                          top: 0,
                          zIndex: 9,
                          background: UI.headerBg,
                          textAlign: "left",
                          padding: "10px 10px",
                          borderBottom: `1px solid ${UI.border}`,
                          fontSize: 13,
                          borderRight: i === 6 ? "none" : `1px solid ${UI.borderSoft}`,
                        }}
                      >
                        <div style={{ fontWeight: 700 }}>{d}</div>
                        <div style={{ fontSize: 12, color: UI.textDim, marginTop: 2 }}>{formatHeaderDate(headerDates[i])}</div>
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {clients.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ padding: 12, opacity: 0.85 }}>
                        No shifts found with the current filters.
                      </td>
                    </tr>
                  ) : (
                    clients.map((client, rowIndex) => {
                      const zebraBg = rowIndex % 2 === 0 ? UI.rowA : UI.rowB;
                      const worstRank = clientWorstRank[client] ?? 0;
                      const clientNameColor = clientNameColorFromPriority(worstRank);
                      const hrs = (clientHours[client] ?? 0).toFixed(1);

                      return (
                        <tr key={client}>
                          <td
                            style={{
                              position: "sticky",
                              left: 0,
                              zIndex: 2,
                              background: zebraBg,
                              padding: "10px 12px",
                              borderBottom: `1px solid ${UI.borderSoft}`,
                              fontWeight: 800,
                              fontSize: 13,
                              color: clientNameColor,
                              borderRight: `1px solid ${UI.borderSoft}`,
                            }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                              <span>{client}</span>
                              <span style={{ color: UI.textDim, fontWeight: 900 }}>{hrs}</span>
                            </div>
                          </td>

                          {DOW_LABELS.map((_, dow) => {
                            const items = grid[client]?.[dow] ?? [];
                            return (
                              <td
                                key={dow}
                                style={{
                                  verticalAlign: "top",
                                  padding: 8,
                                  borderBottom: `1px solid ${UI.borderSoft}`,
                                  background: zebraBg,
                                  borderRight: dow === 6 ? "none" : `1px solid ${UI.borderSoft}`,
                                }}
                              >
                                {items.length === 0 ? (
                                  <div style={{ opacity: 0.25, fontSize: 12 }}>—</div>
                                ) : (
                                  <div style={{ display: "grid", gap: 6 }}>
                                    {items.map((s) => {
                                      const key = getShiftKey(s);
                                      const conflictMsg = conflictByShiftKey[key];
                                      const hasConflict = Boolean(conflictMsg);

                                      const clockEval = evalClockForShift(s, clockMap, 15);
                                      const nowMs = Date.now();
                                      const tState = shiftTimeState(clockEval.scheduledStart, clockEval.scheduledEnd, nowMs);

                                      // ✅ base status color, then apply future shade for Filled
                                      const baseC = statusToColor(s.status);
                                      const c = applyFutureShade(baseC, s.status, tState);

                                      // Location lookup
                                      const loc = s.shiftId ? locationMap[s.shiftId] : undefined;
                                      const inVerdict = loc?.clockIn?.verdict ?? null;
                                      const outVerdict = loc?.clockOut?.verdict ?? null;

                                      const hasLocationIssue = Boolean(isBadVerdict(inVerdict) || isBadVerdict(outVerdict));

                                      // Clock issues (with "in-progress" exception)
                                      const hasClockIssueRaw = clockEval.state === "bad";
                                      const inIsGoodOrOk =
                                        Boolean(clockEval.clockIn) &&
                                        (clockEval.diffInMin == null || Math.abs(clockEval.diffInMin) <= 15);

                                      const isInProgressMissingOutButOk =
                                        tState === "in_progress" && inIsGoodOrOk && !clockEval.clockOut;

                                      const hasClockIssue = hasClockIssueRaw && !isInProgressMissingOutButOk;
                                      const hasClockGood = clockEval.state === "good";

                                      const showClockRow = tState !== "future"; // hide for future
                                      const inText = clockDisplayLabelForPastOrProgress("in", tState, clockEval);
                                      const outText = clockDisplayLabelForPastOrProgress("out", tState, clockEval);

                                      const showCombinedNoClock = tState === "past" && !clockEval.clockIn && !clockEval.clockOut;

                                      // ✅ Verified: past + good clocks + both on-site + no conflict + no location issues
                                      const isVerified =
                                        tState === "past" &&
                                        Boolean(clockEval.clockIn && clockEval.clockOut) &&
                                        clockEval.state === "good" &&
                                        isOnSite(inVerdict) &&
                                        isOnSite(outVerdict) &&
                                        !hasConflict &&
                                        !hasLocationIssue;

                                      // Show flag if any issue
                                      const showFlag = (hasClockIssue || hasLocationIssue || hasConflict) && !isVerified;

                                      const border = hasConflict
                                        ? "2px solid #ff4d4d"
                                        : hasLocationIssue
                                        ? "2px solid #ef4444"
                                        : hasClockIssue
                                        ? "2px solid #ef4444"
                                        : hasClockGood
                                        ? "2px solid #22c55e"
                                        : `1px solid ${c.border}`;

                                      const shadow = hasConflict
                                        ? "0 0 0 2px rgba(255,77,77,0.18)"
                                        : hasLocationIssue
                                        ? "0 0 0 2px rgba(239,68,68,0.18)"
                                        : hasClockIssue
                                        ? "0 0 0 2px rgba(239,68,68,0.18)"
                                        : hasClockGood
                                        ? "0 0 0 2px rgba(34,197,94,0.18)"
                                        : "none";

                                      const duration = shiftDurationHours(s.startTime, s.endTime).toFixed(1);

                                      const locationTooltip = hasLocationIssue
                                        ? `Location: ${[
                                            inVerdict ? `IN=${verdictLabel(inVerdict)}` : "",
                                            outVerdict ? `OUT=${verdictLabel(outVerdict)}` : "",
                                          ]
                                            .filter(Boolean)
                                            .join(", ")}`
                                        : "";

                                      return (
                                        <div
                                          key={key}
                                          style={{
                                            background: c.bg,
                                            color: c.fg,
                                            border,
                                            borderRadius: 10,
                                            padding: "7px 9px",
                                            lineHeight: 1.2,
                                            boxShadow: shadow,
                                            position: "relative",
                                          }}
                                          title={
                                            [
                                              hasConflict && conflictMsg ? conflictMsg : "",
                                              hasClockIssue && clockEval.reasons.length
                                                ? `Clock: ${clockEval.reasons.join(", ")}`
                                                : "",
                                              locationTooltip,
                                            ]
                                              .filter(Boolean)
                                              .join(" | ") || undefined
                                          }
                                        >
                                          {/* ✅ Top-right: Flag OR Verified */}
                                          {showFlag && (
                                            <span
                                              style={{
                                                position: "absolute",
                                                top: 6,
                                                right: 8,
                                                fontSize: 13,
                                                lineHeight: 1,
                                                color: "#fff",
                                                filter: "drop-shadow(0 1px 0 rgba(0,0,0,0.25))",
                                              }}
                                              aria-label="Flagged shift"
                                              title={
                                                [
                                                  hasConflict && conflictMsg ? "Conflict" : "",
                                                  hasClockIssue && clockEval.reasons.length ? clockEval.reasons.join(", ") : "",
                                                  hasLocationIssue ? "Off-site / location issue" : "",
                                                ]
                                                  .filter(Boolean)
                                                  .join(" | ")
                                              }
                                            >
                                              🚩
                                            </span>
                                          )}

                                         {isVerified && (
  <span
    style={{
      position: "absolute",
      top: 6,
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
    title="Verified (clock in/out + on-site)"
    aria-label="Verified"
  >
    ✓
  </span>
)}

                                          <div style={{ fontWeight: 950, fontSize: 12 }}>
                                            {s.startTime}–{s.endTime}
                                          </div>

                                          <div style={{ fontSize: 11, marginTop: 4, opacity: 0.95 }}>
                                            <span style={{ fontWeight: 900 }}>
                                              {norm(s.caregiver)
                                                ? s.caregiver
                                                : s.status.toLowerCase().includes("open")
                                                ? "Open"
                                                : "(No caregiver)"}
                                            </span>
                                            <span style={{ opacity: 0.85 }}> • {duration}h</span>
                                          </div>

                                          {/* ✅ Clock row (past/in-progress only) */}
                                          {showClockRow && (
                                            <div
                                              style={{
                                                fontSize: 11,
                                                marginTop: 6,
                                                display: "flex",
                                                gap: 10,
                                                flexWrap: "wrap",
                                                alignItems: "flex-start",
                                                opacity: 0.95,
                                                overflow: "hidden",
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
                                            </div>
                                          )}

                                          {hasConflict && conflictMsg && (
                                            <div style={{ marginTop: 6, fontSize: 11, fontWeight: 900, color: "#fff" }}>
                                              <span
                                                style={{
                                                  background: "#ff4d4d",
                                                  color: "#111",
                                                  borderRadius: 999,
                                                  padding: "2px 8px",
                                                  marginRight: 8,
                                                }}
                                              >
                                                Conflict!
                                              </span>
                                              <span style={{ fontWeight: 700 }}>
                                                {conflictMsg.replace("Overlaps with: ", "")}
                                              </span>
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Availability sidebar unchanged */}
          {availOpen && (
            <aside style={{ width: 420, position: "sticky", top: 90, alignSelf: "flex-start" }}>
              <div style={{ border: `1px solid ${UI.border}`, background: UI.panelBg, borderRadius: 12, overflow: "hidden" }}>
                <div style={{ padding: 12, borderBottom: `1px solid ${UI.borderSoft}`, background: UI.headerBg }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                    <div>
                      <div style={{ fontWeight: 950, fontSize: 14 }}>Availability</div>
                      <div style={{ fontSize: 12, color: UI.textDim, marginTop: 2 }}>
                        Source: <code>{availTabName || (week === "cw" ? "CW Availability" : "NW Availability")}</code>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setAvailOpen(false)}
                      style={{
                        border: `1px solid ${UI.border}`,
                        background: UI.panelBg,
                        borderRadius: 10,
                        padding: "6px 10px",
                        cursor: "pointer",
                        fontWeight: 900,
                        fontSize: 13,
                      }}
                    >
                      Close
                    </button>
                  </div>

                  <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                    <input
                      value={availSearch}
                      onChange={(e) => setAvailSearch(e.target.value)}
                      placeholder="Search caregivers…"
                      style={{
                        border: `1px solid ${UI.border}`,
                        borderRadius: 12,
                        padding: "8px 10px",
                        fontSize: 13,
                        outline: "none",
                        background: UI.panelBg,
                      }}
                    />

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <DayChip label="All" active={availSelectedDow == null} onClick={() => setAvailSelectedDow(null)} />
                      {DOW_LABELS.map((d, idx) => (
                        <DayChip
                          key={`av_${d}`}
                          label={d.slice(0, 3)}
                          active={availSelectedDow === idx}
                          onClick={() => setAvailSelectedDow(idx)}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                <div style={{ maxHeight: "calc(100vh - 180px)", overflow: "auto" }}>
                  {availLoading ? (
                    <div style={{ padding: 12, fontSize: 13, color: UI.textDim }}>Loading availability…</div>
                  ) : availError ? (
                    <div style={{ padding: 12, fontSize: 13, color: "salmon" }}>{availError}</div>
                  ) : availCards.length === 0 ? (
                    <div style={{ padding: 12, fontSize: 13, color: UI.textDim }}>No caregivers match this search.</div>
                  ) : (
                    <div style={{ display: "grid", gap: 10, padding: 12 }}>
                      {availCards.map((cg) => {
                        const displayName = cg.caregiverName || cg.caregiverId || "Caregiver";

                        const lookup = caregiverLookupKey(cg.caregiverName, cg.caregiverId);
                        const sched = scheduleByCaregiver[lookup];
                        const totalHours = sched?.totalHours ?? 0;

                        const showDows = availSelectedDow == null ? [0, 1, 2, 3, 4, 5, 6] : [availSelectedDow];

                        return (
                          <div
                            key={`${lookup}__${displayName}`}
                            style={{
                              border: `1px solid ${UI.borderSoft}`,
                              borderRadius: 12,
                              padding: 10,
                              background: UI.panelBg,
                            }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                              <div style={{ fontWeight: 950, fontSize: 13 }}>{displayName}</div>
                              <div style={{ fontSize: 12, color: UI.textDim, fontWeight: 900 }}>
                                {totalHours.toFixed(1)}h
                              </div>
                            </div>

                            <div style={{ marginTop: 6, fontSize: 12, color: UI.textDim, fontWeight: 800 }}>
                              Desired hours:{" "}
                              <span style={{ color: UI.text, fontWeight: 900 }}>{cg.desiredHours ? cg.desiredHours : "—"}</span>
                            </div>

                            <div style={{ marginTop: 10 }}>
                              {showDows.map((dow, idx) => {
                                const shiftsForDay = sched?.byDow?.[dow] ?? [];
                                return (
                                  <div
                                    key={`${lookup}_${dow}`}
                                    style={{
                                      paddingTop: idx === 0 ? 0 : 10,
                                      marginTop: idx === 0 ? 0 : 10,
                                      borderTop: idx === 0 ? "none" : `1px solid ${UI.borderSoft}`,
                                    }}
                                  >
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                                      <div style={{ fontSize: 12, fontWeight: 900, color: UI.textDim }}>
                                        {DOW_LABELS[dow]}
                                      </div>
                                      <div style={{ display: "flex", justifyContent: "flex-end" }}>
                                        <AvailabilityCell value={cg.byDow[dow] || "—"} />
                                      </div>
                                    </div>

                                    <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                                      {shiftsForDay.length === 0 ? (
                                        <div style={{ fontSize: 12, color: UI.textDim, opacity: 0.75 }}>(No shifts)</div>
                                      ) : (
                                        shiftsForDay.map((s) => (
                                          <div
                                            key={getShiftKey(s)}
                                            style={{
                                              fontSize: 12,
                                              fontWeight: 900,
                                              color: scheduleTextColorForStatus(s.status),
                                              lineHeight: 1.25,
                                            }}
                                            title={s.status || undefined}
                                          >
                                            {fmtShiftLine(s)}
                                            <span style={{ fontWeight: 800, marginLeft: 8, color: scheduleTextColorForStatus(s.status) }}>
                                              ({s.status || "status"})
                                            </span>
                                          </div>
                                        ))
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>

                            <div style={{ marginTop: 10, borderTop: `1px solid ${UI.borderSoft}`, paddingTop: 10 }}>
                              <div style={{ fontSize: 11, color: UI.textDim, fontWeight: 900 }}>Notes</div>
                              <div style={{ marginTop: 4, fontSize: 12, color: UI.text, whiteSpace: "pre-wrap" }}>
                                {cg.notes ? cg.notes : <span style={{ color: "#9ca3af" }}>—</span>}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </aside>
          )}
        </div>
      )}
    </main>
  );
}

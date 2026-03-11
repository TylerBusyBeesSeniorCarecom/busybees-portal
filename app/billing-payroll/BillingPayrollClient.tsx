"use client";

import React, { useEffect, useMemo, useState } from "react";

type WeekKind = "cw" | "nw";
type ViewMode = "billing" | "payroll";

/** ---- /api/schedule raw values ---- */
type RawValues = string[][];

/** ---- Normalized Shift Row ---- */
type ShiftRow = {
  shiftId: string;
  date: string;
  client: string;
  caregiver: string; // name on schedule (fallback)
  caregiverId: string;
  startTime: string;
  endTime: string;
  status: string;
  conflict?: string;
  dow?: number;
};

type ClockEntry = {
  clockInTime: string | null;
  clockOutTime: string | null;
};

type LocationEntry = {
  clockIn: { timestamp: string | null; verdict: string | null };
  clockOut: { timestamp: string | null; verdict: string | null };
};

type ScheduleMapsApiResponse = {
  ok: boolean;
  values?: RawValues;
  rows?: ShiftRow[];
  clockMap?: Record<string, ClockEntry>;
  locationMap?: Record<string, LocationEntry>;
  error?: string;
};

/** ---- Clients API (/api/clients) ---- */
type ClientsApiResponse = {
  ok: boolean;
  headers: string[];
  rows: string[][];
  meta?: any;
  error?: string;
};

/** ---- Caregivers API (/api/caregivers) ---- */
type CaregiverProfile = {
  caregiverId: string;
  nameOnSchedule: string;
  name: string;
  status?: string;
  certification?: string;
  role?: string;
  email?: string;
  phone?: string;
};
type CaregiversApiResponse = {
  ok: boolean;
  caregivers?: CaregiverProfile[];
  byId?: Record<string, CaregiverProfile>;
  idByNameOnSchedule?: Record<string, string>;
  error?: string;
};

const UI = {
  pageBg: "#f3f4f6",
  panelBg: "#ffffff",
  headerBg: "#f9fafb",
  border: "#d1d5db",
  borderSoft: "#e5e7eb",
  text: "#111827",
  textDim: "#6b7280",

  green: "#1f7a3a",
  red: "#d64545",
  blue: "#2b6fd6",
  orange: "#d08a1a",
  purple: "#7c3aed",
  gray: "#6b7280",
  slate: "#0f172a",
};

const DEFAULT_EXPORT_PAY_RATE = 16;

function money(n: number) {
  if (!isFinite(n)) return "$0.00";
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}
function norm(s: any) {
  return (s ?? "").toString().trim();
}
function normalizeName(s: string) {
  return norm(s).toLowerCase();
}
function parseRate(raw: string): number | null {
  const s = norm(raw);
  if (!s) return null;
  const m = s.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const v = Number(m[0]);
  return isFinite(v) ? v : null;
}
function parseNumber(raw: string): number | null {
  const s = norm(raw);
  if (!s) return null;
  const m = s.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const v = Number(m[0]);
  return isFinite(v) ? v : null;
}

/** ---------- normalize schedule values (accept schedule API "as-is") ---------- */
function normalizeScheduleValues(values: RawValues): ShiftRow[] {
  if (!values || values.length === 0) return [];
  const headers = (values[0] ?? []).map((h) => norm(h));
  const data = values.slice(1);

  const idx = (name: string) =>
    headers.findIndex((h) => h.toLowerCase() === name.toLowerCase());

  const iShiftId = idx("Shift ID");
  const iDate = idx("Date");
  const iClient = idx("Client");
  const iCaregiver = idx("Caregiver");
  const iCaregiverId = idx("Caregiver ID");
  const iStart = idx("Start Time");
  const iEnd = idx("End Time");
  const iStatus = idx("Status");
  const iConflict = idx("Conflict");

  return data
    .filter((r) => (r ?? []).some((cell) => norm(cell) !== ""))
    .map((r) => {
      const safe = r ?? [];
      return {
        shiftId: norm(safe[iShiftId]),
        date: norm(safe[iDate]),
        client: norm(safe[iClient]),
        caregiver: norm(safe[iCaregiver]),
        caregiverId: norm(safe[iCaregiverId]),
        startTime: norm(safe[iStart]),
        endTime: norm(safe[iEnd]),
        status: norm(safe[iStatus]),
        conflict: norm(safe[iConflict]),
      };
    });
}

/** ---------- Time parsing helpers ---------- */
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
function fmtMDY(d: Date) {
  const mm = d.getMonth() + 1;
  const dd = d.getDate();
  const yyyy = d.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

function parseTimeToMinutes(t: string): number | null {
  const raw = norm(t);
  if (!raw) return null;

  const m24 = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (m24) {
    const hh = Number(m24[1]);
    const mm = Number(m24[2]);
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) return hh * 60 + mm;
  }

  const normalized = raw
    .replace(/\s+/g, " ")
    .replace(/([AP]M)$/i, " $1")
    .replace(/\./g, "")
    .trim();

  const m12 = normalized.match(/^(\d{1,2})(?::(\d{2}))?\s*([AP]M)$/i);
  if (!m12) return null;

  let hh = parseInt(m12[1], 10);
  const mm = m12[2] ? parseInt(m12[2], 10) : 0;
  const ap = m12[3].toUpperCase();
  if (hh < 1 || hh > 12 || mm < 0 || mm > 59) return null;

  if (ap === "AM") {
    if (hh === 12) hh = 0;
  } else {
    if (hh !== 12) hh += 12;
  }
  return hh * 60 + mm;
}

function minutesToTimeLabel(mins: number): string {
  mins = ((mins % (24 * 60)) + (24 * 60)) % (24 * 60);
  let hh24 = Math.floor(mins / 60);
  const mm = mins % 60;
  const ap = hh24 >= 12 ? "PM" : "AM";
  let hh = hh24 % 12;
  if (hh === 0) hh = 12;
  const mmStr = mm.toString().padStart(2, "0");
  return `${hh}:${mmStr} ${ap}`;
}

function buildTimeOptions(step = 15) {
  const out: { label: string; value: string }[] = [];
  for (let m = 0; m < 24 * 60; m += step) {
    const label = minutesToTimeLabel(m);
    out.push({ label, value: label });
  }
  return out;
}

function buildScheduledDate(dateStr: string, timeStr: string): Date | null {
  const base = toDateSafe(dateStr);
  const mins = parseTimeToMinutes(timeStr);
  if (!base || mins == null) return null;

  const d = new Date(base);
  d.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
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

function hoursBetween(start: string, end: string): number {
  const s = parseTimeToMinutes(start);
  const e0 = parseTimeToMinutes(end);
  if (s == null || e0 == null) return 0;

  let e = e0;
  if (e <= s) e += 24 * 60;
  return (e - s) / 60;
}

/** ---------- Verdict helpers ---------- */
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
function isOnSite(v: string | null) {
  const x = normVerdict(v);
  return x === "on_site" || x === "onsite" || x === "on site";
}
function isOffSite(v: string | null) {
  const x = normVerdict(v);
  return x === "off_site" || x === "offsite" || x === "off site";
}
function isUnderTimeVerdict(v: string | null) {
  const x = normVerdict(v);
  return x === "location_unavailable" || x === "unknown";
}

/** ---------- Confirm evaluation ---------- */
type ShiftTimeState = "future" | "in_progress" | "past" | "unknown";
function shiftTimeState(
  scheduledStart: Date | null,
  scheduledEnd: Date | null,
  nowMs: number
): ShiftTimeState {
  if (!scheduledStart || !scheduledEnd) return "unknown";
  const start = scheduledStart.getTime();
  const end = scheduledEnd.getTime();
  if (nowMs < start) return "future";
  if (nowMs >= start && nowMs <= end) return "in_progress";
  return "past";
}

type ConfirmEval = {
  state: "confirmed" | "flagged" | "future" | "unknown";
  reasons: string[];
  diffInMin: number | null;
  diffOutMin: number | null;
  inVerdict: string | null;
  outVerdict: string | null;
};

function evalConfirmForShift(
  s: ShiftRow,
  clockMap: Record<string, ClockEntry>,
  locationMap: Record<string, LocationEntry>,
  toleranceMin = 15
): ConfirmEval {
  const shiftId = norm(s.shiftId);
  const clock = shiftId ? clockMap[shiftId] : undefined;
  const loc = shiftId ? locationMap[shiftId] : undefined;

  const scheduledStart = buildScheduledDate(s.date, s.startTime);
  let scheduledEnd = buildScheduledDate(s.date, s.endTime);

  const startMin = parseTimeToMinutes(s.startTime);
  const endMin = parseTimeToMinutes(s.endTime);
  if (
    scheduledStart &&
    scheduledEnd &&
    startMin != null &&
    endMin != null &&
    endMin <= startMin
  ) {
    scheduledEnd = addDays(scheduledEnd, 1);
  }

  const nowMs = Date.now();
  const tState = shiftTimeState(scheduledStart, scheduledEnd, nowMs);

  if (tState === "future") {
    return {
      state: "future",
      reasons: [],
      diffInMin: null,
      diffOutMin: null,
      inVerdict: null,
      outVerdict: null,
    };
  }

  const clockIn = clock?.clockInTime ? new Date(clock.clockInTime) : null;
  const clockOut = clock?.clockOutTime ? new Date(clock.clockOutTime) : null;

  const inVerdict = loc?.clockIn?.verdict ?? null;
  const outVerdict = loc?.clockOut?.verdict ?? null;

  if (!scheduledStart || !scheduledEnd) {
    const reasons: string[] = [];
    if (!clockIn) reasons.push("Missing Clock In");
    if (!clockOut) reasons.push("Missing Clock Out");
    if (!inVerdict) reasons.push("Missing IN verdict");
    if (!outVerdict) reasons.push("Missing OUT verdict");
    return {
      state: "unknown",
      reasons: reasons.length ? reasons : ["Missing/invalid schedule times"],
      diffInMin: null,
      diffOutMin: null,
      inVerdict,
      outVerdict,
    };
  }

  const reasons: string[] = [];
  const diffInMin = clockIn ? minutesDiff(clockIn, scheduledStart) : null;
  const diffOutMin = clockOut ? minutesDiff(clockOut, scheduledEnd) : null;

  if (!clockIn) reasons.push("Missing Clock In");
  if (!clockOut) reasons.push("Missing Clock Out");

  if (diffInMin != null && Math.abs(diffInMin) > toleranceMin) {
    reasons.push(
      diffInMin < 0
        ? `Clock In early (${Math.abs(diffInMin)}m)`
        : `Clock In late (${Math.abs(diffInMin)}m)`
    );
  }
  if (diffOutMin != null && Math.abs(diffOutMin) > toleranceMin) {
    reasons.push(
      diffOutMin < 0
        ? `Clock Out early (${Math.abs(diffOutMin)}m)`
        : `Clock Out late (${Math.abs(diffOutMin)}m)`
    );
  }

  if (!inVerdict) reasons.push("Missing IN verdict");
  if (!outVerdict) reasons.push("Missing OUT verdict");

  if (inVerdict && !isOnSite(inVerdict))
    reasons.push(`IN not on site (${verdictLabel(inVerdict)})`);
  if (outVerdict && !isOnSite(outVerdict))
    reasons.push(`OUT not on site (${verdictLabel(outVerdict)})`);

  if (inVerdict && isUnderTimeVerdict(inVerdict))
    reasons.push(`IN ${verdictLabel(inVerdict)}`);
  if (outVerdict && isUnderTimeVerdict(outVerdict))
    reasons.push(`OUT ${verdictLabel(outVerdict)}`);

  const confirmed =
    Boolean(clockIn && clockOut) &&
    diffInMin != null &&
    diffOutMin != null &&
    Math.abs(diffInMin) <= toleranceMin &&
    Math.abs(diffOutMin) <= toleranceMin &&
    isOnSite(inVerdict) &&
    isOnSite(outVerdict);

  return {
    state: confirmed ? "confirmed" : "flagged",
    reasons: confirmed ? [] : reasons.length ? reasons : ["Not confirmed"],
    diffInMin,
    diffOutMin,
    inVerdict,
    outVerdict,
  };
}

/** status filter */
function isWorkedShift(row: ShiftRow) {
  const s = normalizeName(row.status);
  if (s.includes("open")) return false;
  if (s.includes("cancel")) return false;
  return true;
}

/** ---------- Small UI bits ---------- */
function Pill({
  text,
  bg,
  color = "#fff",
  title,
}: {
  text: string;
  bg: string;
  color?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 8px",
        borderRadius: 999,
        background: bg,
        color,
        fontWeight: 900,
        fontSize: 11.5,
        lineHeight: 1.1,
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
}

function ReasonList({ reasons }: { reasons: string[] }) {
  if (!reasons.length) return null;
  return (
    <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 6 }}>
      {reasons.slice(0, 6).map((r, idx) => (
        <span
          key={`${r}_${idx}`}
          style={{
            display: "inline-block",
            padding: "2px 7px",
            borderRadius: 999,
            background: "rgba(239,68,68,0.10)",
            border: "1px solid rgba(239,68,68,0.28)",
            color: "#991b1b",
            fontSize: 10.5,
            fontWeight: 900,
            whiteSpace: "nowrap",
          }}
          title={r}
        >
          {r}
        </span>
      ))}
      {reasons.length > 6 ? (
        <span style={{ fontSize: 10.5, fontWeight: 900, color: UI.textDim }}>
          +{reasons.length - 6} more
        </span>
      ) : null}
    </div>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  width = 120,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  width?: number | string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width,
        padding: "6px 8px",
        borderRadius: 10,
        border: `1px solid ${UI.border}`,
        background: UI.panelBg,
        fontWeight: 800,
        outline: "none",
      }}
    />
  );
}

/** ---------- Payroll Shift type ---------- */
type PayrollShift = ShiftRow & {
  durationHours: number;
  confirmState: ConfirmEval["state"];
  reasons: string[];
  inVerdict: string | null;
  outVerdict: string | null;
  diffInMin: number | null;
  diffOutMin: number | null;
  payRate: number; // effective for export group display
  payDue: number;
  isManuallyConfirmed?: boolean; // local-only (for now)
  adjustedStartTime?: string;
  adjustedEndTime?: string;
};

export default function BillingPayrollClient() {
  const [week, setWeek] = useState<WeekKind>("cw");
  const [viewMode, setViewMode] = useState<ViewMode>("billing");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [clockMap, setClockMap] = useState<Record<string, ClockEntry>>({});
  const [locationMap, setLocationMap] = useState<Record<string, LocationEntry>>(
    {}
  );

  // shiftId -> pay rate input (payroll)
  const [payRateByShift, setPayRateByShift] = useState<Record<string, string>>(
    {}
  );

  // clientName (normalized) -> base rate from sheet
  const [clientRateMap, setClientRateMap] = useState<Record<string, number>>(
    {}
  );

  // ✅ Billing overrides (local-only)
  const [clientRateOverride, setClientRateOverride] = useState<Record<string, string>>(
    {}
  );
  const [clientScheduledOverride, setClientScheduledOverride] = useState<Record<string, string>>(
    {}
  );
  const [clientAdjustOverride, setClientAdjustOverride] = useState<Record<string, string>>(
    {}
  );

  // caregivers byId + missing profile list
  const [caregiverById, setCaregiverById] = useState<Record<
    string,
    CaregiverProfile
  >>({});
  const [missingCaregiverIds, setMissingCaregiverIds] = useState<string[]>([]);

  // Billing expanded clients
  const [expandedClients, setExpandedClients] = useState<Record<string, boolean>>(
    {}
  );

  // Payroll expanded caregivers
  const [expandedCaregivers, setExpandedCaregivers] = useState<Record<
    string,
    boolean
  >>({});

  // Search bars
  const [billingSearch, setBillingSearch] = useState("");
  const [payrollSearch, setPayrollSearch] = useState("");

  // Export side panel
  const [exportOpen, setExportOpen] = useState(false);

  // Local-only overrides
  const [manualConfirmByShiftId, setManualConfirmByShiftId] = useState<Record<
    string,
    boolean
  >>({});
  const [timeOverrideByShiftId, setTimeOverrideByShiftId] = useState<Record<
    string,
    { startTime: string; endTime: string }
  >>({});

  const timeOptions = useMemo(() => buildTimeOptions(15), []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        // 1) schedule + maps
        const schedRes = await fetch(
          `/api/schedule?week=${encodeURIComponent(week)}`,
          { cache: "no-store" }
        );
        const schedJson = (await schedRes.json()) as ScheduleMapsApiResponse;
        if (!schedJson.ok)
          throw new Error(schedJson.error || "Failed to load schedule");

        const rowsFromApi =
          (schedJson.rows && Array.isArray(schedJson.rows) && schedJson.rows) ||
          normalizeScheduleValues(schedJson.values ?? []);

        const clocks = schedJson.clockMap || {};
        const locs = schedJson.locationMap || {};

        // 2) clients rates
        const clientsRes = await fetch(`/api/clients`, { cache: "no-store" });
        const clientsJson = (await clientsRes.json()) as ClientsApiResponse;
        if (!clientsJson.ok)
          throw new Error(clientsJson.error || "Failed to load clients");

        const headers = clientsJson.headers || [];
        const rowsClients = clientsJson.rows || [];

        const nameIdx = headers.findIndex((h) => normalizeName(h) === "name");
        const rateIdx = headers.findIndex((h) => normalizeName(h) === "rate");

        const rateMap: Record<string, number> = {};
        if (nameIdx >= 0 && rateIdx >= 0) {
          for (const r of rowsClients) {
            const name = norm(r[nameIdx]);
            const rateRaw = norm(r[rateIdx]);
            const rate = parseRate(rateRaw);
            if (name && rate != null) rateMap[normalizeName(name)] = rate;
          }
        }

        // 3) caregivers profiles
        let byId: Record<string, CaregiverProfile> = {};
        try {
          const cgRes = await fetch(`/api/caregivers`, { cache: "no-store" });
          const cgJson = (await cgRes.json()) as CaregiversApiResponse;
          if (cgJson.ok && cgJson.byId) byId = cgJson.byId;
        } catch {
          // ignore; fallback will be schedule names
        }

        if (cancelled) return;

        setShifts(rowsFromApi);
        setClockMap(clocks);
        setLocationMap(locs);
        setClientRateMap(rateMap);
        setCaregiverById(byId);

        // reset expansions/searches on week change
        setExpandedClients({});
        setExpandedCaregivers({});
        setBillingSearch("");
        setPayrollSearch("");
        setExportOpen(false);

        // clear local per-shift overrides on week change
        setManualConfirmByShiftId({});
        setTimeOverrideByShiftId({});

        // keep billing overrides across week toggle? (feels safer to clear)
        setClientRateOverride({});
        setClientScheduledOverride({});
        setClientAdjustOverride({});
        setPayRateByShift({});
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Unknown error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [week]);

  const workedShifts = useMemo(() => shifts.filter(isWorkedShift), [shifts]);

  const weekLabel = useMemo(() => {
    const dates = shifts
      .map((s) => toDateSafe(s.date))
      .filter((d): d is Date => !!d)
      .sort((a, b) => a.getTime() - b.getTime());

    if (!dates.length) return week === "cw" ? "This Week" : "Next Week";
    const start = dates[0];
    const end = dates[dates.length - 1];
    return `Week of ${fmtMDY(start)} – ${fmtMDY(end)}`;
  }, [shifts, week]);

  // derive missing caregiver IDs (in schedule but not in caregiver sheet)
  useEffect(() => {
    const missing = new Set<string>();
    for (const s of workedShifts) {
      const id = norm(s.caregiverId);
      if (!id) continue;
      if (!caregiverById[id]) missing.add(id);
    }
    setMissingCaregiverIds(Array.from(missing).sort());
  }, [workedShifts, caregiverById]);

  const applyTimeOverride = (s: ShiftRow): ShiftRow => {
    const ov = timeOverrideByShiftId[norm(s.shiftId)];
    if (!ov) return s;
    return { ...s, startTime: ov.startTime, endTime: ov.endTime };
  };

  const evalByShiftId = useMemo(() => {
    const out: Record<string, ConfirmEval> = {};
    for (const raw of workedShifts) {
      const s = applyTimeOverride(raw);
      const id = norm(s.shiftId);
      if (!id) continue;
      out[id] = evalConfirmForShift(s, clockMap, locationMap, 15);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workedShifts, clockMap, locationMap, timeOverrideByShiftId]);

  const effectiveConfirmState = (shiftId: string, base: ConfirmEval | undefined) => {
    const manual = manualConfirmByShiftId[norm(shiftId)];
    if (manual) return "confirmed" as const;
    return base?.state ?? "unknown";
  };

  const totalsConfirm = useMemo(() => {
    let confirmedCount = 0;
    let flaggedCount = 0;
    let futureCount = 0;

    for (const s0 of workedShifts) {
      const id = norm(s0.shiftId);
      const ev = id ? evalByShiftId[id] : null;
      const state = effectiveConfirmState(id, ev ?? undefined);

      if (state === "confirmed") confirmedCount += 1;
      else if (state === "flagged") flaggedCount += 1;
      else if (state === "future") futureCount += 1;
    }
    return { confirmedCount, flaggedCount, futureCount };
  }, [workedShifts, evalByShiftId, manualConfirmByShiftId]);

  const caregiverDisplayName = (caregiverId: string, fallbackScheduleName: string) => {
    const p = caregiverById[norm(caregiverId)];
    return p?.name || fallbackScheduleName || "Unknown Caregiver";
  };

  const caregiverNameOnSchedule = (caregiverId: string, fallbackScheduleName: string) => {
    const p = caregiverById[norm(caregiverId)];
    return p?.nameOnSchedule || fallbackScheduleName || "";
  };

  /** ---- Client -> shifts (for dropdown + “finished” logic) ---- */
  const shiftsByClient = useMemo(() => {
    const map = new Map<string, ShiftRow[]>();
    for (const s0 of workedShifts) {
      const s = applyTimeOverride(s0);
      const key = normalizeName(s.client || "unknown");
      const prev = map.get(key) || [];
      prev.push(s);
      map.set(key, prev);
    }

    for (const [k, arr] of map.entries()) {
      arr.sort((a, b) => {
        const ad =
          (toDateSafe(a.date)?.getTime() ?? 0) - (toDateSafe(b.date)?.getTime() ?? 0);
        if (ad !== 0) return ad;
        const am = parseTimeToMinutes(a.startTime) ?? 0;
        const bm = parseTimeToMinutes(b.startTime) ?? 0;
        return am - bm;
      });
      map.set(k, arr);
    }

    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workedShifts, timeOverrideByShiftId]);

  const isClientFinished = (clientKey: string) => {
    const arr = shiftsByClient.get(clientKey) || [];
    if (!arr.length) return false;

    let hasFuture = false;
    let hasNonFuture = false;
    let allNonFutureConfirmed = true;

    for (const s of arr) {
      const id = norm(s.shiftId);
      const ev = id ? evalByShiftId[id] : undefined;
      const state = effectiveConfirmState(id, ev);

      if (state === "future") {
        hasFuture = true;
        continue;
      }
      hasNonFuture = true;
      if (state !== "confirmed") allNonFutureConfirmed = false;
    }

    return !hasFuture && hasNonFuture && allNonFutureConfirmed;
  };

  /** ---- Billing (by client) ---- */
  const billingRows = useMemo(() => {
    const map = new Map<
      string,
      {
        client: string;
        computedScheduledHours: number;
        confirmedHours: number;
        flaggedHours: number;
        flaggedShifts: number;
        baseRate: number | null;
      }
    >();

    for (const s0 of workedShifts) {
      const s = applyTimeOverride(s0);

      const client = norm(s.client) || "Unknown Client";
      const key = normalizeName(client);

      const dur = hoursBetween(s.startTime, s.endTime);

      const sid = norm(s.shiftId);
      const ev = sid ? evalByShiftId[sid] : undefined;
      const state = effectiveConfirmState(sid, ev);

      const confirmed = state === "confirmed";
      const flagged = state === "flagged";

      const prev = map.get(key) || {
        client,
        computedScheduledHours: 0,
        confirmedHours: 0,
        flaggedHours: 0,
        flaggedShifts: 0,
        baseRate: clientRateMap[key] ?? null,
      };

      prev.computedScheduledHours += dur;
      prev.confirmedHours += confirmed ? dur : 0;
      prev.flaggedHours += flagged ? dur : 0;
      prev.flaggedShifts += flagged ? 1 : 0;

      prev.client = client;
      prev.baseRate = clientRateMap[key] ?? prev.baseRate;

      map.set(key, prev);
    }

    let out = Array.from(map.entries()).map(([clientKey, v]) => {
      const rateOv = parseRate(clientRateOverride[clientKey] ?? "");
      const schedOv = parseNumber(clientScheduledOverride[clientKey] ?? "");
      const adj = parseNumber(clientAdjustOverride[clientKey] ?? "") ?? 0;

      const effectiveRate = rateOv ?? v.baseRate ?? null;
      const effectiveScheduledHours =
        schedOv != null && schedOv >= 0 ? schedOv : v.computedScheduledHours;

      const scheduledCharge =
        (effectiveRate ?? 0) * effectiveScheduledHours + adj;

      return {
        clientKey,
        client: v.client,
        computedScheduledHours: v.computedScheduledHours,
        effectiveScheduledHours,
        confirmedHours: v.confirmedHours,
        flaggedHours: v.flaggedHours,
        flaggedShifts: v.flaggedShifts,
        baseRate: v.baseRate,
        effectiveRate,
        adjustment: adj,
        scheduledCharge,
      };
    });

    out.sort((a, b) => a.client.localeCompare(b.client));

    // billing search
    const q = normalizeName(billingSearch);
    if (q) out = out.filter((r) => normalizeName(r.client).includes(q));

    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    workedShifts,
    evalByShiftId,
    clientRateMap,
    billingSearch,
    manualConfirmByShiftId,
    timeOverrideByShiftId,
    clientRateOverride,
    clientScheduledOverride,
    clientAdjustOverride,
  ]);

  const billingTotals = useMemo(() => {
    let effectiveScheduledHours = 0;
    let computedScheduledHours = 0;
    let confirmedHours = 0;
    let flaggedHours = 0;
    let flaggedShifts = 0;

    let scheduledCharges = 0;

    for (const r of billingRows) {
      computedScheduledHours += r.computedScheduledHours;
      effectiveScheduledHours += r.effectiveScheduledHours;
      confirmedHours += r.confirmedHours;
      flaggedHours += r.flaggedHours;
      flaggedShifts += r.flaggedShifts;
      scheduledCharges += r.scheduledCharge;
    }

    return {
      computedScheduledHours,
      effectiveScheduledHours,
      confirmedHours,
      flaggedHours,
      flaggedShifts,
      scheduledCharges,
    };
  }, [billingRows]);

  /** ---- Payroll (by caregiver) ---- */
  const payrollGroups = useMemo(() => {
    const map = new Map<
      string,
      {
        caregiverId: string;
        caregiverLabel: string;
        nameOnSchedule: string;
        hasProfile: boolean;
        shifts: PayrollShift[];
      }
    >();

    for (const s00 of workedShifts) {
      const s0 = applyTimeOverride(s00);

      const caregiverId = norm(s0.caregiverId) || "Unknown";
      const scheduleName = norm(s0.caregiver) || "Unknown Caregiver";
      const profile = caregiverById[caregiverId];

      const fullName = caregiverDisplayName(caregiverId, scheduleName);
      const nos = caregiverNameOnSchedule(caregiverId, scheduleName);

      const durationHours = hoursBetween(s0.startTime, s0.endTime);

      const sid = norm(s0.shiftId);
      const ev = sid ? evalByShiftId[sid] : undefined;
      const baseState = ev?.state ?? "unknown";
      const confirmState = effectiveConfirmState(sid, ev);

      const isConfirmed = confirmState === "confirmed";

      const payRateRaw = norm(payRateByShift[s0.shiftId] ?? "");
      const payRate = parseRate(payRateRaw) ?? DEFAULT_EXPORT_PAY_RATE;

      const payDue = isConfirmed ? durationHours * payRate : 0;

      const prev = map.get(caregiverId) || {
        caregiverId,
        caregiverLabel: fullName,
        nameOnSchedule: nos,
        hasProfile: Boolean(profile),
        shifts: [] as PayrollShift[],
      };

      prev.caregiverLabel = fullName;
      prev.nameOnSchedule = nos;
      prev.hasProfile = Boolean(profile);

      const payrollShift: PayrollShift = {
        shiftId: s0.shiftId,
        date: s0.date,
        client: s0.client,
        caregiver: s0.caregiver,
        caregiverId: s0.caregiverId,
        startTime: s0.startTime,
        endTime: s0.endTime,
        status: s0.status,
        conflict: s0.conflict,
        dow: s0.dow,

        durationHours,
        confirmState,
        reasons:
          ev?.reasons ?? (baseState === "future" ? [] : ["Not confirmed"]),
        inVerdict: ev?.inVerdict ?? null,
        outVerdict: ev?.outVerdict ?? null,
        diffInMin: ev?.diffInMin ?? null,
        diffOutMin: ev?.diffOutMin ?? null,
        payRate,
        payDue,
        isManuallyConfirmed: Boolean(manualConfirmByShiftId[sid]),
        adjustedStartTime: timeOverrideByShiftId[sid]?.startTime,
        adjustedEndTime: timeOverrideByShiftId[sid]?.endTime,
      };

      prev.shifts.push(payrollShift);
      map.set(caregiverId, prev);
    }

    let groups = Array.from(map.values()).map((g) => {
      g.shifts.sort((a, b) => {
        const ad =
          (toDateSafe(a.date)?.getTime() ?? 0) - (toDateSafe(b.date)?.getTime() ?? 0);
        if (ad !== 0) return ad;
        const am = parseTimeToMinutes(a.startTime) ?? 0;
        const bm = parseTimeToMinutes(b.startTime) ?? 0;
        return am - bm;
      });
      return g;
    });

    // payroll search (caregiver name / schedule name / id)
    const q = normalizeName(payrollSearch);
    if (q) {
      groups = groups.filter((g) => {
        return (
          normalizeName(g.caregiverLabel).includes(q) ||
          normalizeName(g.nameOnSchedule).includes(q) ||
          normalizeName(g.caregiverId).includes(q)
        );
      });
    }

    groups.sort((a, b) => a.caregiverLabel.localeCompare(b.caregiverLabel));
    return groups;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    workedShifts,
    evalByShiftId,
    payRateByShift,
    caregiverById,
    payrollSearch,
    manualConfirmByShiftId,
    timeOverrideByShiftId,
  ]);

  const payrollTotals = useMemo(() => {
    let scheduledHours = 0;
    let confirmedHours = 0;
    let flaggedHours = 0;
    let payDue = 0;
    let flaggedShifts = 0;

    for (const g of payrollGroups) {
      for (const s of g.shifts) {
        scheduledHours += s.durationHours;
        if (s.confirmState === "confirmed") confirmedHours += s.durationHours;
        if (s.confirmState === "flagged") {
          flaggedHours += s.durationHours;
          flaggedShifts += 1;
        }
        payDue += s.payDue;
      }
    }
    return { scheduledHours, confirmedHours, flaggedHours, flaggedShifts, payDue };
  }, [payrollGroups]);

  const isCaregiverFinished = (g: { shifts: PayrollShift[] }) => {
    if (!g.shifts.length) return false;
    let hasFuture = false;
    let hasNonFuture = false;
    let allNonFutureConfirmed = true;

    for (const s of g.shifts) {
      if (s.confirmState === "future") {
        hasFuture = true;
        continue;
      }
      hasNonFuture = true;
      if (s.confirmState !== "confirmed") allNonFutureConfirmed = false;
    }
    return !hasFuture && hasNonFuture && allNonFutureConfirmed;
  };

  // ✅ Export text (scheduled hours grouped by pay rate; default $16)
  const exportText = useMemo(() => {
    const lines: string[] = [];
    for (const g of payrollGroups) {
      const byRate = new Map<number, number>();
      for (const s of g.shifts) {
        const rate = s.payRate ?? DEFAULT_EXPORT_PAY_RATE;
        byRate.set(rate, (byRate.get(rate) || 0) + s.durationHours);
      }

      const parts = Array.from(byRate.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([rate, hrs]) => `${hrs.toFixed(2)} hrs @ $${rate.toFixed(2)}`);

      lines.push(`${g.caregiverLabel}: ${parts.join(" ; ")}`);
    }
    return lines.join("\n");
  }, [payrollGroups]);

  const Toggle = ({
    value,
    onChange,
  }: {
    value: ViewMode;
    onChange: (v: ViewMode) => void;
  }) => {
    const btn = (v: ViewMode, label: string) => {
      const active = value === v;
      return (
        <button
          onClick={() => onChange(v)}
          style={{
            padding: "8px 10px",
            borderRadius: 12,
            border: `1px solid ${active ? UI.slate : UI.border}`,
            background: active ? UI.slate : UI.panelBg,
            color: active ? "#fff" : UI.text,
            fontWeight: 950,
            fontSize: 13,
            cursor: "pointer",
            minWidth: 110,
          }}
        >
          {label}
        </button>
      );
    };

    return (
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {btn("billing", "Billing")}
        {btn("payroll", "Payroll")}
      </div>
    );
  };

  const confirmShiftLocal = (shiftId: string) => {
    const sid = norm(shiftId);
    if (!sid) return;
    setManualConfirmByShiftId((prev) => ({ ...prev, [sid]: true }));
  };

  const setShiftTimeLocal = (
    shiftId: string,
    patch: Partial<{ startTime: string; endTime: string }>
  ) => {
    const sid = norm(shiftId);
    if (!sid) return;
    setTimeOverrideByShiftId((prev) => {
      const cur = prev[sid] || { startTime: "", endTime: "" };
      const next = {
        startTime: patch.startTime ?? cur.startTime,
        endTime: patch.endTime ?? cur.endTime,
      };
      return { ...prev, [sid]: next };
    });
  };

  const ExportPanel = () => {
    if (!exportOpen) return null;

    const copyAll = async () => {
      try {
        await navigator.clipboard.writeText(exportText || "");
      } catch {
        // fallback (older browsers): create temp textarea
        const ta = document.createElement("textarea");
        ta.value = exportText || "";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
    };

    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(15,23,42,0.45)",
          zIndex: 50,
          display: "flex",
          justifyContent: "flex-end",
        }}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) setExportOpen(false);
        }}
      >
        <div
          style={{
            width: 520,
            maxWidth: "92vw",
            height: "100%",
            background: UI.panelBg,
            borderLeft: `1px solid ${UI.borderSoft}`,
            padding: 14,
            overflow: "auto",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 950 }}>Export</div>
              <div style={{ marginTop: 6, color: UI.textDim, fontSize: 13 }}>
                Scheduled hours grouped by pay rate (default{" "}
                <b>${DEFAULT_EXPORT_PAY_RATE}</b> if blank).
              </div>
            </div>

            <button
              onClick={() => setExportOpen(false)}
              style={{
                padding: "6px 10px",
                borderRadius: 10,
                border: `1px solid ${UI.border}`,
                background: UI.panelBg,
                fontWeight: 900,
                cursor: "pointer",
                height: 36,
              }}
            >
              Close
            </button>
          </div>

          <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              onClick={copyAll}
              style={{
                padding: "8px 10px",
                borderRadius: 12,
                border: `1px solid ${UI.slate}`,
                background: UI.slate,
                color: "#fff",
                fontWeight: 950,
                cursor: "pointer",
              }}
            >
              Copy all text
            </button>

            <div style={{ color: UI.textDim, fontSize: 13, display: "flex", alignItems: "center" }}>
              {payrollGroups.length} caregivers
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <textarea
              value={exportText}
              readOnly
              style={{
                width: "100%",
                minHeight: "70vh",
                resize: "vertical",
                padding: 12,
                borderRadius: 12,
                border: `1px solid ${UI.borderSoft}`,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                fontSize: 12.5,
                lineHeight: 1.5,
                outline: "none",
                background: UI.headerBg,
              }}
            />
          </div>
        </div>
      </div>
    );
  };

  const MiniSearch = ({
    value,
    onChange,
    placeholder,
  }: {
    value: string;
    onChange: (v: string) => void;
    placeholder: string;
  }) => (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        padding: "8px 10px",
        borderRadius: 12,
        border: `1px solid ${UI.border}`,
        background: UI.panelBg,
        fontWeight: 800,
        minWidth: 240,
        outline: "none",
      }}
    />
  );

  return (
    <div style={{ background: UI.pageBg, minHeight: "100vh", padding: 16, color: UI.text }}>
      <ExportPanel />

      <div style={{ maxWidth: 1300, margin: "0 auto" }}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 12,
          }}
        >
          <div>
            <div style={{ fontSize: 22, fontWeight: 950 }}>Billing &amp; Payroll</div>
            <div style={{ color: UI.textDim, marginTop: 4, fontSize: 13 }}>
              <b>{weekLabel}</b>
              <span style={{ marginLeft: 10 }}>
                ✅ <b>Confirmed</b> = clock in/out within <b>15m</b> of scheduled + <b>On site</b>{" "}
                verdict for both.
              </span>
            </div>

            <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <Pill text={`Confirmed: ${totalsConfirm.confirmedCount}`} bg="rgba(34,197,94,0.14)" color="#065f46" />
              <Pill text={`Flagged: ${totalsConfirm.flaggedCount}`} bg="rgba(239,68,68,0.14)" color="#991b1b" />
              {totalsConfirm.futureCount ? (
                <Pill text={`Future: ${totalsConfirm.futureCount}`} bg="rgba(148,163,184,0.25)" color="#334155" />
              ) : null}
            </div>

            {missingCaregiverIds.length ? (
              <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <Pill
                  text={`Missing caregiver profiles: ${missingCaregiverIds.length}`}
                  bg="rgba(245,158,11,0.18)"
                  color="#7c2d12"
                  title="These caregiver IDs appear on the schedule but are not in the Caregivers sheet."
                />
                <div style={{ color: UI.textDim, fontSize: 12 }}>
                  (They’ll show as “No profile” in Payroll.)
                </div>
              </div>
            ) : null}
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <Toggle value={viewMode} onChange={setViewMode} />

            <button
              onClick={() => setExportOpen(true)}
              style={{
                padding: "8px 10px",
                borderRadius: 12,
                border: `1px solid ${UI.border}`,
                background: UI.panelBg,
                fontWeight: 950,
                cursor: "pointer",
              }}
            >
              Export
            </button>

            <select
              value={week}
              onChange={(e) => setWeek(e.target.value as WeekKind)}
              style={{
                padding: "8px 10px",
                borderRadius: 12,
                border: `1px solid ${UI.border}`,
                background: UI.panelBg,
                fontWeight: 900,
                cursor: "pointer",
              }}
            >
              <option value="cw">This Week</option>
              <option value="nw">Next Week</option>
            </select>

            <a
              href="/schedule"
              style={{
                padding: "8px 10px",
                borderRadius: 12,
                border: `1px solid ${UI.border}`,
                background: UI.panelBg,
                textDecoration: "none",
                color: UI.text,
                fontWeight: 900,
                fontSize: 13,
              }}
            >
              Back to Schedule
            </a>
          </div>
        </div>

        {error && (
          <div
            style={{
              background: UI.panelBg,
              border: `1px solid ${UI.red}`,
              borderRadius: 12,
              padding: 12,
              marginBottom: 12,
              color: UI.red,
              fontWeight: 900,
            }}
          >
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ background: UI.panelBg, border: `1px solid ${UI.borderSoft}`, borderRadius: 12, padding: 16 }}>
            Loading…
          </div>
        ) : (
          <>
            {/* BILLING VIEW */}
            {viewMode === "billing" ? (
              <div style={{ background: UI.panelBg, border: `1px solid ${UI.borderSoft}`, borderRadius: 16 }}>
                <div
                  style={{
                    padding: 12,
                    borderBottom: `1px solid ${UI.borderSoft}`,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 12,
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 950 }}>Client Billing Report</div>
                    <div style={{ color: UI.textDim, fontSize: 13, marginTop: 6 }}>
                      Totals:{" "}
                      <b style={{ color: UI.slate }}>{billingTotals.effectiveScheduledHours.toFixed(2)}</b> scheduled hrs{" "}
                      <span style={{ color: UI.textDim }}>
                        (computed {billingTotals.computedScheduledHours.toFixed(2)}h)
                      </span>{" "}
                      / <b style={{ color: UI.slate }}>{billingTotals.confirmedHours.toFixed(2)}</b> confirmed hrs ·{" "}
                      <b style={{ color: UI.slate }}>{money(billingTotals.scheduledCharges)}</b> estimated charge
                      {billingTotals.flaggedShifts ? (
                        <span style={{ marginLeft: 10 }}>
                          · <b style={{ color: UI.red }}>{billingTotals.flaggedShifts}</b> flagged shifts (
                          {billingTotals.flaggedHours.toFixed(2)}h)
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <MiniSearch value={billingSearch} onChange={setBillingSearch} placeholder="Search clients…" />
                </div>

                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
                    <thead>
                      <tr>
                        {[
                          "Client (tap to expand)",
                          "Scheduled Hours (editable)",
                          "Confirmed Hours",
                          "Flagged (hrs)",
                          "Rate (editable)",
                          "Adj (+/-)",
                          "Estimated Charge",
                        ].map((h) => (
                          <th
                            key={h}
                            style={{
                              textAlign: "left",
                              padding: 10,
                              fontSize: 12,
                              color: UI.textDim,
                              background: UI.headerBg,
                              borderBottom: `1px solid ${UI.borderSoft}`,
                              position: "sticky",
                              top: 0,
                              zIndex: 2,
                              whiteSpace: "nowrap",
                            }}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>

                    <tbody>
                      {billingRows.map((r) => {
                        const hasFlagged = r.flaggedShifts > 0;
                        const open = !!expandedClients[r.clientKey];
                        const clientShifts = shiftsByClient.get(r.clientKey) || [];
                        const finished = isClientFinished(r.clientKey);

                        const rateInput = clientRateOverride[r.clientKey] ?? "";
                        const schedInput = clientScheduledOverride[r.clientKey] ?? "";
                        const adjInput = clientAdjustOverride[r.clientKey] ?? "";

                        return (
                          <React.Fragment key={r.clientKey}>
                            <tr>
                              <td style={{ padding: 10, borderBottom: `1px solid ${UI.borderSoft}`, fontWeight: 950 }}>
                                <button
                                  onClick={() =>
                                    setExpandedClients((prev) => ({ ...prev, [r.clientKey]: !prev[r.clientKey] }))
                                  }
                                  style={{
                                    all: "unset",
                                    cursor: "pointer",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 8,
                                  }}
                                  title="Show shifts"
                                >
                                  <span
                                    style={{
                                      display: "inline-block",
                                      width: 16,
                                      textAlign: "center",
                                      color: UI.textDim,
                                      fontWeight: 950,
                                    }}
                                  >
                                    {open ? "▾" : "▸"}
                                  </span>
                                  <span style={{ color: finished ? UI.green : UI.text }}>
                                    {r.client}
                                  </span>
                                  {finished ? (
                                    <span style={{ marginLeft: 8 }}>
                                      <Pill text="Finished" bg="rgba(34,197,94,0.14)" color="#065f46" />
                                    </span>
                                  ) : null}
                                  {hasFlagged ? (
                                    <span style={{ marginLeft: 8 }}>
                                      <Pill text={`${r.flaggedShifts} flagged`} bg="rgba(239,68,68,0.14)" color="#991b1b" />
                                    </span>
                                  ) : null}
                                </button>
                              </td>

                              <td style={{ padding: 10, borderBottom: `1px solid ${UI.borderSoft}` }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                                  <TextInput
                                    value={schedInput}
                                    onChange={(v) =>
                                      setClientScheduledOverride((prev) => ({
                                        ...prev,
                                        [r.clientKey]: v,
                                      }))
                                    }
                                    placeholder={r.computedScheduledHours.toFixed(2)}
                                    width={120}
                                  />
                                  <span style={{ color: UI.textDim, fontWeight: 900, fontSize: 12 }}>
                                    (computed {r.computedScheduledHours.toFixed(2)}h)
                                  </span>
                                </div>
                              </td>

                              <td style={{ padding: 10, borderBottom: `1px solid ${UI.borderSoft}`, fontWeight: 900 }}>
                                <span style={{ color: r.confirmedHours ? UI.green : UI.textDim }}>
                                  {r.confirmedHours.toFixed(2)}
                                </span>
                              </td>

                              <td style={{ padding: 10, borderBottom: `1px solid ${UI.borderSoft}` }}>
                                {r.flaggedHours ? (
                                  <span style={{ color: UI.red, fontWeight: 900 }}>{r.flaggedHours.toFixed(2)}</span>
                                ) : (
                                  "—"
                                )}
                              </td>

                              <td style={{ padding: 10, borderBottom: `1px solid ${UI.borderSoft}` }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                                  <TextInput
                                    value={rateInput}
                                    onChange={(v) =>
                                      setClientRateOverride((prev) => ({ ...prev, [r.clientKey]: v }))
                                    }
                                    placeholder={r.baseRate == null ? "Missing" : r.baseRate.toFixed(2)}
                                    width={120}
                                  />
                                  <span style={{ color: UI.textDim, fontWeight: 900, fontSize: 12 }}>
                                    effective:{" "}
                                    <b style={{ color: r.effectiveRate == null ? UI.red : UI.slate }}>
                                      {r.effectiveRate == null ? "—" : money(r.effectiveRate)}
                                    </b>
                                  </span>
                                </div>
                              </td>

                              <td style={{ padding: 10, borderBottom: `1px solid ${UI.borderSoft}` }}>
                                <TextInput
                                  value={adjInput}
                                  onChange={(v) =>
                                    setClientAdjustOverride((prev) => ({ ...prev, [r.clientKey]: v }))
                                  }
                                  placeholder="0.00"
                                  width={120}
                                />
                              </td>

                              <td style={{ padding: 10, borderBottom: `1px solid ${UI.borderSoft}`, fontWeight: 950 }}>
                                {money(r.scheduledCharge)}
                              </td>
                            </tr>

                            {open ? (
                              <tr>
                                <td colSpan={7} style={{ padding: 0, borderBottom: `1px solid ${UI.borderSoft}` }}>
                                  <div style={{ padding: 12 }}>
                                    <div style={{ border: `1px solid ${UI.borderSoft}`, borderRadius: 12, overflow: "hidden" }}>
                                      <div style={{ overflowX: "auto" }}>
                                        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
                                          <thead>
                                            <tr>
                                              {["Date", "Caregiver", "Time (adjustable)", "Confirm", "Actions"].map((h) => (
                                                <th
                                                  key={h}
                                                  style={{
                                                    textAlign: "left",
                                                    padding: 10,
                                                    fontSize: 12,
                                                    color: UI.textDim,
                                                    background: UI.headerBg,
                                                    borderBottom: `1px solid ${UI.borderSoft}`,
                                                    whiteSpace: "nowrap",
                                                  }}
                                                >
                                                  {h}
                                                </th>
                                              ))}
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {clientShifts.map((s) => {
                                              const id = norm(s.shiftId);
                                              const ev = evalByShiftId[id];
                                              const state = effectiveConfirmState(id, ev);

                                              const badge =
                                                state === "confirmed" ? (
                                                  <Pill text="Confirmed" bg={UI.green} />
                                                ) : state === "flagged" ? (
                                                  <Pill text="Flagged" bg={UI.red} />
                                                ) : state === "future" ? (
                                                  <Pill text="Future" bg="rgba(148,163,184,0.75)" color="#0f172a" />
                                                ) : (
                                                  <Pill text="Unknown" bg="rgba(100,116,139,0.75)" color="#0f172a" />
                                                );

                                              const cgFull = caregiverDisplayName(s.caregiverId, s.caregiver);
                                              const cgNos = caregiverNameOnSchedule(s.caregiverId, s.caregiver);

                                              return (
                                                <tr key={s.shiftId}>
                                                  <td style={{ padding: 10, borderBottom: `1px solid ${UI.borderSoft}`, whiteSpace: "nowrap" }}>
                                                    {s.date}
                                                  </td>

                                                  <td
                                                    style={{ padding: 10, borderBottom: `1px solid ${UI.borderSoft}`, fontWeight: 900 }}
                                                    title={cgNos && cgNos !== cgFull ? `Name on schedule: ${cgNos}` : undefined}
                                                  >
                                                    {cgFull}
                                                  </td>

                                                  <td style={{ padding: 10, borderBottom: `1px solid ${UI.borderSoft}`, whiteSpace: "nowrap" }}>
                                                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                                                      <select
                                                        value={timeOverrideByShiftId[id]?.startTime ?? s.startTime}
                                                        onChange={(e) =>
                                                          setShiftTimeLocal(id, {
                                                            startTime: e.target.value,
                                                            endTime: timeOverrideByShiftId[id]?.endTime ?? s.endTime,
                                                          })
                                                        }
                                                        style={{
                                                          padding: "6px 8px",
                                                          borderRadius: 10,
                                                          border: `1px solid ${UI.border}`,
                                                          background: UI.panelBg,
                                                          fontWeight: 800,
                                                          cursor: "pointer",
                                                        }}
                                                      >
                                                        {timeOptions.map((opt) => (
                                                          <option key={opt.value} value={opt.value}>
                                                            {opt.label}
                                                          </option>
                                                        ))}
                                                      </select>

                                                      <span style={{ color: UI.textDim, fontWeight: 900 }}>–</span>

                                                      <select
                                                        value={timeOverrideByShiftId[id]?.endTime ?? s.endTime}
                                                        onChange={(e) =>
                                                          setShiftTimeLocal(id, {
                                                            startTime: timeOverrideByShiftId[id]?.startTime ?? s.startTime,
                                                            endTime: e.target.value,
                                                          })
                                                        }
                                                        style={{
                                                          padding: "6px 8px",
                                                          borderRadius: 10,
                                                          border: `1px solid ${UI.border}`,
                                                          background: UI.panelBg,
                                                          fontWeight: 800,
                                                          cursor: "pointer",
                                                        }}
                                                      >
                                                        {timeOptions.map((opt) => (
                                                          <option key={opt.value} value={opt.value}>
                                                            {opt.label}
                                                          </option>
                                                        ))}
                                                      </select>

                                                      <span style={{ color: UI.textDim, fontWeight: 900 }}>
                                                        (
                                                        {hoursBetween(
                                                          timeOverrideByShiftId[id]?.startTime ?? s.startTime,
                                                          timeOverrideByShiftId[id]?.endTime ?? s.endTime
                                                        ).toFixed(2)}
                                                        h)
                                                      </span>
                                                    </div>
                                                  </td>

                                                  <td style={{ padding: 10, borderBottom: `1px solid ${UI.borderSoft}` }}>
                                                    {badge}
                                                    {state === "flagged" && ev?.reasons?.length ? <ReasonList reasons={ev.reasons} /> : null}
                                                  </td>

                                                  <td style={{ padding: 10, borderBottom: `1px solid ${UI.borderSoft}` }}>
                                                    {state === "flagged" ? (
                                                      <button
                                                        onClick={() => confirmShiftLocal(id)}
                                                        style={{
                                                          padding: "6px 10px",
                                                          borderRadius: 10,
                                                          border: `1px solid ${UI.green}`,
                                                          background: "rgba(34,197,94,0.10)",
                                                          color: UI.green,
                                                          fontWeight: 950,
                                                          cursor: "pointer",
                                                        }}
                                                        title="Local override (does not write to Sheets yet)"
                                                      >
                                                        Confirm shift
                                                      </button>
                                                    ) : (
                                                      <span style={{ color: UI.textDim, fontWeight: 900 }}>—</span>
                                                    )}
                                                  </td>
                                                </tr>
                                              );
                                            })}

                                            {clientShifts.length === 0 ? (
                                              <tr>
                                                <td colSpan={5} style={{ padding: 12, color: UI.textDim }}>
                                                  No shifts found for this client.
                                                </td>
                                              </tr>
                                            ) : null}
                                          </tbody>
                                        </table>
                                      </div>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            ) : null}
                          </React.Fragment>
                        );
                      })}

                      {billingRows.length === 0 && (
                        <tr>
                          <td colSpan={7} style={{ padding: 12, color: UI.textDim }}>
                            No shifts found for this week.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {/* PAYROLL VIEW */}
            {viewMode === "payroll" ? (
              <div style={{ background: UI.panelBg, border: `1px solid ${UI.borderSoft}`, borderRadius: 16 }}>
                <div
                  style={{
                    padding: 12,
                    borderBottom: `1px solid ${UI.borderSoft}`,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 12,
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 950 }}>Payroll Report</div>
                    <div style={{ color: UI.textDim, fontSize: 13, marginTop: 6 }}>
                      Totals:{" "}
                      <b style={{ color: UI.green }}>{payrollTotals.confirmedHours.toFixed(2)}</b> confirmed hrs ·{" "}
                      <b style={{ color: UI.red }}>{payrollTotals.flaggedHours.toFixed(2)}</b> flagged hrs ·{" "}
                      <b style={{ color: UI.slate }}>{money(payrollTotals.payDue)}</b>{" "}
                      {payrollTotals.flaggedShifts ? (
                        <span style={{ marginLeft: 10 }}>
                          · <b style={{ color: UI.red }}>{payrollTotals.flaggedShifts}</b> flagged shifts
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <MiniSearch value={payrollSearch} onChange={setPayrollSearch} placeholder="Search caregivers…" />
                </div>

                <div style={{ padding: 12, color: UI.textDim, fontSize: 13 }}>
                  Default view is summary-only. Expand a caregiver to see shifts.
                </div>

                <div style={{ display: "grid", gap: 12, padding: 12 }}>
                  {payrollGroups.map((g) => {
                    const caregiverScheduled = g.shifts.reduce((a, s) => a + s.durationHours, 0);
                    const caregiverConfirmed = g.shifts.reduce(
                      (a, s) => a + (s.confirmState === "confirmed" ? s.durationHours : 0),
                      0
                    );
                    const caregiverFlagged = g.shifts.reduce(
                      (a, s) => a + (s.confirmState === "flagged" ? s.durationHours : 0),
                      0
                    );
                    const flaggedCount = g.shifts.reduce((a, s) => a + (s.confirmState === "flagged" ? 1 : 0), 0);
                    const caregiverPay = g.shifts.reduce((a, s) => a + s.payDue, 0);

                    const open = !!expandedCaregivers[g.caregiverId];
                    const finished = isCaregiverFinished(g);

                    return (
                      <div
                        key={g.caregiverId}
                        style={{
                          border: `1px solid ${UI.borderSoft}`,
                          borderRadius: 14,
                          overflow: "hidden",
                        }}
                      >
                        <button
                          onClick={() =>
                            setExpandedCaregivers((prev) => ({ ...prev, [g.caregiverId]: !prev[g.caregiverId] }))
                          }
                          style={{
                            all: "unset",
                            cursor: "pointer",
                            display: "flex",
                            width: "100%",
                            padding: 12,
                            alignItems: "flex-start",
                            justifyContent: "flex-start",
                            gap: 12,
                            borderBottom: open ? `1px solid ${UI.borderSoft}` : "none",
                          }}
                          title="Show shifts"
                        >
                          {/* Left: arrow + name + pills + metrics (moved left so it always shows) */}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                              <span style={{ width: 16, textAlign: "center", color: UI.textDim, fontWeight: 950 }}>
                                {open ? "▾" : "▸"}
                              </span>

                              <span
                                title={g.nameOnSchedule ? `Name on schedule: ${g.nameOnSchedule}` : undefined}
                                style={{
                                  fontWeight: 950,
                                  color: finished ? UI.green : UI.text,
                                }}
                              >
                                {g.caregiverLabel}
                              </span>

                              {finished ? (
                                <Pill text="Finished" bg="rgba(34,197,94,0.14)" color="#065f46" />
                              ) : null}

                              {!g.hasProfile ? (
                                <Pill
                                  text="No profile"
                                  bg="rgba(245,158,11,0.18)"
                                  color="#7c2d12"
                                  title="This caregiver is on the schedule but not in the Caregivers sheet."
                                />
                              ) : null}

                              {flaggedCount ? (
                                <Pill text={`${flaggedCount} flagged`} bg="rgba(239,68,68,0.14)" color="#991b1b" />
                              ) : null}
                            </div>

                            <div style={{ marginTop: 6, color: UI.textDim, fontSize: 13 }}>
                              <b style={{ color: UI.green }}>{caregiverConfirmed.toFixed(2)}</b> confirmed ·{" "}
                              <b style={{ color: UI.red }}>{caregiverFlagged.toFixed(2)}</b> flagged ·{" "}
                              <b style={{ color: UI.slate }}>{caregiverScheduled.toFixed(2)}</b> scheduled ·{" "}
                              <b style={{ color: UI.slate }}>{money(caregiverPay)}</b>
                            </div>
                          </div>
                        </button>

                        {open ? (
                          <div style={{ overflowX: "auto" }}>
                            <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
                              <thead>
                                <tr>
                                  {[
                                    "Date",
                                    "Client",
                                    "Time (adjustable)",
                                    "Confirm",
                                    "Why (if flagged)",
                                    "Pay Rate ($/hr) (default $16)",
                                    "Pay Due",
                                    "Actions",
                                  ].map((h) => (
                                    <th
                                      key={h}
                                      style={{
                                        textAlign: "left",
                                        padding: 10,
                                        fontSize: 12,
                                        color: UI.textDim,
                                        background: UI.headerBg,
                                        borderBottom: `1px solid ${UI.borderSoft}`,
                                        whiteSpace: "nowrap",
                                      }}
                                    >
                                      {h}
                                    </th>
                                  ))}
                                </tr>
                              </thead>

                              <tbody>
                                {g.shifts.map((s) => {
                                  const id = norm(s.shiftId);
                                  const ev = evalByShiftId[id];
                                  const state = s.confirmState;

                                  const badge =
                                    state === "confirmed" ? (
                                      <Pill text="Confirmed" bg={UI.green} />
                                    ) : state === "flagged" ? (
                                      <Pill text="Flagged" bg={UI.red} />
                                    ) : state === "future" ? (
                                      <Pill text="Future" bg="rgba(148,163,184,0.75)" color="#0f172a" />
                                    ) : (
                                      <Pill text="Unknown" bg="rgba(100,116,139,0.75)" color="#0f172a" />
                                    );

                                  const rowBg =
                                    state === "confirmed"
                                      ? "rgba(34,197,94,0.06)"
                                      : state === "flagged"
                                      ? "rgba(239,68,68,0.06)"
                                      : "transparent";

                                  return (
                                    <tr key={s.shiftId} style={{ background: rowBg }}>
                                      <td style={{ padding: 10, borderBottom: `1px solid ${UI.borderSoft}`, whiteSpace: "nowrap" }}>
                                        {s.date}
                                      </td>

                                      <td style={{ padding: 10, borderBottom: `1px solid ${UI.borderSoft}`, fontWeight: 900 }}>
                                        {s.client}
                                      </td>

                                      <td style={{ padding: 10, borderBottom: `1px solid ${UI.borderSoft}`, whiteSpace: "nowrap" }}>
                                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                                          <select
                                            value={timeOverrideByShiftId[id]?.startTime ?? s.startTime}
                                            onChange={(e) =>
                                              setShiftTimeLocal(id, {
                                                startTime: e.target.value,
                                                endTime: timeOverrideByShiftId[id]?.endTime ?? s.endTime,
                                              })
                                            }
                                            style={{
                                              padding: "6px 8px",
                                              borderRadius: 10,
                                              border: `1px solid ${UI.border}`,
                                              background: UI.panelBg,
                                              fontWeight: 800,
                                              cursor: "pointer",
                                            }}
                                          >
                                            {timeOptions.map((opt) => (
                                              <option key={opt.value} value={opt.value}>
                                                {opt.label}
                                              </option>
                                            ))}
                                          </select>

                                          <span style={{ color: UI.textDim, fontWeight: 900 }}>–</span>

                                          <select
                                            value={timeOverrideByShiftId[id]?.endTime ?? s.endTime}
                                            onChange={(e) =>
                                              setShiftTimeLocal(id, {
                                                startTime: timeOverrideByShiftId[id]?.startTime ?? s.startTime,
                                                endTime: e.target.value,
                                              })
                                            }
                                            style={{
                                              padding: "6px 8px",
                                              borderRadius: 10,
                                              border: `1px solid ${UI.border}`,
                                              background: UI.panelBg,
                                              fontWeight: 800,
                                              cursor: "pointer",
                                            }}
                                          >
                                            {timeOptions.map((opt) => (
                                              <option key={opt.value} value={opt.value}>
                                                {opt.label}
                                              </option>
                                            ))}
                                          </select>

                                          <span style={{ color: UI.textDim, fontWeight: 900 }}>
                                            (
                                            {hoursBetween(
                                              timeOverrideByShiftId[id]?.startTime ?? s.startTime,
                                              timeOverrideByShiftId[id]?.endTime ?? s.endTime
                                            ).toFixed(2)}
                                            h)
                                          </span>
                                        </div>
                                      </td>

                                      <td style={{ padding: 10, borderBottom: `1px solid ${UI.borderSoft}` }}>
                                        {badge}
                                        {s.isManuallyConfirmed ? (
                                          <span style={{ marginLeft: 8 }}>
                                            <Pill text="Manual" bg="rgba(2,132,199,0.16)" color="#075985" title="Local override" />
                                          </span>
                                        ) : null}
                                      </td>

                                      <td style={{ padding: 10, borderBottom: `1px solid ${UI.borderSoft}`, minWidth: 280 }}>
                                        {state === "flagged" ? (
                                          <div>
                                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                                              {s.inVerdict ? (
                                                <Pill
                                                  text={`IN: ${verdictLabel(s.inVerdict)}`}
                                                  bg={
                                                    isOnSite(s.inVerdict)
                                                      ? "rgba(34,197,94,0.18)"
                                                      : isOffSite(s.inVerdict)
                                                      ? "rgba(239,68,68,0.18)"
                                                      : "rgba(245,158,11,0.22)"
                                                  }
                                                  color={isOnSite(s.inVerdict) ? "#065f46" : "#7c2d12"}
                                                />
                                              ) : (
                                                <Pill text="IN: (no verdict)" bg="rgba(239,68,68,0.14)" color="#991b1b" />
                                              )}

                                              {s.outVerdict ? (
                                                <Pill
                                                  text={`OUT: ${verdictLabel(s.outVerdict)}`}
                                                  bg={
                                                    isOnSite(s.outVerdict)
                                                      ? "rgba(34,197,94,0.18)"
                                                      : isOffSite(s.outVerdict)
                                                      ? "rgba(239,68,68,0.18)"
                                                      : "rgba(245,158,11,0.22)"
                                                  }
                                                  color={isOnSite(s.outVerdict) ? "#065f46" : "#7c2d12"}
                                                />
                                              ) : (
                                                <Pill text="OUT: (no verdict)" bg="rgba(239,68,68,0.14)" color="#991b1b" />
                                              )}

                                              {s.diffInMin != null ? (
                                                <Pill
                                                  text={`ΔIN ${s.diffInMin}m`}
                                                  bg={Math.abs(s.diffInMin) <= 15 ? "rgba(34,197,94,0.18)" : "rgba(239,68,68,0.18)"}
                                                  color={Math.abs(s.diffInMin) <= 15 ? "#065f46" : "#991b1b"}
                                                />
                                              ) : (
                                                <Pill text="ΔIN —" bg="rgba(239,68,68,0.14)" color="#991b1b" />
                                              )}

                                              {s.diffOutMin != null ? (
                                                <Pill
                                                  text={`ΔOUT ${s.diffOutMin}m`}
                                                  bg={Math.abs(s.diffOutMin) <= 15 ? "rgba(34,197,94,0.18)" : "rgba(239,68,68,0.18)"}
                                                  color={Math.abs(s.diffOutMin) <= 15 ? "#065f46" : "#991b1b"}
                                                />
                                              ) : (
                                                <Pill text="ΔOUT —" bg="rgba(239,68,68,0.14)" color="#991b1b" />
                                              )}
                                            </div>

                                            <ReasonList reasons={s.reasons} />
                                          </div>
                                        ) : state === "confirmed" ? (
                                          <span style={{ color: UI.green, fontWeight: 900 }}>✓ 15m + on-site + both clocks</span>
                                        ) : state === "future" ? (
                                          <span style={{ color: UI.textDim, fontWeight: 900 }}>Not evaluated yet</span>
                                        ) : (
                                          <span style={{ color: UI.textDim, fontWeight: 900 }}>—</span>
                                        )}
                                      </td>

                                      <td style={{ padding: 10, borderBottom: `1px solid ${UI.borderSoft}` }}>
                                        <TextInput
                                          value={payRateByShift[s.shiftId] ?? ""}
                                          onChange={(v) =>
                                            setPayRateByShift((prev) => ({
                                              ...prev,
                                              [s.shiftId]: v,
                                            }))
                                          }
                                          placeholder={`${DEFAULT_EXPORT_PAY_RATE}`}
                                          width={140}
                                        />
                                      </td>

                                      <td style={{ padding: 10, borderBottom: `1px solid ${UI.borderSoft}`, fontWeight: 950 }}>
                                        {money(s.payDue)}
                                      </td>

                                      <td style={{ padding: 10, borderBottom: `1px solid ${UI.borderSoft}` }}>
                                        {state === "flagged" ? (
                                          <button
                                            onClick={() => confirmShiftLocal(id)}
                                            style={{
                                              padding: "6px 10px",
                                              borderRadius: 10,
                                              border: `1px solid ${UI.green}`,
                                              background: "rgba(34,197,94,0.10)",
                                              color: UI.green,
                                              fontWeight: 950,
                                              cursor: "pointer",
                                            }}
                                            title="Local override (does not write to Sheets yet)"
                                          >
                                            Confirm shift
                                          </button>
                                        ) : (
                                          <span style={{ color: UI.textDim, fontWeight: 900 }}>—</span>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}

                                {g.shifts.length === 0 && (
                                  <tr>
                                    <td colSpan={8} style={{ padding: 12, color: UI.textDim }}>
                                      No shifts.
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}

                  {payrollGroups.length === 0 && (
                    <div style={{ color: UI.textDim, padding: 8 }}>No payroll data found for this week.</div>
                  )}
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

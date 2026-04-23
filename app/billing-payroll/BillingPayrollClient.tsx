"use client";

import React, { useEffect, useMemo, useState } from "react";

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

type PayrollArchiveRow = Record<string, any>;

type PayrollArchiveApiResponse = {
  ok: boolean;
  rows?: PayrollArchiveRow[];
  error?: string;
};

type ArchiveShiftMeta = {
  archiveId: string;
  weekStartDate: string;
  weekEndDate: string;
  caregiverName: string;
  nameOnSchedule: string;
  clockInSite: string;
  clockOutSite: string;
  scheduledHours: number;
  overtimeHours: number;
  overtimePay: number;
  totalPay: number;
  edits: string;
  lastEditedAt: string;
  lastEditedBy: string;
  approvalStatus: string;
  reason: string;
};

type ArchivedWeekOption = {
  weekStartDate: string;
  weekEndDate: string;
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

type ShiftRatesApiResponse = {
  ok: boolean;
  rows?: Record<string, any>[];
  rates?: Record<string, any>[];
  error?: string;
};

type PayrollMessage = {
  messageId: string;
  parentMessageId: string;
  timestamp: string;
  category: string;
  status: string;
  text: string;
  notified: string;
  readReceiptsRaw: string;
  caregiverId: string;
  caregiverName: string;
  sender: {
    id: string;
    name: string;
  };
};

type PayrollMessagesByCaregiverEntry = {
  caregiverId: string;
  caregiverName: string;
  count: number;
  messages: PayrollMessage[];
};

type PayrollMessagesApiResponse = {
  ok: boolean;
  count?: number;
  messages?: PayrollMessage[];
  grouped?: Record<string, PayrollMessagesByCaregiverEntry>;
  error?: string;
};

type ShiftRateRule = {
  ruleId: string;
  active: string;
  priority: string;
  ruleName: string;
  ruleType: string;
  rateMode: string;
  client: string;
  caregiverId: string;
  shiftType: string;
  holidayRule: string;
  startDate: string;
  endDate: string;
  payRate: string;
  addAmount: string;
  requiresApproval: string;
};

type ShiftRateMeta = {
  finalRate: string;
  baseRate: string;
  addOnTotal: string;

  updatedBy: string;
  updatedAt: string;
  updatedSource: string;

  rateSource: string;
  rateSourceDetail: string;

  approvedBy: string;
  approvedAt: string;
  approvalStatus: string;
  requiresApprovalFromRules: string;

  appliedRuleIds: string[];
  appliedRuleSummary: string;
  appliedRules: ShiftRateRule[];

  raw?: Record<string, any>;
};

type RateRuleFormState = {
  ruleId: string;
  ruleIdManuallyEdited: boolean;
  active: boolean;
  priority: string;
  ruleName: string;
  ruleType: "Base" | "Addon";
  targetScope: "client" | "caregiver";
  rateMode: "Set" | "Add";
  client: string;
  caregiverId: string;
  shiftType: string;
  holidayRule: string;
  startDate: string;
  endDate: string;
  payRate: string;
  addAmount: string;
  requiresApproval: boolean;
};

type CreateRateRuleApiResponse = {
  ok: boolean;
  ruleId?: string;
  rule?: Record<string, any>;
  error?: string;
};
type CaregiverOption = {
  caregiverId: string;
  label: string;
  sublabel: string;
};

type RateRuleFormChange = (
  key: keyof RateRuleFormState,
  value: RateRuleFormState[keyof RateRuleFormState]
) => void;

type AddRuleModalProps = {
  open: boolean;
  saving: boolean;
  error: string | null;
  success: string | null;
  form: RateRuleFormState;
  clientOptions: string[];
  caregiverOptions: CaregiverOption[];
  onClose: () => void;
  onSubmit: () => void;
  onChange: RateRuleFormChange;
};
const UI = {
  pageBg: "#f3f4f6",
  panelBg: "#ffffff",
  headerBg: "#f9fafb",
  border: "#d1d5db",
  borderSoft: "#e5e7eb",
  text: "#111827",
  textDim: "#6b7280",

  green: "#166534",
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

function formatHoursLabel(hours: number) {
  const rounded = Math.round(hours * 100) / 100;
  const label = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
  return `${label} ${rounded === 1 ? "hour" : "hours"}`;
}

function toIsoDate(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getDateRangeFromShifts(rows: ShiftRow[]) {
  const dates = rows
    .map((r) => toDateSafe(r.date))
    .filter((d): d is Date => !!d)
    .sort((a, b) => a.getTime() - b.getTime());

  if (!dates.length) return null;

  return {
    dateFrom: toIsoDate(dates[0]),
    dateTo: toIsoDate(dates[dates.length - 1]),
  };
}

function buildPayRateMapFromApi(rows: any[] | undefined) {
  const out: Record<string, string> = {};

  for (const row of rows || []) {
    const shiftId = norm(
      row?.shiftId ??
      row?.["Shift ID"] ??
      row?.ShiftID ??
      row?.shift_id
    );
    if (!shiftId) continue;

    const raw =
      row?.["Final Pay Rate"] ??
      row?.["Base Rate"] ??
      row?.newRate ??
      row?.payRate ??
      row?.rate;

    const parsed = parseRate(String(raw ?? ""));
    if (parsed != null) {
      out[shiftId] = parsed.toFixed(2);
    }
  }

  return out;
}

function buildShiftRateMetaMapFromApi(rows: any[] | undefined) {
  const out: Record<string, ShiftRateMeta> = {};

  for (const row of rows || []) {
    const shiftId = norm(
      row?.shiftId ??
      row?.["Shift ID"] ??
      row?.ShiftID ??
      row?.shift_id
    );
    if (!shiftId) continue;

    const finalRateParsed = parseRate(
      String(
        row?.["Final Pay Rate"] ??
          row?.newRate ??
          row?.payRate ??
          row?.rate ??
          ""
      )
    );
    if (finalRateParsed == null) continue;

    const baseRateParsed = parseRate(String(row?.["Base Rate"] ?? ""));
    const addOnTotalParsed = parseRate(String(row?.["Add on Total"] ?? ""));

    const approvedBy = norm(row?.["Approved By"]);
    const approvedAt = norm(row?.["Approved Timestamp"]);
    const explicitApprovalStatus = norm(
      row?.["Approval Status"] ??
        row?.["Approved"] ??
        row?.["Is Approved"]
    );

    const rawAppliedRules = Array.isArray(row?.["Applied Rules"])
      ? row["Applied Rules"]
      : [];

    const appliedRules: ShiftRateRule[] = rawAppliedRules.map((rule: any) => ({
      ruleId: norm(rule?.["Rule ID"]),
      active: norm(rule?.["Active"]),
      priority: norm(rule?.["Priority"]),
      ruleName: norm(rule?.["Rule Name"]),
      ruleType: norm(rule?.["Rule Type"]),
      rateMode: norm(rule?.["Rate Mode"]),
      client: norm(rule?.["Client"]),
      caregiverId: norm(rule?.["Caregiver ID"]),
      shiftType: norm(rule?.["Shift Type"]),
      holidayRule: norm(rule?.["Holiday Rule"]),
      startDate: norm(rule?.["Start Date"]),
      endDate: norm(rule?.["End Date"]),
      payRate: norm(rule?.["Pay Rate"]),
      addAmount: norm(rule?.["Add Amount"]),
      requiresApproval: norm(rule?.["Requires Approval"]),
    }));

   const parsedRuleIds: string[] = Array.isArray(row?.["Applied Rule IDs Parsed"])
  ? row["Applied Rule IDs Parsed"]
      .map((v: unknown) => norm(v))
      .filter((v: string) => Boolean(v))
  : norm(row?.["Applied Rule IDs"])
      .split(/[,|;]+/)
      .map((v: string) => norm(v))
      .filter((v: string) => Boolean(v));

    out[shiftId] = {
      finalRate: finalRateParsed.toFixed(2),
      baseRate: baseRateParsed != null ? baseRateParsed.toFixed(2) : "",
      addOnTotal: addOnTotalParsed != null ? addOnTotalParsed.toFixed(2) : "",

      updatedBy: norm(row?.["Updated By"]),
      updatedAt: norm(
        row?.["TimeStamp"] ??
          row?.["Timestamp"] ??
          row?.["Last Updated"] ??
          row?.["Updated At"]
      ),
      updatedSource: norm(row?.["Updated Source"]),

      rateSource: norm(row?.["Rate Source"] ?? row?.["Source"]),
      rateSourceDetail: norm(
        row?.["Rate Source Detail"] ?? row?.["Reason"]
      ),

      approvedBy,
      approvedAt,
      approvalStatus:
        explicitApprovalStatus ||
        (approvedBy || approvedAt ? "Approved" : "Not approved"),
      requiresApprovalFromRules: norm(row?.["Requires Approval From Rules"]),

      appliedRuleIds: parsedRuleIds,
      appliedRuleSummary: norm(row?.["Applied Rule Summary"]),
      appliedRules,

      raw: row,
    };
  }

  return out;
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

function formatArchiveDate(raw: string) {
  const value = norm(raw);
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

function formatArchiveTime(raw: string) {
  const value = norm(raw);
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;

  let hours = d.getUTCHours();
  const minutes = String(d.getUTCMinutes()).padStart(2, "0");
  const ap = hours >= 12 ? "PM" : "AM";
  if (hours === 0) hours = 12;
  else if (hours > 12) hours -= 12;
  return `${hours}:${minutes} ${ap}`;
}

function archiveDateTimeToLocalValue(raw: string) {
  const value = norm(raw);
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;

  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const min = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");

  return `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}`;
}

function archiveSiteToVerdict(raw: string | null | undefined): string | null {
  const v = normalizeName(String(raw ?? ""));
  if (!v) return null;
  if (v.includes("on site") || v === "onsite" || v === "on_site") return "on_site";
  if (v.includes("off site") || v === "offsite" || v === "off_site") return "off_site";
  return v;
}

function buildArchiveShiftRateMetaMap(rows: PayrollArchiveRow[]) {
  const out: Record<string, ShiftRateMeta> = {};
  for (const row of rows) {
    const shiftId = norm(row?.["Shift ID"]);
    if (!shiftId) continue;
    const payRate = parseRate(String(row?.["Pay Rate"] ?? ""));
    if (payRate == null) continue;
    out[shiftId] = {
      finalRate: payRate.toFixed(2),
      baseRate: payRate.toFixed(2),
      addOnTotal: parseRate(String(row?.["Overtime Pay"] ?? ""))?.toFixed(2) || "",
      updatedBy: norm(row?.["Last Edited By"]),
      updatedAt: norm(row?.["Last Edited At"]),
      updatedSource: "Payroll Archive",
      rateSource: "Payroll Archive",
      rateSourceDetail: norm(row?.["Edits"]) || "Archived payroll row",
      approvedBy: "",
      approvedAt: "",
      approvalStatus: norm(row?.["Approval Status"]) || "Not Approved",
      requiresApprovalFromRules: "FALSE",
      appliedRuleIds: [],
      appliedRuleSummary: "",
      appliedRules: [],
      raw: row,
    };
  }
  return out;
}

function normalizePayrollArchiveRows(rows: PayrollArchiveRow[]) {
  const shifts: ShiftRow[] = [];
  const clockMap: Record<string, ClockEntry> = {};
  const locationMap: Record<string, LocationEntry> = {};
  const payRateByShift: Record<string, string> = {};
  const archiveMetaByShift: Record<string, ArchiveShiftMeta> = {};

  for (const row of rows) {
    const shiftId = norm(row?.["Shift ID"]);
    if (!shiftId) continue;

    const date = formatArchiveDate(row?.["Date"]);
    const startTime = formatArchiveTime(row?.["Start Time"]);
    const endTime = formatArchiveTime(row?.["End Time"]);
    const payRate = parseRate(String(row?.["Pay Rate"] ?? ""));

    shifts.push({
      shiftId,
      date,
      client: norm(row?.["Client"]),
      caregiver: norm(row?.["Name on Schedule"]) || norm(row?.["Caregiver Name"]),
      caregiverId: norm(row?.["Caregiver ID"]),
      startTime,
      endTime,
      status: "Archived",
      conflict: norm(row?.["Reason"]),
      dow: toDateSafe(date)?.getDay(),
    });

    clockMap[shiftId] = {
      clockInTime: archiveDateTimeToLocalValue(row?.["Clock In Time"]) || null,
      clockOutTime: archiveDateTimeToLocalValue(row?.["Clock Out Time"]) || null,
    };

    locationMap[shiftId] = {
      clockIn: {
        timestamp: archiveDateTimeToLocalValue(row?.["Clock In Time"]) || null,
        verdict: archiveSiteToVerdict(row?.["Clock In Site"]),
      },
      clockOut: {
        timestamp: archiveDateTimeToLocalValue(row?.["Clock Out Time"]) || null,
        verdict: archiveSiteToVerdict(row?.["Clock Out Site"]),
      },
    };

    if (payRate != null) {
      payRateByShift[shiftId] = payRate.toFixed(2);
    }

    archiveMetaByShift[shiftId] = {
      archiveId: norm(row?.["Archive ID"]),
      weekStartDate: norm(row?.["Week Start Date"]),
      weekEndDate: norm(row?.["Week End Date"]),
      caregiverName: norm(row?.["Caregiver Name"]),
      nameOnSchedule: norm(row?.["Name on Schedule"]),
      clockInSite: norm(row?.["Clock In Site"]),
      clockOutSite: norm(row?.["Clock Out Site"]),
      scheduledHours: parseNumber(String(row?.["Scheduled Hours"] ?? "")) ?? 0,
      overtimeHours: parseNumber(String(row?.["Overtime Hours"] ?? "")) ?? 0,
      overtimePay: parseNumber(String(row?.["Overtime Pay"] ?? "")) ?? 0,
      totalPay: parseNumber(String(row?.["Total Pay"] ?? "")) ?? 0,
      edits: norm(row?.["Edits"]),
      lastEditedAt: norm(row?.["Last Edited At"]),
      lastEditedBy: norm(row?.["Last Edited By"]),
      approvalStatus: norm(row?.["Approval Status"]) || "Not Approved",
      reason: norm(row?.["Reason"]),
    };
  }

  return {
    shifts,
    clockMap,
    locationMap,
    payRateByShift,
    shiftRateMetaByShift: buildArchiveShiftRateMetaMap(rows),
    archiveMetaByShift,
  };
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

function roundHours(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function splitWeeklyOvertime(hoursSoFar: number, shiftHours: number) {
  const regularRemaining = Math.max(0, 40 - hoursSoFar);
  const regularHours = roundHours(Math.min(shiftHours, regularRemaining));
  const overtimeHours = roundHours(Math.max(0, shiftHours - regularHours));

  return {
    regularHours,
    overtimeHours,
  };
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
        gap: 5,
        padding: "2px 7px",
        borderRadius: 999,
        background: bg,
        color,
        fontWeight: 900,
        fontSize: 10.5,
        lineHeight: 1.05,
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
}

function summarizeReasons(reasons: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();

  const add = (label: string) => {
    if (!seen.has(label)) {
      seen.add(label);
      out.push(label);
    }
  };

  for (const reason of reasons) {
    const r = norm(reason);

    if (!r) continue;

    if (r.includes("Missing Clock In")) {
      add("Missing clock in");
      continue;
    }

    if (r.includes("Missing Clock Out")) {
      add("Missing clock out");
      continue;
    }

    if (r.includes("Missing IN verdict") || r.startsWith("IN ")) {
      add("IN issue");
      continue;
    }

    if (r.includes("Missing OUT verdict") || r.startsWith("OUT ")) {
      add("OUT issue");
      continue;
    }

    if (r.includes("Clock In early")) {
      add("Clock in early");
      continue;
    }

    if (r.includes("Clock In late")) {
      add("Clock in late");
      continue;
    }

    if (r.includes("Clock Out early")) {
      add("Clock out early");
      continue;
    }

    if (r.includes("Clock Out late")) {
      add("Clock out late");
      continue;
    }

    add(r);
  }

  return out;
}

function ReasonList({ reasons }: { reasons: string[] }) {
  if (!reasons.length) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {reasons.map((r) => (
        <span
          key={r}
          style={{
            display: "inline-block",
            padding: "2px 7px",
            borderRadius: 999,
            background: "rgba(239,68,68,0.10)",
            border: "1px solid rgba(239,68,68,0.22)",
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
    </div>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  width = 120,
  textAlign = "left",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  width?: number | string;
  textAlign?: "left" | "center" | "right";
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width,
        padding: "4px 6px",
        borderRadius: 8,
        border: `1px solid ${UI.border}`,
        background: UI.panelBg,
        fontWeight: 800,
        fontSize: 12,
        lineHeight: 1.2,
        textAlign,
        outline: "none",
      }}
    />
  );
}

function isApprovedStatus(raw: string | null | undefined) {
  const status = normalizeName(raw || "");
  return (
    status.includes("approved") &&
    !status.includes("not approved") &&
    !status.includes("unapproved")
  );
}

function getApprovalPill(meta?: ShiftRateMeta) {
  if (isApprovedStatus(meta?.approvalStatus)) {
    return {
      text: "Approved",
      bg: "rgba(34,197,94,0.10)",
      color: "#166534",
    };
  }

  if (meta?.approvedBy || meta?.approvedAt) {
    return {
      text: "Approved",
      bg: "rgba(34,197,94,0.08)",
      color: "#166534",
    };
  }

  return {
    text: "Not approved",
    bg: "rgba(245,158,11,0.14)",
    color: "#7c2d12",
  };
}

function yesNoLabel(v: string) {
  const x = normalizeName(v);
  if (x === "true" || x === "yes" || x === "1") return "Yes";
  if (x === "false" || x === "no" || x === "0") return "No";
  return v || "—";
}

function formatAuditDate(value: string) {
  const raw = norm(value);
  if (!raw) return "—";

  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;

  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const year = d.getFullYear();

  if (hours === 0) hours = 12;
  if (hours > 12) hours -= 12;

  return `${hours}:${minutes} ${month}/${day}/${year}`;
}

function formatPayrollMessageStamp(value: string) {
  const raw = norm(value);
  if (!raw) return "—";

  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;

  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const ap = hours >= 12 ? "PM" : "AM";
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const year = d.getFullYear();

  if (hours === 0) hours = 12;
  else if (hours > 12) hours -= 12;

  return `${month}/${day}/${year} ${hours}:${minutes} ${ap}`;
}

function formatClockStamp(value: string | null | undefined) {
  const raw = norm(value);
  if (!raw) return "—";

  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;

  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const ap = hours >= 12 ? "PM" : "AM";

  if (hours === 0) hours = 12;
  else if (hours > 12) hours -= 12;

  return `${hours}:${minutes} ${ap}`;
}

function formatSiteLabel(value: string | null | undefined) {
  const raw = norm(value);
  if (!raw) return "No site";
  return raw.replace(/_/g, " ");
}

function makeBlankRateRuleForm(): RateRuleFormState {
  return {
    ruleId: "",
    ruleIdManuallyEdited: false,
    active: true,
    priority: "5",
    ruleName: "",
    ruleType: "Addon",
    targetScope: "caregiver",
    rateMode: "Add",
    client: "",
    caregiverId: "",
    shiftType: "",
    holidayRule: "",
    startDate: "",
    endDate: "",
    payRate: "",
    addAmount: "",
    requiresApproval: false,
  };
}
function slugifyRuleIdPart(value: string) {
  return norm(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function buildRuleIdFromName(ruleName: string) {
  const slug = slugifyRuleIdPart(ruleName);
  if (!slug) return "";
  const digits = String(Date.now()).slice(-4);
  return `${slug}-${digits}`;
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
  payRate: number;
  payDue: number;

  regularHours: number;
  overtimeHours: number;
  overtimePayDue: number;

  clockInTime: string | null;
  clockOutTime: string | null;
  clockInSite: string;
  clockOutSite: string;
  approvalStatus: string;
  archivedTotalPay: number;
  archiveReason: string;
  isManuallyConfirmed?: boolean;
  adjustedStartTime?: string;
  adjustedEndTime?: string;
};
function AddRuleModal({
  open,
  saving,
  error,
  success,
  form,
  clientOptions,
  caregiverOptions,
  onClose,
  onSubmit,
  onChange,
}: AddRuleModalProps) {
  if (!open) return null;

  const fieldLabelStyle: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 900,
    color: UI.textDim,
    marginBottom: 6,
    display: "block",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "9px 10px",
    borderRadius: 10,
    border: `1px solid ${UI.border}`,
    background: UI.panelBg,
    fontWeight: 800,
    fontSize: 13,
    outline: "none",
  };

  const selectedCaregiver =
    caregiverOptions.find((cg) => cg.caregiverId === form.caregiverId) || null;
  const showStepTwo = Boolean(norm(form.ruleName));
  const showStepThree = showStepTwo && Boolean(form.ruleType);
  const showStepFour =
    showStepThree &&
    (form.targetScope === "client" ? Boolean(norm(form.client)) : Boolean(norm(form.caregiverId)));
  const autoRateMode = form.ruleType === "Base" ? "Set" : "Add";
  const amountLabel = form.ruleType === "Base" ? "Base Amount" : "Add On Amount";
  const amountPlaceholder = form.ruleType === "Base" ? "Ex: 18.00" : "Ex: 2.00";
  const stepCardStyle: React.CSSProperties = {
    border: `1px solid ${UI.borderSoft}`,
    borderRadius: 14,
    padding: 14,
    background: UI.headerBg,
    display: "grid",
    gap: 12,
  };
  const stepTitleStyle: React.CSSProperties = {
    fontSize: 14,
    fontWeight: 950,
    color: UI.text,
  };
  const helperStyle: React.CSSProperties = {
    fontSize: 12,
    color: UI.textDim,
    lineHeight: 1.4,
  };
  const toggleButtonStyle = (active: boolean): React.CSSProperties => ({
    padding: "9px 12px",
    borderRadius: 10,
    border: active ? `1px solid ${UI.blue}` : `1px solid ${UI.border}`,
    background: active ? "rgba(43,111,214,0.10)" : UI.panelBg,
    color: active ? UI.blue : UI.text,
    fontWeight: 900,
    fontSize: 13,
    cursor: "pointer",
  });

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.45)",
        zIndex: 55,
        display: "grid",
        placeItems: "center",
        padding: 16,
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: 780,
          maxWidth: "100%",
          maxHeight: "92vh",
          overflow: "auto",
          background: UI.panelBg,
          border: `1px solid ${UI.borderSoft}`,
          borderRadius: 18,
          padding: 18,
          boxShadow: "0 20px 60px rgba(15,23,42,0.22)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            alignItems: "flex-start",
          }}
        >
          <div>
            <div style={{ fontSize: 20, fontWeight: 950 }}>Add Rule</div>
            <div style={{ marginTop: 6, color: UI.textDim, fontSize: 13 }}>
              Create a new rate rule and add it to the Rate Rules sheet.
            </div>
          </div>

          <button
            onClick={onClose}
            disabled={saving}
            style={{
              padding: "8px 10px",
              borderRadius: 10,
              border: `1px solid ${UI.border}`,
              background: UI.panelBg,
              fontWeight: 900,
              cursor: saving ? "not-allowed" : "pointer",
              opacity: saving ? 0.6 : 1,
            }}
          >
            Close
          </button>
        </div>

        {error ? (
          <div
            style={{
              marginTop: 14,
              padding: 10,
              borderRadius: 12,
              background: "rgba(239,68,68,0.10)",
              border: "1px solid rgba(239,68,68,0.18)",
              color: "#991b1b",
              fontWeight: 900,
              fontSize: 13,
            }}
          >
            {error}
          </div>
        ) : null}

        {success ? (
          <div
            style={{
              marginTop: 14,
              padding: 10,
              borderRadius: 12,
              background: "rgba(34,197,94,0.10)",
              border: "1px solid rgba(34,197,94,0.18)",
              color: "#166534",
              fontWeight: 900,
              fontSize: 13,
            }}
          >
            {success}
          </div>
        ) : null}

        <div style={{ marginTop: 16, display: "grid", gap: 14 }}>
          <div style={stepCardStyle}>
            <div style={stepTitleStyle}>Step 1 · Name The Rule</div>
            <div style={helperStyle}>
              Enter the rule name first. The rule ID is generated automatically and priority is fixed at 5.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14 }}>
              <div>
                <label style={fieldLabelStyle}>Rule Name</label>
                <input
                  value={form.ruleName}
                  onChange={(e) => onChange("ruleName", e.target.value)}
                  placeholder="Ex: Christmas Day Add On"
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={fieldLabelStyle}>Rule ID</label>
                <input
                  value={form.ruleId}
                  readOnly
                  placeholder="Auto-generated from rule name"
                  style={{
                    ...inputStyle,
                    background: "#f8fafc",
                    color: UI.textDim,
                    cursor: "default",
                  }}
                />
              </div>
            </div>
          </div>

          {showStepTwo ? (
            <div style={stepCardStyle}>
              <div style={stepTitleStyle}>Step 2 · Choose The Rule Type</div>
              <div style={helperStyle}>
                Addon rules add to a rate. Base rules set the rate. Rate mode updates automatically.
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14 }}>
                <div>
                  <label style={fieldLabelStyle}>Rule Type</label>
                  <select
                    value={form.ruleType}
                    onChange={(e) =>
                      onChange("ruleType", e.target.value as RateRuleFormState["ruleType"])
                    }
                    style={inputStyle}
                  >
                    <option value="Base">Base</option>
                    <option value="Addon">Addon</option>
                  </select>
                </div>

                <div>
                  <label style={fieldLabelStyle}>Rate Mode</label>
                  <input
                    value={autoRateMode}
                    readOnly
                    style={{
                      ...inputStyle,
                      background: "#f8fafc",
                      color: UI.textDim,
                      cursor: "default",
                    }}
                  />
                </div>
              </div>
            </div>
          ) : null}

          {showStepThree ? (
            <div style={stepCardStyle}>
              <div style={stepTitleStyle}>Step 3 · Choose Client Or Caregiver</div>
              <div style={helperStyle}>
                Pick one target for this rule. Use either a caregiver or a client, not both.
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => {
                    onChange("targetScope", "caregiver");
                    onChange("client", "");
                  }}
                  style={toggleButtonStyle(form.targetScope === "caregiver")}
                >
                  Caregiver
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onChange("targetScope", "client");
                    onChange("caregiverId", "");
                  }}
                  style={toggleButtonStyle(form.targetScope === "client")}
                >
                  Client
                </button>
              </div>

              {form.targetScope === "client" ? (
                <div>
                  <label style={fieldLabelStyle}>Client</label>
                  <input
                    list="rate-rule-client-options"
                    value={form.client}
                    onChange={(e) => onChange("client", e.target.value)}
                    placeholder="Start typing client name"
                    style={inputStyle}
                  />
                  <datalist id="rate-rule-client-options">
                    {clientOptions.map((client) => (
                      <option key={client} value={client} />
                    ))}
                  </datalist>
                </div>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  <div>
                    <label style={fieldLabelStyle}>Caregiver</label>
                    <select
                      value={form.caregiverId}
                      onChange={(e) => onChange("caregiverId", e.target.value)}
                      style={inputStyle}
                    >
                      <option value="">Select caregiver</option>
                      {caregiverOptions.map((cg) => (
                        <option key={cg.caregiverId} value={cg.caregiverId}>
                          {cg.label}
                          {cg.sublabel ? ` — ${cg.sublabel}` : ""}
                          {` (${cg.caregiverId})`}
                        </option>
                      ))}
                    </select>
                  </div>

                  {selectedCaregiver ? (
                    <div style={{ fontSize: 12, color: UI.textDim }}>
                      Selected caregiver ID: <b style={{ color: UI.text }}>{selectedCaregiver.caregiverId}</b>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          ) : null}

          {showStepFour ? (
            <div style={stepCardStyle}>
              <div style={stepTitleStyle}>Step 4 · Rule Details</div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: 14,
                }}
              >
                <div>
                  <label style={fieldLabelStyle}>Type</label>
                  <input
                    value={form.shiftType}
                    onChange={(e) => onChange("shiftType", e.target.value)}
                    placeholder="Ex: Weekend, Overnight"
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label style={fieldLabelStyle}>Holiday Rule</label>
                  <input
                    value={form.holidayRule}
                    onChange={(e) => onChange("holidayRule", e.target.value)}
                    placeholder="Ex: Christmas Day"
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label style={fieldLabelStyle}>Start Date</label>
                  <input
                    type="date"
                    value={form.startDate}
                    onChange={(e) => onChange("startDate", e.target.value)}
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label style={fieldLabelStyle}>End Date</label>
                  <input
                    type="date"
                    value={form.endDate}
                    onChange={(e) => onChange("endDate", e.target.value)}
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label style={fieldLabelStyle}>{amountLabel}</label>
                  <input
                    value={form.ruleType === "Base" ? form.payRate : form.addAmount}
                    onChange={(e) =>
                      form.ruleType === "Base"
                        ? onChange("payRate", e.target.value)
                        : onChange("addAmount", e.target.value)
                    }
                    placeholder={amountPlaceholder}
                    style={inputStyle}
                  />
                </div>

                <div
                  style={{
                    display: "grid",
                    alignContent: "end",
                    gap: 10,
                  }}
                >
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontWeight: 900,
                      fontSize: 13,
                      color: UI.text,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={form.active}
                      onChange={(e) => onChange("active", e.target.checked)}
                    />
                    Active
                  </label>

                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontWeight: 900,
                      fontSize: 13,
                      color: UI.text,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={form.requiresApproval}
                      onChange={(e) => onChange("requiresApproval", e.target.checked)}
                    />
                    Requires Approval
                  </label>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div
          style={{
            marginTop: 18,
            padding: 12,
            borderRadius: 12,
            background: UI.headerBg,
            border: `1px solid ${UI.borderSoft}`,
            fontSize: 12.5,
            color: UI.textDim,
            lineHeight: 1.45,
          }}
        >
          You can keep the rule broad or narrow it down with type, holiday, or a date range.
          The client or caregiver target is chosen in Step 3.
        </div>

        <div
          style={{
            marginTop: 18,
            display: "flex",
            justifyContent: "flex-end",
            gap: 10,
          }}
        >
          <button
            onClick={onClose}
            disabled={saving}
            style={{
              padding: "9px 12px",
              borderRadius: 10,
              border: `1px solid ${UI.border}`,
              background: UI.panelBg,
              fontWeight: 900,
              cursor: saving ? "not-allowed" : "pointer",
              opacity: saving ? 0.6 : 1,
            }}
          >
            Cancel
          </button>

          <button
            onClick={onSubmit}
            disabled={saving}
            style={{
              padding: "9px 14px",
              borderRadius: 10,
              border: `1px solid ${UI.green}`,
              background: UI.green,
              color: "#fff",
              fontWeight: 950,
              cursor: saving ? "not-allowed" : "pointer",
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? "Saving..." : "Save Rule"}
          </button>
        </div>
      </div>
    </div>
  );
}
export default function BillingPayrollClient() {
  const [selectedWeekStartDate, setSelectedWeekStartDate] = useState("");
  const [availableWeeks, setAvailableWeeks] = useState<ArchivedWeekOption[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("billing");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [clockMap, setClockMap] = useState<Record<string, ClockEntry>>({});
  const [locationMap, setLocationMap] = useState<Record<string, LocationEntry>>(
    {}
  );
  const [archiveMetaByShift, setArchiveMetaByShift] = useState<Record<string, ArchiveShiftMeta>>({});

      // shiftId -> pay rate input (payroll)
  const [payRateByShift, setPayRateByShift] = useState<Record<string, string>>(
    {}
  );
  const [originalPayRateByShift, setOriginalPayRateByShift] = useState<Record<string, string>>(
    {}
  );
  const [savingRateByShift, setSavingRateByShift] = useState<Record<string, boolean>>(
    {}
  );
  const [shiftRateMetaByShift, setShiftRateMetaByShift] = useState<
    Record<string, ShiftRateMeta>
  >({});

    // clientName (normalized) -> base rate from sheet
  const [clientRateMap, setClientRateMap] = useState<Record<string, number>>(
    {}
  );
  const [clientOptions, setClientOptions] = useState<string[]>([]);

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

  // Payroll messages
  const [payrollMessagesByCaregiver, setPayrollMessagesByCaregiver] = useState<
    Record<string, PayrollMessagesByCaregiverEntry>
  >({});
  const [payrollMessagesLoading, setPayrollMessagesLoading] = useState(false);
  const [payrollMessagesError, setPayrollMessagesError] = useState<string | null>(null);

    // Search bars
  const [billingSearch, setBillingSearch] = useState("");
  const [payrollSearch, setPayrollSearch] = useState("");

   // Add Rule modal
  const [addRuleOpen, setAddRuleOpen] = useState(false);
  const [addRuleSaving, setAddRuleSaving] = useState(false);
  const [addRuleError, setAddRuleError] = useState<string | null>(null);
  const [addRuleSuccess, setAddRuleSuccess] = useState<string | null>(null);
  const [rateRuleForm, setRateRuleForm] = useState<RateRuleFormState>(
    makeBlankRateRuleForm()
  );

   // Sync rates
  const [syncingRates, setSyncingRates] = useState(false);
  const [syncRatesError, setSyncRatesError] = useState<string | null>(null);
  const [syncRatesSuccess, setSyncRatesSuccess] = useState<string | null>(null);
  const [payrollTextModalOpen, setPayrollTextModalOpen] = useState(false);
  const [payrollSummaryDraft, setPayrollSummaryDraft] = useState("");
  const [copyExportSuccess, setCopyExportSuccess] = useState<string | null>(null);

  // Rules view
  const [rulesOpen, setRulesOpen] = useState(false);

  // Payroll details dropdown per shift

  // Payroll details dropdown per shift
  const [expandedRateDetailsByShift, setExpandedRateDetailsByShift] = useState<
    Record<string, boolean>
  >({});
  // Local-only overrides
  const [manualConfirmByShiftId, setManualConfirmByShiftId] = useState<Record<
    string,
    boolean
  >>({});
  const [timeOverrideByShiftId, setTimeOverrideByShiftId] = useState<Record<
    string,
    { startTime: string; endTime: string }
  >>({});

  // Editable pay due per shift
  const [payDueOverrideByShiftId, setPayDueOverrideByShiftId] = useState<
    Record<string, string>
  >({});

  const timeOptions = useMemo(() => buildTimeOptions(15), []);
  const caregiverOptions = useMemo<CaregiverOption[]>(() => {
  return Object.values(caregiverById)
    .map((cg) => ({
      caregiverId: norm(cg.caregiverId),
      label:
        norm(cg.name) ||
        norm(cg.nameOnSchedule) ||
        norm(cg.caregiverId),
      sublabel: norm(cg.nameOnSchedule),
    }))
    .filter((cg) => cg.caregiverId)
    .sort((a, b) => a.label.localeCompare(b.label));
}, [caregiverById]);

  const reloadShiftRates = async (rowsForRange: ShiftRow[]) => {
    const range = getDateRangeFromShifts(rowsForRange);

    if (!range) {
      setPayRateByShift({});
      setShiftRateMetaByShift({});
      return;
    }

    const rateRes = await fetch(
      `/api/shift-rates?dateFrom=${encodeURIComponent(range.dateFrom)}&dateTo=${encodeURIComponent(range.dateTo)}`,
      { cache: "no-store" }
    );

    const rateJson = (await rateRes.json()) as ShiftRatesApiResponse;

    if (!rateJson.ok) {
      throw new Error(rateJson.error || "Failed to load shift rates");
    }

    const rawRows = rateJson.rows || rateJson.rates || [];

    setPayRateByShift(buildPayRateMapFromApi(rawRows));
    setShiftRateMetaByShift(buildShiftRateMetaMapFromApi(rawRows));
  };

  useEffect(() => {
    let cancelled = false;

        async function load() {
      setLoading(true);
      setError(null);
      setPayrollMessagesLoading(true);
      setPayrollMessagesError(null);

      try {
        // 1) archived payroll rows
        const archiveRes = await fetch(`/api/payroll-archive`, { cache: "no-store" });
        const archiveJson = (await archiveRes.json()) as PayrollArchiveApiResponse;
        if (!archiveRes.ok || !archiveJson.ok) {
          throw new Error(archiveJson.error || "Failed to load payroll archive");
        }

        const archiveRows = Array.isArray(archiveJson.rows) ? archiveJson.rows : [];
        const weekOptions = Array.from(
          archiveRows.reduce((map, row) => {
            const weekStartDate = norm(row?.["Week Start Date"]);
            const weekEndDate = norm(row?.["Week End Date"]);
            if (!weekStartDate) return map;

            const existing = map.get(weekStartDate);
            if (!existing || (!existing.weekEndDate && weekEndDate)) {
              map.set(weekStartDate, { weekStartDate, weekEndDate });
            }
            return map;
          }, new Map<string, ArchivedWeekOption>()).values()
        ).sort(
          (a, b) =>
            new Date(b.weekStartDate).getTime() - new Date(a.weekStartDate).getTime()
        );

        const weekStarts = weekOptions.map((week) => week.weekStartDate);

        const effectiveWeekStart =
          selectedWeekStartDate && weekStarts.includes(selectedWeekStartDate)
            ? selectedWeekStartDate
            : weekStarts[0] || "";

        const filteredArchiveRows = effectiveWeekStart
          ? archiveRows.filter((row) => norm(row?.["Week Start Date"]) === effectiveWeekStart)
          : archiveRows;

        const normalizedArchive = normalizePayrollArchiveRows(filteredArchiveRows);

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
        const clientNameSet = new Set<string>();

        for (const r of rowsClients) {
          const name = nameIdx >= 0 ? norm(r[nameIdx]) : "";
          const rateRaw = rateIdx >= 0 ? norm(r[rateIdx]) : "";
          const rate = parseRate(rateRaw);

          if (name) clientNameSet.add(name);
          if (name && rate != null) {
            rateMap[normalizeName(name)] = rate;
          }
        }

        const sortedClientOptions = Array.from(clientNameSet).sort((a, b) =>
          a.localeCompare(b)
        );

                // 3) caregivers profiles
        let byId: Record<string, CaregiverProfile> = {};
        try {
          const cgRes = await fetch(`/api/caregivers`, { cache: "no-store" });
          const cgJson = (await cgRes.json()) as CaregiversApiResponse;
          if (cgJson.ok && cgJson.byId) byId = cgJson.byId;
        } catch {
          // ignore; fallback will be schedule names
        }

                           // 4) shift rates for the displayed week
        const rateMapByShift = normalizedArchive.payRateByShift;
        const rateMetaMapByShift = normalizedArchive.shiftRateMetaByShift;

        // 5) payroll messages for the displayed week
        let groupedPayrollMessages: Record<string, PayrollMessagesByCaregiverEntry> = {};
        let payrollMessagesLoadError: string | null = null;

        try {
          const range = getDateRangeFromShifts(normalizedArchive.shifts);
          if (range) {
            const msgRes = await fetch(
              `/api/payroll-messages?dateFrom=${encodeURIComponent(range.dateFrom)}&dateTo=${encodeURIComponent(range.dateTo)}&groupByCaregiver=true`,
              { cache: "no-store" }
            );

            const msgJson = (await msgRes.json()) as PayrollMessagesApiResponse;

            if (!msgJson.ok) {
              throw new Error(msgJson.error || "Failed to load payroll messages");
            }

            groupedPayrollMessages = msgJson.grouped || {};
          }
        } catch (err: any) {
          console.error("[billing-payroll] failed to load payroll messages:", err);
          payrollMessagesLoadError = err?.message || "Failed to load payroll messages";
        }

        if (cancelled) return;

        setAvailableWeeks(weekOptions);
        if (effectiveWeekStart !== selectedWeekStartDate) {
          setSelectedWeekStartDate(effectiveWeekStart);
        }
        setShifts(normalizedArchive.shifts);
        setClockMap(normalizedArchive.clockMap);
        setLocationMap(normalizedArchive.locationMap);
        setArchiveMetaByShift(normalizedArchive.archiveMetaByShift);
        setClientRateMap(rateMap);
        setClientOptions(sortedClientOptions);
        setCaregiverById(byId);
        setPayRateByShift(rateMapByShift);
        setOriginalPayRateByShift(rateMapByShift);
        setShiftRateMetaByShift(rateMetaMapByShift);
        setPayrollMessagesByCaregiver(groupedPayrollMessages);
        setPayrollMessagesError(payrollMessagesLoadError);

               // reset expansions/searches on week change
                      setExpandedClients({});
        setExpandedCaregivers({});
        setExpandedRateDetailsByShift({});
        setPayrollMessagesByCaregiver(groupedPayrollMessages);
        setBillingSearch("");
        setPayrollSearch("");
        setAddRuleOpen(false);
        setAddRuleSaving(false);
        setAddRuleError(null);
        setAddRuleSuccess(null);
        setRateRuleForm(makeBlankRateRuleForm());
        setSyncingRates(false);
        setSyncRatesError(null);
        setSyncRatesSuccess(null);
        setPayrollTextModalOpen(false);
        setPayrollSummaryDraft("");
        setCopyExportSuccess(null);
        // clear local per-shift overrides on week change
        setManualConfirmByShiftId({});
        setTimeOverrideByShiftId({});
        setPayDueOverrideByShiftId({});
        setSavingRateByShift({});

        // keep billing overrides across week toggle? (feels safer to clear)
        setClientRateOverride({});
        setClientScheduledOverride({});
        setClientAdjustOverride({});
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Unknown error");
         } finally {
        if (!cancelled) {
          setLoading(false);
          setPayrollMessagesLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [selectedWeekStartDate]);
  const weeklyRules = useMemo(() => {
    const byId = new Map<string, ShiftRateRule>();

    Object.values(shiftRateMetaByShift).forEach((meta) => {
      (meta.appliedRules || []).forEach((rule) => {
        const id = norm(rule.ruleId);
        if (!id) return;
        if (!byId.has(id)) {
          byId.set(id, rule);
        }
      });
    });

    return Array.from(byId.values()).sort((a, b) => {
      const ap = Number(a.priority || 0);
      const bp = Number(b.priority || 0);
      if (ap !== bp) return bp - ap;
      return norm(a.ruleName).localeCompare(norm(b.ruleName));
    });
  }, [shiftRateMetaByShift]);
  const workedShifts = useMemo(() => shifts.filter(isWorkedShift), [shifts]);

  const weekLabel = useMemo(() => {
    const dates = shifts
      .map((s) => toDateSafe(s.date))
      .filter((d): d is Date => !!d)
      .sort((a, b) => a.getTime() - b.getTime());

    if (!dates.length) return selectedWeekStartDate ? `Week of ${formatArchiveDate(selectedWeekStartDate)}` : "Archived Week";
    const start = dates[0];
    const end = dates[dates.length - 1];
    return `Week of ${fmtMDY(start)} – ${fmtMDY(end)}`;
  }, [shifts, selectedWeekStartDate]);

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
    const normalizedShiftId = norm(shiftId);
    const manual = manualConfirmByShiftId[normalizedShiftId];
    if (manual) return "confirmed" as const;

    const archiveApprovalStatus = archiveMetaByShift[normalizedShiftId]?.approvalStatus;
    const rateApprovalStatus = shiftRateMetaByShift[normalizedShiftId]?.approvalStatus;
    if (isApprovedStatus(archiveApprovalStatus) || isApprovedStatus(rateApprovalStatus)) {
      return "confirmed" as const;
    }

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
  }, [workedShifts, evalByShiftId, manualConfirmByShiftId, archiveMetaByShift, shiftRateMetaByShift]);

  const confirmedHoursTotal = useMemo(() => {
    let total = 0;
    for (const s0 of workedShifts) {
      const s = applyTimeOverride(s0);
      const id = norm(s.shiftId);
      const ev = id ? evalByShiftId[id] : null;
      const state = effectiveConfirmState(id, ev ?? undefined);
      if (state === "confirmed") {
        total += hoursBetween(s.startTime, s.endTime);
      }
    }
    return total;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workedShifts, evalByShiftId, manualConfirmByShiftId, timeOverrideByShiftId, archiveMetaByShift, shiftRateMetaByShift]);

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

      const shiftClock = sid ? clockMap[sid] : undefined;
      const archiveMeta = sid ? archiveMetaByShift[sid] : undefined;
      const clockInTime = shiftClock?.clockInTime ?? null;
      const clockOutTime = shiftClock?.clockOutTime ?? null;

      const payRateRaw = norm(payRateByShift[sid] ?? "");
      const payRate = parseRate(payRateRaw) ?? DEFAULT_EXPORT_PAY_RATE;

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
        payDue: 0,

        regularHours: 0,
        overtimeHours: 0,
        overtimePayDue: 0,

        clockInTime,
        clockOutTime,
        clockInSite: archiveMeta?.clockInSite || "",
        clockOutSite: archiveMeta?.clockOutSite || "",
        approvalStatus: archiveMeta?.approvalStatus || "Not Approved",
        archivedTotalPay: archiveMeta?.totalPay || 0,
        archiveReason: archiveMeta?.reason || "",
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

      let runningHours = 0;

      g.shifts = g.shifts.map((s) => {
        const { regularHours, overtimeHours } = splitWeeklyOvertime(
          runningHours,
          s.durationHours
        );

        runningHours += s.durationHours;

        const computedPayDue =
          s.archivedTotalPay > 0
            ? s.archivedTotalPay
            : s.confirmState === "confirmed"
            ? roundHours(regularHours * s.payRate + overtimeHours * s.payRate * 1.5)
            : 0;

        const payDueOverride = parseNumber(payDueOverrideByShiftId[norm(s.shiftId)] ?? "");
        const payDue = payDueOverride != null ? payDueOverride : computedPayDue;

        return {
          ...s,
          regularHours,
          overtimeHours,
          overtimePayDue: roundHours(overtimeHours * s.payRate * 1.5),
          payDue,
        };
      });

      return g;
    });

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
  }, [
    workedShifts,
    evalByShiftId,
    payRateByShift,
    caregiverById,
    payrollSearch,
    manualConfirmByShiftId,
    timeOverrideByShiftId,
    payDueOverrideByShiftId,
    clockMap,
    archiveMetaByShift,
  ]);
    const payrollTotals = useMemo(() => {
    let scheduledHours = 0;
    let confirmedHours = 0;
    let flaggedHours = 0;
    let regularHours = 0;
    let overtimeHours = 0;
    let payDue = 0;
    let flaggedShifts = 0;

    for (const g of payrollGroups) {
      for (const s of g.shifts) {
        scheduledHours += s.durationHours;
        regularHours += s.regularHours;
        overtimeHours += s.overtimeHours;

        if (s.confirmState === "confirmed") confirmedHours += s.durationHours;
        if (s.confirmState === "flagged") {
          flaggedHours += s.durationHours;
          flaggedShifts += 1;
        }

        payDue += s.payDue;
      }
    }

    return {
      scheduledHours,
      confirmedHours,
      flaggedHours,
      regularHours,
      overtimeHours,
      flaggedShifts,
      payDue,
    };
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

    function csvEscape(value: any) {
    const s = norm(value);
    if (/[",\n]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }

  const exportCsv = useMemo(() => {
    const rows: string[][] = [];

            rows.push([
      "Caregiver ID",
      "Caregiver Name",
      "Name On Schedule",
      "Shift ID",
      "Date",
      "Client",
      "Start Time",
      "End Time",
      "Hours",
      "Regular Hours",
      "Overtime Hours",
      "Pay Rate",
      "Pay Due",
    ]);

       for (const g of payrollGroups) {
      for (const s of g.shifts) {
                rows.push([
          g.caregiverId,
          g.caregiverLabel,
          g.nameOnSchedule,
          s.shiftId,
          s.date,
          s.client,
          s.startTime,
          s.endTime,
          s.durationHours.toFixed(2),
          s.regularHours.toFixed(2),
          s.overtimeHours.toFixed(2),
          s.payRate.toFixed(2),
          s.payDue.toFixed(2),
        ]);
      }
    }

    return rows.map((row) => row.map(csvEscape).join(",")).join("\n");
  }, [payrollGroups]);

  const exportPayrollSummaryText = useMemo(() => {
    const blocks = payrollGroups
      .map((g) => {
        const caregiverName =
          norm(g.caregiverLabel) || norm(g.nameOnSchedule) || "Unknown Caregiver";
        const hoursByRate = new Map<string, { rate: number; hours: number }>();

        for (const s of g.shifts) {
          if (s.durationHours <= 0 || s.payRate <= 0) continue;

          const rateKey = s.payRate.toFixed(2);
          const prev = hoursByRate.get(rateKey) || { rate: s.payRate, hours: 0 };
          prev.hours += s.durationHours;
          hoursByRate.set(rateKey, prev);
        }

        if (!hoursByRate.size) return "";

        const lines = Array.from(hoursByRate.values())
          .sort((a, b) => b.rate - a.rate)
          .map((entry) => `${formatHoursLabel(entry.hours)} at ${money(entry.rate)} an hour`);

        return [caregiverName, ...lines].join("\n");
      })
      .filter(Boolean);

    return blocks.join("\n\n");
  }, [payrollGroups]);

  const downloadPayrollCsv = () => {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, "0");
    const d = String(today.getDate()).padStart(2, "0");
    const safeWeek = selectedWeekStartDate
      ? formatArchiveDate(selectedWeekStartDate).replace(/\//g, "-")
      : "archived-week";
    const filename = `busybees-payroll-${safeWeek}-${y}-${m}-${d}.csv`;

    const blob = new Blob([exportCsv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(url);
  };

  const openPayrollSummaryEditor = () => {
    setCopyExportSuccess(null);
    setError(null);

    if (!exportPayrollSummaryText.trim()) {
      setError("No payroll data available for the selected week.");
      return;
    }

    setPayrollSummaryDraft(exportPayrollSummaryText);
    setPayrollTextModalOpen(true);
  };

  const copyPayrollSummaryDraft = async () => {
    try {
      setCopyExportSuccess(null);
      setError(null);

      if (!payrollSummaryDraft.trim()) {
        throw new Error("Payroll text is empty.");
      }

      await navigator.clipboard.writeText(payrollSummaryDraft);
      setCopyExportSuccess("Payroll summary copied.");
      window.setTimeout(() => {
        setCopyExportSuccess((prev) =>
          prev === "Payroll summary copied." ? null : prev
        );
      }, 2500);
    } catch (e: any) {
      setError(e?.message || "Failed to copy payroll summary.");
    }
  };

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
          padding: "7px 10px",
          borderRadius: 10,
          border: `1px solid ${active ? UI.slate : UI.border}`,
          background: active ? UI.slate : UI.panelBg,
          color: active ? "#fff" : UI.text,
          fontWeight: 950,
          fontSize: 12,
          cursor: "pointer",
          minWidth: 96,
          lineHeight: 1.1,
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

  const syncShiftRates = async () => {
    try {
      setSyncingRates(true);
      setSyncRatesError(null);
      setSyncRatesSuccess(null);
      setError(null);

      const range = getDateRangeFromShifts(shifts);
      if (!range) {
        throw new Error("No shifts found for the selected week.");
      }

      const res = await fetch(`/api/shift-rates/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "syncShiftRatesFromAllShifts",
          dateFrom: range.dateFrom,
          dateTo: range.dateTo,
        }),
      });

      const json = await res.json();

      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Failed to sync shift rates");
      }

      await reloadShiftRates(shifts);

      setSyncRatesSuccess(
        json?.message ||
          `Shift rates synced successfully. Created: ${json?.created ?? 0}, Updated: ${json?.updated ?? 0}`
      );
    } catch (e: any) {
      setSyncRatesError(e?.message || "Failed to sync shift rates");
    } finally {
      setSyncingRates(false);
    }
  };

   const saveShiftRate = async (shiftId: string) => {
    const sid = norm(shiftId);
    if (!sid) return;

    const parsed = parseRate(payRateByShift[sid] ?? "");
    if (parsed == null) {
      setError("Please enter a valid pay rate before saving.");
      return;
    }

    try {
      setSavingRateByShift((prev) => ({ ...prev, [sid]: true }));
      setError(null);

      const res = await fetch(`/api/shift-rates`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "updateShiftRate",
          shiftId: sid,
          newRate: parsed,
          updatedBy: "Billing & Payroll Page",
          reason: "Updated from payroll section",
        }),
      });

      const json = await res.json();
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Failed to save shift rate");
      }

      setPayRateByShift((prev) => ({
        ...prev,
        [sid]: parsed.toFixed(2),
      }));

        setShiftRateMetaByShift((prev) => {
        const current = prev[sid];

        return {
          ...prev,
          [sid]: {
            finalRate: parsed.toFixed(2),
            baseRate: parsed.toFixed(2),
            addOnTotal: "0.00",

            updatedBy:
              norm(json?.rate?.updatedBy) ||
              norm(json?.updatedBy) ||
              "Billing & Payroll Page",
            updatedAt:
              norm(json?.rate?.updatedAt) ||
              norm(json?.updatedAt) ||
              new Date().toLocaleString(),
            updatedSource: "SchedulerManualEdit",

            rateSource: current?.rateSource || "Manual Override",
            rateSourceDetail:
              norm(json?.rate?.reason) ||
              norm(json?.reason) ||
              "Updated from payroll section",

            approvedBy:
              norm(json?.rate?.updatedBy) ||
              norm(json?.updatedBy) ||
              "Billing & Payroll Page",
            approvedAt:
              norm(json?.rate?.updatedAt) ||
              norm(json?.updatedAt) ||
              new Date().toLocaleString(),
            approvalStatus: "Approved",
            requiresApprovalFromRules: current?.requiresApprovalFromRules || "FALSE",

            appliedRuleIds: ["MANUAL_OVERRIDE"],
            appliedRuleSummary: "MANUAL_OVERRIDE • Manual scheduler override",
            appliedRules: [],

            raw: current?.raw,
          },
        };
      });

      setOriginalPayRateByShift((prev) => ({
        ...prev,
        [sid]: parsed.toFixed(2),
      }));
    } catch (e: any) {
      setError(e?.message || "Failed to save shift rate");
    } finally {
      setSavingRateByShift((prev) => ({ ...prev, [sid]: false }));
    }
  };

  const approveAllCaregiverShifts = (shiftsForCaregiver: PayrollShift[]) => {
    const nextEntries = shiftsForCaregiver
      .filter((s) => s.confirmState !== "future")
      .map((s) => norm(s.shiftId))
      .filter(Boolean);

    if (!nextEntries.length) return;

    setManualConfirmByShiftId((prev) => {
      const next = { ...prev };
      for (const shiftId of nextEntries) {
        next[shiftId] = true;
      }
      return next;
    });
  };

     const updateRateRuleForm: RateRuleFormChange = (key, value) => {
  setRateRuleForm((prev) => {
     const next: RateRuleFormState = {
      ...prev,
      [key]: value,
    } as RateRuleFormState;

    if (key === "ruleName" && !prev.ruleIdManuallyEdited) {
      next.ruleId = buildRuleIdFromName(String(value || ""));
    }

    if (key === "ruleType") {
      next.rateMode = value === "Base" ? "Set" : "Add";
      if (value === "Base") {
        next.addAmount = "";
      } else {
        next.payRate = "";
      }
    }

    if (key === "targetScope") {
      if (value === "client") {
        next.caregiverId = "";
      } else {
        next.client = "";
      }
    }

    return next;
  });
};

  const closeAddRuleModal = () => {
    if (addRuleSaving) return;
    setAddRuleOpen(false);
    setAddRuleError(null);
    setAddRuleSuccess(null);
    setRateRuleForm(makeBlankRateRuleForm());
  };

  const submitAddRule = async () => {
    setAddRuleError(null);
    setAddRuleSuccess(null);

    if (!norm(rateRuleForm.ruleName)) {
      setAddRuleError("Rule name is required.");
      return;
    }

    if (rateRuleForm.rateMode === "Set" && !norm(rateRuleForm.payRate)) {
      setAddRuleError("Pay Rate is required when Rate Mode is Set.");
      return;
    }

    if (rateRuleForm.rateMode === "Add" && !norm(rateRuleForm.addAmount)) {
      setAddRuleError("Add Amount is required when Rate Mode is Add.");
      return;
    }

    if (rateRuleForm.targetScope === "client" && !norm(rateRuleForm.client)) {
      setAddRuleError("Choose a client for this rule.");
      return;
    }

    if (rateRuleForm.targetScope === "caregiver" && !norm(rateRuleForm.caregiverId)) {
      setAddRuleError("Choose a caregiver for this rule.");
      return;
    }

    if (
      !norm(rateRuleForm.client) &&
      !norm(rateRuleForm.caregiverId) &&
      !norm(rateRuleForm.shiftType) &&
      !norm(rateRuleForm.holidayRule) &&
      !norm(rateRuleForm.startDate) &&
      !norm(rateRuleForm.endDate)
    ) {
      setAddRuleError(
        "Add at least one condition: client, caregiver, shift type, holiday, or date."
      );
      return;
    }

    try {
      setAddRuleSaving(true);

      const res = await fetch(`/api/shift-rates`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "createRateRule",
          ruleId: norm(rateRuleForm.ruleId),
          active: rateRuleForm.active,
          priority: "5",
          ruleName: norm(rateRuleForm.ruleName),
          ruleType: rateRuleForm.ruleType,
          rateMode: rateRuleForm.ruleType === "Base" ? "Set" : "Add",
          client: rateRuleForm.targetScope === "client" ? norm(rateRuleForm.client) : "",
          caregiverId:
            rateRuleForm.targetScope === "caregiver" ? norm(rateRuleForm.caregiverId) : "",
          shiftType: norm(rateRuleForm.shiftType),
          holidayRule: norm(rateRuleForm.holidayRule),
          startDate: norm(rateRuleForm.startDate),
          endDate: norm(rateRuleForm.endDate),
          payRate:
            rateRuleForm.rateMode === "Set" ? norm(rateRuleForm.payRate) : "",
          addAmount:
            rateRuleForm.rateMode === "Add" ? norm(rateRuleForm.addAmount) : "",
          requiresApproval: rateRuleForm.requiresApproval,
        }),
      });

      const json = (await res.json()) as CreateRateRuleApiResponse;

      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Failed to create rate rule");
      }

      setAddRuleSuccess(
        `Rule created${json.ruleId ? `: ${json.ruleId}` : ""}`
      );

      setTimeout(() => {
        setAddRuleOpen(false);
        setAddRuleError(null);
        setAddRuleSuccess(null);
        setRateRuleForm(makeBlankRateRuleForm());
      }, 700);
    } catch (e: any) {
      setAddRuleError(e?.message || "Failed to create rate rule");
    } finally {
      setAddRuleSaving(false);
    }
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

    
 
 function MiniSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoComplete="off"
      spellCheck={false}
      style={{
        padding: "7px 10px",
        borderRadius: 10,
        border: `1px solid ${UI.border}`,
        background: UI.panelBg,
        fontWeight: 800,
        fontSize: 12,
        minWidth: 220,
        outline: "none",
      }}
    />
  );
}

  return (
  <div
    style={{
      background: UI.pageBg,
      minHeight: "100vh",
      padding: 16,
      color: UI.text,
    }}
  >
    

    <AddRuleModal
      open={addRuleOpen}
      saving={addRuleSaving}
      error={addRuleError}
      success={addRuleSuccess}
      form={rateRuleForm}
      clientOptions={clientOptions}
      caregiverOptions={caregiverOptions}
      onClose={closeAddRuleModal}
      onSubmit={submitAddRule}
      onChange={updateRateRuleForm}
    />

    {payrollTextModalOpen ? (
      <div
        onClick={() => setPayrollTextModalOpen(false)}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(15,23,42,0.45)",
          display: "grid",
          placeItems: "center",
          padding: 20,
          zIndex: 1000,
        }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            width: "min(920px, 100%)",
            maxHeight: "85vh",
            background: UI.panelBg,
            borderRadius: 16,
            border: `1px solid ${UI.borderSoft}`,
            boxShadow: "0 24px 60px rgba(15,23,42,0.22)",
            padding: 18,
            display: "grid",
            gap: 14,
          }}
        >
          <div style={{ display: "grid", gap: 4 }}>
            <div style={{ fontSize: 18, fontWeight: 950 }}>Payroll Text</div>
            <div style={{ fontSize: 13, color: UI.textDim }}>
              Edit the text below, then copy it when it looks right.
            </div>
          </div>

          <textarea
            value={payrollSummaryDraft}
            onChange={(e) => setPayrollSummaryDraft(e.target.value)}
            spellCheck={false}
            style={{
              width: "100%",
              minHeight: 360,
              maxHeight: "55vh",
              resize: "vertical",
              borderRadius: 12,
              border: `1px solid ${UI.border}`,
              padding: 14,
              fontSize: 14,
              lineHeight: 1.45,
              color: UI.text,
              outline: "none",
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            }}
          />

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 10,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 800, color: UI.textDim }}>
              {copyExportSuccess || " "}
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => setPayrollTextModalOpen(false)}
                style={{
                  padding: "9px 12px",
                  borderRadius: 10,
                  border: `1px solid ${UI.border}`,
                  background: UI.panelBg,
                  fontWeight: 900,
                  cursor: "pointer",
                }}
              >
                Close
              </button>

              <button
                type="button"
                onClick={copyPayrollSummaryDraft}
                style={{
                  padding: "9px 14px",
                  borderRadius: 10,
                  border: `1px solid ${UI.green}`,
                  background: UI.green,
                  color: "#fff",
                  fontWeight: 950,
                  cursor: "pointer",
                }}
              >
                Copy Text
              </button>
            </div>
          </div>
        </div>
      </div>
    ) : null}

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
          <div style={{ fontSize: 22, fontWeight: 950 }}>
            Billing &amp; Payroll
          </div>

          <div style={{ color: UI.textDim, marginTop: 4, fontSize: 13 }}>
            <b>{weekLabel}</b>
          </div>

          <div
            style={{
              marginTop: 8,
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <Pill
              text={`Confirmed: ${confirmedHoursTotal.toFixed(2)}h`}
              bg="rgba(22,101,52,0.12)"
              color="#166534"
            />
            <Pill
              text={`Flagged: ${totalsConfirm.flaggedCount}`}
              bg="rgba(239,68,68,0.14)"
              color="#991b1b"
            />
            {totalsConfirm.futureCount ? (
              <Pill
                text={`Future: ${totalsConfirm.futureCount}`}
                bg="rgba(148,163,184,0.25)"
                color="#334155"
              />
            ) : null}
          </div>

          {missingCaregiverIds.length ? (
            <div
              style={{
                marginTop: 10,
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <Pill
                text={`Missing caregiver profiles: ${missingCaregiverIds.length}`}
                bg="rgba(245,158,11,0.18)"
                color="#7c2d12"
                title="These caregiver IDs appear on the schedule but are not in the Caregivers sheet."
              />
            </div>
          ) : null}
        </div>

                      <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <Toggle value={viewMode} onChange={setViewMode} />

                   <button
            onClick={() => {
              setAddRuleError(null);
              setAddRuleSuccess(null);
              setRateRuleForm(makeBlankRateRuleForm());
              setAddRuleOpen(true);
            }}
            style={{
              padding: "7px 10px",
              borderRadius: 10,
              border: `1px solid ${UI.green}`,
              background: UI.green,
              color: "#fff",
              fontWeight: 950,
              fontSize: 12,
              cursor: "pointer",
              lineHeight: 1.1,
            }}
          >
            + Add Rule
          </button>

          <button
            type="button"
            onClick={() => setRulesOpen((v) => !v)}
            style={{
              padding: "7px 10px",
              borderRadius: 10,
              border: `1px solid ${UI.purple}`,
              background: rulesOpen ? "rgba(124,58,237,0.10)" : UI.panelBg,
              color: UI.purple,
              fontWeight: 950,
              fontSize: 12,
              cursor: "pointer",
              lineHeight: 1.1,
            }}
          >
            {rulesOpen ? "Hide Rules" : "View Rules"}
          </button>

          <button
            type="button"
            onClick={syncShiftRates}
            disabled={syncingRates || loading}
            style={{
              padding: "7px 10px",
              borderRadius: 10,
              border: `1px solid ${UI.blue}`,
              background: syncingRates ? "rgba(43,111,214,0.12)" : UI.panelBg,
              color: UI.blue,
              fontWeight: 950,
              fontSize: 12,
              cursor: syncingRates || loading ? "wait" : "pointer",
              lineHeight: 1.1,
              opacity: syncingRates || loading ? 0.7 : 1,
            }}
            title="Sync shift rates from All Shifts"
          >
            {syncingRates ? "Syncing Rates..." : "Sync Rates"}
          </button>

          <button
            onClick={openPayrollSummaryEditor}
            disabled={loading}
            style={{
              padding: "7px 10px",
              borderRadius: 10,
              border: `1px solid ${UI.green}`,
              background: UI.panelBg,
              color: UI.green,
              fontWeight: 950,
              fontSize: 12,
              cursor: loading ? "wait" : "pointer",
              lineHeight: 1.1,
              opacity: loading ? 0.7 : 1,
            }}
            title="Open editable payroll text"
          >
            Copy Payroll Text
          </button>

          <button
            onClick={downloadPayrollCsv}
            style={{
              padding: "7px 10px",
              borderRadius: 10,
              border: `1px solid ${UI.border}`,
              background: UI.panelBg,
              fontWeight: 950,
              fontSize: 12,
              cursor: "pointer",
              lineHeight: 1.1,
            }}
            title="Download payroll CSV"
          >
            Export CSV
          </button>
          <select
            value={selectedWeekStartDate}
            onChange={(e) => setSelectedWeekStartDate(e.target.value)}
            style={{
              padding: "7px 10px",
              borderRadius: 10,
              border: `1px solid ${UI.border}`,
              background: UI.panelBg,
              fontWeight: 900,
              fontSize: 12,
              cursor: "pointer",
              lineHeight: 1.1,
            }}
          >
            {availableWeeks.length === 0 ? (
              <option value="">No archived weeks</option>
            ) : (
              availableWeeks.map((week) => (
                <option key={week.weekStartDate} value={week.weekStartDate}>
                  {`${formatArchiveDate(week.weekStartDate)} - ${formatArchiveDate(
                    week.weekEndDate || week.weekStartDate
                  )}`}
                </option>
              ))
            )}
          </select>

          <a
            href="/schedule"
            style={{
              padding: "7px 10px",
              borderRadius: 10,
              border: `1px solid ${UI.border}`,
              background: UI.panelBg,
              textDecoration: "none",
              color: UI.text,
              fontWeight: 900,
              fontSize: 12,
              lineHeight: 1.1,
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

      {syncRatesError && (
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
          {syncRatesError}
        </div>
      )}

      {syncRatesSuccess && (
        <div
          style={{
            background: UI.panelBg,
            border: `1px solid ${UI.green}`,
            borderRadius: 12,
            padding: 12,
            marginBottom: 12,
            color: UI.green,
            fontWeight: 900,
          }}
        >
          {syncRatesSuccess}
        </div>
      )}
      {rulesOpen ? (
        <div
          style={{
            background: UI.panelBg,
            border: `1px solid ${UI.borderSoft}`,
            borderRadius: 14,
            padding: 14,
            marginBottom: 12,
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 950 }}>Rules Used For This Report</div>
          <div style={{ marginTop: 6, color: UI.textDim, fontSize: 13 }}>
            Showing distinct applied rules found in the loaded shift-rate data for this week.
          </div>

          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            {weeklyRules.length ? (
              weeklyRules.map((rule) => (
                <div
                  key={rule.ruleId}
                  style={{
                    border: `1px solid ${UI.borderSoft}`,
                    borderRadius: 12,
                    padding: 12,
                    background: UI.headerBg,
                  }}
                >
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <div style={{ fontWeight: 950 }}>{rule.ruleName || rule.ruleId}</div>
                    <Pill
                      text={rule.ruleType || "Rule"}
                      bg="rgba(124,58,237,0.10)"
                      color={UI.purple}
                    />
                    <Pill
                      text={`Priority ${rule.priority || "—"}`}
                      bg="rgba(15,23,42,0.08)"
                      color={UI.slate}
                    />
                    <Pill
                      text={yesNoLabel(rule.active) === "Yes" ? "Active" : "Inactive"}
                      bg={
                        yesNoLabel(rule.active) === "Yes"
                          ? "rgba(34,197,94,0.10)"
                          : "rgba(148,163,184,0.16)"
                      }
                      color={
                        yesNoLabel(rule.active) === "Yes" ? "#166534" : "#475569"
                      }
                    />
                  </div>

                  <div
                    style={{
                      marginTop: 8,
                      display: "grid",
                      gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                      gap: 8,
                      fontSize: 12.5,
                    }}
                  >
                    <div><b>ID:</b> {rule.ruleId || "—"}</div>
                    <div><b>Mode:</b> {rule.rateMode || "—"}</div>
                    <div><b>Client:</b> {rule.client || "—"}</div>
                    <div><b>Caregiver:</b> {rule.caregiverId || "—"}</div>
                    <div><b>Shift Type:</b> {rule.shiftType || "—"}</div>
                    <div><b>Holiday:</b> {rule.holidayRule || "—"}</div>
                    <div><b>Start:</b> {rule.startDate || "—"}</div>
                    <div><b>End:</b> {rule.endDate || "—"}</div>
                    <div><b>Pay Rate:</b> {rule.payRate || "—"}</div>
                    <div><b>Add Amount:</b> {rule.addAmount || "—"}</div>
                    <div><b>Approval:</b> {yesNoLabel(rule.requiresApproval)}</div>
                  </div>
                </div>
              ))
            ) : (
              <div style={{ color: UI.textDim, fontSize: 13 }}>
                No applied rules were found in the loaded shift-rate data for this week.
              </div>
            )}
          </div>
        </div>
      ) : null}
        {loading ? (
          <div style={{ background: UI.panelBg, border: `1px solid ${UI.borderSoft}`, borderRadius: 12, padding: 16 }}>
            Loading…
          </div>
        ) : (
          <>
            {/* BILLING VIEW */}
            {viewMode === "billing" ? (
              <div style={{ background: UI.panelBg, border: `1px solid ${UI.borderSoft}`, borderRadius: 14 }}>
  <div
    style={{
      padding: 10,
      borderBottom: `1px solid ${UI.borderSoft}`,
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      gap: 10,
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
    padding: "7px 8px",
    fontSize: 11,
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
                            <td style={{ padding: "7px 8px", borderBottom: `1px solid ${UI.borderSoft}`, fontWeight: 950, verticalAlign: "middle" }}>
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
                               <span style={{ color: finished ? UI.green : UI.text, fontSize: 13.5 }}>
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
    <div style={{ padding: 6 }}>
      <div style={{ border: `1px solid ${UI.borderSoft}`, borderRadius: 8, overflow: "hidden" }}>
                                      <div style={{ overflowX: "auto" }}>
                                        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
                                          <thead>
                                            <tr>
                                              {["Date", "Caregiver", "Time (adjustable)", "Clock In", "Clock Out", "Confirm", "Actions"].map((h) => (
                                               <th
  key={h}
  style={{
    textAlign: "left",
    padding: "6px 7px",
    fontSize: 11,
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
                                              const shiftClock = clockMap[id];

                                              return (
                                                <tr key={s.shiftId}>
                                                 <td style={{ padding: "6px 7px", borderBottom: `1px solid ${UI.borderSoft}`, whiteSpace: "nowrap", fontSize: 12.5 }}>
  {s.date}
</td>

                                                  <td
  style={{ padding: "6px 7px", borderBottom: `1px solid ${UI.borderSoft}`, fontWeight: 900, fontSize: 12.5, verticalAlign: "middle" }}
  title={cgNos && cgNos !== cgFull ? `Name on schedule: ${cgNos}` : undefined}
>
  {cgFull}
</td>

                                                  <td style={{ padding: "6px 7px", borderBottom: `1px solid ${UI.borderSoft}`, whiteSpace: "nowrap", verticalAlign: "middle" }}>
  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
    <select
      value={timeOverrideByShiftId[id]?.startTime ?? s.startTime}
      onChange={(e) =>
        setShiftTimeLocal(id, {
          startTime: e.target.value,
          endTime: timeOverrideByShiftId[id]?.endTime ?? s.endTime,
        })
      }
      style={{
        padding: "4px 6px",
        borderRadius: 8,
        border: `1px solid ${UI.border}`,
        background: UI.panelBg,
        fontWeight: 800,
        fontSize: 12,
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

                                                  <td style={{ padding: "6px 7px", borderBottom: `1px solid ${UI.borderSoft}`, whiteSpace: "nowrap", fontSize: 12.5 }}>
  {formatClockStamp(shiftClock?.clockInTime)}
</td>

                                                  <td style={{ padding: "6px 7px", borderBottom: `1px solid ${UI.borderSoft}`, whiteSpace: "nowrap", fontSize: 12.5 }}>
  {formatClockStamp(shiftClock?.clockOutTime)}
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
                                                <td colSpan={7} style={{ padding: 12, color: UI.textDim }}>
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
             <div style={{ background: UI.panelBg, border: `1px solid ${UI.borderSoft}`, borderRadius: 14 }}>
  <div
    style={{
      padding: 10,
      borderBottom: `1px solid ${UI.borderSoft}`,
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      gap: 10,
      flexWrap: "wrap",
    }}
  >
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 950 }}>Payroll Report</div>
                                        <div style={{ color: UI.textDim, fontSize: 13, marginTop: 6 }}>
                      Totals:{" "}
                      <b style={{ color: UI.slate }}>{payrollTotals.regularHours.toFixed(2)}</b> regular hrs ·{" "}
                      <b style={{ color: UI.orange }}>{payrollTotals.overtimeHours.toFixed(2)}</b> OT hrs ·{" "}
                      <b style={{ color: UI.green }}>{payrollTotals.confirmedHours.toFixed(2)}</b> confirmed hrs ·{" "}
                      <b style={{ color: UI.red }}>{payrollTotals.flaggedHours.toFixed(2)}</b> flagged hrs ·{" "}
                      <b style={{ color: UI.slate }}>{money(payrollTotals.payDue)}</b>
                      {payrollTotals.flaggedShifts ? (
                        <span style={{ marginLeft: 10 }}>
                          · <b style={{ color: UI.red }}>{payrollTotals.flaggedShifts}</b> flagged shifts
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <MiniSearch value={payrollSearch} onChange={setPayrollSearch} placeholder="Search caregivers…" />
                </div>

               <div style={{ padding: "8px 10px", color: UI.textDim, fontSize: 12 }}>
  Default view is summary-only. Expand a caregiver to see shifts.
</div>

<div style={{ display: "grid", gap: 10, padding: 10 }}>
                                   {payrollGroups.map((g) => {
                    const caregiverScheduled = g.shifts.reduce((a, s) => a + s.durationHours, 0);
                    const caregiverRegular = g.shifts.reduce((a, s) => a + s.regularHours, 0);
                    const caregiverOvertime = g.shifts.reduce((a, s) => a + s.overtimeHours, 0);
                    const caregiverConfirmed = g.shifts.reduce(
                      (a, s) => a + (s.confirmState === "confirmed" ? s.durationHours : 0),
                      0
                    );
                    const caregiverFlagged = g.shifts.reduce(
                      (a, s) => a + (s.confirmState === "flagged" ? s.durationHours : 0),
                      0
                    );
                    const flaggedCount = g.shifts.reduce(
                      (a, s) => a + (s.confirmState === "flagged" ? 1 : 0),
                      0
                    );
                                       const caregiverPay = g.shifts.reduce((a, s) => a + s.payDue, 0);
                    const payrollMessageEntry = payrollMessagesByCaregiver[g.caregiverId];
                    const caregiverPayrollMessages = payrollMessageEntry?.messages || [];
                    const caregiverPayrollMessageCount = payrollMessageEntry?.count || 0;
                    const open = !!expandedCaregivers[g.caregiverId];
                    const finished = isCaregiverFinished(g);
                    const caregiverApproveAllCount = g.shifts.filter(
                      (s) => s.confirmState !== "future"
                    ).length;
                    return (
                      <div
  key={g.caregiverId}
  style={{
    border: `1px solid ${UI.borderSoft}`,
    borderRadius: 10,
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
      padding: "8px 10px",
      alignItems: "flex-start",
      justifyContent: "flex-start",
      gap: 10,
      borderBottom: open ? `1px solid ${UI.borderSoft}` : "none",
    }}
    title="Show shifts"
  >
    <div style={{ flex: 1, minWidth: 0 }}>
           <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
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
          <Pill text="Finished" bg="rgba(22,101,52,0.12)" color="#166534" />
        ) : null}

        {!g.hasProfile ? (
          <Pill
            text="No profile"
            bg="rgba(245,158,11,0.18)"
            color="#7c2d12"
            title="This caregiver is on the schedule but not in the Caregivers sheet."
          />
        ) : null}

        <Pill
          text={`${caregiverScheduled.toFixed(2)}h scheduled`}
          bg="rgba(15,23,42,0.08)"
          color={UI.slate}
        />

        {caregiverOvertime > 0 ? (
          <Pill
            text={`OT ${caregiverOvertime.toFixed(2)}h`}
            bg="rgba(245,158,11,0.14)"
            color="#9a3412"
          />
        ) : null}

        <Pill
          text={`${caregiverConfirmed.toFixed(2)}h confirmed`}
          bg="rgba(34,197,94,0.12)"
          color="#166534"
        />

              {flaggedCount ? (
          <Pill
            text={`${flaggedCount} flagged`}
            bg="rgba(239,68,68,0.14)"
            color="#991b1b"
          />
        ) : null}

        <Pill
          text={`💬 ${caregiverPayrollMessageCount}`}
          bg={
            caregiverPayrollMessageCount
              ? "rgba(124,58,237,0.12)"
              : "rgba(15,23,42,0.06)"
          }
          color={caregiverPayrollMessageCount ? UI.purple : UI.textDim}
          title="Payroll messages sent by this caregiver during the selected week"
        />

        <Pill
          text={money(caregiverPay)}
          bg="rgba(15,23,42,0.08)"
          color={UI.slate}
        />
      </div>

      <div style={{ marginTop: 4, color: UI.textDim, fontSize: 12, lineHeight: 1.3 }}>
        <b style={{ color: UI.red }}>{caregiverFlagged.toFixed(2)}</b> flagged hrs
      </div>
                          </div>
                        </button>

                                           {open ? (
                          <div style={{ display: "grid", gap: 12 }}>
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "flex-end",
                                padding: "10px 10px 0",
                              }}
                            >
                              <button
                                type="button"
                                onClick={() => approveAllCaregiverShifts(g.shifts)}
                                disabled={caregiverApproveAllCount === 0}
                                style={{
                                  padding: "7px 10px",
                                  borderRadius: 9,
                                  border: `1px solid ${UI.green}`,
                                  background:
                                    caregiverApproveAllCount === 0
                                      ? "rgba(22,101,52,0.08)"
                                      : UI.green,
                                  color: caregiverApproveAllCount === 0 ? UI.green : "#fff",
                                  fontWeight: 900,
                                  fontSize: 12,
                                  cursor:
                                    caregiverApproveAllCount === 0
                                      ? "not-allowed"
                                      : "pointer",
                                  opacity: caregiverApproveAllCount === 0 ? 0.65 : 1,
                                }}
                                title="Approve all non-future shifts for this caregiver"
                              >
                                Approve All
                              </button>
                            </div>
                            <div style={{ overflowX: "auto" }}>
                              <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
                                <thead>
                                  <tr>
                                  {[
  "Date",
  "Client",
  "Start",
  "End",
  "Clock In",
  "Clock Out",
  "Pay Rate / Rules",
  "Final Pay",
  "Approved",
  "Actions",
  ].map((h) => (
                                     <th
    key={h}
    style={{
      textAlign: "left",
      padding: "6px 7px",
      fontSize: 11,
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
  const rateMeta = shiftRateMetaByShift[id];
  const approvalPill = getApprovalPill(rateMeta);
  const currentRateInput = norm(payRateByShift[id] ?? "");
  const parsedCurrentRate = parseRate(currentRateInput);
  const originalRateInput = norm(originalPayRateByShift[id] ?? "");
  const parsedOriginalRate = parseRate(originalRateInput);
  const hasRateChange =
    currentRateInput !== "" &&
    parsedCurrentRate != null &&
    parsedCurrentRate !== (parsedOriginalRate ?? null);
  const rowBg = normalizeName(s.approvalStatus).includes("approved") && !normalizeName(s.approvalStatus).includes("not approved")
      ? "rgba(22,101,52,0.04)"
      : "transparent";

  return (
    <tr key={s.shiftId} style={{ background: rowBg }}>
      <td
        style={{
          padding: "6px 7px",
          borderBottom: `1px solid ${UI.borderSoft}`,
          whiteSpace: "nowrap",
          fontSize: 12.5,
          verticalAlign: "top",
        }}
      >
        {s.date}
      </td>

      <td
        style={{
          padding: "6px 7px",
          borderBottom: `1px solid ${UI.borderSoft}`,
          verticalAlign: "top",
        }}
      >
        <div style={{ fontWeight: 900, fontSize: 14.5, lineHeight: 1.2 }}>
          {s.client}
        </div>
      </td>

      <td
        style={{
          padding: "6px 7px",
          borderBottom: `1px solid ${UI.borderSoft}`,
          whiteSpace: "nowrap",
          verticalAlign: "top",
          fontSize: 12.5,
        }}
      >
        {s.startTime}
      </td>

      <td
        style={{
          padding: "6px 7px",
          borderBottom: `1px solid ${UI.borderSoft}`,
          whiteSpace: "nowrap",
          verticalAlign: "top",
          fontSize: 12.5,
        }}
      >
        {s.endTime}
      </td>

      <td
        style={{
          padding: "6px 7px",
          borderBottom: `1px solid ${UI.borderSoft}`,
          verticalAlign: "top",
          fontSize: 12.5,
        }}
      >
        <div
          style={{
            display: "grid",
            gap: 2,
          }}
        >
          <div style={{ fontWeight: 800, color: UI.text }}>{formatClockStamp(s.clockInTime)}</div>
          <div style={{ color: UI.textDim, fontSize: 11.5 }}>{formatSiteLabel(s.clockInSite)}</div>
        </div>
      </td>

      <td
        style={{
          padding: "6px 7px",
          borderBottom: `1px solid ${UI.borderSoft}`,
          verticalAlign: "top",
          fontSize: 12.5,
        }}
      >
        <div style={{ display: "grid", gap: 2 }}>
          <div style={{ fontWeight: 800, color: UI.text }}>{formatClockStamp(s.clockOutTime)}</div>
          <div style={{ color: UI.textDim, fontSize: 11.5 }}>{formatSiteLabel(s.clockOutSite)}</div>
        </div>
      </td>

      <td
        style={{
          padding: "6px 7px",
          borderBottom: `1px solid ${UI.borderSoft}`,
          verticalAlign: "top",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 5,
            minWidth: 240,
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 6,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <TextInput
              value={payRateByShift[id] ?? ""}
              onChange={(v) =>
                setPayRateByShift((prev) => ({ ...prev, [id]: v }))
              }
              placeholder={s.payRate.toFixed(2)}
              width={88}
            />
            <span
              style={{ color: UI.textDim, fontWeight: 900, fontSize: 12 }}
            >
              / hr
            </span>
            {hasRateChange ? (
              <button
                type="button"
                onClick={() => saveShiftRate(id)}
                disabled={!!savingRateByShift[id]}
                style={{
                  padding: "6px 8px",
                  borderRadius: 8,
                  border: `1px solid ${UI.slate}`,
                  background: UI.slate,
                  color: "#fff",
                  fontWeight: 900,
                  fontSize: 12,
                  lineHeight: 1.1,
                  cursor: savingRateByShift[id] ? "wait" : "pointer",
                }}
              >
                {savingRateByShift[id] ? "Saving..." : "Save"}
              </button>
            ) : null}
            <Pill
              text={approvalPill.text}
              bg={approvalPill.bg}
              color={approvalPill.color}
            />

            <button
              type="button"
              onClick={() =>
                setExpandedRateDetailsByShift((prev) => ({
                  ...prev,
                  [id]: !prev[id],
                }))
              }
              style={{
                border: "none",
                background: "transparent",
                padding: 0,
                color: UI.blue,
                fontWeight: 900,
                fontSize: 11.5,
                cursor: "pointer",
              }}
            >
              {expandedRateDetailsByShift[id]
                ? "Hide details"
                : "View details"}
            </button>
          </div>

          {expandedRateDetailsByShift[id] ? (
            <div
              style={{
                border: `1px solid ${UI.borderSoft}`,
                borderRadius: 8,
                background: UI.headerBg,
                padding: 8,
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: "4px 10px",
                fontSize: 11,
                lineHeight: 1.25,
                color: UI.textDim,
              }}
            >
              <div>
                <b style={{ color: UI.text }}>Final:</b> $
                {rateMeta?.finalRate || "—"}
              </div>
              <div>
                <b style={{ color: UI.text }}>Base:</b> $
                {rateMeta?.baseRate || "—"}
              </div>
              <div>
                <b style={{ color: UI.text }}>Add:</b> $
                {rateMeta?.addOnTotal || "0.00"}
              </div>
              <div>
                <b style={{ color: UI.text }}>Req. approval:</b>{" "}
                {yesNoLabel(rateMeta?.requiresApprovalFromRules || "")}
              </div>
              <div>
                <b style={{ color: UI.text }}>Source:</b>{" "}
                {rateMeta?.rateSource || "—"}
              </div>
              <div>
                <b style={{ color: UI.text }}>Rule count:</b>{" "}
                {rateMeta?.appliedRuleIds?.length || 0}
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <b style={{ color: UI.text }}>Rule IDs:</b>{" "}
                {rateMeta?.appliedRuleIds?.length
                  ? rateMeta.appliedRuleIds.join(", ")
                  : "—"}
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <b style={{ color: UI.text }}>Rule summary:</b>{" "}
                {rateMeta?.appliedRuleSummary || "—"}
              </div>
              <div>
                <b style={{ color: UI.text }}>Updated by:</b>{" "}
                {rateMeta?.updatedBy || "—"}
              </div>
              <div>
                <b style={{ color: UI.text }}>Updated at:</b>{" "}
                {formatAuditDate(rateMeta?.updatedAt || "")}
              </div>
            </div>
          ) : null}

        </div>
      </td>

      <td
        style={{
          padding: "6px 7px",
          borderBottom: `1px solid ${UI.borderSoft}`,
          verticalAlign: "top",
        }}
      >
        <TextInput
          value={payDueOverrideByShiftId[id] ?? s.payDue.toFixed(2)}
          onChange={(v) =>
            setPayDueOverrideByShiftId((prev) => ({
              ...prev,
              [id]: v,
            }))
          }
          width={96}
          textAlign="right"
        />
      </td>

      <td
        style={{
          padding: "6px 7px",
          borderBottom: `1px solid ${UI.borderSoft}`,
          verticalAlign: "top",
        }}
      >
        <div style={{ display: "grid", gap: 6 }}>
          <Pill
            text={s.approvalStatus || approvalPill.text}
            bg={approvalPill.bg}
            color={approvalPill.color}
          />
          {s.archiveReason ? (
            <div style={{ color: UI.textDim, fontWeight: 800, fontSize: 11.5, lineHeight: 1.35, maxWidth: 220 }}>
              {s.archiveReason}
            </div>
          ) : null}
        </div>
      </td>

      <td
        style={{
          padding: "6px 7px",
          borderBottom: `1px solid ${UI.borderSoft}`,
          verticalAlign: "top",
        }}
      >
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <span style={{ color: UI.textDim, fontWeight: 900 }}>—</span>
        </div>
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

                                               <div
                            style={{
                              margin: "0 10px 10px",
                              border: `1px solid ${UI.borderSoft}`,
                              borderRadius: 10,
                              overflow: "hidden",
                              background: UI.panelBg,
                            }}
                          >
                            <div
                              style={{
                                padding: "8px 10px",
                                background: UI.headerBg,
                                borderBottom: `1px solid ${UI.borderSoft}`,
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                gap: 10,
                                flexWrap: "wrap",
                              }}
                            >
                              <div style={{ fontWeight: 900, color: UI.text }}>
                                Payroll Messages
                              </div>

                              <div style={{ fontSize: 12, color: UI.textDim }}>
                                {payrollMessagesLoading
                                  ? "Loading..."
                                  : caregiverPayrollMessageCount
                                  ? `${caregiverPayrollMessageCount} message${
                                      caregiverPayrollMessageCount === 1 ? "" : "s"
                                    }`
                                  : "No payroll messages"}
                              </div>
                            </div>

                            {payrollMessagesError ? (
                              <div
                                style={{
                                  padding: 10,
                                  fontSize: 12,
                                  color: "#991b1b",
                                  background: "rgba(239,68,68,0.06)",
                                }}
                              >
                                {payrollMessagesError}
                              </div>
                            ) : caregiverPayrollMessages.length ? (
                              <div style={{ display: "grid" }}>
                                {caregiverPayrollMessages.map((msg, idx) => (
                                  <div
                                    key={msg.messageId || `${g.caregiverId}-${idx}`}
                                    style={{
                                      padding: "10px 12px",
                                      borderTop:
                                        idx === 0 ? "none" : `1px solid ${UI.borderSoft}`,
                                      display: "grid",
                                      gap: 6,
                                    }}
                                  >
                                    <div
                                      style={{
                                        display: "flex",
                                        justifyContent: "space-between",
                                        alignItems: "center",
                                        gap: 10,
                                        flexWrap: "wrap",
                                      }}
                                    >
                                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                        <Pill
                                          text="Payroll"
                                          bg="rgba(124,58,237,0.12)"
                                          color={UI.purple}
                                        />
                                        {msg.status ? (
                                          <Pill
                                            text={msg.status}
                                            bg="rgba(15,23,42,0.08)"
                                            color={UI.slate}
                                          />
                                        ) : null}
                                      </div>

                                      <div style={{ fontSize: 12, color: UI.textDim }}>
                                        {formatPayrollMessageStamp(msg.timestamp)}
                                      </div>
                                    </div>

                                    <div
                                      style={{
                                        fontSize: 13,
                                        color: UI.text,
                                        lineHeight: 1.45,
                                        whiteSpace: "pre-wrap",
                                      }}
                                    >
                                      {msg.text || "—"}
                                    </div>
                                  </div>
                                ))}
                              </div>
                                                       ) : (
                              <div
                                style={{
                                  padding: 10,
                                  fontSize: 12,
                                  color: UI.textDim,
                                }}
                              >
                                No payroll messages sent by this caregiver during this week.
                              </div>
                            )}
                          </div>
                        </div>
                        ) : null}
                      </div>
                    );
                  })}
                  {payrollGroups.length === 0 ? (
                    <div style={{ color: UI.textDim, padding: 8 }}>
                      No payroll data found for this week.
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

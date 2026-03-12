// app/schedule/CWWebSchedule.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation"; // ✅ NEW
import ShiftCard from "./components/ShiftCard";
import { useShiftInfo } from "./components/useShiftInfo";
import { useMessagesUI } from "@/app/api/messages/MessagesContext";
import TopNav from "./components/TopNav";
import CaregiverWebSchedulePanel from "./components/CaregiverWebSchedulePanel";
import ServiceRequestsPanel from "./components/AppServiceRequests";
import {
  buildShiftSaveToast,
  parseShiftTextForFeedback,
  type ShiftSaveCaregiverInput,
} from "./utils/shiftSaveFeedback";
/**
 * NOTE (hydration + nested buttons):
 * The invalid DOM nesting error you showed ("<button> cannot be a descendant of <button>") is almost always
 * coming from ShiftCard (its root wrapper being a <button> while it renders inner <button>s).
 *
 * This file doesn’t create a button-inside-button, but I did one safe tweak here too:
 * - Client name "button" in the sticky left column is now a <div role="button"> to avoid any chance of nesting
 *   if that cell ever gets wrapped by a button elsewhere.
 */

/** ---------- Types from your Grid API ---------- */

type Cell = { a1: string; value: string; fontColor: string };
type GridRow = {
  row: number;
  clientName: string;
  clientA1: string;
  cells: Cell[]; // B..H (Sun..Sat)
};

type GridResponse = {
  ok: boolean;
  apiVersion?: string;
  meta?: { sheet?: string; fetchedAt?: string };
  headers: {
    dayHeaders: string[]; // ["Client Name","Sunday",...]
    dateHeaders: string[]; // ["Date","2/1/2026",...]
  };
  body: {
    startRow: number;
    endRow: number;
    rows: GridRow[];
  };
  error?: string;
};

/** ---------- Types from /api/caregivers ---------- */

/** ---------- Types from /api/caregivers ---------- */

type CaregiverProfile = {
  caregiverId: string;
  nameOnSchedule: string;
  name: string;
  status: string;
  certification: string;
  role: string;
  email: string;
  phone: string;
  dateInterviewed?: string; // ✅ used for tenure
};

type CaregiversApiResponse = {
  ok: boolean;
  caregivers?: CaregiverProfile[];
  byId?: Record<string, CaregiverProfile>;
  idByNameOnSchedule?: Record<string, string>;
  error?: string;
};

/** ---------- Types from /api/employees (Applicants) ---------- */

type ApplicantsApiResponse = {
  ok: boolean;
  headers?: string[];
  rows?: any[];
  error?: string;
};

type ApplicantMini = {
  id: string; // stable key for UI
  firstName: string;
  lastName: string;
  name: string; // "First Last"
  phone: string;
  address: string;
  certification: string;
  vaccinated: string;
  availability: string;

  // ✅ overall score for UI
  score10: number | null;
  score: number | null;

  // ✅ breakdown + supporting fields (what your API actually returns)
  age?: number | null;
  firstImpression?: number | null; // sheet column: "First Impression"
  presentation?: number | null;
  experience?: number | null;
  personality?: number | null;
  reliability?: number | null;

  interviewNotes?: string;
  scoreSource?: "First Impression" | "Breakdown Average" | "None";

  dateInterviewed: string;
  status: string;
  onboardingStage: string;
  interviewId: string;
  birthYear?: string;
};

// ✅ accepts: 7, "7", "7.5", "7/10", "Score: 8", etc.
function toNumOrNull(v: any): number | null {
  const raw = String(v ?? "").trim();
  if (!raw) return null;

  const m = raw.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;

  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function normHeaderLikeEmployeesRoute(s: string) {
  return (s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
}
function buildApplicantsMini(payload: ApplicantsApiResponse): ApplicantMini[] {
  const headersRaw = payload.headers ?? [];
  const headers = headersRaw.map((h) => norm(h));
  const headersNorm = headersRaw.map((h) => normHeaderLikeEmployeesRoute(String(h ?? "")));
  const rows = payload.rows ?? [];

  const idx = (candidates: string[]) => {
    const candNorm = candidates.map((c) => normHeaderLikeEmployeesRoute(c));

    // exact match on normalized headers
    for (const c of candNorm) {
      const i = headersNorm.findIndex((h) => h === c);
      if (i !== -1) return i;
    }

    // contains match on normalized headers
    for (const c of candNorm) {
      const i = headersNorm.findIndex((h) => h.includes(c));
      if (i !== -1) return i;
    }

    return -1;
  };

    const iFirst = idx(["First Name"]);
  const iLast = idx(["Last Name"]);
  const iPhone = idx(["Phone Number", "Phone"]);
  const iAddr = idx(["Address", "Location"]);
  const iCert = idx(["Certification"]);
  const iVax = idx(["Vaccinated"]);
  const iAvail = idx(["Availability"]);

  // ✅ IMPORTANT:
  // Your sheet uses "First Impression" as the overall score.
  // Keep iScore as a fallback, but prefer First Impression.
  const iFirstImpression = idx(["First Impression"]);
  const iScore = idx(["Score", "Score (0-10)", "Score 0-10", "Score10", "score10"]);

  // ✅ breakdown fields shown in the panel
  const iPresentation = idx(["Presentation"]);
  const iExperience = idx(["Experience"]);
  const iPersonality = idx(["Personality"]);
  const iReliability = idx(["Reliability"]);

  // ✅ other fields panel shows
  const iNotes = idx(["Interview Notes", "Notes"]);
  const iAge = idx(["Age"]);

  const iDate = idx(["Date Interviewed", "Interview Date"]);
  const iStatus = idx(["Status"]);
  const iStage = idx(["Onboarding Stage"]);
  const iInterviewId = idx(["Interview ID", "InterviewId", "Interview"]);
  const iBirthYear = idx(["Birth Year", "BirthYear", "Year of Birth"]);

  const out: ApplicantMini[] = [];

  for (let rIdx = 0; rIdx < rows.length; rIdx++) {
    const r = rows[rIdx];

    const rowObj = r && typeof r === "object" && !Array.isArray(r) ? (r as any) : null;
    const rowArr = Array.isArray(r) ? (r as any[]) : null;

    const getArr = (i: number) => (rowArr && i >= 0 ? norm(rowArr[i]) : "");

    const firstName = rowObj ? norm(rowObj["First Name"] ?? rowObj["first name"]) : getArr(iFirst);
    const lastName = rowObj ? norm(rowObj["Last Name"] ?? rowObj["last name"]) : getArr(iLast);

    const name = [firstName, lastName].filter(Boolean).join(" ").trim();

    const phone = rowObj ? norm(rowObj["Phone Number"] ?? rowObj["phone number"] ?? rowObj["phone"]) : getArr(iPhone);
    const address = rowObj ? norm(rowObj["Address"] ?? rowObj["address"] ?? rowObj["Location"] ?? rowObj["location"]) : getArr(iAddr);
    const certification = rowObj ? norm(rowObj["Certification"] ?? rowObj["certification"]) : getArr(iCert);
    const vaccinated = rowObj ? norm(rowObj["Vaccinated"] ?? rowObj["vaccinated"]) : getArr(iVax);
    const availability = rowObj ? norm(rowObj["Availability"] ?? rowObj["availability"]) : getArr(iAvail);

        // ✅ Overall score:
    // Prefer "First Impression" (your sheet's real overall score),
    // then fall back to "Score" variants,
    // then fall back to breakdown average.
    const firstImpressionRaw = rowObj
      ? (rowObj["First Impression"] ?? rowObj["first impression"])
      : (rowArr ? rowArr[iFirstImpression] : "");

    const scoreFallbackRaw =
      rowObj
        ? (rowObj["Score"] ??
           rowObj["score"] ??
           rowObj["Score (0-10)"] ??
           rowObj["score (0-10)"] ??
           rowObj["Score 0-10"] ??
           rowObj["score 0-10"] ??
           rowObj["Score10"] ??
           rowObj["score10"])
        : (rowArr ? rowArr[iScore] : "");

    const presentationRaw = rowObj ? rowObj["Presentation"] : (rowArr ? rowArr[iPresentation] : "");
    const experienceRaw = rowObj ? rowObj["Experience"] : (rowArr ? rowArr[iExperience] : "");
    const personalityRaw = rowObj ? rowObj["Personality"] : (rowArr ? rowArr[iPersonality] : "");
    const reliabilityRaw = rowObj ? rowObj["Reliability"] : (rowArr ? rowArr[iReliability] : "");

    const notesRaw = rowObj
      ? (rowObj["Interview Notes"] ?? rowObj["interview notes"] ?? rowObj["Notes"] ?? rowObj["notes"])
      : (rowArr ? rowArr[iNotes] : "");

    const ageRaw = rowObj ? (rowObj["Age"] ?? rowObj["age"]) : (rowArr ? rowArr[iAge] : "");

    const firstImpression = toNumOrNull(firstImpressionRaw);
    const presentation = toNumOrNull(presentationRaw);
    const experience = toNumOrNull(experienceRaw);
    const personality = toNumOrNull(personalityRaw);
    const reliability = toNumOrNull(reliabilityRaw);
    const age = toNumOrNull(ageRaw);
    const interviewNotes = norm(notesRaw);

    const breakdownNums = [presentation, experience, personality, reliability].filter(
      (n): n is number => n != null
    );
    const breakdownAvg = breakdownNums.length
      ? breakdownNums.reduce((a, b) => a + b, 0) / breakdownNums.length
      : null;

    const score10 =
      firstImpression ??
      toNumOrNull(scoreFallbackRaw) ??
      breakdownAvg ??
      null;

    const scoreSource: ApplicantMini["scoreSource"] =
      firstImpression != null ? "First Impression"
      : (toNumOrNull(scoreFallbackRaw) != null) ? "First Impression" // treat fallback as overall score-like
      : breakdownAvg != null ? "Breakdown Average"
      : "None";
    const dateInterviewed = rowObj
      ? norm(rowObj["Date Interviewed"] ?? rowObj["date interviewed"] ?? rowObj["Interview Date"] ?? rowObj["interview date"])
      : getArr(iDate);

    const status = rowObj ? norm(rowObj["Status"] ?? rowObj["status"]) : getArr(iStatus);

    const onboardingStage = rowObj
      ? norm(rowObj["Onboarding Stage"] ?? rowObj["onboarding stage"])
      : getArr(iStage);

    const interviewId = rowObj
      ? norm(rowObj["Interview ID"] ?? rowObj["interview id"] ?? rowObj["InterviewId"] ?? rowObj["interviewId"])
      : getArr(iInterviewId);

    const birthYear = rowObj
      ? norm(rowObj["Birth Year"] ?? rowObj["birth year"] ?? rowObj["BirthYear"] ?? rowObj["birthYear"])
      : getArr(iBirthYear);

    if (!name && !phone && !address && !interviewId) continue;

    const id =
      norm((rowObj as any)?.__key) ||
      norm((rowObj as any)?.__rowNumber) ||
      (interviewId ? `interview:${interviewId}` : `row:${rIdx}`);

       out.push({
      id,
      firstName,
      lastName,
      name: name || "(No name)",
      phone,
      address,
      certification,
      vaccinated,
      availability,

      // overall
      score10,
      score: score10,

      // ✅ breakdown + supporting fields
      age,
      firstImpression,
      presentation,
      experience,
      personality,
      reliability,
      interviewNotes: interviewNotes || undefined,
      scoreSource,

      dateInterviewed,
      status,
      onboardingStage,
      interviewId,
      birthYear: birthYear || undefined,
    });
  }

  out.sort((a, b) => fullNameSortKey(a.name).localeCompare(fullNameSortKey(b.name)));
  return out;
}
/** ---------- Types from /api/clients ---------- */

type ClientsApiResponse =
  | { ok: true; meta: any; headers: string[]; rows: string[][] }
  | { ok: false; error: string };

type ClientProfile = {
  name: string;
  location: string; // ✅ Location column in Clients sheet
  description: string;
  rate: string;
  raw?: Record<string, string>;
};

/** ---------- Types from /api/schedule ---------- */

type RawValues = string[][];
type WeekKind = "cw" | "nw";

function weekLabel(week: WeekKind) {
  return week === "cw" ? "Current Week" : "Next Week";
}
function gridRouteForWeek(week: WeekKind) {
  return week === "cw" ? "/api/current-week" : "/api/next-week";
}
function gridActionForWeek(week: WeekKind) {
  return week === "cw" ? "getCurrentWeekGrid" : "getNextWeekGrid";
}
function sheetLabelForWeek(week: WeekKind) {
  return week === "cw" ? "Current Week" : "Next Week";
}

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

type ClockEntry = {
  clockInTime: string | null;
  clockOutTime: string | null;
};
type ClockMap = Record<string, ClockEntry>;

/** ---------- Types from /api/historical-data ---------- */

type HistoricalRow = {
  shiftId: string;
  date: string;
  client: string;
  caregiver: string;
  caregiverId: string;
  startTime: string;
  endTime: string;
  status: string;
};

type ClientCaregiverHistoryItem = {
  caregiverId: string;
  caregiverName: string;
  visitCount: number;
  lastDate: string;
};

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

/** ---------- Types from /api/service-requests (Ghost Shifts) ---------- */
/**
 * "Ghost shifts" = service requested / not-yet-on-schedule shifts that we want to *display*
 * inside the schedule cell (NOT writing to the grid).
 *
 * IMPORTANT: This type is shaped to match what ShiftCard expects (`start`, `end`).
 */
type GhostShift = {
  requestId: string;
  client: string;
  date: string; // parseable by toDateSafe
  dow: number; // 0=Sun..6=Sat (computed if endpoint doesn’t include it)
  start: string;
  end: string;

  services?: string;
  notes?: string;
  status?: string;
};

/** ---------- Status logic ---------- */

export type ShiftStatus =
  | "filled"
  | "offered"
  | "offering"
  | "considering"
  | "open"
  | "canceled"
  | "pending"
  | "none";

const SHEET_COLORS: Record<ShiftStatus, string> = {
  filled: "#1f7a3a",
  offered: "#2b6fd6",
  offering: "#49c9f2",
  considering: "#d08a1a",
  open: "#d64545",
  canceled: "#000000",
  pending: "#7a3db8",
  none: "#111827",
};

function worstStatus(statuses: ShiftStatus[]): ShiftStatus {
  if (statuses.includes("open")) return "open";
  if (statuses.includes("considering")) return "considering";
  if (statuses.includes("offered")) return "offered";
  if (statuses.includes("offering")) return "offering";
  if (statuses.includes("pending")) return "pending";
  if (statuses.includes("canceled")) return "canceled";
  if (statuses.includes("filled")) return "filled";
  return "none";
}

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

function normalizeCellText(raw: unknown): string {
  const s = String(raw ?? "");
  return s.replace(/[“”]/g, '"');
}

function statusFromCellValue(raw: unknown): ShiftStatus {
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

function scheduleStatusKeyFromRowStatus(
  raw: string
): "filled" | "offered" | "considering" | "pending" | "other" {
  const s = norm(raw).toLowerCase();
  if (!s) return "other";
  if (s.includes("fill")) return "filled";
  if (s.includes("offer")) return "offered";
  if (s.includes("consider")) return "considering";
  if (s.includes("pend")) return "pending";
  return "other";
}

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

function scheduleStatusColor(raw: string): string {
  const k = scheduleStatusKeyFromRowStatus(raw);
  if (k === "filled") return SHEET_COLORS.filled;
  if (k === "offered") return SHEET_COLORS.offered;
  if (k === "considering") return SHEET_COLORS.considering;
  if (k === "pending") return SHEET_COLORS.pending;
  return UI.text;
}

const DOW_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

// Sticky header sizing
// Sticky header sizing
// Sticky header sizing
// Sticky header sizing
// Sticky header sizing
const STICKY_DAY_ROW_HEIGHT = 44;

// ✅ TopNav is sticky and its height can change.
// Measure it so the day/date rows stick directly under it.
const TOPNAV_Z = 200; // keep nav above header rows
const STICKY_DAY_Z = 150;
const STICKY_DATE_Z = 140;

// ✅ Responsive client column width
const CLIENT_COL_WIDTH = "clamp(150px, 18vw, 240px)";
// Empty cell sizing
const EMPTY_CELL_HEIGHT = 20;

/** ---------- Parsing helpers ---------- */

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

function parseFirstTimeRange(
  cellValue: string
): { start: string; end: string } | null {
  const s = normalizeCellText(cellValue);
  const m = s.match(
    /(\d{1,2}:\d{2}\s?[APMapm]{2})\s*-\s*(\d{1,2}:\d{2}\s?[APMapm]{2})/
  );
  if (!m) return null;
  return {
    start: m[1].replace(/\s+/g, ""),
    end: m[2].replace(/\s+/g, ""),
  };
}

/** ---------- Time helpers ---------- */

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
function ymdFromDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function toYmd(dateStr: string): string {
  const d = toDateSafe(dateStr);
  if (!d) return "";
  return ymdFromDate(d);
}
function addDaysYmd(ymd: string, days: number): string {
  const d = toDateSafe(ymd);
  if (!d) return "";
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return ymdFromDate(out);
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

  const normalized = raw
    .replace(/\s+/g, " ")
    .replace(/([AP]M)$/i, " $1")
    .trim();
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
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function evalClockForShiftLikeScheduleClient(
  dateStr: string,
  startTime: string,
  endTime: string,
  shiftId: string | null,
  clockMap: ClockMap,
  toleranceMin = 15
): ClockEval {
  const entry = shiftId ? clockMap[shiftId] : undefined;

  const scheduledStart = buildScheduledDate(dateStr, startTime);
  let scheduledEnd = buildScheduledDate(dateStr, endTime);

  const startMin = parseTimeToMinutes(startTime);
  const endMin = parseTimeToMinutes(endTime);
  if (
    scheduledStart &&
    scheduledEnd &&
    startMin != null &&
    endMin != null &&
    endMin <= startMin
  ) {
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

  const diffInMin =
    clockIn && scheduledStart ? minutesDiff(clockIn, scheduledStart) : null;
  const diffOutMin =
    clockOut && scheduledEnd ? minutesDiff(clockOut, scheduledEnd) : null;

  if (diffInMin != null && Math.abs(diffInMin) > toleranceMin)
    reasons.push("Clock In outside 15m");
  if (diffOutMin != null && Math.abs(diffOutMin) > toleranceMin)
    reasons.push("Clock Out outside 15m");

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

/** ---------- Shift time state ---------- */

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

function clockDisplayLabelForPastOrProgress(
  which: "in" | "out",
  state: ShiftTimeState,
  clockEval: ClockEval
): string {
  if (which === "in") {
    if (clockEval.clockIn) return fmtNiceTime(clockEval.clockIn);
    return "No Clock In";
  }
  if (clockEval.clockOut) return fmtNiceTime(clockEval.clockOut);
  if (state === "in_progress") return "In progress";
  return "No Clock Out";
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
  return (
    x === "off_site" ||
    x === "offsite" ||
    x === "no_geofence" ||
    x === "location_unavailable"
  );
}
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
        alignItems: "center",
        flexWrap: "wrap",
        gap: 4,
        minWidth: 0,
        maxWidth: "100%",
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

/** ---------- API calls ---------- */

async function fetchGrid(week: WeekKind): Promise<GridResponse> {
  const route = gridRouteForWeek(week);
  const action = gridActionForWeek(week);

  const r = await fetch(`${route}?action=${encodeURIComponent(action)}`, {
    cache: "no-store",
  });
  const text = await r.text();
  const data = text ? (JSON.parse(text) as GridResponse) : (null as any);

  if (!r.ok) throw new Error(data?.error || `Request failed (${r.status})`);
  if (!data?.ok) throw new Error(data?.error || `Failed to load ${weekLabel(week)} grid`);
  return data;
}

async function fetchGhostShifts(week: WeekKind): Promise<any[]> {
  const res = await fetch(`/api/service-requests?week=${encodeURIComponent(week)}`, {
    cache: "no-store",
  });

  const text = await res.text();
  let j: any = null;
  try {
    j = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Non-JSON service-requests response (${res.status}): ${text.slice(0, 200)}`);
  }

  if (!res.ok) throw new Error(j?.error || `Service-requests failed (${res.status})`);
  if (!j?.ok) throw new Error(j?.error || "Failed to load service requests");

  // ✅ accept either "rows" or "requests"
  return j.rows ?? j.requests ?? [];
}

function parseDateToDow(dateStr: string): number {
  const d = toDateSafe(dateStr);
  if (!d) return 0;
  return d.getDay();
}

function normalizeGhostShifts(rawRows: any[]): GhostShift[] {
  const out: GhostShift[] = [];

  for (let i = 0; i < (rawRows?.length ?? 0); i++) {
    const r = rawRows[i];
    const obj = r && typeof r === "object" && !Array.isArray(r) ? r : null;
    const arr = Array.isArray(r) ? r : null;

    const client = norm(obj?.client) || norm(obj?.clientName) || norm(arr?.[2]);

    // ✅ dateKey/rawDate/date fallback
    const date = norm(obj?.dateKey) || norm(obj?.rawDate) || norm(obj?.date) || norm(arr?.[1]);

    // ✅ IMPORTANT: match ShiftCard expectations (start/end)
    const start = norm(obj?.start) || norm(obj?.startTime) || norm(arr?.[3]);
    const end = norm(obj?.end) || norm(obj?.endTime) || norm(arr?.[4]);

    if (!client || !date || !start || !end) continue;

    const requestId =
      norm(obj?.requestId) ||
      norm(obj?.id) ||
      norm(obj?.timestamp) ||
      `${normalizeKey(client)}__${dateKey(date)}__${start}__${end}__${i}`;

    const services = norm(obj?.services) || norm(arr?.[5]);
    const notes = norm(obj?.notes) || norm(arr?.[6]);
    const status = norm(obj?.status) || norm(arr?.[7]);

    const dowRaw = obj?.dow;
    const dow = typeof dowRaw === "number" ? dowRaw : parseDateToDow(date);

    out.push({
      requestId,
      client,
      date,
      dow,
      start,
      end,
      services: services || undefined,
      notes: notes || undefined,
      status: status || undefined,
    });
  }

  out.sort((a, b) => {
    if (a.dow !== b.dow) return a.dow - b.dow;
    const am = parseTimeToMinutes(a.start) ?? 0;
    const bm = parseTimeToMinutes(b.start) ?? 0;
    return am - bm;
  });

  return out;
}

async function fetchClients(): Promise<ClientsApiResponse> {
  const res = await fetch("/api/clients", { cache: "no-store" });
  const text = await res.text();

  let j: any = null;
  try {
    j = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Non-JSON clients response (${res.status}): ${text.slice(0, 200)}`);
  }

  if (!res.ok) throw new Error(j?.error || `Clients request failed (${res.status})`);
  if (!j?.ok) throw new Error(j?.error || "Failed to load clients");
  return j as ClientsApiResponse;
}

function headerIndex(headers: string[], candidates: string[]) {
  const hs = headers.map((h) => norm(h).toLowerCase());
  for (const c of candidates) {
    const i = hs.findIndex((h) => h === c.toLowerCase());
    if (i !== -1) return i;
  }
  for (const c of candidates) {
    const i = hs.findIndex((h) => h.includes(c.toLowerCase()));
    if (i !== -1) return i;
  }
  return -1;
}

function buildClientsByName(payload: Extract<ClientsApiResponse, { ok: true }>) {
  const headers = (payload.headers || []).map((h) => norm(h));
  const rows = payload.rows || [];

  const iName = headerIndex(headers, ["client name", "name", "client"]);
  const iLoc = headerIndex(headers, ["location", "address", "street address"]);
  const iDesc = headerIndex(headers, ["description", "notes", "client description"]);
  const iRate = headerIndex(headers, ["rate", "hourly rate", "bill rate", "billing rate"]);

  const map: Record<string, ClientProfile> = {};

  for (const r of rows) {
    const name = iName >= 0 ? norm(r[iName]) : "";
    if (!name) continue;

    const location = iLoc >= 0 ? norm(r[iLoc]) : "";
    const description = iDesc >= 0 ? norm(r[iDesc]) : "";
    const rate = iRate >= 0 ? norm(r[iRate]) : "";

    const raw: Record<string, string> = {};
    headers.forEach((h, idx) => (raw[h || `col_${idx}`] = norm(r[idx])));

    map[normalizeKey(name)] = { name, location, description, rate, raw };
  }

  return map;
}

async function updateCell(week: WeekKind, a1: string, value: string) {
  const status = statusFromCellValue(value);
  const fontColor = SHEET_COLORS[status] || "#111827";
  const payload = { action: "updateCellByA1", a1, value, fontColor };

  const r = await fetch(gridRouteForWeek(week), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  const text = await r.text();
  const data = text ? JSON.parse(text) : null;

  if (!r.ok) throw new Error(data?.error || `Update failed (${r.status})`);
  if (!data?.ok) throw new Error(data?.error || "Update failed");
  return data;
}

async function fetchScheduleMaps(week: WeekKind): Promise<{
  values: RawValues;
  clockMap: ClockMap;
  locationMap: LocationMap;
}> {
  const res = await fetch(`/api/schedule?week=${encodeURIComponent(week)}`, {
    cache: "no-store",
  });
  const text = await res.text();

  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Non-JSON schedule response (${res.status}): ${text.slice(0, 200)}`);
  }

  if (!res.ok) throw new Error(data?.error || `Schedule request failed (${res.status})`);
  if (!data?.ok) throw new Error(data?.error || "Failed to load schedule maps");

  return {
    values: data.values ?? [],
    clockMap: data.clockMap ?? {},
    locationMap: data.locationMap ?? {},
  };
}

async function fetchHistoricalTail(tailWeeks = 26, limit = 5000): Promise<HistoricalRow[]> {
  const res = await fetch(
    `/api/historical-data?tailWeeks=${encodeURIComponent(String(tailWeeks))}&limit=${encodeURIComponent(
      String(limit)
    )}`,
    { cache: "no-store" }
  );

  const text = await res.text();
  let j: any = null;
  try {
    j = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Non-JSON historical response (${res.status}): ${text.slice(0, 200)}`);
  }

  if (!res.ok) throw new Error(j?.error || `Historical request failed (${res.status})`);
  if (!j?.ok) throw new Error(j?.error || "Failed to load historical data");
  return (j.rows ?? []) as HistoricalRow[];
}

function compareDatesLoose(a: string, b: string) {
  const da = toDateSafe(a);
  const db = toDateSafe(b);
  const ta = da ? da.getTime() : -Infinity;
  const tb = db ? db.getTime() : -Infinity;
  return ta - tb;
}

function buildClientHistoryList(args: {
  clientName: string;
  historicalRows: HistoricalRow[];
  caregiversById: Record<string, CaregiverProfile>;
  idByNameOnSchedule: Record<string, string>;
}): ClientCaregiverHistoryItem[] {
  const clientKey = normalizeKey(args.clientName);
  if (!clientKey) return [];

  const map: Record<
    string,
    { caregiverId: string; caregiverName: string; visitCount: number; lastDate: string }
  > = {};

  for (const r of args.historicalRows) {
    if (normalizeKey(r.client) !== clientKey) continue;

    const rawId = norm(r.caregiverId);
    const rawName = norm(r.caregiver);

    const idFromName = rawName ? args.idByNameOnSchedule[normalizeKey(rawName)] : "";
    const caregiverId = rawId || idFromName || "";

    const prof = caregiverId ? args.caregiversById[caregiverId] : undefined;
    const caregiverName =
      norm(prof?.name) ||
      norm(prof?.nameOnSchedule) ||
      rawName ||
      (caregiverId ? caregiverId : "Unknown");

    const key = caregiverId ? `id:${caregiverId}` : `name:${normalizeKey(caregiverName)}`;
    if (!map[key]) map[key] = { caregiverId, caregiverName, visitCount: 0, lastDate: "" };

    map[key].visitCount += 1;

    const cur = map[key].lastDate;
    if (!cur || compareDatesLoose(cur, r.date) < 0) map[key].lastDate = r.date;
  }

  return Object.values(map)
    .filter((x) => x.caregiverName)
    .sort((a, b) => {
      if (b.visitCount !== a.visitCount) return b.visitCount - a.visitCount;
      return compareDatesLoose(b.lastDate, a.lastDate);
    });
}

/** ---------- Availability ---------- */

type AvailRow = {
  caregiverName: string;
  caregiverId: string;
  desiredHours: string;
  notes: string;
  byDow: Record<number, string>;
};

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
    padding: "3px 7px",
    borderRadius: 999,
    fontSize: 10.5,
    fontWeight: 900,
    border: "1px solid",
    lineHeight: 1.1,
    whiteSpace: "nowrap",
  };

  if (isOff) {
    return (
      <span
        style={{
          ...chipStyle,
          background: "#f3f4f6",
          color: "#6b7280",
          borderColor: "#e5e7eb",
        }}
      >
        Not available
      </span>
    );
  }

  if (isOpen) {
    return (
      <span
        style={{
          ...chipStyle,
          background: "#ecfdf5",
          color: "#065f46",
          borderColor: "#a7f3d0",
        }}
      >
        Open
      </span>
    );
  }

  return (
    <span style={{ fontWeight: 800, fontSize: 11, color: UI.text, whiteSpace: "pre-wrap" }}>
      {v}
    </span>
  );
}

/** ---------- Schedule parsing ---------- */

function normalizeScheduleValues(values: RawValues): ShiftRow[] {
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

function makeShiftLookupKey(args: {
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

/** ---------- Modal ---------- */

function Modal({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(17,24,39,0.42)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
        zIndex: 9999,
      }}
    >
      <div
        style={{
          width: "min(780px, 96vw)",
          background: UI.panelBg,
          border: `1px solid ${UI.border}`,
          borderRadius: 14,
          overflow: "hidden",
          boxShadow: "0 12px 34px rgba(0,0,0,0.22)",
        }}
      >
        <div
          style={{
            padding: 12,
            background: UI.headerBg,
            borderBottom: `1px solid ${UI.borderSoft}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 10,
          }}
        >
          <div style={{ fontWeight: 950, fontSize: 14 }}>{title}</div>
          <button
            type="button"
            onClick={onClose}
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
        <div style={{ padding: 12 }}>{children}</div>
      </div>
    </div>
  );
}

/** ---------- Caregiver panel helpers ---------- */

function durationHoursFromStartEnd(start: string, end: string): number {
  const s = parseTimeToMinutes(start);
  const e0 = parseTimeToMinutes(end);
  if (s == null || e0 == null) return 0;
  let e = e0;
  if (e <= s) e += 24 * 60;
  return Math.max(0, (e - s) / 60);
}

function isActiveStatus(status: string) {
  const s = norm(status).toLowerCase();
  if (!s) return true;
  return s.includes("active");
}

function isCancelledStatus(status: string) {
  const s = norm(status).toLowerCase();
  return s.includes("cancel");
}

function isFlaggedShiftFromScheduleRow(
  s: ShiftRow,
  clockMap: ClockMap,
  locationMap: LocationMap
): boolean {
  if (!s.shiftId) return false;
  if (isCancelledStatus(s.status)) return false;

  const nowMs = Date.now();
  const clockEval = evalClockForShiftLikeScheduleClient(
    s.date,
    s.startTime,
    s.endTime,
    s.shiftId,
    clockMap,
    15
  );
  const tState = shiftTimeState(clockEval.scheduledStart, clockEval.scheduledEnd, nowMs);

  const loc = locationMap[s.shiftId];
  const inVerdict = loc?.clockIn?.verdict ?? null;
  const outVerdict = loc?.clockOut?.verdict ?? null;

  const hasLocationIssue = Boolean(isBadVerdict(inVerdict) || isBadVerdict(outVerdict));

  const hasClockIssueRaw = clockEval.state === "bad";
  const inIsGoodOrOk =
    Boolean(clockEval.clockIn) &&
    (clockEval.diffInMin == null || Math.abs(clockEval.diffInMin) <= 15);
  const isInProgressMissingOutButOk = tState === "in_progress" && inIsGoodOrOk && !clockEval.clockOut;
  const hasClockIssue = hasClockIssueRaw && !isInProgressMissingOutButOk;

  const isPastNoClocks = tState === "past" && !clockEval.clockIn && !clockEval.clockOut;

  const isVerified =
    tState === "past" &&
    Boolean(clockEval.clockIn && clockEval.clockOut) &&
    clockEval.state === "good" &&
    isOnSite(inVerdict) &&
    isOnSite(outVerdict) &&
    !hasLocationIssue;

  return (hasClockIssue || hasLocationIssue || isPastNoClocks) && !isVerified;
}

function parseInterviewDate(d: string | undefined): Date | null {
  const raw = norm(d);
  if (!raw) return null;
  const dt = new Date(raw);
  if (!Number.isNaN(dt.getTime())) return dt;
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    const mm = parseInt(m[1], 10);
    const dd = parseInt(m[2], 10);
    let yyyy = parseInt(m[3], 10);
    if (yyyy < 100) yyyy += 2000;
    const out = new Date(yyyy, mm - 1, dd);
    return Number.isNaN(out.getTime()) ? null : out;
  }
  return null;
}

function tenureLabelFromInterviewDate(dateInterviewed?: string): string {
  const d = parseInterviewDate(dateInterviewed);
  if (!d) return "";
  const now = new Date();
  let months = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
  if (months < 0) months = 0;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  if (years <= 0 && rem <= 0) return "0m";
  if (years <= 0) return `${rem}m`;
  if (rem <= 0) return `${years}y`;
  return `${years}y ${rem}m`;
}

function fullNameSortKey(fullName: string) {
  const s = norm(fullName).replace(/\s+/g, " ").trim();
  const parts = s.split(" ").filter(Boolean);
  const first = parts[0] || "";
  const last = parts.length > 1 ? parts[parts.length - 1] : "";
  return `${normalizeKey(first)}__${normalizeKey(last)}__${normalizeKey(s)}`;
}

/** ---------- Small UI components ---------- */

function DayChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
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
}

/** ---------- Main component ---------- */

export default function CWWebSchedule() {
  const router = useRouter(); // ✅ NEW
  const pathname = usePathname() || "/schedule"; // ✅ NEW
  const searchParams = useSearchParams(); // ✅ NEW
const [applicantSearch, setApplicantSearch] = useState("");
  const [week, setWeek] = useState<WeekKind>("cw");

  // ✅ TopNav height tracking (MUST live inside component)
  const [topNavH, setTopNavH] = useState(0);
  const topNavRef = useRef<HTMLDivElement | null>(null);

  // ✅ Computed sticky tops (depend on topNavH)
  const STICKY_DAY_ROW_TOP = topNavH;
  const STICKY_DATE_ROW_TOP = topNavH + STICKY_DAY_ROW_HEIGHT;

  // ✅ Measure TopNav height so sticky table headers sit right under it
  useEffect(() => {
    const el = topNavRef.current;
    if (!el) return;

    const update = () => setTopNavH(el.offsetHeight || 0);

    update();

    const ro = new ResizeObserver(update);
    ro.observe(el);

    window.addEventListener("resize", update);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  // ✅ NEW: write week to URL (preserve any existing query params)
  function setWeekAndUrl(next: WeekKind) {
    setWeek(next);

    const sp = new URLSearchParams(searchParams?.toString() || "");
    sp.set("week", next);

    // keep other params if they exist
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  // ✅ NEW: read week from URL
  useEffect(() => {
    const qp = (searchParams?.get("week") || "").toLowerCase();
    if (qp === "cw" || qp === "nw") {
      if (qp !== week) setWeek(qp as WeekKind);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Messages UI
  const messagesUI = useMessagesUI();
  const { openPanel } = messagesUI;

  // grid
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<GridResponse | null>(null);

  // maps
  const [clockMap, setClockMap] = useState<ClockMap>({});
  const [locationMap, setLocationMap] = useState<LocationMap>({});
  const [shiftIdLookup, setShiftIdLookup] = useState<Record<string, string>>({});
  const [scheduleRows, setScheduleRows] = useState<ShiftRow[]>([]);

  const shiftInfo = useShiftInfo({
    week,
    scheduleRows,
    shiftIdLookup,
    clockMap,
    locationMap,
  });

    // caregivers
  const [caregiversById, setCaregiversById] = useState<Record<string, CaregiverProfile>>({});
  const [idByNameOnSchedule, setIdByNameOnSchedule] = useState<Record<string, string>>({});
  const [caregiversLoading, setCaregiversLoading] = useState(false);
  const [caregiversError, setCaregiversError] = useState<string | null>(null);

  // ✅ applicants (from /api/employees)
  const [applicantsLoading, setApplicantsLoading] = useState(false);
  const [applicantsError, setApplicantsError] = useState<string | null>(null);
  const [applicants, setApplicants] = useState<ApplicantMini[]>([]);

  // historical
  const [histLoading, setHistLoading] = useState(false);
  const [histError, setHistError] = useState<string | null>(null);
  const [histRows, setHistRows] = useState<HistoricalRow[]>([]);

  // ✅ Ghost shifts (service requests)
  const [ghostLoading, setGhostLoading] = useState(false);
  const [ghostError, setGhostError] = useState<string | null>(null);
  const [ghostShifts, setGhostShifts] = useState<GhostShift[]>([]);

  // clients
  const [clientsLoading, setClientsLoading] = useState(false);
  const [clientsError, setClientsError] = useState<string | null>(null);
  const [clientsByName, setClientsByName] = useState<Record<string, ClientProfile>>({});

  // client profile modal
  const [clientProfileOpen, setClientProfileOpen] = useState(false);
  const [clientProfileName, setClientProfileName] = useState<string>("");

  // ✅ Service Requests panel (per-client, per-week)
  const [svcPanelOpen, setSvcPanelOpen] = useState(false);
  const [svcClientName, setSvcClientName] = useState<string>("");

  // filters
  const [selectedDow, setSelectedDow] = useState<number | null>(null);
  const [searchText, setSearchText] = useState("");

  // expanded shift cards
  const [expandedA1ByWeek, setExpandedA1ByWeek] = useState<Record<WeekKind, Set<string>>>({
    cw: new Set(),
    nw: new Set(),
  });
  const expandedA1 = expandedA1ByWeek[week];
  const setExpandedA1 = (updater: (prev: Set<string>) => Set<string>) => {
    setExpandedA1ByWeek((prev) => {
      const next = { ...prev };
      next[week] = updater(prev[week] ?? new Set());
      return next;
    });
  };

  useEffect(() => {
    setExpandedA1ByWeek((prev) => ({
      ...prev,
      [week]: new Set(),
    }));
  }, [week]);

    // edit modal
  const [editOpen, setEditOpen] = useState(false);
  const [editA1, setEditA1] = useState<string | null>(null);
  const [editClientName, setEditClientName] = useState<string>("");
  const [editDayLabel, setEditDayLabel] = useState<string>("");
  const [editDraft, setEditDraft] = useState<string>("");
  const [savingA1, setSavingA1] = useState<string | null>(null);

  // shift save feedback toast
  const [saveToast, setSaveToast] = useState<{
    id: number;
    kind: "success" | "warning" | "error";
    title: string;
    lines: string[];
  } | null>(null);
  function openClientProfile(clientName: string) {
    const n = norm(clientName);
    if (!n) return;
    const p = clientsByName[normalizeKey(n)];
    setClientProfileName(p?.name || n);
    setClientProfileOpen(true);
  }

  // caregiver panel
  const [panelOpen, setPanelOpen] = useState(true);
  const [availLoading, setAvailLoading] = useState(false);
  const [availError, setAvailError] = useState<string | null>(null);
  const [availValues, setAvailValues] = useState<RawValues>([]);
  const [availTabName, setAvailTabName] = useState<string>("");

  const [panelSearch, setPanelSearch] = useState("");
  const [panelSelectedDow, setPanelSelectedDow] = useState<number | null>(null);
  const [panelFilter, setPanelFilter] = useState<"all" | "certifiedActive" | "missingProfile">("all");

    async function loadGridForWeek(w: WeekKind) {
    const j = await fetchGrid(w);
    setData(j);
  }

  async function refreshScheduleMapsForWeek(w: WeekKind) {
    const sched = await fetchScheduleMaps(w);
    setClockMap(sched.clockMap ?? {});
    setLocationMap(sched.locationMap ?? {});
    const rows = normalizeScheduleValues(sched.values ?? []);
    setScheduleRows(rows);

    const lookup: Record<string, string> = {};
    for (const s of rows) {
      const key = makeShiftLookupKey({
        client: s.client,
        date: s.date,
        start: s.startTime,
        end: s.endTime,
        caregiver: s.caregiver || "",
      });
      if (s.shiftId) lookup[key] = s.shiftId;
    }
    setShiftIdLookup(lookup);
  }

  async function refreshGhostShiftsForWeek(w: WeekKind) {
    try {
      setGhostLoading(true);
      setGhostError(null);

      const raw = await fetchGhostShifts(w);
      const normalized = normalizeGhostShifts(raw);
      setGhostShifts(normalized);
    } catch (e: any) {
      setGhostError(e?.message ?? "Unknown service requests error");
      setGhostShifts([]);
    } finally {
      setGhostLoading(false);
    }
  }

    async function refreshCaregivers() {
    try {
      setCaregiversLoading(true);
      setCaregiversError(null);

      const res = await fetch("/api/caregivers", { cache: "no-store" });
      const text = await res.text();
      const j = text ? (JSON.parse(text) as CaregiversApiResponse) : null;

      if (!res.ok) throw new Error((j as any)?.error || `Caregivers request failed (${res.status})`);
      if (!j?.ok) throw new Error(j?.error || "Failed to load caregivers");

      setCaregiversById(j.byId ?? {});
      const rawMap = j.idByNameOnSchedule ?? {};
      const normMap: Record<string, string> = {};
      for (const k of Object.keys(rawMap)) normMap[normalizeKey(k)] = rawMap[k];
      setIdByNameOnSchedule(normMap);
    } catch (e: any) {
      setCaregiversError(e?.message ?? "Unknown caregivers error");
    } finally {
      setCaregiversLoading(false);
    }
  }

  // ✅ Applicants fetch
  async function refreshApplicants() {
    try {
      setApplicantsLoading(true);
      setApplicantsError(null);

      const res = await fetch("/api/employees", { cache: "no-store" });
      const text = await res.text();

      let j: any = null;
      try {
        j = text ? JSON.parse(text) : null;
      } catch {
        throw new Error(`Non-JSON employees response (${res.status}): ${text.slice(0, 200)}`);
      }

      if (!res.ok) throw new Error(j?.error || `Employees request failed (${res.status})`);
      if (!j?.ok) throw new Error(j?.error || "Failed to load employees");

      const mini = buildApplicantsMini(j as ApplicantsApiResponse);
      setApplicants(mini);
    } catch (e: any) {
      setApplicantsError(e?.message ?? "Unknown applicants error");
      setApplicants([]);
    } finally {
      setApplicantsLoading(false);
    }
  }

  async function refreshClients() {
    try {
      setClientsLoading(true);
      setClientsError(null);
      const j = await fetchClients();
      if (!j.ok) throw new Error(j.error);
      const map = buildClientsByName(j);
      setClientsByName(map);
    } catch (e: any) {
      setClientsError(e?.message ?? "Unknown clients error");
      setClientsByName({});
    } finally {
      setClientsLoading(false);
    }
  }

  // initial load
  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setLoading(true);
        setError(null);

        const j = await fetchGrid(week);
        if (!alive) return;
        setData(j);

        await Promise.all([
  refreshScheduleMapsForWeek(week),
  refreshCaregivers(),
  refreshApplicants(), // ✅ add
  refreshClients(),
  refreshGhostShiftsForWeek(week),
  (async () => {
    try {
      setHistLoading(true);
      setHistError(null);
      const rows = await fetchHistoricalTail(26, 5000);
      if (!alive) return;
      setHistRows(rows);
    } catch (e: any) {
      if (!alive) return;
      setHistError(e?.message ?? "Historical load failed");
    } finally {
      if (alive) setHistLoading(false);
    }
  })(),
]);
      } catch (e: any) {
        if (alive) setError(e?.message ?? "Unknown error");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [week]);

  // availability fetch
    useEffect(() => {
    let alive = true;

    async function runAvail() {
      if (!panelOpen) return;

      try {
        setAvailLoading(true);
        setAvailError(null);

        const res = await fetch(`/api/availability?week=${encodeURIComponent(week)}`, {
          cache: "no-store",
        });
        const text = await res.text();
        let j: any = null;
        try {
          j = text ? JSON.parse(text) : null;
        } catch {
          throw new Error(`Non-JSON availability response (${res.status}): ${text.slice(0, 200)}`);
        }

        if (!j?.ok) throw new Error(j?.error || "Failed to load availability");
        if (alive) {
          setAvailValues(j.values ?? []);
          setAvailTabName(j.tabName ?? "");
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
  }, [panelOpen, week]);

  useEffect(() => {
    if (!saveToast) return;

    const timer = window.setTimeout(() => {
      setSaveToast((prev) => (prev?.id === saveToast.id ? null : prev));
    }, 5000);

    return () => window.clearTimeout(timer);
  }, [saveToast]);

  /** ---------- Week window (for ghost shifts) ---------- */

  const weekStartYmd = useMemo(() => {
    const sunday = norm(data?.headers?.dateHeaders?.[1]); // Sunday header
    return toYmd(sunday) || "";
  }, [data?.headers?.dateHeaders?.[1]]);

  const weekEndYmd = useMemo(() => {
    return weekStartYmd ? addDaysYmd(weekStartYmd, 6) : "";
  }, [weekStartYmd]);

  const ghostShiftsThisWeek = useMemo(() => {
    if (!weekStartYmd || !weekEndYmd) return [];
    return ghostShifts.filter((g) => {
      const y = toYmd(g.date);
      if (!y) return false;
      // ymd strings compare safely lexicographically
      return y >= weekStartYmd && y <= weekEndYmd;
    });
  }, [ghostShifts, weekStartYmd, weekEndYmd]);

  /** ---------- Service requests helpers ---------- */
 /** ---------- Grid rows + filters ---------- */

  const rowsAll = useMemo(() => data?.body?.rows ?? [], [data]);

  function openServiceRequestsForClient(clientName: string) {
    const n = norm(clientName);
    if (!n) return;

    // Don’t open if we don’t yet know the week’s Sunday date
    if (!weekStartYmd) {
      alert("Week start date not loaded yet — try again in a moment.");
      return;
    }

    setSvcClientName(n);
    setSvcPanelOpen(true);
  }

    const requestCountByClientKey = useMemo(() => {
    const map: Record<string, number> = {};
    for (const g of ghostShiftsThisWeek) {
      const key = normalizeKey(g.client);
      if (!key) continue;
      map[key] = (map[key] || 0) + 1;
    }
    return map;
  }, [ghostShiftsThisWeek]);

  // Which DOWs already have *any* schedule text for each client (0=Sun..6=Sat)
  const scheduledDowsByClientKey = useMemo(() => {
    const map: Record<string, Set<number>> = {};

    for (const r of rowsAll) {
      const name = norm(r.clientName);
      const ck = normalizeKey(name);
      if (!ck) continue;

      const set = map[ck] ?? (map[ck] = new Set<number>());

      for (let dow = 0; dow < 7; dow++) {
        const hasAnyShiftText = Boolean(norm(r.cells?.[dow]?.value));
        if (hasAnyShiftText) set.add(dow);
      }
    }

    return map;
  }, [rowsAll]);

  // Which DOWs have service-requests for each client (only this week)
  const requestDowsByClientKey = useMemo(() => {
    const map: Record<string, Set<number>> = {};

    for (const g of ghostShiftsThisWeek) {
      const ck = normalizeKey(g.client);
      if (!ck) continue;

      const set = map[ck] ?? (map[ck] = new Set<number>());
      set.add(typeof g.dow === "number" ? g.dow : parseDateToDow(g.date));
    }

    return map;
  }, [ghostShiftsThisWeek]);

  // Badge info per client: uncovered request-days vs covered
  const badgeByClientKey = useMemo(() => {
    const out: Record<
      string,
      { reqCount: number; uncoveredDays: number; requestedDows: number[] }
    > = {};

    for (const ck of Object.keys(requestCountByClientKey)) {
      const reqCount = requestCountByClientKey[ck] || 0;
      const reqSet = requestDowsByClientKey[ck] ?? new Set<number>();
      const scheduledSet = scheduledDowsByClientKey[ck] ?? new Set<number>();

      let uncoveredDays = 0;
      const requestedDows = Array.from(reqSet).sort((a, b) => a - b);

      for (const dow of reqSet) {
        if (!scheduledSet.has(dow)) uncoveredDays += 1;
      }

      out[ck] = { reqCount, uncoveredDays, requestedDows };
    }

    return out;
  }, [requestCountByClientKey, requestDowsByClientKey, scheduledDowsByClientKey]);
  /** ---------- Client history (modal) ---------- */

  const clientCaregiverHistory = useMemo(() => {
    if (!clientProfileOpen || !clientProfileName) return [];
    return buildClientHistoryList({
      clientName: clientProfileName,
      historicalRows: histRows,
      caregiversById,
      idByNameOnSchedule,
    });
  }, [clientProfileOpen, clientProfileName, histRows, caregiversById, idByNameOnSchedule]);

 

  const rows = useMemo(() => {
    const q = searchText.trim();
    if (!q) return rowsAll;

    return rowsAll.filter((r) => {
      const name = norm(r.clientName);
      const clientKey = normalizeKey(name);
      const clientProfile = clientKey ? clientsByName[clientKey] : undefined;

      const clientLocation = norm(clientProfile?.location);
      const clientDescription = norm(clientProfile?.description);
      const clientRate = norm(clientProfile?.rate);

      if (containsCI(name, q)) return true;
      if (containsCI(clientLocation, q)) return true;
      if (containsCI(clientDescription, q)) return true;
      if (containsCI(clientRate, q)) return true;

      const anyCell = r.cells.some((c) => containsCI(norm(c.value), q));
      return anyCell;
    });
  }, [rowsAll, searchText, clientsByName]);

  const dayHeaders = data?.headers?.dayHeaders ?? ["Client Name", ...DOW_LABELS];
  const dateHeaders = data?.headers?.dateHeaders ?? ["Date", "", "", "", "", "", "", ""];

  // ✅ IMPORTANT: ghost map key must match lookup key (NO dow in either place)
  const ghostByCell = useMemo(() => {
    const map: Record<string, GhostShift[]> = {};

    for (const g of ghostShiftsThisWeek) {
      const ck = normalizeKey(g.client);
      const dk = dateKey(g.date);
      const key = `${ck}__${dk}`;

      if (!map[key]) map[key] = [];
      map[key].push(g);
    }

    for (const k of Object.keys(map)) {
      map[k].sort(
        (a, b) => (parseTimeToMinutes(a.start) ?? 0) - (parseTimeToMinutes(b.start) ?? 0)
      );
    }

    return map;
  }, [ghostShiftsThisWeek]);

  const visibleDows = useMemo(() => {
    if (selectedDow == null) return [0, 1, 2, 3, 4, 5, 6];
    return [selectedDow];
  }, [selectedDow]);

  const clientWorstStatus = useMemo(() => {
    const map = new Map<string, ShiftStatus>();
    for (const r of rows) {
      const name = norm(r.clientName);
      if (!name) continue;

      const statusesForRow = r.cells
        .map((c) => statusFromCellValue(c.value))
        .filter((s) => s !== "none");
      const rowWorst = statusesForRow.length ? worstStatus(statusesForRow) : "none";

      const prev = map.get(name);
      if (!prev) map.set(name, rowWorst);
      else map.set(name, worstStatus([prev, rowWorst]));
    }
    return map;
  }, [rows]);

  const totals = useMemo(() => {
    let totalHours = 0;
    const clientSet = new Set<string>();

    for (const r of rows) {
      const cn = norm(r.clientName);
      if (cn) clientSet.add(cn);

      for (let dow = 0; dow < 7; dow++) {
        if (selectedDow != null && dow !== selectedDow) continue;
        const c = r.cells[dow];
        const v = norm(c?.value);
        if (!v) continue;

        const tr = parseFirstTimeRange(v);
        if (!tr) continue;

        totalHours += durationHoursFromStartEnd(tr.start, tr.end);
      }
    }

    return { clientCount: clientSet.size, totalHours };
  }, [rows, selectedDow]);

  const hoursByClient = useMemo(() => {
    const map = new Map<string, number>();

    for (const r of rows) {
      const cn = norm(r.clientName);
      if (!cn) continue;

      let sum = map.get(cn) ?? 0;

      for (let dow = 0; dow < 7; dow++) {
        if (selectedDow != null && dow !== selectedDow) continue;

        const v = norm(r.cells?.[dow]?.value);
        if (!v) continue;

        const tr = parseFirstTimeRange(v);
        if (!tr) continue;

        sum += durationHoursFromStartEnd(tr.start, tr.end);
      }

      map.set(cn, sum);
    }
    return map;
  }, [rows, selectedDow]);

  /** ---------- Availability parsing -> maps ---------- */

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

  const availabilityByCaregiverId = useMemo(() => {
    const byId: Record<string, AvailRow> = {};
    const byName: Record<string, AvailRow> = {};

    for (const r of availRowsAll) {
      const caregiverName = caregiverNameIdx >= 0 ? norm(r[caregiverNameIdx]) : "";
      const caregiverId = caregiverIdIdx >= 0 ? norm(r[caregiverIdIdx]) : "";

      const label = caregiverName || caregiverId;
      if (!label) continue;

      const desiredHours = desiredHoursIdx >= 0 ? norm(r[desiredHoursIdx]) : "";
      const notes = notesIdx >= 0 ? norm(r[notesIdx]) : "";

      const byDow: Record<number, string> = { 0: "—", 1: "—", 2: "—", 3: "—", 4: "—", 5: "—", 6: "—" };
      for (const dc of dayCols) byDow[dc.dow] = norm(r[dc.colIndex]) || "—";

      const row: AvailRow = { caregiverName, caregiverId, desiredHours, notes, byDow };

      if (caregiverId) byId[caregiverId] = row;
      if (caregiverName) byName[normalizeKey(caregiverName)] = row;
    }

    return { byId, byName };
  }, [availRowsAll, caregiverNameIdx, caregiverIdIdx, desiredHoursIdx, notesIdx, dayCols]);

  /** ---------- Caregivers on schedule + missing profiles ---------- */

  const scheduleCaregiverNames = useMemo(() => {
    const set = new Set<string>();
    for (const s of scheduleRows) {
      const name = norm(s.caregiver);
      if (!name) continue;
      set.add(name);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [scheduleRows]);

    const caregiversWithCertsActive = useMemo(() => {
    return Object.values(caregiversById)
      .filter((c) => isActiveStatus(c.status))
      .filter((c) => {
        const cert = norm(c.certification);
        if (!cert) return false;
        if (cert.toLowerCase() === "none") return false;
        return true;
      })
      .sort((a, b) => {
        const aName = a.name || a.nameOnSchedule || a.caregiverId;
        const bName = b.name || b.nameOnSchedule || b.caregiverId;
        return fullNameSortKey(aName).localeCompare(fullNameSortKey(bName));
      });
  }, [caregiversById]);

  const shiftSaveCaregivers = useMemo<ShiftSaveCaregiverInput[]>(() => {
    return Object.values(caregiversById).map((c) => ({
      caregiverId: c.caregiverId,
      nameOnSchedule: c.nameOnSchedule,
      name: c.name,
      status: c.status,
    }));
  }, [caregiversById]);

  /** ---------- Schedule summaries for caregiver panel ---------- */
  type ScheduleItem = {
    shiftId: string;
    client: string;
    date: string;
    dow: number;
    startTime: string;
    endTime: string;
    status: string;
    flagged: boolean;
    hours: number;
  };

  const scheduleByCaregiverKey = useMemo(() => {
    const map: Record<string, ScheduleItem[]> = {};

    for (const s of scheduleRows) {
      const cgName = norm(s.caregiver);
      if (!cgName) continue;

      const hours = durationHoursFromStartEnd(s.startTime, s.endTime);
      const flagged = isFlaggedShiftFromScheduleRow(s, clockMap, locationMap);

      const item: ScheduleItem = {
        shiftId: s.shiftId,
        client: s.client,
        date: s.date,
        dow: s.dow,
        startTime: s.startTime,
        endTime: s.endTime,
        status: s.status,
        flagged,
        hours,
      };

      const keys: string[] = [];
      if (s.caregiverId) keys.push(`id:${s.caregiverId}`);
      keys.push(`name:${normalizeKey(cgName)}`);

      for (const k of keys) {
        if (!map[k]) map[k] = [];
        map[k].push(item);
      }
    }

    for (const k of Object.keys(map)) {
      map[k].sort((a, b) => {
        if (a.dow !== b.dow) return a.dow - b.dow;
        const am = parseTimeToMinutes(a.startTime) ?? 0;
        const bm = parseTimeToMinutes(b.startTime) ?? 0;
        return am - bm;
      });
    }

    return map;
  }, [scheduleRows, clockMap, locationMap]);

  function caregiverProfileByScheduleName(nameOnSchedule: string): CaregiverProfile | undefined {
    const id = idByNameOnSchedule[normalizeKey(nameOnSchedule)];
    if (!id) return undefined;
    return caregiversById[id];
  }

  type CaregiverPanelRow = {
    kind: "profile" | "missingProfile";
    caregiverId: string;
    nameOnSchedule: string;
    profile?: CaregiverProfile;

    hasAvailability: boolean;
    availability?: AvailRow;

    schedule: ScheduleItem[];
    totalHours: number;
    flaggedCount: number;
  };

  const caregiverPanelRowsAll = useMemo(() => {
    const out: CaregiverPanelRow[] = [];

    for (const name of scheduleCaregiverNames) {
      const prof = caregiverProfileByScheduleName(name);
      const caregiverId = prof?.caregiverId || "";

      const avail =
        (caregiverId ? availabilityByCaregiverId.byId[caregiverId] : undefined) ??
        availabilityByCaregiverId.byName[normalizeKey(name)];

      const scheduleKey = caregiverId ? `id:${caregiverId}` : `name:${normalizeKey(name)}`;
      const schedule = scheduleByCaregiverKey[scheduleKey] ?? [];
      const totalHours = schedule.reduce((sum, x) => sum + (x.hours || 0), 0);
      const flaggedCount = schedule.reduce((sum, x) => sum + (x.flagged ? 1 : 0), 0);

      if (!prof) {
        out.push({
          kind: "missingProfile",
          caregiverId: "",
          nameOnSchedule: name,
          profile: undefined,
          hasAvailability: Boolean(avail),
          availability: avail,
          schedule,
          totalHours,
          flaggedCount,
        });
      } else {
        out.push({
          kind: "profile",
          caregiverId,
          nameOnSchedule: prof.nameOnSchedule || name,
          profile: prof,
          hasAvailability: Boolean(avail),
          availability: avail,
          schedule,
          totalHours,
          flaggedCount,
        });
      }
    }

    out.sort((a, b) => {
      const aName = a.profile?.name || a.nameOnSchedule || a.profile?.nameOnSchedule || a.caregiverId || "";
      const bName = b.profile?.name || b.nameOnSchedule || b.profile?.nameOnSchedule || b.caregiverId || "";
      return fullNameSortKey(aName).localeCompare(fullNameSortKey(bName));
    });

    return out;
  }, [
    scheduleCaregiverNames,
    scheduleByCaregiverKey,
    caregiversById,
    idByNameOnSchedule,
    availabilityByCaregiverId,
  ]);

  const certifiedActiveExtraRows = useMemo(() => {
    const out: CaregiverPanelRow[] = [];

    for (const prof of caregiversWithCertsActive) {
      const name = prof.name || prof.nameOnSchedule || prof.caregiverId;
      const caregiverId = prof.caregiverId;

      const already = caregiverPanelRowsAll.some((r) => r.caregiverId === caregiverId);
      if (already) continue;

      const avail =
        availabilityByCaregiverId.byId[caregiverId] ??
        availabilityByCaregiverId.byName[normalizeKey(name)];
      const scheduleKey = `id:${caregiverId}`;
      const schedule = scheduleByCaregiverKey[scheduleKey] ?? [];
      const totalHours = schedule.reduce((sum, x) => sum + (x.hours || 0), 0);
      const flaggedCount = schedule.reduce((sum, x) => sum + (x.flagged ? 1 : 0), 0);

      out.push({
        kind: "profile",
        caregiverId,
        nameOnSchedule: prof.nameOnSchedule || name,
        profile: prof,
        hasAvailability: Boolean(avail),
        availability: avail,
        schedule,
        totalHours,
        flaggedCount,
      });
    }

    out.sort((a, b) => {
      const aName = a.profile?.name || a.nameOnSchedule || a.profile?.nameOnSchedule || a.caregiverId || "";
      const bName = b.profile?.name || b.nameOnSchedule || b.profile?.nameOnSchedule || b.caregiverId || "";
      return fullNameSortKey(aName).localeCompare(fullNameSortKey(bName));
    });

    return out;
  }, [
    caregiversWithCertsActive,
    caregiverPanelRowsAll,
    availabilityByCaregiverId,
    scheduleByCaregiverKey,
  ]);

  const caregiverPanelRows = useMemo(() => {
    let base = caregiverPanelRowsAll;

    if (panelFilter === "missingProfile") {
      base = base.filter((r) => r.kind === "missingProfile");
    } else if (panelFilter === "certifiedActive") {
      const onScheduleCertified = caregiverPanelRowsAll.filter((r) => {
        const cert = norm(r.profile?.certification).toLowerCase();
        const active = r.profile ? isActiveStatus(r.profile.status) : false;
        return Boolean(cert) && cert !== "none" && active;
      });

      base = [...onScheduleCertified, ...certifiedActiveExtraRows];
    }

    const q = panelSearch.trim();
    if (q) {
      base = base.filter((r) => {
        const p = r.profile;
        const fullName = p?.name || r.nameOnSchedule || p?.nameOnSchedule || r.caregiverId;
        const hay = [fullName, r.caregiverId, p?.certification, p?.email, p?.phone]
          .filter(Boolean)
          .join(" ");
        return containsCI(hay, q);
      });
    }

    base = [...base].sort((a, b) => {
      const aName = a.profile?.name || a.nameOnSchedule || a.profile?.nameOnSchedule || a.caregiverId || "";
      const bName = b.profile?.name || b.nameOnSchedule || b.profile?.nameOnSchedule || b.caregiverId || "";
      return fullNameSortKey(aName).localeCompare(fullNameSortKey(bName));
    });

    return base;
  }, [caregiverPanelRowsAll, certifiedActiveExtraRows, panelFilter, panelSearch]);

  const flaggedShiftsTotal = useMemo(() => {
    return caregiverPanelRowsAll.reduce((sum, r) => sum + r.flaggedCount, 0);
  }, [caregiverPanelRowsAll]);

  function openEditModal(a1: string, currentValue: string, clientName: string, dowLabel: string) {
    setEditA1(a1);
    setEditDraft(currentValue);
    setEditClientName(clientName);
    setEditDayLabel(dowLabel);
    setEditOpen(true);
  }

    async function saveEdit() {
    if (!editA1) return;
    const a1 = editA1;
    const newVal = editDraft;

    let oldVal = "";
    const snapshot = data;
    if (snapshot?.ok) {
      for (const r of snapshot.body.rows) {
        const cell = r.cells.find((x) => x.a1 === a1);
        if (cell) oldVal = norm(cell.value);
      }
    }

    if (norm(oldVal) === norm(newVal)) {
      setEditOpen(false);
      setEditA1(null);
      return;
    }

    const parsed = parseShiftTextForFeedback(newVal, shiftSaveCaregivers);
    const toastModel = buildShiftSaveToast(parsed);

    try {
      setSavingA1(a1);
      await updateCell(week, a1, newVal);

      setData((prev) => {
        if (!prev?.ok) return prev;
        const next = structuredClone(prev);
        for (const row of next.body.rows) {
          const cell = row.cells.find((x) => x.a1 === a1);
          if (cell) {
            cell.value = newVal;
            cell.fontColor = (SHEET_COLORS[statusFromCellValue(newVal)] || "#111827").toLowerCase();
          }
        }
        return next;
      });

      await loadGridForWeek(week);
      await Promise.all([refreshScheduleMapsForWeek(week), refreshCaregivers(), refreshClients()]);

      setSaveToast({
        id: Date.now(),
        kind: toastModel.kind,
        title: toastModel.title,
        lines: toastModel.lines,
      });

      setEditOpen(false);
      setEditA1(null);
    } catch (err: any) {
      setSaveToast({
        id: Date.now(),
        kind: "error",
        title: "Save failed",
        lines: [err?.message ?? "The cell could not be updated."],
      });
    } finally {
      setSavingA1(null);
    }
  }

    return (
    <main
      style={{
        padding: 18,
        // ✅ When the caregiver panel is OFF, let schedule use full width
        maxWidth: panelOpen ? 2200 : "none",
        margin: "0 auto",
        color: UI.text,
        background: UI.pageBg,
        minHeight: "100vh",
      }}
    >
      {saveToast ? (
        <div
          style={{
            position: "fixed",
            top: 18,
            right: 18,
            zIndex: 10050,
            width: "min(390px, calc(100vw - 24px))",
            background:
              saveToast.kind === "success"
                ? "#ecfdf5"
                : saveToast.kind === "warning"
                ? "#fffbeb"
                : "#fef2f2",
            border:
              saveToast.kind === "success"
                ? "1px solid #86efac"
                : saveToast.kind === "warning"
                ? "1px solid #fcd34d"
                : "1px solid #fca5a5",
            color: "#111827",
            borderRadius: 14,
            boxShadow: "0 12px 30px rgba(0,0,0,0.18)",
            padding: 12,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: 10,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 1000 }}>
                {saveToast.title}
              </div>

              <div
                style={{
                  marginTop: 6,
                  display: "grid",
                  gap: 4,
                }}
              >
                {saveToast.lines.map((line, idx) => (
                  <div
                    key={`${saveToast.id}_${idx}`}
                    style={{
                      fontSize: 12,
                      fontWeight: idx < 4 ? 850 : 700,
                      lineHeight: 1.3,
                      color:
                        saveToast.kind === "error"
                          ? "#991b1b"
                          : idx < 4
                          ? "#111827"
                          : "#92400e",
                      wordBreak: "break-word",
                    }}
                  >
                    {line}
                  </div>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setSaveToast(null)}
              style={{
                border: `1px solid ${UI.border}`,
                background: "#fff",
                color: UI.text,
                borderRadius: 10,
                padding: "5px 8px",
                cursor: "pointer",
                fontWeight: 900,
                fontSize: 12,
                flex: "0 0 auto",
              }}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}

      <div
  ref={topNavRef}
  style={{
    position: "sticky",
    top: 0,
    zIndex: TOPNAV_Z,
    background: UI.pageBg, // prevents transparent overlap while scrolling
    paddingTop: 0,
  }}
>
  <TopNav
    week={week}
    right={
      <>
        {/* Week toggle */}
        <div
          style={{
            display: "inline-flex",
            border: `1px solid ${UI.border}`,
            borderRadius: 12,
            overflow: "hidden",
            background: UI.panelBg,
          }}
          role="group"
          aria-label="Week toggle"
        >
          <button
            type="button"
            onClick={() => setWeekAndUrl("cw")}
            style={{
              padding: "7px 10px",
              fontSize: 13,
              fontWeight: 900,
              border: "none",
              cursor: "pointer",
              background: week === "cw" ? "#111827" : UI.headerBg,
              color: week === "cw" ? "#fff" : UI.text,
            }}
            aria-pressed={week === "cw"}
          >
            Current
          </button>

          <button
            type="button"
            onClick={() => setWeekAndUrl("nw")}
            style={{
              padding: "7px 10px",
              fontSize: 13,
              fontWeight: 900,
              border: "none",
              cursor: "pointer",
              background: week === "nw" ? "#111827" : UI.headerBg,
              color: week === "nw" ? "#fff" : UI.text,
            }}
            aria-pressed={week === "nw"}
          >
            Next
          </button>
        </div>

        {/* Messages */}
        <button
          type="button"
          onClick={openPanel}
          style={{
            border: `1px solid ${UI.border}`,
            background: UI.headerBg,
            color: UI.text,
            borderRadius: 10,
            padding: "7px 10px",
            fontSize: 13,
            cursor: "pointer",
            fontWeight: 900,
          }}
          title="Open Messages"
        >
          💬 Messages
        </button>

        {/* Caregiver panel toggle */}
        <button
          type="button"
          onClick={() => setPanelOpen((v) => !v)}
          style={{
            border: `1px solid ${UI.border}`,
            background: panelOpen ? "#111827" : UI.headerBg,
            color: panelOpen ? "#fff" : UI.text,
            borderRadius: 10,
            padding: "7px 10px",
            fontSize: 13,
            cursor: "pointer",
            fontWeight: 900,
          }}
        >
          Caregiver Panel: {panelOpen ? "ON" : "OFF"}
        </button>

        {/* Refresh */}
        <button
          type="button"
          onClick={async () => {
            try {
              setLoading(true);
              setError(null);
              setExpandedA1ByWeek((prev) => ({ ...prev, [week]: new Set() }));
              await loadGridForWeek(week);
              await Promise.all([
                refreshScheduleMapsForWeek(week),
                refreshCaregivers(),
                refreshApplicants(),
                refreshGhostShiftsForWeek(week),
              ]);
            } catch (e: any) {
              setError(e?.message ?? "Refresh failed");
            } finally {
              setLoading(false);
            }
          }}
          style={{
            border: `1px solid ${UI.border}`,
            background: UI.headerBg,
            color: UI.text,
            borderRadius: 10,
            padding: "7px 10px",
            fontSize: 13,
            cursor: "pointer",
            fontWeight: 900,
          }}
        >
          Refresh
        </button>
      </>
    }
  />
</div>

      <header
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>{weekLabel(week)}</h1>
          <p style={{ opacity: 0.8, marginTop: 6, fontSize: 13 }}>
            Source: <code>{sheetLabelForWeek(week)}</code>
            {panelOpen && (
              <span style={{ marginLeft: 10, fontSize: 12, color: UI.textDim }}>
                (Caregiver Panel: {availLoading ? "loading…" : availError ? "error" : "ready"})
              </span>
            )}
            <span style={{ marginLeft: 10, fontSize: 12, color: UI.textDim }}>
  (Caregivers: {caregiversLoading ? "loading…" : caregiversError ? "error" : "ready"})
</span>
<span style={{ marginLeft: 10, fontSize: 12, color: UI.textDim }}>
  (Applicants: {applicantsLoading ? "loading…" : applicantsError ? "error" : "ready"})
</span>
<span style={{ marginLeft: 10, fontSize: 12, color: UI.textDim }}>
  (Service requests: {ghostLoading ? "loading…" : ghostError ? "error" : "ready"})
</span>
          </p>
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
  value={searchText ?? ""}
  onChange={(e) => setSearchText(e.target.value)}
  placeholder="Search client or cell text…"
          style={{
            marginLeft: "auto",
            width: 320,
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
          <div style={{ fontSize: 11, color: UI.textDim, fontWeight: 800 }}>Total Hours (approx)</div>
          <div style={{ fontSize: 16, fontWeight: 900 }}>{totals.totalHours.toFixed(1)}</div>
        </div>

        <div style={{ background: UI.panelBg, border: `1px solid ${UI.border}`, borderRadius: 12, padding: "8px 10px" }}>
          <div style={{ fontSize: 11, color: UI.textDim, fontWeight: 800 }}>Clients</div>
          <div style={{ fontSize: 16, fontWeight: 900 }}>{totals.clientCount}</div>
        </div>

        <div style={{ background: UI.panelBg, border: `1px solid ${UI.border}`, borderRadius: 12, padding: "8px 10px" }}>
          <div style={{ fontSize: 11, color: UI.textDim, fontWeight: 800 }}>Flagged Shifts</div>
          <div style={{ fontSize: 16, fontWeight: 900 }}>{flaggedShiftsTotal}</div>
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ fontSize: 12, fontWeight: 900, color: UI.textDim }}>Panel filter</div>
          <select
            value={panelFilter}
            onChange={(e) => setPanelFilter(e.target.value as any)}
            style={{
              border: `1px solid ${UI.border}`,
              borderRadius: 12,
              padding: "8px 10px",
              fontSize: 13,
              outline: "none",
              background: UI.panelBg,
              minWidth: 280,
              fontWeight: 800,
            }}
            title="Filter the caregiver panel"
          >
            <option value="all">Caregivers on schedule (active)</option>
            <option value="certifiedActive">Caregivers with certification (active)</option>
            <option value="missingProfile">On schedule, missing caregiver profile</option>
          </select>
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

      {/* Edit modal */}
      <Modal
        open={editOpen}
        title={`${editClientName || "Client"} • ${editDayLabel || ""}${editA1 ? ` • ${editA1}` : ""}`}
        onClose={() => {
          if (savingA1) return;
          setEditOpen(false);
          setEditA1(null);
        }}
      >
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ fontSize: 12, color: UI.textDim, fontWeight: 900 }}>
            Full cell text (edit anything exactly as you want it saved):
          </div>

          <textarea
            value={editDraft}
            onChange={(e) => setEditDraft(e.target.value)}
            rows={6}
            style={{
              width: "100%",
              boxSizing: "border-box",
              border: `1px solid ${UI.border}`,
              borderRadius: 12,
              padding: "10px 10px",
              fontSize: 13,
              outline: "none",
              background: UI.panelBg,
              color: UI.text,
              resize: "vertical",
              fontFamily: "inherit",
              whiteSpace: "pre-wrap",
            }}
            disabled={Boolean(savingA1)}
            autoFocus
          />

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => {
                if (savingA1) return;
                setEditOpen(false);
                setEditA1(null);
              }}
              style={{
                border: `1px solid ${UI.border}`,
                background: UI.panelBg,
                color: UI.text,
                borderRadius: 10,
                padding: "8px 12px",
                cursor: savingA1 ? "default" : "pointer",
                fontWeight: 900,
                fontSize: 13,
              }}
              disabled={Boolean(savingA1)}
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={saveEdit}
              style={{
                border: "1px solid #111827",
                background: "#111827",
                color: "#fff",
                borderRadius: 10,
                padding: "8px 12px",
                cursor: savingA1 ? "default" : "pointer",
                fontWeight: 900,
                fontSize: 13,
              }}
              disabled={Boolean(savingA1)}
            >
              {savingA1 ? "Saving…" : "Save"}
            </button>
          </div>

          <div style={{ fontSize: 11.5, color: UI.textDim, lineHeight: 1.35 }}>
            Tip: tap a cell to edit • cancelled shifts are shown in light gray.
          </div>
        </div>
      </Modal>

      {/* Client Profile modal (details + history) */}
      <Modal
        open={clientProfileOpen}
        title={`Client Profile • ${clientProfileName || "Client"}`}
        onClose={() => {
          setClientProfileOpen(false);
          setClientProfileName("");
        }}
      >
        {(() => {
          const key = normalizeKey(clientProfileName);
          const p = key ? clientsByName[key] : undefined;

          const name = p?.name || clientProfileName || "Client";
          const location = norm(p?.location);
          const description = norm(p?.description);
          const rate = norm(p?.rate);

          return (
            <div style={{ maxHeight: "70vh", overflowY: "auto", paddingRight: 6 }}>
              <div style={{ display: "grid", gap: 14 }}>
                <div
                  style={{
                    border: `1px solid ${UI.borderSoft}`,
                    borderRadius: 14,
                    padding: 12,
                    background: "rgba(255,255,255,0.9)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 10,
                      alignItems: "baseline",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 950, color: UI.textDim }}>Client</div>
                      <div
                        style={{
                          marginTop: 2,
                          fontSize: 18,
                          fontWeight: 1000,
                          letterSpacing: 0.2,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={name}
                      >
                        {name}
                      </div>
                    </div>

                    {rate ? (
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 950,
                          padding: "6px 10px",
                          borderRadius: 999,
                          border: `1px solid ${UI.borderSoft}`,
                          background: "#f8fafc",
                          color: UI.text,
                          whiteSpace: "nowrap",
                        }}
                        title="Hourly rate"
                      >
                        Rate: {rate}
                      </div>
                    ) : null}
                  </div>

                  <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 11.5, fontWeight: 950, color: UI.textDim }}>Location</div>
                      {location ? (
                        <div
                          style={{
                            marginTop: 3,
                            fontSize: 13,
                            fontWeight: 850,
                            color: UI.text,
                            whiteSpace: "pre-wrap",
                          }}
                        >
                          {location}
                        </div>
                      ) : (
                        <div style={{ marginTop: 3, fontSize: 13, color: "#9ca3af", fontWeight: 850 }}>—</div>
                      )}
                    </div>

                    <div>
                      <div style={{ fontSize: 11.5, fontWeight: 950, color: UI.textDim }}>Description</div>
                      {description ? (
                        <div style={{ marginTop: 3, fontSize: 13, color: UI.text, whiteSpace: "pre-wrap", lineHeight: 1.35 }}>
                          {description}
                        </div>
                      ) : (
                        <div style={{ marginTop: 3, fontSize: 13, color: "#9ca3af", fontWeight: 850 }}>—</div>
                      )}
                    </div>

                    <div style={{ marginTop: 2, fontSize: 11.5, color: UI.textDim, lineHeight: 1.3 }}>
                      {clientsLoading ? (
                        <span>Client details: loading…</span>
                      ) : clientsError ? (
                        <span style={{ color: "salmon", fontWeight: 900 }}>Client details error: {clientsError}</span>
                      ) : p ? (
                        <span>Client details: loaded from Clients sheet.</span>
                      ) : (
                        <span style={{ color: "salmon", fontWeight: 900 }}>
                          Client details not found in Clients sheet for: <strong>{clientProfileName}</strong>
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontSize: 12, fontWeight: 950, color: UI.textDim }}>
                    Caregivers who have been here
                  </div>

                  {histLoading ? (
                    <div style={{ fontSize: 13, color: UI.textDim }}>Loading history…</div>
                  ) : histError ? (
                    <div style={{ fontSize: 13, color: "salmon", fontWeight: 800 }}>{histError}</div>
                  ) : clientCaregiverHistory.length === 0 ? (
                    <div style={{ fontSize: 13, color: UI.textDim }}>
                      No historical visits found in the loaded window.
                    </div>
                  ) : (
                    <div style={{ display: "grid", gap: 8 }}>
                      {clientCaregiverHistory.slice(0, 20).map((h) => {
                        const prof = h.caregiverId ? caregiversById[h.caregiverId] : undefined;
                        const cert = norm(prof?.certification);
                        const certOk = cert && cert.toLowerCase() !== "none";

                        return (
                          <div
                            key={(h.caregiverId || h.caregiverName) + "::" + h.lastDate}
                            style={{
                              border: `1px solid ${UI.borderSoft}`,
                              borderRadius: 12,
                              padding: "8px 10px",
                              background: "rgba(255,255,255,0.85)",
                              display: "flex",
                              justifyContent: "space-between",
                              gap: 10,
                              alignItems: "baseline",
                            }}
                          >
                            <div style={{ minWidth: 0 }}>
                              <div
                                style={{
                                  fontWeight: 950,
                                  fontSize: 13,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {h.caregiverName}
                                {certOk ? (
                                  <span
                                    style={{
                                      marginLeft: 8,
                                      fontSize: 11,
                                      fontWeight: 900,
                                      padding: "2px 8px",
                                      borderRadius: 999,
                                      border: `1px solid ${UI.borderSoft}`,
                                      background: "#f8fafc",
                                      color: UI.textDim,
                                      whiteSpace: "nowrap",
                                    }}
                                    title="Certification"
                                  >
                                    {cert}
                                  </span>
                                ) : null}
                              </div>

                              <div style={{ marginTop: 2, fontSize: 11.5, color: UI.textDim }}>
                                Last visit: <strong>{h.lastDate || "—"}</strong>
                                {h.caregiverId ? <span style={{ marginLeft: 8 }}>ID: {h.caregiverId}</span> : null}
                              </div>
                            </div>

                            <div style={{ fontSize: 12, fontWeight: 950, whiteSpace: "nowrap" }}>
                              {h.visitCount} visit{h.visitCount === 1 ? "" : "s"}
                            </div>
                          </div>
                        );
                      })}

                      {clientCaregiverHistory.length > 20 ? (
                        <div style={{ fontSize: 12, color: UI.textDim }}>
                          Showing top 20 (of {clientCaregiverHistory.length}) by visits/recentness.
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* ✅ LAYOUT FIX: responsive grid + no squeezing + table scroll */}
      {!loading && !error && data?.ok && (
        <>
        <div
  className="scheduleLayout"
  style={{
    marginTop: 14,
    display: "grid",
    gridTemplateColumns: panelOpen ? "1fr 460px" : "1fr",
    gap: 12,
    alignItems: "start",
  }}
>
  <div className="scheduleMain" style={{ minWidth: 0 }}>
  <div
    style={{
      border: `1px solid ${UI.border}`,
      borderRadius: 12,
      background: UI.panelBg,

      // ✅ IMPORTANT: do NOT set overflow hidden/auto/scroll on an ancestor of sticky
      // Let the table wrapper handle horizontal scrolling.
      overflow: "visible",
    }}
  >
    {/* table scroll wrapper (this is the ONLY place we want overflowX) */}
    <div
      style={{
        overflowX: "auto",
        overflowY: "visible",
        WebkitOverflowScrolling: "touch",
      }}
    >
      <table
        style={{
          width: "100%",
          minWidth: selectedDow == null ? 1200 : 680,
          borderCollapse: "separate",
          borderSpacing: 0,
          tableLayout: "fixed",
        }}
      >
          <thead>
            <tr>
              <th
  style={{
    position: "sticky",
    top: STICKY_DAY_ROW_TOP,
    left: 0,
    zIndex: STICKY_DAY_Z + 5, // ✅ above other day headers
    background: UI.headerBg,
    textAlign: "left",
    padding: "10px 12px",
    borderBottom: `1px solid ${UI.border}`,
    width: CLIENT_COL_WIDTH,
    maxWidth: CLIENT_COL_WIDTH,
    fontSize: 13,
    borderRight: `1px solid ${UI.borderSoft}`,
    height: STICKY_DAY_ROW_HEIGHT,
  }}
>
                {dayHeaders?.[0] || "Client Name"}
              </th>

              {visibleDows.map((dow) => (
                <th
  key={`day_${dow}`}
  style={{
    position: "sticky",
    top: STICKY_DAY_ROW_TOP,
    zIndex: STICKY_DAY_Z,
    background: UI.headerBg,
    textAlign: "left",
    padding: "10px 10px",
    borderBottom: `1px solid ${UI.border}`,
    fontSize: 13,
    borderRight:
      dow === visibleDows[visibleDows.length - 1]
        ? "none"
        : `1px solid ${UI.borderSoft}`,
    height: STICKY_DAY_ROW_HEIGHT,
  }}
>
                  <div style={{ fontWeight: 700 }}>
                    {dayHeaders?.[dow + 1] || DOW_LABELS[dow]}
                  </div>
                </th>
              ))}
            </tr>

            <tr>
              <th
  style={{
    position: "sticky",
    top: STICKY_DATE_ROW_TOP,
    left: 0,
    zIndex: STICKY_DATE_Z + 5, // ✅ above other date headers
    background: UI.headerBg,
    textAlign: "left",
    padding: "8px 12px",
    borderBottom: `1px solid ${UI.border}`,
    width: CLIENT_COL_WIDTH,
    maxWidth: CLIENT_COL_WIDTH,
    fontSize: 12,
    color: UI.textDim,
    borderRight: `1px solid ${UI.borderSoft}`,
    height: 40,
  }}
>
                {dateHeaders?.[0] || "Date"}
              </th>

              {visibleDows.map((dow) => (
               <th
  key={`date_${dow}`}
  style={{
    position: "sticky",
    top: STICKY_DATE_ROW_TOP,
    zIndex: STICKY_DATE_Z,
    background: UI.headerBg,
    textAlign: "left",
    padding: "8px 10px",
    borderBottom: `1px solid ${UI.border}`,
    fontSize: 12,
    color: UI.textDim,
    borderRight:
      dow === visibleDows[visibleDows.length - 1]
        ? "none"
        : `1px solid ${UI.borderSoft}`,
    height: 40,
  }}
>
                  {dateHeaders?.[dow + 1] || ""}
                </th>
              ))}
            </tr>
          </thead>

                    <tbody>
                      {rows.length === 0 ? (
                        <tr>
                          <td colSpan={1 + visibleDows.length} style={{ padding: 12, opacity: 0.85 }}>
                            No rows match the current filters.
                          </td>
                        </tr>
                      ) : (
                        (() => {
                          let lastClient = "";
                          let groupIndex = -1;
                          const seenClientForHours = new Set<string>();

                          return rows.map((r) => {
                            const name = norm(r.clientName);

                            if (name !== lastClient) {
                              groupIndex += 1;
                              lastClient = name;
                            }

                            const groupBg = groupIndex % 2 === 0 ? UI.rowA : UI.rowB;
                            const rowIsEmpty = visibleDows.every((dow) => !norm(r.cells?.[dow]?.value));

                            const status = name ? clientWorstStatus.get(name) ?? "none" : "none";
                            const clientColor = SHEET_COLORS[status] || UI.text;

                            const clientHours = name ? hoursByClient.get(name) ?? 0 : 0;
                            const showClientHours = Boolean(name) && !seenClientForHours.has(name);
                            if (name) seenClientForHours.add(name);

                            const clientKey = normalizeKey(name);
                            const clientProfile = clientKey ? clientsByName[clientKey] : undefined;
                            const clientDescription = norm(clientProfile?.description);

                            return (
                              <tr key={r.row}>
                                <td
                                  style={{
                                    position: "sticky",
                                    left: 0,
                                    zIndex: 2,
                                    background: groupBg,
                                    padding: rowIsEmpty ? "6px 12px" : "10px 12px",
                                    borderBottom: `1px solid ${UI.borderSoft}`,
                                    fontWeight: 800,
                                    fontSize: 13,
                                    color: clientColor,
                                    borderRight: `1px solid ${UI.borderSoft}`,
                                    whiteSpace: "nowrap",
                                    maxWidth: CLIENT_COL_WIDTH,
                                  }}
                                  title={status === "none" ? undefined : `Status: ${status} • Double click for profile`}
                                >
                                  <div
                                    style={{
                                      display: "flex",
                                      justifyContent: "space-between",
                                      gap: 10,
                                      alignItems: "baseline",
                                      minWidth: 0,
                                    }}
                                  >
                                    <div style={{ display: "flex", gap: 8, alignItems: "baseline", minWidth: 0, flex: "1 1 auto" }}>
                                      {/* ✅ was a <button>; now a safe role-button */}
                                      <div
                                        role="button"
                                        tabIndex={0}
                                        onDoubleClick={() => openClientProfile(r.clientName || "")}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter" || e.key === " ") {
                                            e.preventDefault();
                                            openClientProfile(r.clientName || "");
                                          }
                                        }}
                                        style={{
                                          border: "none",
                                          background: "transparent",
                                          padding: 0,
                                          margin: 0,
                                          cursor: "pointer",
                                          textAlign: "left",
                                          color: "inherit",
                                          font: "inherit",
                                          fontWeight: 900,
                                          overflow: "hidden",
                                          textOverflow: "ellipsis",
                                          whiteSpace: "nowrap",
                                          minWidth: 0,
                                          flex: "1 1 auto",
                                          outline: "none",
                                        }}
                                        title="Double click (or Enter/Space) to open client profile"
                                      >
                                        {r.clientName || ""}
                                      </div>

                                      {(() => {
  const ck = clientKey;
  const b = ck ? badgeByClientKey[ck] : null;

  const reqCount = b?.reqCount || 0;
  if (reqCount <= 0) return null;

  const uncoveredDays = b?.uncoveredDays || 0;
  const isCovered = uncoveredDays === 0;

  const title = isCovered
    ? `All service-request day(s) already have schedule shifts. (${reqCount} request${reqCount === 1 ? "" : "s"})`
    : `${uncoveredDays} service-request day(s) have NO schedule shifts. (${reqCount} request${reqCount === 1 ? "" : "s"})`;

  return (
    <button
      type="button"
      onClick={() => openServiceRequestsForClient(r.clientName || "")}
      title={title}
      aria-label={title}
      style={{
        border: "none",
        background: "transparent",
        padding: 0,
        margin: 0,
        cursor: "pointer",
        lineHeight: 1,
        display: "inline-flex",
        alignItems: "center",
        flex: "0 0 auto",
      }}
    >
      <span
        style={{
          minWidth: 18,
          height: 18,
          padding: "0 6px",
          borderRadius: 999,
          background: isCovered ? "#22c55e" : "#ef4444", // ✅ green ✓ vs red
          color: "#fff",
          fontSize: 11,
          fontWeight: 1000,
          lineHeight: "18px",
          textAlign: "center",
          border: "2px solid #fff",
          boxShadow: "0 2px 6px rgba(0,0,0,0.18)",
        }}
      >
        {isCovered ? "✓" : String(uncoveredDays)}
      </span>
    </button>
  );
})()}
                                    </div>

                                    {showClientHours ? (
                                      <span
                                        style={{
                                          fontSize: 12,
                                          fontWeight: 900,
                                          color: UI.textDim,
                                          whiteSpace: "nowrap",
                                          flex: "0 0 auto",
                                        }}
                                      >
                                        {clientHours.toFixed(1)}h
                                      </span>
                                    ) : null}
                                  </div>
                                </td>

                                {visibleDows.map((dow, idx) => {
                                  const c = r.cells[dow];
                                  const a1 = c?.a1 || "";
                                  const value = norm(c?.value);

                                  const isSaving = savingA1 === a1;
                                  const cellStatus = statusFromCellValue(value);
                                  const dateStrForDow = norm(dateHeaders?.[dow + 1]);
                                  const dayLabel = dayHeaders?.[dow + 1] || DOW_LABELS[dow];

                                  const isExpanded = Boolean(a1) && expandedA1.has(a1);

                                  const ck = normalizeKey(name);
                                  const dk = dateKey(dateStrForDow);
                                  const ghostKey = `${ck}__${dk}`;
                                  const ghostShiftsForCell = ghostByCell[ghostKey] ?? [];

                                  return (
                                    <td
                                      key={a1 || `${r.row}_${dow}`}
                                      style={{
                                        verticalAlign: "top",
                                        padding: rowIsEmpty ? 4 : 10,
                                        borderBottom: `1px solid ${UI.borderSoft}`,
                                        background: groupBg,
                                        borderRight:
                                          idx === visibleDows.length - 1 ? "none" : `1px solid ${UI.borderSoft}`,
                                        cursor: "default",
                                        whiteSpace: "pre-wrap",
                                      }}
                                    >
                                      <ShiftCard
                                        a1Key={a1 || `${r.row}_${dow}`}
                                        value={value}
                                        status={cellStatus}
                                        disabled={isSaving}
                                        onRequestEdit={() => {
                                          if (!a1) return;
                                          openEditModal(a1, value, name, dayLabel);
                                        }}
                                        expanded={isExpanded}
                                        onToggleExpanded={() => {
                                          if (!a1) return;
                                          setExpandedA1((prev) => {
                                            const next = new Set(prev);
                                            if (next.has(a1)) next.delete(a1);
                                            else next.add(a1);
                                            return next;
                                          });
                                        }}
                                        dateStrForDow={dateStrForDow}
                                        clientName={name}
                                        shiftInfo={shiftInfo}
                                        rowIsEmpty={rowIsEmpty}
                                        cellBg={groupBg}
                                        sheetColors={SHEET_COLORS}
                                        week={week}
                                        messagesUI={messagesUI}
                                        clientDescription={clientDescription}
                                        requests={ghostShiftsForCell}
                                      />
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          });
                        })()
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

           <CaregiverWebSchedulePanel
  open={panelOpen}
  onClose={() => setPanelOpen(false)}
  caregiversError={caregiversError}
  availLoading={availLoading}
  availError={availError}
  caregiverPanelRows={caregiverPanelRows}
  panelSearch={panelSearch ?? ""}
  setPanelSearch={(v: any) => setPanelSearch(String(v ?? ""))}
  panelSelectedDow={panelSelectedDow}
  setPanelSelectedDow={setPanelSelectedDow}
  applicants={applicants}
  applicantsLoading={applicantsLoading}
  applicantsError={applicantsError}
  applicantSearch={applicantSearch ?? ""}
  setApplicantSearch={(v: string) => setApplicantSearch(v)}
/>
          </div>

          {/* Responsive behavior: stack panel below schedule on smaller screens */}
          <style jsx>{`
            .scheduleLayout {
              gap: 12px;
              align-items: start;
            }

            @media (max-width: 1200px) {
              .scheduleLayout {
                grid-template-columns: 1fr;
              }
              .caregiverAside {
                position: static !important;
                width: auto !important;
                top: auto !important;
              }
            }

            @media (max-width: 900px) {
              .caregiverAside {
                max-height: 60vh;
                overflow: auto;
              }
            }
          `}</style>
        </>
      )}

      {/* ✅ FIXED: render default export directly (no .default wrapper) */}
      <ServiceRequestsPanel
        open={svcPanelOpen}
        onClose={() => setSvcPanelOpen(false)}
        clientName={svcClientName}
        weekStartYmd={weekStartYmd}
        weekKind={week}
      />
    </main>
  );
}
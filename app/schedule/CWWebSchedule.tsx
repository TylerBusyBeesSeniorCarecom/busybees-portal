// app/schedule/CWWebSchedule.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation"; // ✅ NEW
import { useSession } from "next-auth/react";
import ShiftCard, { type ShiftStatus as ShiftCardStatus } from "./components/ShiftCard";
import { useShiftInfo } from "./components/useShiftInfo";
import { useMessagesUI } from "@/app/api/messages/MessagesContext";
import TopNav from "./components/TopNav";
import CaregiverWebSchedulePanel from "./components/CaregiverWebSchedulePanel";
import ServiceRequestsPanel from "./components/AppServiceRequests";
import OnboardingPanel from "./components/OnboardingPanel";
import SupraesophagealGanglionPanel from "./components/SupraesophagealGanglionPanel";
import useDraftSchedule from "./hooks/useDraftSchedule";
import {
  buildShiftSaveToast,
  parseShiftTextForFeedback,
  type ShiftSaveCaregiverInput,
  type ShiftConflictMatch,
} from "./utils/shiftSaveFeedback";
import {
  parseScheduleShiftCell,
  convertScheduleShiftStatus,
  type BaseShiftStatus,
} from "./utils/scheduleShiftStatus";
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

type CellEditHistoryPresenceMap = Record<string, boolean>;

type EditHistoryModalTarget = {
  a1: string;
  clientName: string;
  dateStr: string;
  dayLabel: string;
  week: WeekKind;
  shiftId: string;
  caregiverName: string;
  startTime: string;
  endTime: string;
  status: ShiftCardStatus;
};
type EditHistoryOpenPayload = {
  a1Key: string;
  clientName: string;
  dateStr: string;
  week: WeekKind;
  shiftId: string;
  caregiverName: string;
  startTime: string;
  endTime: string;
  status: ShiftCardStatus;
};
type ShiftRateRecord = {
  shiftId: string;
  rate: number | string | null;
  updatedAt?: string;
  updatedBy?: string;
  reason?: string;

  // raw sheet-backed fields from /api/shift-rates GET
  raw?: Record<string, any>;
};

type ShiftRatesGetResponse = {
  ok: boolean;
  count?: number;
  rows?: Record<string, any>[];
  error?: string;
};

type ShiftRatesPostResponse = {
  ok: boolean;
  rate?: ShiftRateRecord | null;
  error?: string;
};

type ScheduleEditLogRow = {
  timestamp: string;
  user: string;
  userEmail: string;
  actionType: string;
  weekType: string;
  weekOf: string;
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
};

type ScheduleEditLogGetResponse = {
  ok: boolean;
  rows?: ScheduleEditLogRow[];
  error?: string;
};
type BulkSelectedCell = {
  a1: string;
  week: WeekKind;
  clientName: string;
  dateStr: string;
  dayLabel: string;
  originalValue: string;
};

type BulkTargetStatus = Exclude<BaseShiftStatus, "Unknown">;

type BulkSmartStatusFilter =
  | "Any"
  | "Open"
  | "Filled"
  | "Offered"
  | "Considering"
  | "PendingClientApproval";
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
const STICKY_DAY_ROW_HEIGHT = 44;
const STICKY_DATE_ROW_HEIGHT = 40;

// ✅ TopNav is sticky and its height can change.
// The schedule header rows must sit directly below it.
const TOPNAV_Z = 200;
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

  // New considering format: (Tara K, 9:00AM-2:00PM
  const consideringOpenOnly = s.match(/^\(([^,]+),\s*\d{1,2}:\d{2}\s?[APMapm]{2}/);
  if (consideringOpenOnly?.[1]) {
    const cg = norm(consideringOpenOnly[1]);
    return cg.toLowerCase() === "open" ? "" : cg;
  }

  // Older considering format fallback: (Tara K) 9:00AM-2:00PM
  const consideringOld = s.match(/^\(([^)]+)\)\s*\d{1,2}:\d{2}\s?[APMapm]{2}/);
  if (consideringOld?.[1]) {
    const cg = norm(consideringOld[1]);
    return cg.toLowerCase() === "open" ? "" : cg;
  }

  // Standard comma-based formats
  const idx = s.indexOf(",");
  if (idx === -1) return "";

  const cg = s.slice(0, idx).replace(/[(")\^$]/g, "").trim();
  if (!cg) return "";
  if (cg.toLowerCase() === "open") return "";

  return cg;
}

function parseCaregiverNameFromAnyShiftText(cellValue: string): string {
  const v = norm(cellValue);
  if (!v) return "";

  const s = normalizeCellText(v);

  // Filled: Tara K, 9:00AM-2:00PM
  const filled = s.match(/^([^,*\$\(\)\^"]+)\s*,\s*\d{1,2}:\d{2}\s?[APMapm]{2}/);
  if (filled?.[1]) return norm(filled[1]);

  // Considering (new format): (Tara K, 9:00AM-2:00PM
  const consideringOpenOnly = s.match(/^\(([^,]+),\s*\d{1,2}:\d{2}\s?[APMapm]{2}/);
  if (consideringOpenOnly?.[1]) return norm(consideringOpenOnly[1]);

  // Considering (older format fallback): (Tara K) 9:00AM-2:00PM
  const consideringOld = s.match(/^\(([^)]+)\)\s*\d{1,2}:\d{2}\s?[APMapm]{2}/);
  if (consideringOld?.[1]) return norm(consideringOld[1]);

  // Offered (new format): "Tara K, 9:00AM-2:00PM
const offeredOpenOnly = s.match(/^"([^,]+),\s*\d{1,2}:\d{2}\s?[APMapm]{2}/);
if (offeredOpenOnly?.[1]) return norm(offeredOpenOnly[1]);

// Offered (older format fallback): "Tara K" 9:00AM-2:00PM
const offeredOld = s.match(/^"([^"]+)"\s*\d{1,2}:\d{2}\s?[APMapm]{2}/);
if (offeredOld?.[1]) return norm(offeredOld[1]);
  // Offering: ^Tara K, 9:00AM-2:00PM
  const offering = s.match(/^\^([^,]+),\s*\d{1,2}:\d{2}\s?[APMapm]{2}/);
  if (offering?.[1]) return norm(offering[1]);

  // Pending: $Tara K, 9:00AM-2:00PM
  const pending = s.match(/^\$([^,]+),\s*\d{1,2}:\d{2}\s?[APMapm]{2}/);
  if (pending?.[1]) return norm(pending[1]);

  return "";
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
function buildConsideringShiftValueFromExisting(args: {
  existingValue: string;
  caregiverName: string;
}): string | null {
  const caregiverName = norm(args.caregiverName);
  if (!caregiverName) return null;

  const timeRange = parseFirstTimeRange(args.existingValue);
  if (!timeRange) return null;

  return `(${caregiverName}, ${timeRange.start}-${timeRange.end}`;
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

function a1ColumnLetters(a1: string): string {
  const m = String(a1 || "").match(/^[A-Z]+/i);
  return (m?.[0] || "").toUpperCase();
}

function columnLettersToNumber(col: string): number {
  let n = 0;
  for (let i = 0; i < col.length; i++) {
    n = n * 26 + (col.charCodeAt(i) - 64);
  }
  return n;
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

function formatIsoTimestampForDisplay(raw: string): string {
  const s = norm(raw);
  if (!s) return "—";

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;

  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatSingleTimeForDisplay(raw: string): string {
  const s = norm(raw);
  if (!s) return "";

  // ✅ If it already looks like a normal schedule time, keep it
  if (/^\d{1,2}:\d{2}\s?[APMapm]{2}$/.test(s)) {
    return s.replace(/\s+/g, "");
  }

  // ✅ If Google/Apps Script turned it into a full Date string, convert to time only
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).replace(/\s/g, "");
  }

  // ✅ fallback
  return s;
}

function formatTimeRangeForDisplay(start: string, end: string): string {
  const s = formatSingleTimeForDisplay(start);
  const e = formatSingleTimeForDisplay(end);

  if (!s && !e) return "—";
  if (!s) return e;
  if (!e) return s;

  return `${s}-${e}`;
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
  const data = text ? JSON.parse(text.trim()) : null;

  if (!r.ok) throw new Error(data?.error || `Update failed (${r.status})`);
  if (!data?.ok) throw new Error(data?.error || "Update failed");
  return data;
}

async function fetchScheduleEditLog(week: WeekKind): Promise<ScheduleEditLogRow[]> {
  const res = await fetch(`/api/schedule-edit-log?week=${encodeURIComponent(week)}`, {
    cache: "no-store",
  });

  const text = await res.text();
  let j: ScheduleEditLogGetResponse | any = null;

  try {
    j = text ? JSON.parse(text.trim()) : null;
  } catch {
    throw new Error(`Non-JSON schedule edit log response (${res.status}): ${text.slice(0, 200)}`);
  }

  if (!res.ok) throw new Error(j?.error || `Schedule edit log request failed (${res.status})`);
  if (!j?.ok) throw new Error(j?.error || "Failed to load schedule edit log");

  return Array.isArray(j.rows) ? j.rows : [];
}

async function fetchShiftRateByShiftId(shiftId: string): Promise<ShiftRateRecord | null> {
  if (!norm(shiftId)) return null;

  const res = await fetch(`/api/shift-rates?shiftId=${encodeURIComponent(shiftId)}`, {
    cache: "no-store",
  });

  const text = await res.text();
  let j: ShiftRatesGetResponse | any = null;

  try {
    j = text ? JSON.parse(text.trim()) : null;
  } catch {
    throw new Error(`Non-JSON shift-rates response (${res.status}): ${text.slice(0, 200)}`);
  }

  if (!res.ok) throw new Error(j?.error || `Shift rate request failed (${res.status})`);
  if (!j?.ok) throw new Error(j?.error || "Failed to load shift rate");

  const rows = Array.isArray(j?.rows) ? j.rows : [];
  const match = rows.find((row: any) => norm(row?.["Shift ID"]) === norm(shiftId));

  if (!match) return null;

  return {
    shiftId: norm(match?.["Shift ID"]),
    rate: match?.["Final Pay Rate"] ?? match?.["Base Rate"] ?? "",
    updatedAt:
      norm(match?.["TimeStamp"]) ||
      norm(match?.["Approved Timestamp"]) ||
      norm(match?.["Last Synced At"]),
    updatedBy: norm(match?.["Updated By"]) || norm(match?.["Approved By"]),
    reason: norm(match?.["Rate Source Detail"]) || norm(match?.["Updated Source"]),
    raw: match,
  };
}
async function saveShiftRate(args: {
  shiftId: string;
  newRate: number;
  shiftTotal?: number | null;
  updatedBy: string;
  reason?: string;
}): Promise<ShiftRateRecord | null> {
  const res = await fetch("/api/shift-rates", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "updateShiftRate",
      shiftId: args.shiftId,
      newRate: args.newRate,
      shiftTotal: args.shiftTotal ?? null,
      updatedBy: args.updatedBy,
      reason: args.reason || "",
    }),
  });

  const text = await res.text();
  let j: ShiftRatesPostResponse | any = null;

  try {
    j = text ? JSON.parse(text.trim()) : null;
  } catch {
    throw new Error(`Shift rate save failed (${res.status})`);
  }

  if (!res.ok || !j?.ok) {
    throw new Error(j?.error || `Shift rate save failed (${res.status})`);
  }

  return j?.rate ?? null;
}



async function logAndSaveScheduleEdit(args: {
  timestamp: string;
  user: string;
  userEmail: string;
  actionType: string;
  weekType: "cw" | "nw";
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
  const res = await fetch("/api/schedule-edit-log", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });

  const text = await res.text();
  let data: any = null;

  try {
    data = text ? JSON.parse(text.trim()) : null;
  } catch {
    throw new Error(`Schedule edit log save failed (${res.status})`);
  }

  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || `Schedule edit log save failed (${res.status})`);
  }

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

function makeCellEditHistoryKey(args: {
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
    width: "min(680px, 96vw)",
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

const SHIFT_RATE_REASON_OPTIONS = [
  "Incentive pay",
  "Meet & Greet",
  "Holiday Pay",
  "Manual Correction",
  "Other",
] as const;

type ShiftRateReasonOption = (typeof SHIFT_RATE_REASON_OPTIONS)[number];

function durationHoursFromStartEnd(start: string, end: string): number {
  const s = parseTimeToMinutes(start);
  const e0 = parseTimeToMinutes(end);
  if (s == null || e0 == null) return 0;
  let e = e0;
  if (e <= s) e += 24 * 60;
  return Math.max(0, (e - s) / 60);
}

function formatMoneyInput(value: number | string | null | undefined): string {
  if (value == null) return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return n.toFixed(2);
}

function parseMoneyInput(value: string): number | null {
  const cleaned = norm(value).replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
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

  // ✅ signed-in portal user from NextAuth
  const { data: session, status: sessionStatus } = useSession();

  const currentUserName =
    session?.user?.name?.trim() || "Unknown User";

  const currentUserEmail =
    session?.user?.email?.trim() || "";

  // ✅ for now, "online users" = current signed-in user only
  // later we can replace this with true shared presence tracking
  const portalUsersOnline = useMemo(() => {
    if (!currentUserEmail) return [];
    return [
      {
        name: currentUserName,
        email: currentUserEmail,
        isCurrentUser: true,
      },
    ];
  }, [currentUserName, currentUserEmail]);

 const [applicantSearch, setApplicantSearch] = useState("");
const [week, setWeek] = useState<WeekKind>("cw");

const [panelOpen, setPanelOpen] = useState(false);
const [panelWidth, setPanelWidth] = useState(470);
const [ganglionOpen, setGanglionOpen] = useState(false);

function handlePanelResize(nextWidth: number) {
  const clamped = Math.max(360, Math.min(760, Math.round(nextWidth)));
  setPanelWidth(clamped);
}

const {
  draftMode,
  toggleDraftMode,
  resetDraft,
  undo,
  redo,
  canUndo,
  canRedo,
  hasDraftChanges,
  changedCellCount,
  setDraftCell,
  getDraftValue,
  isCellChanged,
  buildSavePayload,
} = useDraftSchedule();

    // ✅ TopNav height tracking (MUST live inside component)
  const [topNavH, setTopNavH] = useState(0);
  const topNavRef = useRef<HTMLDivElement | null>(null);

  // ✅ Computed sticky tops (depend on topNavH)
  // The day/date header rows should sit directly below the sticky TopNav.
  // This is the correct setup for the final table/header layout fix.
  // ✅ Computed sticky tops (depend on measured TopNav height)
// Day row should sit directly under TopNav
// Date row should sit directly under the day row
const STICKY_DAY_ROW_TOP = 0;
const STICKY_DATE_ROW_TOP = STICKY_DAY_ROW_HEIGHT;
    // ✅ Measure TopNav height so sticky schedule headers sit right under it
  useEffect(() => {
    const el = topNavRef.current;
    if (!el) return;

    const update = () => {
      setTopNavH(el.offsetHeight || 0);
    };

    update();

    const ro = new ResizeObserver(() => update());
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

  // publish
  const [publishingSchedule, setPublishingSchedule] = useState(false);

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

  // client description edit state
  const [clientProfileEditMode, setClientProfileEditMode] = useState(false);
  const [clientDescriptionDraft, setClientDescriptionDraft] = useState<string>("");
  const [clientDescriptionSaving, setClientDescriptionSaving] = useState(false);
  const [clientDescriptionError, setClientDescriptionError] = useState<string | null>(null);
  const [clientDescriptionSavedAt, setClientDescriptionSavedAt] = useState<string>("");

// edit history modal
const [editHistoryModalTarget, setEditHistoryModalTarget] =
  useState<EditHistoryModalTarget | null>(null);
const [editHistoryLoading, setEditHistoryLoading] = useState(false);
const [editHistoryError, setEditHistoryError] = useState<string | null>(null);
const [scheduleEditLogRows, setScheduleEditLogRows] = useState<ScheduleEditLogRow[]>([]);

// shift rate state
const [shiftRateLoading, setShiftRateLoading] = useState(false);
const [shiftRateError, setShiftRateError] = useState<string | null>(null);

// hourly rate
const [shiftRateValue, setShiftRateValue] = useState<string>("");
const [shiftRateOriginalValue, setShiftRateOriginalValue] = useState<string>("");

// total shift pay
const [shiftRateTotalValue, setShiftRateTotalValue] = useState<string>("");
const [shiftRateOriginalTotalValue, setShiftRateOriginalTotalValue] = useState<string>("");

// reason dropdown
const [shiftRateReason, setShiftRateReason] = useState<string>("");
const [shiftRateCustomReason, setShiftRateCustomReason] = useState<string>("");
// saved metadata
const [shiftRateUpdatedAt, setShiftRateUpdatedAt] = useState<string>("");
const [shiftRateUpdatedBy, setShiftRateUpdatedBy] = useState<string>("");

const [shiftRateSaving, setShiftRateSaving] = useState(false);
const shiftRateHours = useMemo(() => {
  if (!editHistoryModalTarget) return 0;
  return durationHoursFromStartEnd(
    editHistoryModalTarget.startTime,
    editHistoryModalTarget.endTime
  );
}, [editHistoryModalTarget]);

const shiftRateParsedTotal = useMemo(() => {
  return parseMoneyInput(shiftRateTotalValue);
}, [shiftRateTotalValue]);

const shiftRateParsedHourly = useMemo(() => {
  return parseMoneyInput(shiftRateValue);
}, [shiftRateValue]);

const shiftRateCalculatedHourly = useMemo(() => {
  if (!shiftRateHours || shiftRateHours <= 0) return null;
  if (shiftRateParsedTotal == null) return null;
  return shiftRateParsedTotal / shiftRateHours;
}, [shiftRateParsedTotal, shiftRateHours]);

const shiftRateCalculatedTotal = useMemo(() => {
  if (!shiftRateHours || shiftRateHours <= 0) return null;
  if (shiftRateParsedHourly == null) return null;
  return shiftRateParsedHourly * shiftRateHours;
}, [shiftRateParsedHourly, shiftRateHours]);

const finalShiftRateReason = useMemo(() => {
  if (shiftRateReason === "Other") {
    return norm(shiftRateCustomReason);
  }
  return norm(shiftRateReason);
}, [shiftRateReason, shiftRateCustomReason]);

// ✅ Onboarding panel
const [onboardingOpen, setOnboardingOpen] = useState(false);
   // ✅ Service Requests panel (per-client, per-week)
  const [svcPanelOpen, setSvcPanelOpen] = useState(false);
  const [svcClientName, setSvcClientName] = useState<string>("");

  // ✅ Insert row modal
  const [insertRowModal, setInsertRowModal] = useState<{
  open: boolean;
  anchorRow: number | null;
  insertAtRow: number | null;
  position: "above" | "below";
  clientName: string;
  anchorClientName: string;
}>({
  open: false,
  anchorRow: null,
  insertAtRow: null,
  position: "below",
  clientName: "",
  anchorClientName: "",
});

const [insertRowSaving, setInsertRowSaving] = useState(false);
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

   setInsertRowModal({
  open: false,
  anchorRow: null,
  insertAtRow: null,
  position: "below",
  clientName: "",
  anchorClientName: "",
});
  }, [week]);

      // inline cell editing
   const [editingA1, setEditingA1] = useState<string | null>(null);
  const [draftByA1, setDraftByA1] = useState<Record<string, string>>({});
  const [dragOverA1, setDragOverA1] = useState<string | null>(null);

  // allow independent cell save states
  const [savingA1Set, setSavingA1Set] = useState<Set<string>>(new Set());
    // shift save feedback toast
  const [saveToast, setSaveToast] = useState<{
    id: number;
    kind: "success" | "warning" | "error";
    title: string;
    lines: string[];
  } | null>(null);

  // ✅ remembers which just-saved cell has a conflict
    const [conflictHighlight, setConflictHighlight] = useState<{
    a1: string;
    conflicts: ShiftConflictMatch[];
  } | null>(null);

 const [cellEditHistoryPresence, setCellEditHistoryPresence] =
  useState<CellEditHistoryPresenceMap>({});
// bulk editing
const [bulkMode, setBulkMode] = useState(false);
const [selectedBulkCells, setSelectedBulkCells] = useState<Record<string, BulkSelectedCell>>({});
const [bulkApplying, setBulkApplying] = useState(false);

const [bulkSmartCaregiver, setBulkSmartCaregiver] = useState("");
const [bulkSmartClient, setBulkSmartClient] = useState("");
const [bulkSmartStatus, setBulkSmartStatus] = useState<BulkSmartStatusFilter>("Any");
const [bulkCancelledTarget, setBulkCancelledTarget] = useState<
  "keep" | "cancelled" | "not_cancelled"
>("keep");

const [bulkSelectionMode, setBulkSelectionMode] = useState<
  "caregiver" | "client" | "status" | "manual"
>("caregiver");

const [showCaregiverSuggestions, setShowCaregiverSuggestions] = useState(false);
const [showClientSuggestions, setShowClientSuggestions] = useState(false);

const selectedBulkCount = Object.keys(selectedBulkCells).length;
    function openClientProfile(clientName: string) {
    const n = norm(clientName);
    if (!n) return;
    const p = clientsByName[normalizeKey(n)];
    setClientProfileName(p?.name || n);
    setClientProfileOpen(true);
  }

  function openInsertRowModal(args: {
  anchorRow: number;
  anchorClientName: string;
}) {
  const anchorClientName = args.anchorClientName || "";

  setInsertRowModal({
    open: true,
    anchorRow: args.anchorRow,
    insertAtRow: args.anchorRow + 1,
    position: "below",
    clientName: anchorClientName,
    anchorClientName,
  });
}

function closeInsertRowModal() {
  if (insertRowSaving) return;

  setInsertRowModal({
    open: false,
    anchorRow: null,
    insertAtRow: null,
    position: "below",
    clientName: "",
    anchorClientName: "",
  });
}
function setInsertRowPosition(position: "above" | "below") {
  setInsertRowModal((prev) => {
    const anchorRow = prev.anchorRow;
    if (!anchorRow) return prev;

    return {
      ...prev,
      position,
      insertAtRow: position === "above" ? anchorRow : anchorRow + 1,
    };
  });
}
  function isCellSaving(a1: string) {
    return savingA1Set.has(a1);
  }

  function markCellSaving(a1: string) {
    setSavingA1Set((prev) => {
      const next = new Set(prev);
      next.add(a1);
      return next;
    });
  }

    function unmarkCellSaving(a1: string) {
    setSavingA1Set((prev) => {
      const next = new Set(prev);
      next.delete(a1);
      return next;
    });
  }

  function markCellHasEditHistory(args: {
  week: WeekKind;
  a1: string;
  clientName: string;
  dateStr: string;
}) {
  const key = makeCellEditHistoryKey(args);

  setCellEditHistoryPresence((prev) => ({
    ...prev,
    [key]: true,
  }));
}

async function refreshScheduleEditLogForWeek(targetWeek: WeekKind) {
  try {
    setEditHistoryLoading(true);
    setEditHistoryError(null);
    const rows = await fetchScheduleEditLog(targetWeek);
    setScheduleEditLogRows(rows);
  } catch (err: any) {
    setEditHistoryError(err?.message || "Failed to load edit history.");
    setScheduleEditLogRows([]);
  } finally {
    setEditHistoryLoading(false);
  }
}

async function loadShiftRateForTarget(target: EditHistoryModalTarget) {
  try {
    setShiftRateLoading(true);
    setShiftRateError(null);

    setShiftRateValue("");
    setShiftRateOriginalValue("");

    setShiftRateTotalValue("");
    setShiftRateOriginalTotalValue("");

    setShiftRateReason("");
setShiftRateCustomReason("");
setShiftRateUpdatedAt("");
setShiftRateUpdatedBy("");

const rateRow = await fetchShiftRateByShiftId(target.shiftId);
const nextRate = rateRow?.rate == null ? "" : String(rateRow.rate);

const hours = durationHoursFromStartEnd(target.startTime, target.endTime);
const parsedRate = parseMoneyInput(nextRate);
const derivedTotal =
  parsedRate != null && hours > 0 ? (parsedRate * hours).toFixed(2) : "";

setShiftRateValue(nextRate);
setShiftRateOriginalValue(nextRate);

setShiftRateTotalValue(derivedTotal);
setShiftRateOriginalTotalValue(derivedTotal);

setShiftRateUpdatedAt(norm(rateRow?.updatedAt));
setShiftRateUpdatedBy(norm(rateRow?.updatedBy));

const loadedReason = norm(rateRow?.reason);

if (!loadedReason) {
  setShiftRateReason("");
  setShiftRateCustomReason("");
} else if (
  SHIFT_RATE_REASON_OPTIONS.includes(loadedReason as ShiftRateReasonOption)
) {
  setShiftRateReason(loadedReason);
  setShiftRateCustomReason("");
} else {
  setShiftRateReason("Other");
  setShiftRateCustomReason(loadedReason);
}
  } catch (err: any) {
    setShiftRateError(err?.message || "Failed to load shift rate.");
  } finally {
    setShiftRateLoading(false);
  }
}
  // caregiver panel
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

    async function handlePublishSchedule() {
    try {
      setPublishingSchedule(true);

      const weekType = week === "cw" ? "current" : "next";

      const res = await fetch("/api/publish-schedule", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ weekType }),
      });

      const text = await res.text();
      let data: any = null;

      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        throw new Error(`Non-JSON publish response (${res.status}): ${text.slice(0, 200)}`);
      }

      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Failed to publish schedule.");
      }

      await Promise.all([
        loadGridForWeek(week),
        refreshScheduleMapsForWeek(week),
        refreshGhostShiftsForWeek(week),
        refreshScheduleEditLogForWeek(week),
      ]);

      const result = data?.result || {};
      const rowsWritten = result?.rowsWritten;
      const destinationSheet =
        result?.destinationSheet || (week === "cw" ? "All Shifts" : "NW All Shifts");

      setSaveToast({
        id: Date.now(),
        kind: "success",
        title: week === "cw" ? "Current Week published" : "Next Week published",
        lines: [
          `Published to ${destinationSheet}.`,
          rowsWritten != null
            ? `${rowsWritten} row${rowsWritten === 1 ? "" : "s"} written.`
            : "Publish completed successfully.",
        ],
      });
    } catch (err: any) {
      setSaveToast({
        id: Date.now(),
        kind: "error",
        title: "Publish failed",
        lines: [err?.message || "Unable to publish the schedule."],
      });
    } finally {
      setPublishingSchedule(false);
    }
  }

  async function handleInsertRowSubmit() {
    const insertAtRow = insertRowModal.insertAtRow;
    const clientName = norm(insertRowModal.clientName);

    if (!insertAtRow) {
      setSaveToast({
        id: Date.now(),
        kind: "error",
        title: "Add row failed",
        lines: ["Missing target row."],
      });
      return;
    }

    if (!clientName) {
      setSaveToast({
        id: Date.now(),
        kind: "warning",
        title: "Client name required",
        lines: ["Please enter a client name before adding the row."],
      });
      return;
    }

    try {
      setInsertRowSaving(true);

      const res = await fetch("/api/insert-row", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sheetName: sheetLabelForWeek(week),
          insertAtRow,
          clientName,
        }),
      });

      const text = await res.text();
      let data: any = null;

      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        throw new Error(`Non-JSON insert-row response (${res.status}): ${text.slice(0, 200)}`);
      }

      if (!res.ok || !data?.success) {
        throw new Error(data?.error || "Failed to insert row.");
      }

      await Promise.all([
        loadGridForWeek(week),
        refreshScheduleMapsForWeek(week),
        refreshGhostShiftsForWeek(week),
        refreshScheduleEditLogForWeek(week),
      ]);

      setSaveToast({
        id: Date.now(),
        kind: "success",
        title: "Row added",
        lines: [
          `Inserted row ${insertAtRow}.`,
          `Client: ${clientName}`,
        ],
      });

      closeInsertRowModal();
    } catch (err: any) {
      setSaveToast({
        id: Date.now(),
        kind: "error",
        title: "Add row failed",
        lines: [err?.message || "Unable to insert the row."],
      });
    } finally {
      setInsertRowSaving(false);
    }
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
async function handleSaveClientDescription() {
  const clientName = norm(clientProfileName);
  if (!clientName) {
    setClientDescriptionError("Missing client name");
    return;
  }

  try {
    setClientDescriptionSaving(true);
    setClientDescriptionError(null);
    setClientDescriptionSavedAt("");

    const res = await fetch("/api/clients", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "updateClientDescription",
        clientName,
        description: clientDescriptionDraft,
        updatedBy: currentUserName,
        updatedByEmail: currentUserEmail,
      }),
    });

    const text = await res.text();
    let j: any = null;

    try {
      j = text ? JSON.parse(text.trim()) : null;
    } catch {
      throw new Error(`Client description save failed (${res.status})`);
    }

    if (!res.ok || !j?.ok) {
      throw new Error(j?.error || `Client description save failed (${res.status})`);
    }

    await refreshClients();
    setClientProfileEditMode(false);
    setClientDescriptionSavedAt(new Date().toISOString());
  } catch (e: any) {
    setClientDescriptionError(e?.message ?? "Unknown save error");
  } finally {
    setClientDescriptionSaving(false);
  }
}
  useEffect(() => {
    if (!clientProfileOpen) return;

    const key = normalizeKey(clientProfileName);
    const p = key ? clientsByName[key] : undefined;

    setClientDescriptionDraft(norm(p?.description));
    setClientProfileEditMode(false);
    setClientDescriptionError(null);
    setClientDescriptionSavedAt("");
  }, [clientProfileOpen, clientProfileName, clientsByName]);
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
  refreshApplicants(),
  refreshClients(),
  refreshGhostShiftsForWeek(week),
  refreshScheduleEditLogForWeek(week),
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
  }, 60000);

  return () => window.clearTimeout(timer);
}, [saveToast]);

useEffect(() => {
  if (!draftMode) {
    setDragOverA1(null);
  }
}, [draftMode]);

useEffect(() => {
  if (!bulkMode) {
    setSelectedBulkCells({});
    setBulkSelectionMode("caregiver");
    setBulkSmartCaregiver("");
    setBulkSmartClient("");
    setBulkSmartStatus("Any");
    setShowCaregiverSuggestions(false);
    setShowClientSuggestions(false);
  }
}, [bulkMode]);
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

const selectedCellHistoryRows = useMemo(() => {
  if (!editHistoryModalTarget) return [];

  return scheduleEditLogRows
    .filter((row) => {
      return (
        normalizeKey(row.cell) === normalizeKey(editHistoryModalTarget.a1) &&
        normalizeKey(row.client) === normalizeKey(editHistoryModalTarget.clientName) &&
        dateKey(row.date) === dateKey(editHistoryModalTarget.dateStr) &&
        normalizeKey(row.weekType) === normalizeKey(editHistoryModalTarget.week)
      );
    })
    .sort((a, b) => {
      const ta = new Date(a.timestamp).getTime();
      const tb = new Date(b.timestamp).getTime();
      return tb - ta;
    });
}, [editHistoryModalTarget, scheduleEditLogRows]);
 

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

      const anyCell = r.cells.some((c) => {
        const originalValue = norm(c.value);
        const effectiveValue =
          draftMode && c.a1
            ? norm(
                getDraftValue({
                  a1: c.a1,
                  week,
                  originalValue,
                })
              )
            : originalValue;

        return containsCI(effectiveValue, q);
      });

      return anyCell;
    });
  }, [rowsAll, searchText, clientsByName, draftMode, getDraftValue, week]);

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

  const visibleBulkCandidates = useMemo(() => {
    const out: BulkSelectedCell[] = [];

    for (const r of rows) {
      const clientName = norm(r.clientName);

      for (const dow of visibleDows) {
        const c = r.cells[dow];
        const a1 = c?.a1 || "";
        if (!a1) continue;

        const originalValue = norm(c?.value);
        const effectiveValue =
          draftMode
            ? norm(
                getDraftValue({
                  a1,
                  week,
                  originalValue,
                })
              )
            : originalValue;

        if (!effectiveValue) continue;

        const dateStr = norm(dateHeaders?.[dow + 1]);
        const dayLabel = dayHeaders?.[dow + 1] || DOW_LABELS[dow];

        out.push({
          a1,
          week,
          clientName,
          dateStr,
          dayLabel,
          originalValue: effectiveValue,
        });
      }
    }

    return out;
  }, [rows, visibleDows, draftMode, getDraftValue, week, dateHeaders, dayHeaders]);
  function smartSelectByCaregiver(caregiverName: string) {
  const target = normalizeKey(caregiverName);
  if (!target) return;

  const matches = visibleBulkCandidates.filter((cell) => {
    const parsed = parseScheduleShiftCell(cell.originalValue);
    return normalizeKey(parsed.caregiverName || "") === target;
  });

  const next: Record<string, BulkSelectedCell> = {};
  for (const m of matches) next[m.a1] = m;
  setSelectedBulkCells(next);
}

function smartSelectByClient(clientName: string) {
  const target = normalizeKey(clientName);
  if (!target) return;

  const matches = visibleBulkCandidates.filter(
    (cell) => normalizeKey(cell.clientName) === target
  );

  const next: Record<string, BulkSelectedCell> = {};
  for (const m of matches) next[m.a1] = m;
  setSelectedBulkCells(next);
}

function smartSelectByStatus(status: Exclude<BulkSmartStatusFilter, "Any">) {
  const matches = visibleBulkCandidates.filter((cell) => {
    const parsed = parseScheduleShiftCell(cell.originalValue);
    return parsed.baseStatus === status;
  });

  const next: Record<string, BulkSelectedCell> = {};
  for (const m of matches) next[m.a1] = m;
  setSelectedBulkCells(next);
}

function smartSelectByCaregiverAndStatus(
  caregiverName: string,
  status: BulkSmartStatusFilter
) {
  const target = normalizeKey(caregiverName);
  if (!target) return;

  const matches = visibleBulkCandidates.filter((cell) => {
    const parsed = parseScheduleShiftCell(cell.originalValue);
    const caregiverMatch = normalizeKey(parsed.caregiverName || "") === target;
    const statusMatch = status === "Any" ? true : parsed.baseStatus === status;
    return caregiverMatch && statusMatch;
  });

  const next: Record<string, BulkSelectedCell> = {};
  for (const m of matches) next[m.a1] = m;
  setSelectedBulkCells(next);
}

function selectAllVisibleShifts() {
  const next: Record<string, BulkSelectedCell> = {};
  for (const c of visibleBulkCandidates) next[c.a1] = c;
  setSelectedBulkCells(next);
}

const bulkCaregiverSuggestions = useMemo(() => {
  const names = Array.from(
    new Set(
      visibleBulkCandidates
        .map((cell) => parseScheduleShiftCell(cell.originalValue).caregiverName || "")
        .map((name) => norm(name))
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b));

  const q = normalizeKey(bulkSmartCaregiver);
  if (!q) return names.slice(0, 8);

  return names.filter((name) => normalizeKey(name).includes(q)).slice(0, 8);
}, [visibleBulkCandidates, bulkSmartCaregiver]);

const bulkClientSuggestions = useMemo(() => {
  const names = Array.from(
    new Set(visibleBulkCandidates.map((cell) => norm(cell.clientName)).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));

  const q = normalizeKey(bulkSmartClient);
  if (!q) return names.slice(0, 8);

  return names.filter((name) => normalizeKey(name).includes(q)).slice(0, 8);
}, [visibleBulkCandidates, bulkSmartClient]);

function resetBulkSearchUi(mode: "caregiver" | "client" | "status" | "manual") {
  setBulkSelectionMode(mode);
  setBulkSmartCaregiver("");
  setBulkSmartClient("");
  setBulkSmartStatus("Any");
  setShowCaregiverSuggestions(false);
  setShowClientSuggestions(false);
}
    const clientWorstStatus = useMemo(() => {
    const map = new Map<string, ShiftStatus>();

    for (const r of rows) {
      const name = norm(r.clientName);
      if (!name) continue;

      const statusesForRow = r.cells
        .map((c) => {
          const originalValue = norm(c.value);
          const effectiveValue =
            draftMode && c.a1
              ? norm(
                  getDraftValue({
                    a1: c.a1,
                    week,
                    originalValue,
                  })
                )
              : originalValue;

          return statusFromCellValue(effectiveValue);
        })
        .filter((s) => s !== "none");

      const rowWorst = statusesForRow.length ? worstStatus(statusesForRow) : "none";

      const prev = map.get(name);
      if (!prev) map.set(name, rowWorst);
      else map.set(name, worstStatus([prev, rowWorst]));
    }

    return map;
  }, [rows, draftMode, getDraftValue, week]);

    const totals = useMemo(() => {
  let totalHours = 0;
  const clientSet = new Set<string>();
  const caregiverSet = new Set<string>();

  for (const r of rows) {
    const cn = norm(r.clientName);
    if (cn) clientSet.add(cn);

    for (let dow = 0; dow < 7; dow++) {
      if (selectedDow != null && dow !== selectedDow) continue;

      const c = r.cells[dow];
      const originalValue = norm(c?.value);
      const v =
        draftMode && c?.a1
          ? norm(
              getDraftValue({
                a1: c.a1,
                week,
                originalValue,
              })
            )
          : originalValue;

      if (!v) continue;

      const status = statusFromCellValue(v);
      if (status !== "filled") continue;

      const tr = parseFirstTimeRange(v);
      if (!tr) continue;

      totalHours += durationHoursFromStartEnd(tr.start, tr.end);

      const caregiverName = parseCaregiverFromCell(v);
      if (caregiverName) caregiverSet.add(caregiverName);
    }
  }

  return {
    clientCount: clientSet.size,
    caregiverCount: caregiverSet.size,
    totalHours,
  };
}, [rows, selectedDow, draftMode, getDraftValue, week]);

   const hoursByClient = useMemo(() => {
  const map = new Map<string, number>();

  for (const r of rows) {
    const cn = norm(r.clientName);
    if (!cn) continue;

    let sum = map.get(cn) ?? 0;

    for (let dow = 0; dow < 7; dow++) {
      if (selectedDow != null && dow !== selectedDow) continue;

      const cell = r.cells?.[dow];
      const originalValue = norm(cell?.value);
      const v =
        draftMode && cell?.a1
          ? norm(
              getDraftValue({
                a1: cell.a1,
                week,
                originalValue,
              })
            )
          : originalValue;

      if (!v) continue;

      const status = statusFromCellValue(v);
      if (status !== "filled") continue;

      const tr = parseFirstTimeRange(v);
      if (!tr) continue;

      sum += durationHoursFromStartEnd(tr.start, tr.end);
    }

    map.set(cn, sum);
  }

  return map;
}, [rows, selectedDow, draftMode, getDraftValue, week]);
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
  const effectiveScheduleItemsForPanel = useMemo(() => {
    const items: ScheduleItem[] = [];

    const liveScheduleByLookupKey = new Map<string, ShiftRow>();
    for (const s of scheduleRows) {
      const key = makeShiftLookupKey({
        client: s.client,
        date: s.date,
        start: s.startTime,
        end: s.endTime,
        caregiver: s.caregiver || "",
      });
      liveScheduleByLookupKey.set(key, s);
    }

    for (const r of rowsAll) {
      const clientName = norm(r.clientName);
      if (!clientName) continue;

      for (let dow = 0; dow < 7; dow++) {
        const c = r.cells[dow];
        const a1 = c?.a1 || "";
        if (!a1) continue;

        const originalValue = norm(c?.value);
        const effectiveValue =
          draftMode
            ? norm(
                getDraftValue({
                  a1,
                  week,
                  originalValue,
                })
              )
            : originalValue;

        const caregiverName = parseCaregiverNameFromAnyShiftText(effectiveValue);
        const timeRange = parseFirstTimeRange(effectiveValue);
        const dateStr = norm(dateHeaders?.[dow + 1]);

        if (!caregiverName || !timeRange || !dateStr) continue;

        const lookupKey = makeShiftLookupKey({
          client: clientName,
          date: dateStr,
          start: timeRange.start,
          end: timeRange.end,
          caregiver: caregiverName,
        });

        const liveMatch = liveScheduleByLookupKey.get(lookupKey);

        items.push({
          shiftId: liveMatch?.shiftId || `${a1}::${timeRange.start}-${timeRange.end}`,
          client: clientName,
          date: dateStr,
          dow,
          startTime: timeRange.start,
          endTime: timeRange.end,
          status: statusFromCellValue(effectiveValue),
          flagged: liveMatch
            ? isFlaggedShiftFromScheduleRow(liveMatch, clockMap, locationMap)
            : false,
          hours: durationHoursFromStartEnd(timeRange.start, timeRange.end),
          caregiverId: liveMatch?.caregiverId || "",
          caregiverName,
          isDraft:
            draftMode && a1
              ? isCellChanged({
                  a1,
                  week,
                })
              : false,
        });
      }
    }

    return items;
  }, [
    rowsAll,
    scheduleRows,
    dateHeaders,
    draftMode,
    week,
    getDraftValue,
    isCellChanged,
    clockMap,
    locationMap,
  ]);
  /** ---------- Caregivers on schedule + missing profiles ---------- */

    const scheduleCaregiverNames = useMemo(() => {
    const set = new Set<string>();

    for (const s of effectiveScheduleItemsForPanel) {
      const name = norm(s.caregiverName);
      if (!name) continue;
      set.add(name);
    }

    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [effectiveScheduleItemsForPanel]);
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
    caregiverId?: string;
    caregiverName?: string;
    isDraft?: boolean;
  };

    const scheduleByCaregiverKey = useMemo(() => {
    const map: Record<string, ScheduleItem[]> = {};

    for (const s of effectiveScheduleItemsForPanel) {
      const cgName = norm(s.caregiverName);
      if (!cgName) continue;

      const item: ScheduleItem = {
        shiftId: s.shiftId,
        client: s.client,
        date: s.date,
        dow: s.dow,
        startTime: s.startTime,
        endTime: s.endTime,
        status: s.status,
        flagged: s.flagged,
        hours: s.hours,
        caregiverId: s.caregiverId,
        caregiverName: s.caregiverName,
        isDraft: s.isDraft,
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
  }, [effectiveScheduleItemsForPanel]);

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

    function startInlineEdit(a1: string, currentValue: string) {
    setEditingA1(a1);
    setDraftByA1((prev) => ({
      ...prev,
      [a1]: currentValue,
    }));
  }

  function cancelInlineEdit(a1: string) {
    setEditingA1((prev) => (prev === a1 ? null : prev));
    setDraftByA1((prev) => {
      const next = { ...prev };
      delete next[a1];
      return next;
    });
  }
 function openEditHistoryForCell(args: {
  a1: string;
  clientName: string;
  dateStr: string;
  dayLabel: string;
  shiftId: string;
  caregiverName: string;
  startTime: string;
  endTime: string;
  status: ShiftStatus;
}) {
   setEditHistoryModalTarget({
  a1: args.a1,
  clientName: args.clientName,
  dateStr: args.dateStr,
  dayLabel: args.dayLabel,
  week,
  shiftId: args.shiftId,
  caregiverName: args.caregiverName,
  startTime: args.startTime,
  endTime: args.endTime,
  status: args.status,
});
  }

      function cellHasEditHistory(args: {
    a1: string;
    clientName: string;
    dateStr: string;
  }) {
    const key = makeCellEditHistoryKey({
      week,
      a1: args.a1,
      clientName: args.clientName,
      dateStr: args.dateStr,
    });

    return Boolean(cellEditHistoryPresence[key]);
  }

  function toggleBulkCellSelection(cell: BulkSelectedCell) {
    setSelectedBulkCells((prev) => {
      const next = { ...prev };
      if (next[cell.a1]) delete next[cell.a1];
      else next[cell.a1] = cell;
      return next;
    });
  }

  function clearBulkSelection() {
    setSelectedBulkCells({});
  }

  function isBulkCellSelected(a1: string) {
    return Boolean(selectedBulkCells[a1]);
  }

  function showDraftShiftFeedback(args: {
    a1: string;
    oldValue: string;
    newValue: string;
    clientName: string;
    shiftDateForSave: string;
    dayLabel: string;
  }) {
    const { oldValue, newValue, clientName, shiftDateForSave, dayLabel } = args;

    const oldTimeRange = parseFirstTimeRange(oldValue);

    const currentShiftId =
      scheduleRows.find((s) => {
        const rowDateKey = dateKey(s.date);
        const targetDateKey = dateKey(shiftDateForSave);

        return (
          rowDateKey === targetDateKey &&
          normalizeKey(s.client) === normalizeKey(clientName) &&
          normalizeKey(s.caregiver) === normalizeKey(parseCaregiverNameFromAnyShiftText(oldValue)) &&
          norm(s.startTime).replace(/\s+/g, "").toUpperCase() ===
            norm(oldTimeRange?.start).replace(/\s+/g, "").toUpperCase() &&
          norm(s.endTime).replace(/\s+/g, "").toUpperCase() ===
            norm(oldTimeRange?.end).replace(/\s+/g, "").toUpperCase()
        );
      })?.shiftId || "";

    const parsed = parseShiftTextForFeedback(newValue, shiftSaveCaregivers, {
      currentShiftId,
      shiftDate: shiftDateForSave,
      existingShifts: scheduleRows.map((s) => ({
        shiftId: s.shiftId,
        date: s.date,
        caregiverId: s.caregiverId,
        caregiverName: s.caregiver,
        startTime: s.startTime,
        endTime: s.endTime,
        status: s.status,
        client: s.client,
      })),
      previousRawText: oldValue,
    });

    const toastModel = buildShiftSaveToast(parsed);

    setSaveToast({
      id: Date.now(),
      kind: toastModel.kind,
      title:
        toastModel.title === "Shift saved"
          ? "Draft updated"
          : toastModel.title === "Shift saved with warnings"
          ? "Draft updated with warnings"
          : toastModel.title,
      lines: [
        `${clientName} • ${dayLabel}`,
        ...toastModel.lines,
        "Saved to draft mode only.",
      ],
    });
  }

  async function saveInlineEdit(args: {
    a1: string;
    newVal: string;
    clientName: string;
    shiftDateForSave: string;
    dayLabel: string;
    weekOf?: string;
  }) {
  const { a1, newVal, clientName, shiftDateForSave, dayLabel, weekOf } = args;

  let oldVal = "";
  const snapshot = data;

  if (snapshot?.ok) {
    for (const r of snapshot.body.rows) {
      const cell = r.cells.find((x) => x.a1 === a1);
      if (cell) {
        oldVal = norm(cell.value);
        break;
      }
    }
  }

    if (norm(oldVal) === norm(newVal)) {
    cancelInlineEdit(a1);
    return;
  }

     if (draftMode) {
    setDraftCell({
      a1,
      week,
      originalValue: oldVal,
      draftValue: newVal,
      clientName,
      dateStr: shiftDateForSave,
      dayLabel,
    });

    cancelInlineEdit(a1);

    showDraftShiftFeedback({
      a1,
      oldValue: oldVal,
      newValue: newVal,
      clientName,
      shiftDateForSave,
      dayLabel,
    });

    return;
  }

  const oldTimeRange = parseFirstTimeRange(oldVal);
  const newTimeRange = parseFirstTimeRange(newVal);

  const oldCaregiverName = parseCaregiverFromCell(oldVal);
  const newCaregiverName = parseCaregiverFromCell(newVal);

  const oldStatus = statusFromCellValue(oldVal);
  const newStatus = statusFromCellValue(newVal);

  const oldStatusLabel = oldStatus === "none" ? "" : oldStatus;
  const newStatusLabel = newStatus === "none" ? "" : newStatus;

  const actionType =
    !norm(oldVal) && norm(newVal)
      ? "Created Shift"
      : norm(oldVal) && !norm(newVal)
      ? "Deleted Shift"
      : "Edited Shift";

  const logTimestamp = new Date().toISOString();

  const currentShiftId =
    scheduleRows.find((s) => {
      const rowDateKey = dateKey(s.date);
      const targetDateKey = dateKey(shiftDateForSave);

      return (
        rowDateKey === targetDateKey &&
        normalizeKey(s.client) === normalizeKey(clientName) &&
        normalizeKey(s.caregiver) === normalizeKey(oldCaregiverName) &&
        norm(s.startTime).replace(/\s+/g, "").toUpperCase() ===
          norm(oldTimeRange?.start).replace(/\s+/g, "").toUpperCase() &&
        norm(s.endTime).replace(/\s+/g, "").toUpperCase() ===
          norm(oldTimeRange?.end).replace(/\s+/g, "").toUpperCase()
      );
    })?.shiftId || "";

  const parsed = parseShiftTextForFeedback(newVal, shiftSaveCaregivers, {
    currentShiftId,
    shiftDate: shiftDateForSave,
    existingShifts: scheduleRows.map((s) => ({
      shiftId: s.shiftId,
      date: s.date,
      caregiverId: s.caregiverId,
      caregiverName: s.caregiver,
      startTime: s.startTime,
      endTime: s.endTime,
      status: s.status,
      client: s.client,
    })),
  });

  const notesParts: string[] = [];

  if (parsed.warnings?.length) {
    notesParts.push(`Warnings: ${parsed.warnings.join(" | ")}`);
  }

  if (parsed.errors?.length) {
    notesParts.push(`Errors: ${parsed.errors.join(" | ")}`);
  }

  if (parsed.conflictMatches?.length) {
    const conflictSummary = parsed.conflictMatches
      .map(
        (m) =>
          `${m.client} ${m.startTime}-${m.endTime}${m.shiftId ? ` (${m.shiftId})` : ""}`
      )
      .join(" | ");

    notesParts.push(`Conflicts: ${conflictSummary}`);
  }

  const logNotes = notesParts.join(" || ");

  const toastModel = buildShiftSaveToast(parsed);

  try {
    markCellSaving(a1);
    setConflictHighlight(null);

    // optimistic local update first
    setData((prev) => {
      if (!prev?.ok) return prev;
      const next = structuredClone(prev);

      for (const row of next.body.rows) {
        const cell = row.cells.find((x) => x.a1 === a1);
        if (cell) {
          cell.value = newVal;
          cell.fontColor = (
            SHEET_COLORS[statusFromCellValue(newVal)] || "#111827"
          ).toLowerCase();
          break;
        }
      }

      return next;
    });

    // close editor immediately so scheduler can keep moving
    cancelInlineEdit(a1);

    // 1) save actual schedule cell
    await updateCell(week, a1, newVal);

    // 2) append edit-log row
        await logAndSaveScheduleEdit({
      timestamp: logTimestamp,
      user: currentUserName,
      userEmail: currentUserEmail,
      actionType,
      weekType: week,
      weekOf,
      date: shiftDateForSave,
      client: clientName,
      oldValue: oldVal,
      newValue: newVal,
      cell: a1,
      day: dayLabel,
      oldStatus: oldStatusLabel,
      newStatus: newStatusLabel,
      oldCaregiver: oldCaregiverName,
      newCaregiver: newCaregiverName,
      oldStartTime: oldTimeRange?.start ?? "",
      newStartTime: newTimeRange?.start ?? "",
      oldEndTime: oldTimeRange?.end ?? "",
      newEndTime: newTimeRange?.end ?? "",
      notes: logNotes,
      accessPoint: "CWWebSchedule inline edit",
    });

    markCellHasEditHistory({
  week,
  a1,
  clientName,
  dateStr: shiftDateForSave,
});

// re-sync from source-of-truth sheet
await Promise.all([
  loadGridForWeek(week),
  refreshScheduleMapsForWeek(week),
  refreshScheduleEditLogForWeek(week),
]);
    if (parsed.conflictMatches.length > 0) {
      setConflictHighlight({
        a1,
        conflicts: parsed.conflictMatches,
      });
    } else {
      setConflictHighlight(null);
    }

    setSaveToast({
      id: Date.now(),
      kind: toastModel.kind,
      title: toastModel.title,
      lines: toastModel.lines,
    });
  } catch (err: any) {
    // rollback if actual save or log failed
    setData((prev) => {
      if (!prev?.ok) return prev;
      const next = structuredClone(prev);

      for (const row of next.body.rows) {
        const cell = row.cells.find((x) => x.a1 === a1);
        if (cell) {
          cell.value = oldVal;
          cell.fontColor = (
            SHEET_COLORS[statusFromCellValue(oldVal)] || "#111827"
          ).toLowerCase();
          break;
        }
      }

      return next;
    });

    setEditingA1(a1);
    setDraftByA1((prev) => ({
      ...prev,
      [a1]: newVal,
    }));

    setSaveToast({
      id: Date.now(),
      kind: "error",
      title: "Save failed",
      lines: [
        err?.message ?? "The cell could not be updated.",
        "The cell was restored to its previous value.",
      ],
    });
  } finally {
    unmarkCellSaving(a1);
  }
}

async function saveDraftScheduleToSheet() {
  const payload = buildSavePayload();
  if (!payload.length) {
    setSaveToast({
      id: Date.now(),
      kind: "warning",
      title: "No draft changes",
      lines: ["There are no draft changes to save."],
    });
    return;
  }

  try {
    setLoading(true);
    setError(null);

    for (const item of payload) {
      await updateCell(item.week, item.a1, item.draftValue);

      await logAndSaveScheduleEdit({
        timestamp: new Date().toISOString(),
        user: currentUserName,
        userEmail: currentUserEmail,
        actionType:
          !norm(item.originalValue) && norm(item.draftValue)
            ? "Created Shift"
            : norm(item.originalValue) && !norm(item.draftValue)
            ? "Deleted Shift"
            : "Edited Shift",
        weekType: item.week,
        weekOf: weekStartYmd || "",
        date: item.dateStr || "",
        client: item.clientName || "",
        oldValue: item.originalValue,
        newValue: item.draftValue,
        cell: item.a1,
        day: item.dayLabel || "",
        oldStatus: statusFromCellValue(item.originalValue) === "none" ? "" : statusFromCellValue(item.originalValue),
        newStatus: statusFromCellValue(item.draftValue) === "none" ? "" : statusFromCellValue(item.draftValue),
        oldCaregiver: parseCaregiverFromCell(item.originalValue),
        newCaregiver: parseCaregiverFromCell(item.draftValue),
        oldStartTime: parseFirstTimeRange(item.originalValue)?.start ?? "",
        newStartTime: parseFirstTimeRange(item.draftValue)?.start ?? "",
        oldEndTime: parseFirstTimeRange(item.originalValue)?.end ?? "",
        newEndTime: parseFirstTimeRange(item.draftValue)?.end ?? "",
        notes: "Saved from Draft Mode",
        accessPoint: "CWWebSchedule draft save",
      });

      if (item.clientName && item.dateStr) {
        markCellHasEditHistory({
          week: item.week,
          a1: item.a1,
          clientName: item.clientName,
          dateStr: item.dateStr,
        });
      }
    }

    await Promise.all([
      loadGridForWeek(week),
      refreshScheduleMapsForWeek(week),
      refreshScheduleEditLogForWeek(week),
    ]);

    resetDraft();

    setSaveToast({
      id: Date.now(),
      kind: "success",
      title: "Draft schedule saved",
      lines: [`${payload.length} change${payload.length === 1 ? "" : "s"} saved to the sheet.`],
    });
  } catch (err: any) {
    setSaveToast({
      id: Date.now(),
      kind: "error",
      title: "Draft save failed",
      lines: [err?.message ?? "Unable to save draft changes to the sheet."],
    });
  } finally {
    setLoading(false);
  }
}
async function applyBulkStatusChange(args: {
  targetBaseStatus: BulkTargetStatus;
  targetCancelled?: "keep" | boolean;
  caregiverNameOverride?: string | null;
}) {
  const cells = Object.values(selectedBulkCells);

  if (!cells.length) {
    setSaveToast({
      id: Date.now(),
      kind: "warning",
      title: "No shifts selected",
      lines: ["Select one or more shifts first."],
    });
    return;
  }

  try {
    setBulkApplying(true);

    const successes: string[] = [];
    const failures: string[] = [];

    for (const cell of cells) {
      const parsed = parseScheduleShiftCell(cell.originalValue);

      const targetCancelled =
        args.targetCancelled === "keep"
          ? parsed.isCancelled
          : typeof args.targetCancelled === "boolean"
          ? args.targetCancelled
          : parsed.isCancelled;

      const result = convertScheduleShiftStatus({
        rawText: cell.originalValue,
        targetBaseStatus: args.targetBaseStatus,
        caregiverNameOverride: args.caregiverNameOverride ?? undefined,
        targetCancelled,
      });

      if (!result.ok || !result.newText) {
        failures.push(
          `${cell.clientName} • ${cell.dayLabel} • ${result.error || "Conversion failed"}`
        );
        continue;
      }

      if (draftMode) {
        setDraftCell({
          a1: cell.a1,
          week: cell.week,
          originalValue: cell.originalValue,
          draftValue: result.newText,
          clientName: cell.clientName,
          dateStr: cell.dateStr,
          dayLabel: cell.dayLabel,
        });
        successes.push(`${cell.clientName} • ${cell.dayLabel}`);
      } else {
        await saveInlineEdit({
          a1: cell.a1,
          newVal: result.newText,
          clientName: cell.clientName,
          shiftDateForSave: cell.dateStr,
          dayLabel: cell.dayLabel,
          weekOf: weekStartYmd,
        });
        successes.push(`${cell.clientName} • ${cell.dayLabel}`);
      }
    }

    setSaveToast({
      id: Date.now(),
      kind: failures.length ? "warning" : "success",
      title: failures.length
        ? "Bulk update finished with warnings"
        : draftMode
        ? "Bulk draft update complete"
        : "Bulk update complete",
      lines: [
        `${successes.length} shift${successes.length === 1 ? "" : "s"} updated.`,
        ...failures.slice(0, 8),
        ...(failures.length > 8 ? [`+${failures.length - 8} more issue(s)`] : []),
      ],
    });

    clearBulkSelection();
  } catch (err: any) {
    setSaveToast({
      id: Date.now(),
      kind: "error",
      title: "Bulk update failed",
      lines: [err?.message ?? "Unable to apply bulk changes."],
    });
  } finally {
    setBulkApplying(false);
  }
}
async function handleOpenEditHistory(payload: EditHistoryOpenPayload) {
  const nextTarget: EditHistoryModalTarget = {
    a1: payload.a1Key,
    clientName: payload.clientName,
    dateStr: payload.dateStr,
    dayLabel: DOW_LABELS[toDateSafe(payload.dateStr)?.getDay() ?? 0] || "",
    week: payload.week,
    shiftId: payload.shiftId,
    caregiverName: payload.caregiverName,
    startTime: payload.startTime,
    endTime: payload.endTime,
    status: payload.status,
  };

  setEditHistoryModalTarget(nextTarget);
  setEditHistoryError(null);
  setShiftRateError(null);

  await Promise.all([
    refreshScheduleEditLogForWeek(payload.week),
    loadShiftRateForTarget(nextTarget),
  ]);
}


    async function handleSaveShiftRate() {
  if (!editHistoryModalTarget?.shiftId) return;

  if (!finalShiftRateReason) {
  setShiftRateError("Please select or enter a reason.");
  return;
}

  if (!shiftRateHours || shiftRateHours <= 0) {
    setShiftRateError("This shift does not have valid hours for rate calculation.");
    return;
  }

  const parsedTotal = parseMoneyInput(shiftRateTotalValue);
  if (parsedTotal == null) {
    setShiftRateError("Please enter the total pay for the entire shift.");
    return;
  }

  if (parsedTotal < 0) {
    setShiftRateError("Total shift pay must be a valid positive number.");
    return;
  }

  const calculatedRate = parsedTotal / shiftRateHours;
  if (!Number.isFinite(calculatedRate) || calculatedRate < 0) {
    setShiftRateError("Calculated hourly rate is invalid.");
    return;
  }

  try {
    setShiftRateSaving(true);
    setShiftRateError(null);

    await saveShiftRate({
  shiftId: editHistoryModalTarget.shiftId,
  newRate: calculatedRate,
  shiftTotal: parsedTotal,
  updatedBy: currentUserName,
  reason: finalShiftRateReason,
});

    await loadShiftRateForTarget(editHistoryModalTarget);
    await refreshScheduleEditLogForWeek(editHistoryModalTarget.week);

    setSaveToast({
      id: Date.now(),
      kind: "success",
      title: "Shift rate saved",
      lines: [
        `${editHistoryModalTarget.clientName} • ${formatTimeRangeForDisplay(
          editHistoryModalTarget.startTime,
          editHistoryModalTarget.endTime
        )}`,
        `Shift total: $${parsedTotal.toFixed(2)}`,
        `Hourly rate: $${calculatedRate.toFixed(2)}`,
     `Reason: ${finalShiftRateReason}`,
      ],
    });
  } catch (err: any) {
    setShiftRateError(err?.message || "Failed to save shift rate.");
  } finally {
    setShiftRateSaving(false);
  }
}

async function handleCaregiverDropToShift(args: {
  dropEvent: React.DragEvent<HTMLElement>;
  a1: string;
  clientName: string;
  dateStrForDow: string;
  dayLabel: string;
  originalCellValue: string;
}) {
  const { dropEvent, a1, clientName, dateStrForDow, dayLabel, originalCellValue } = args;

  dropEvent.preventDefault();
  setDragOverA1(null);

  let payload: any = null;

  try {
    const json = dropEvent.dataTransfer.getData("application/json");
    payload = json ? JSON.parse(json) : null;
  } catch {
    payload = null;
  }

  const caregiverName =
    norm(payload?.nameOnSchedule) ||
    norm(payload?.caregiverName) ||
    norm(dropEvent.dataTransfer.getData("text/plain"));

  if (!caregiverName) {
    setSaveToast({
      id: Date.now(),
      kind: "error",
      title: "Drop failed",
      lines: ["No caregiver name was found in the drag payload."],
    });
    return;
  }

  const newValue = buildConsideringShiftValueFromExisting({
    existingValue: originalCellValue,
    caregiverName,
  });

  if (!newValue) {
    setSaveToast({
      id: Date.now(),
      kind: "error",
      title: "Drop failed",
      lines: ["This shift could not be converted into a considering shift."],
    });
    return;
  }

  if (draftMode) {
    setDraftCell({
      a1,
      week,
      originalValue: originalCellValue,
      draftValue: newValue,
      clientName,
      dateStr: dateStrForDow,
      dayLabel,
    });

    showDraftShiftFeedback({
      a1,
      oldValue: originalCellValue,
      newValue,
      clientName,
      shiftDateForSave: dateStrForDow,
      dayLabel,
    });

    return;
  }

  await saveInlineEdit({
    a1,
    newVal: newValue,
    clientName,
    shiftDateForSave: dateStrForDow,
    dayLabel,
    weekOf: weekStartYmd,
  });
}
    return (
  <main
  style={{
    padding: 18,
    width: "100%",
    maxWidth: "none",
    margin: 0,
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
            <div style={{ fontSize: 13, fontWeight: 1000 }}>{saveToast.title}</div>

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
        position: "relative",
        zIndex: TOPNAV_Z,
      }}
    >
          <TopNav
  week={week}
  currentUserName={currentUserName}
  currentUserEmail={currentUserEmail}
  portalUsersOnline={portalUsersOnline}
  right={
    <>
      <button
        type="button"
        onClick={() => setGanglionOpen(true)}
        style={{
          border: `1px solid ${UI.border}`,
          background: UI.panelBg,
          color: UI.text,
          borderRadius: 10,
          padding: "8px 12px",
          fontWeight: 900,
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
        title="Open Supraesophageal Ganglion workpad"
      >
        🧠 Workpad
      </button>

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

            <button
              type="button"
              onClick={handlePublishSchedule}
              disabled={publishingSchedule || loading || hasDraftChanges}
              style={{
                border: `1px solid ${UI.border}`,
                background:
                  publishingSchedule || loading || hasDraftChanges
                    ? "#f3f4f6"
                    : "#f4b400",
                color:
                  publishingSchedule || loading || hasDraftChanges
                    ? "#9ca3af"
                    : "#111827",
                borderRadius: 10,
                padding: "7px 10px",
                fontSize: 13,
                cursor:
                  publishingSchedule || loading || hasDraftChanges
                    ? "default"
                    : "pointer",
                fontWeight: 1000,
                opacity: publishingSchedule || loading || hasDraftChanges ? 0.7 : 1,
              }}
              title={
                hasDraftChanges
                  ? "Save or reset draft changes before publishing."
                  : week === "cw"
                  ? "Publish Current Week to All Shifts"
                  : "Publish Next Week to NW All Shifts"
              }
            >
              {publishingSchedule
                ? "Publishing..."
                : week === "cw"
                ? "Publish Current Week"
                : "Publish Next Week"}
            </button>

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

           <button
  type="button"
  onClick={() => setPanelOpen((v) => !v)}
  style={{
    border: `1px solid ${UI.border}`,
    background: panelOpen ? "#111827" : "#f4b400",
    color: panelOpen ? "#fff" : "#111827",
    borderRadius: 10,
    padding: "7px 10px",
    fontSize: 13,
    cursor: "pointer",
    fontWeight: 900,
  }}
  title={panelOpen ? "Close caregiver panel" : "Open caregiver panel"}
>
  {panelOpen ? "Close Caregiver Panel" : "Open Caregiver Panel"}
</button>
            <button
              type="button"
              onClick={toggleDraftMode}
              style={{
                border: `1px solid ${draftMode ? "#111827" : UI.border}`,
                background: draftMode ? "#111827" : UI.headerBg,
                color: draftMode ? "#fff" : UI.text,
                borderRadius: 10,
                padding: "7px 10px",
                fontSize: 13,
                cursor: "pointer",
                fontWeight: 900,
              }}
              title="Toggle Draft Mode"
            >
              Draft Mode: {draftMode ? "ON" : "OFF"}
            </button>

            <button
              type="button"
              onClick={() => {
                setBulkMode((v) => !v);
                setSelectedBulkCells({});
                setBulkSelectionMode("caregiver");
                setBulkSmartCaregiver("");
                setBulkSmartClient("");
                setBulkSmartStatus("Any");
                setShowCaregiverSuggestions(false);
                setShowClientSuggestions(false);
              }}
              style={{
                border: `1px solid ${bulkMode ? "#111827" : UI.border}`,
                background: bulkMode ? "#111827" : UI.headerBg,
                color: bulkMode ? "#fff" : UI.text,
                borderRadius: 10,
                padding: "7px 10px",
                fontSize: 13,
                cursor: "pointer",
                fontWeight: 900,
              }}
              title="Toggle Bulk Edit Mode"
            >
              Bulk Edit: {bulkMode ? "ON" : "OFF"}
            </button>

            {draftMode ? (
              <>
                <button
                  type="button"
                  onClick={undo}
                  disabled={!canUndo}
                  style={{
                    border: `1px solid ${UI.border}`,
                    background: canUndo ? UI.headerBg : "#f3f4f6",
                    color: canUndo ? UI.text : "#9ca3af",
                    borderRadius: 10,
                    padding: "7px 10px",
                    fontSize: 13,
                    cursor: canUndo ? "pointer" : "default",
                    fontWeight: 900,
                  }}
                >
                  Undo
                </button>

                <button
                  type="button"
                  onClick={redo}
                  disabled={!canRedo}
                  style={{
                    border: `1px solid ${UI.border}`,
                    background: canRedo ? UI.headerBg : "#f3f4f6",
                    color: canRedo ? UI.text : "#9ca3af",
                    borderRadius: 10,
                    padding: "7px 10px",
                    fontSize: 13,
                    cursor: canRedo ? "pointer" : "default",
                    fontWeight: 900,
                  }}
                >
                  Redo
                </button>

                <button
                  type="button"
                  onClick={resetDraft}
                  disabled={!hasDraftChanges}
                  style={{
                    border: `1px solid ${UI.border}`,
                    background: hasDraftChanges ? UI.headerBg : "#f3f4f6",
                    color: hasDraftChanges ? UI.text : "#9ca3af",
                    borderRadius: 10,
                    padding: "7px 10px",
                    fontSize: 13,
                    cursor: hasDraftChanges ? "pointer" : "default",
                    fontWeight: 900,
                  }}
                >
                  Reset Draft
                </button>

                <button
                  type="button"
                  onClick={saveDraftScheduleToSheet}
                  disabled={!hasDraftChanges}
                  style={{
                    border: "1px solid #111827",
                    background: hasDraftChanges ? "#111827" : "#9ca3af",
                    color: "#fff",
                    borderRadius: 10,
                    padding: "7px 10px",
                    fontSize: 13,
                    cursor: hasDraftChanges ? "pointer" : "default",
                    fontWeight: 900,
                  }}
                >
                  Save Schedule{hasDraftChanges ? ` (${changedCellCount})` : ""}
                </button>
              </>
            ) : null}

            <button
              type="button"
              onClick={async () => {
                try {
                  setLoading(true);
                  setError(null);
                  setExpandedA1ByWeek((prev) => ({ ...prev, [week]: new Set() }));
                  setEditingA1(null);
                  setDraftByA1({});
                  setSelectedBulkCells({});
                  resetDraft();
                  await loadGridForWeek(week);
                  await Promise.all([
                    refreshScheduleMapsForWeek(week),
                    refreshCaregivers(),
                    refreshApplicants(),
                    refreshClients(),
                    refreshGhostShiftsForWeek(week),
                    refreshScheduleEditLogForWeek(week),
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

          <span style={{ marginLeft: 10, fontSize: 12, color: UI.textDim }}>
            (Portal user:{" "}
            {sessionStatus === "loading"
              ? "loading…"
              : currentUserEmail
              ? `${currentUserName}${currentUserEmail ? ` • ${currentUserEmail}` : ""}`
              : "not signed in"})
          </span>

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

    <div
      style={{
        marginTop: 10,
        display: "flex",
        gap: 10,
        alignItems: "center",
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <DayChip label="All Days" active={selectedDow == null} onClick={() => setSelectedDow(null)} />
        {DOW_LABELS.map((d, idx) => (
          <DayChip
            key={d}
            label={d}
            active={selectedDow === idx}
            onClick={() => setSelectedDow(idx)}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={() => setOnboardingOpen(true)}
        style={{
          border: `1px solid ${UI.border}`,
          background: onboardingOpen ? "#111827" : UI.panelBg,
          color: onboardingOpen ? "#fff" : UI.text,
          borderRadius: 999,
          padding: "6px 12px",
          fontSize: 12,
          cursor: "pointer",
          fontWeight: 900,
          whiteSpace: "nowrap",
        }}
        title="Open onboarding panel"
      >
        Onboarding
      </button>

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

    <div
      style={{
        marginTop: 10,
        display: "flex",
        gap: 10,
        flexWrap: "wrap",
        alignItems: "center",
      }}
    >
     <div
  style={{
    background: UI.panelBg,
    border: `1px solid ${UI.border}`,
    borderRadius: 12,
    padding: "8px 10px",
  }}
>
  <div style={{ fontSize: 11, color: UI.textDim, fontWeight: 800 }}>Filled Hours</div>
  <div style={{ fontSize: 16, fontWeight: 900 }}>{totals.totalHours.toFixed(1)}</div>
</div>

<div
  style={{
    background: UI.panelBg,
    border: `1px solid ${UI.border}`,
    borderRadius: 12,
    padding: "8px 10px",
  }}
>
  <div style={{ fontSize: 11, color: UI.textDim, fontWeight: 800 }}>Clients</div>
  <div style={{ fontSize: 16, fontWeight: 900 }}>{totals.clientCount}</div>
</div>

<div
  style={{
    background: UI.panelBg,
    border: `1px solid ${UI.border}`,
    borderRadius: 12,
    padding: "8px 10px",
  }}
>
  <div style={{ fontSize: 11, color: UI.textDim, fontWeight: 800 }}>Caregivers</div>
  <div style={{ fontSize: 16, fontWeight: 900 }}>{totals.caregiverCount}</div>
</div>

<div
  style={{
    background: UI.panelBg,
    border: `1px solid ${UI.border}`,
    borderRadius: 12,
    padding: "8px 10px",
  }}
>
  <div style={{ fontSize: 11, color: UI.textDim, fontWeight: 800 }}>Flagged Shifts</div>
  <div style={{ fontSize: 16, fontWeight: 900 }}>{flaggedShiftsTotal}</div>
</div>

<div
  style={{
    marginLeft: "auto",
    display: "flex",
    gap: 10,
    alignItems: "center",
    flexWrap: "wrap",
  }}
>
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

    {draftMode ? (
      <div
        style={{
          marginTop: 12,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          padding: "10px 12px",
          borderRadius: 12,
          border: "1px solid #cbd5e1",
          background: "#eff6ff",
        }}
      >
        <div>
          <div style={{ fontSize: 13, fontWeight: 1000, color: "#111827" }}>Draft Mode is ON</div>
          <div style={{ fontSize: 12, color: "#475569", marginTop: 2 }}>
            Changes stay in the portal until you click Save Schedule.
          </div>
        </div>

        <div style={{ fontSize: 12, fontWeight: 900, color: "#1e3a8a" }}>
          {hasDraftChanges
            ? `${changedCellCount} unsaved draft change${changedCellCount === 1 ? "" : "s"}`
            : "No draft changes yet"}
        </div>
      </div>
    ) : null}

    {bulkMode ? (
      <div
        style={{
          marginTop: 12,
          display: "grid",
          gap: 12,
          padding: "12px",
          borderRadius: 12,
          border: `1px solid ${UI.border}`,
          background: UI.panelBg,
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 1000, color: UI.text }}>Bulk Edit Mode</div>

          <div style={{ fontSize: 12, fontWeight: 900, color: UI.textDim }}>
            {selectedBulkCount} selected
          </div>

          <button
            type="button"
            onClick={selectAllVisibleShifts}
            style={{
              border: `1px solid ${UI.border}`,
              background: UI.headerBg,
              color: UI.text,
              borderRadius: 10,
              padding: "6px 10px",
              fontSize: 12,
              cursor: "pointer",
              fontWeight: 900,
            }}
          >
            Select All Visible
          </button>

          <button
            type="button"
            onClick={clearBulkSelection}
            disabled={!selectedBulkCount}
            style={{
              border: `1px solid ${UI.border}`,
              background: selectedBulkCount ? UI.headerBg : "#f3f4f6",
              color: selectedBulkCount ? UI.text : "#9ca3af",
              borderRadius: 10,
              padding: "6px 10px",
              fontSize: 12,
              cursor: selectedBulkCount ? "pointer" : "default",
              fontWeight: 900,
            }}
          >
            Clear Selection
          </button>
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 900, color: UI.textDim }}>
            Step 1: Choose how to find shifts
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => resetBulkSearchUi("caregiver")}
              style={{
                border: `1px solid ${bulkSelectionMode === "caregiver" ? "#111827" : UI.border}`,
                background: bulkSelectionMode === "caregiver" ? "#111827" : UI.headerBg,
                color: bulkSelectionMode === "caregiver" ? "#fff" : UI.text,
                borderRadius: 10,
                padding: "6px 10px",
                fontSize: 12,
                cursor: "pointer",
                fontWeight: 900,
              }}
            >
              By Caregiver
            </button>

            <button
              type="button"
              onClick={() => resetBulkSearchUi("client")}
              style={{
                border: `1px solid ${bulkSelectionMode === "client" ? "#111827" : UI.border}`,
                background: bulkSelectionMode === "client" ? "#111827" : UI.headerBg,
                color: bulkSelectionMode === "client" ? "#fff" : UI.text,
                borderRadius: 10,
                padding: "6px 10px",
                fontSize: 12,
                cursor: "pointer",
                fontWeight: 900,
              }}
            >
              By Client
            </button>

            <button
              type="button"
              onClick={() => resetBulkSearchUi("status")}
              style={{
                border: `1px solid ${bulkSelectionMode === "status" ? "#111827" : UI.border}`,
                background: bulkSelectionMode === "status" ? "#111827" : UI.headerBg,
                color: bulkSelectionMode === "status" ? "#fff" : UI.text,
                borderRadius: 10,
                padding: "6px 10px",
                fontSize: 12,
                cursor: "pointer",
                fontWeight: 900,
              }}
            >
              By Status
            </button>

            <button
              type="button"
              onClick={() => resetBulkSearchUi("manual")}
              style={{
                border: `1px solid ${bulkSelectionMode === "manual" ? "#111827" : UI.border}`,
                background: bulkSelectionMode === "manual" ? "#111827" : UI.headerBg,
                color: bulkSelectionMode === "manual" ? "#fff" : UI.text,
                borderRadius: 10,
                padding: "6px 10px",
                fontSize: 12,
                cursor: "pointer",
                fontWeight: 900,
              }}
            >
              Manual Select
            </button>
          </div>
        </div>

        {bulkSelectionMode === "caregiver" ? (
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 900, color: UI.textDim }}>
              Step 2: Choose caregiver
            </div>

            <div style={{ position: "relative", maxWidth: 320 }}>
              <input
                value={bulkSmartCaregiver}
                onChange={(e) => {
                  setBulkSmartCaregiver(e.target.value);
                  setShowCaregiverSuggestions(true);
                }}
                onFocus={() => setShowCaregiverSuggestions(true)}
                placeholder="Search caregiver…"
                style={{
                  width: "100%",
                  border: `1px solid ${UI.border}`,
                  borderRadius: 10,
                  padding: "8px 10px",
                  fontSize: 12,
                  outline: "none",
                  background: UI.panelBg,
                  boxSizing: "border-box",
                }}
              />

              {showCaregiverSuggestions && bulkCaregiverSuggestions.length > 0 ? (
                <div
                  style={{
                    position: "absolute",
                    top: "calc(100% + 4px)",
                    left: 0,
                    right: 0,
                    background: "#fff",
                    border: `1px solid ${UI.border}`,
                    borderRadius: 10,
                    boxShadow: "0 8px 20px rgba(0,0,0,0.12)",
                    zIndex: 40,
                    overflow: "hidden",
                  }}
                >
                  {bulkCaregiverSuggestions.map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => {
                        setBulkSmartCaregiver(name);
                        setShowCaregiverSuggestions(false);
                        smartSelectByCaregiverAndStatus(name, bulkSmartStatus);
                      }}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        border: "none",
                        background: "#fff",
                        padding: "9px 10px",
                        fontSize: 12,
                        cursor: "pointer",
                        fontWeight: 800,
                      }}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <select
                value={bulkSmartStatus}
                onChange={(e) => setBulkSmartStatus(e.target.value as BulkSmartStatusFilter)}
                style={{
                  border: `1px solid ${UI.border}`,
                  borderRadius: 10,
                  padding: "8px 10px",
                  fontSize: 12,
                  outline: "none",
                  background: UI.panelBg,
                  fontWeight: 800,
                }}
              >
                <option value="Any">Any status</option>
                <option value="Open">Open</option>
                <option value="Filled">Filled</option>
                <option value="Offered">Offered</option>
                <option value="Considering">Considering</option>
                <option value="PendingClientApproval">Pending Approval</option>
              </select>

              <button
                type="button"
                onClick={() =>
                  smartSelectByCaregiverAndStatus(bulkSmartCaregiver, bulkSmartStatus)
                }
                style={{
                  border: `1px solid ${UI.border}`,
                  background: UI.headerBg,
                  color: UI.text,
                  borderRadius: 10,
                  padding: "8px 10px",
                  fontSize: 12,
                  cursor: "pointer",
                  fontWeight: 900,
                }}
              >
                Select Matching Shifts
              </button>
            </div>
          </div>
        ) : null}

        {bulkSelectionMode === "client" ? (
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 900, color: UI.textDim }}>
              Step 2: Choose client
            </div>

            <div style={{ position: "relative", maxWidth: 320 }}>
              <input
                value={bulkSmartClient}
                onChange={(e) => {
                  setBulkSmartClient(e.target.value);
                  setShowClientSuggestions(true);
                }}
                onFocus={() => setShowClientSuggestions(true)}
                placeholder="Search client…"
                style={{
                  width: "100%",
                  border: `1px solid ${UI.border}`,
                  borderRadius: 10,
                  padding: "8px 10px",
                  fontSize: 12,
                  outline: "none",
                  background: UI.panelBg,
                  boxSizing: "border-box",
                }}
              />

              {showClientSuggestions && bulkClientSuggestions.length > 0 ? (
                <div
                  style={{
                    position: "absolute",
                    top: "calc(100% + 4px)",
                    left: 0,
                    right: 0,
                    background: "#fff",
                    border: `1px solid ${UI.border}`,
                    borderRadius: 10,
                    boxShadow: "0 8px 20px rgba(0,0,0,0.12)",
                    zIndex: 40,
                    overflow: "hidden",
                  }}
                >
                  {bulkClientSuggestions.map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => {
                        setBulkSmartClient(name);
                        setShowClientSuggestions(false);
                        smartSelectByClient(name);
                      }}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        border: "none",
                        background: "#fff",
                        padding: "9px 10px",
                        fontSize: 12,
                        cursor: "pointer",
                        fontWeight: 800,
                      }}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div>
              <button
                type="button"
                onClick={() => smartSelectByClient(bulkSmartClient)}
                style={{
                  border: `1px solid ${UI.border}`,
                  background: UI.headerBg,
                  color: UI.text,
                  borderRadius: 10,
                  padding: "8px 10px",
                  fontSize: 12,
                  cursor: "pointer",
                  fontWeight: 900,
                }}
              >
                Select Matching Shifts
              </button>
            </div>
          </div>
        ) : null}

        {bulkSelectionMode === "status" ? (
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 900, color: UI.textDim }}>
              Step 2: Choose status
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <select
                value={bulkSmartStatus}
                onChange={(e) => setBulkSmartStatus(e.target.value as BulkSmartStatusFilter)}
                style={{
                  border: `1px solid ${UI.border}`,
                  borderRadius: 10,
                  padding: "8px 10px",
                  fontSize: 12,
                  outline: "none",
                  background: UI.panelBg,
                  fontWeight: 800,
                }}
              >
                <option value="Any">Any status</option>
                <option value="Open">Open</option>
                <option value="Filled">Filled</option>
                <option value="Offered">Offered</option>
                <option value="Considering">Considering</option>
                <option value="PendingClientApproval">Pending Approval</option>
              </select>

              <button
                type="button"
                disabled={bulkSmartStatus === "Any"}
                onClick={() => {
                  if (bulkSmartStatus !== "Any") {
                    smartSelectByStatus(bulkSmartStatus);
                  }
                }}
                style={{
                  border: `1px solid ${UI.border}`,
                  background: UI.headerBg,
                  color: bulkSmartStatus === "Any" ? "#9ca3af" : UI.text,
                  borderRadius: 10,
                  padding: "8px 10px",
                  fontSize: 12,
                  cursor: bulkSmartStatus === "Any" ? "default" : "pointer",
                  fontWeight: 900,
                }}
              >
                Select Matching Shifts
              </button>
            </div>
          </div>
        ) : null}

        {bulkSelectionMode === "manual" ? (
          <div style={{ fontSize: 12, color: UI.textDim, fontWeight: 800 }}>
            Step 2: Click schedule cells directly to select them.
          </div>
        ) : null}

        {selectedBulkCount > 0 ? (
          <div
            style={{
              display: "grid",
              gap: 10,
              paddingTop: 8,
              borderTop: `1px solid ${UI.borderSoft}`,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 900, color: UI.textDim }}>
              Step 3: Choose what to change
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <select
                value={bulkCancelledTarget}
                onChange={(e) => setBulkCancelledTarget(e.target.value as any)}
                style={{
                  border: `1px solid ${UI.border}`,
                  borderRadius: 10,
                  padding: "8px 10px",
                  fontSize: 12,
                  outline: "none",
                  background: UI.panelBg,
                  fontWeight: 800,
                }}
                title="Cancelled state behavior"
              >
                <option value="keep">Keep cancelled state</option>
                <option value="cancelled">Make cancelled</option>
                <option value="not_cancelled">Remove cancelled</option>
              </select>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <button
                type="button"
                onClick={() =>
                  applyBulkStatusChange({
                    targetBaseStatus: "Considering",
                    targetCancelled:
                      bulkCancelledTarget === "keep"
                        ? "keep"
                        : bulkCancelledTarget === "cancelled",
                  })
                }
                disabled={bulkApplying}
                style={{
                  border: `1px solid ${UI.border}`,
                  background: "#fff7ed",
                  color: "#9a3412",
                  borderRadius: 10,
                  padding: "6px 10px",
                  fontSize: 12,
                  cursor: bulkApplying ? "default" : "pointer",
                  fontWeight: 900,
                }}
              >
                Change to Considering
              </button>

              <button
                type="button"
                onClick={() =>
                  applyBulkStatusChange({
                    targetBaseStatus: "Offered",
                    targetCancelled:
                      bulkCancelledTarget === "keep"
                        ? "keep"
                        : bulkCancelledTarget === "cancelled",
                  })
                }
                disabled={bulkApplying}
                style={{
                  border: `1px solid ${UI.border}`,
                  background: "#eff6ff",
                  color: "#1d4ed8",
                  borderRadius: 10,
                  padding: "6px 10px",
                  fontSize: 12,
                  cursor: bulkApplying ? "default" : "pointer",
                  fontWeight: 900,
                }}
              >
                Change to Offered
              </button>

              <button
                type="button"
                onClick={() =>
                  applyBulkStatusChange({
                    targetBaseStatus: "Filled",
                    targetCancelled:
                      bulkCancelledTarget === "keep"
                        ? "keep"
                        : bulkCancelledTarget === "cancelled",
                  })
                }
                disabled={bulkApplying}
                style={{
                  border: `1px solid ${UI.border}`,
                  background: "#ecfdf5",
                  color: "#166534",
                  borderRadius: 10,
                  padding: "6px 10px",
                  fontSize: 12,
                  cursor: bulkApplying ? "default" : "pointer",
                  fontWeight: 900,
                }}
              >
                Change to Filled
              </button>

              <button
                type="button"
                onClick={() =>
                  applyBulkStatusChange({
                    targetBaseStatus: "PendingClientApproval",
                    targetCancelled:
                      bulkCancelledTarget === "keep"
                        ? "keep"
                        : bulkCancelledTarget === "cancelled",
                  })
                }
                disabled={bulkApplying}
                style={{
                  border: `1px solid ${UI.border}`,
                  background: "#faf5ff",
                  color: "#7e22ce",
                  borderRadius: 10,
                  padding: "6px 10px",
                  fontSize: 12,
                  cursor: bulkApplying ? "default" : "pointer",
                  fontWeight: 900,
                }}
              >
                Change to Pending Approval
              </button>

              <button
                type="button"
                onClick={() =>
                  applyBulkStatusChange({
                    targetBaseStatus: "Open",
                    targetCancelled:
                      bulkCancelledTarget === "keep"
                        ? "keep"
                        : bulkCancelledTarget === "cancelled",
                  })
                }
                disabled={bulkApplying}
                style={{
                  border: `1px solid ${UI.border}`,
                  background: "#fef2f2",
                  color: "#b91c1c",
                  borderRadius: 10,
                  padding: "6px 10px",
                  fontSize: 12,
                  cursor: bulkApplying ? "default" : "pointer",
                  fontWeight: 900,
                }}
              >
                Change to Open
              </button>
            </div>
          </div>
        ) : null}

        <div style={{ fontSize: 11, color: UI.textDim, fontWeight: 800 }}>
          Bulk mode now works in steps: choose a filter, select shifts, then choose the change.
        </div>
      </div>
    ) : null}

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

        <Modal
  open={insertRowModal.open}
  title="Add Schedule Row"
  onClose={closeInsertRowModal}
>
  <div style={{ display: "grid", gap: 14 }}>
    <div style={{ fontSize: 12, color: UI.textDim, lineHeight: 1.4 }}>
      {insertRowModal.anchorClientName ? (
        <>
          Add a row above or below <strong>{insertRowModal.anchorClientName}</strong>.
          Column A will start with that client name.
        </>
      ) : (
        <>Choose where to add the row.</>
      )}
    </div>

    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button
        type="button"
        onClick={() => setInsertRowPosition("above")}
        disabled={insertRowSaving}
        style={{
          border: `1px solid ${
            insertRowModal.position === "above" ? "#111827" : UI.border
          }`,
          background:
            insertRowModal.position === "above" ? "#111827" : UI.panelBg,
          color: insertRowModal.position === "above" ? "#fff" : UI.text,
          borderRadius: 999,
          padding: "7px 12px",
          fontSize: 12,
          fontWeight: 900,
          cursor: insertRowSaving ? "default" : "pointer",
        }}
      >
        Add Above
      </button>

      <button
        type="button"
        onClick={() => setInsertRowPosition("below")}
        disabled={insertRowSaving}
        style={{
          border: `1px solid ${
            insertRowModal.position === "below" ? "#111827" : UI.border
          }`,
          background:
            insertRowModal.position === "below" ? "#111827" : UI.panelBg,
          color: insertRowModal.position === "below" ? "#fff" : UI.text,
          borderRadius: 999,
          padding: "7px 12px",
          fontSize: 12,
          fontWeight: 900,
          cursor: insertRowSaving ? "default" : "pointer",
        }}
      >
        Add Below
      </button>
    </div>

    <div style={{ display: "grid", gap: 6 }}>
      <label
        style={{
          fontSize: 12,
          fontWeight: 900,
          color: UI.text,
        }}
      >
        Client Name
      </label>
      <input
        type="text"
        value={insertRowModal.clientName}
        onChange={(e) =>
          setInsertRowModal((prev) => ({
            ...prev,
            clientName: e.target.value,
          }))
        }
        onKeyDown={(e) => {
          if (e.key === "Enter" && !insertRowSaving) {
            e.preventDefault();
            handleInsertRowSubmit();
          }
        }}
        placeholder="Enter client name"
        autoFocus
        style={{
          border: `1px solid ${UI.border}`,
          borderRadius: 10,
          padding: "10px 12px",
          fontSize: 13,
          outline: "none",
          background: "#fff",
          color: UI.text,
        }}
      />
    </div>

    <div style={{ fontSize: 12, color: UI.textDim }}>
      Insert at sheet row: <strong>{insertRowModal.insertAtRow ?? "—"}</strong>
    </div>

    <div
      style={{
        display: "flex",
        justifyContent: "flex-end",
        gap: 8,
      }}
    >
      <button
        type="button"
        onClick={closeInsertRowModal}
        disabled={insertRowSaving}
        style={{
          border: `1px solid ${UI.border}`,
          background: UI.panelBg,
          color: UI.text,
          borderRadius: 10,
          padding: "8px 12px",
          fontSize: 12,
          fontWeight: 900,
          cursor: insertRowSaving ? "default" : "pointer",
        }}
      >
        Cancel
      </button>

      <button
        type="button"
        onClick={handleInsertRowSubmit}
        disabled={insertRowSaving}
        style={{
          border: `1px solid ${UI.border}`,
          background: "#111827",
          color: "#fff",
          borderRadius: 10,
          padding: "8px 12px",
          fontSize: 12,
          fontWeight: 900,
          cursor: insertRowSaving ? "default" : "pointer",
        }}
      >
        {insertRowSaving
          ? "Adding..."
          : insertRowModal.position === "above"
          ? "Add Above"
          : "Add Below"}
      </button>
    </div>
  </div>
</Modal>
  <Modal
  open={clientProfileOpen}
  title={`Client Profile • ${clientProfileName || "Client"}`}
  onClose={() => {
    setClientProfileOpen(false);
    setClientProfileName("");
    setClientProfileEditMode(false);
    setClientDescriptionDraft("");
    setClientDescriptionError(null);
    setClientDescriptionSavedAt("");
  }}
>
  {(() => {
    const key = normalizeKey(clientProfileName);
    const p = key ? clientsByName[key] : undefined;

    const name = p?.name || clientProfileName || "Client";
    const location = norm(p?.location);
    const description = norm(p?.description);
    const rate = norm(p?.rate);

    const clientHistory = buildClientHistoryList({
      clientName: name,
      historicalRows: histRows,
      caregiversById,
      idByNameOnSchedule,
    });

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
                flexWrap: "wrap",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 950, color: UI.textDim }}>
                  Client
                </div>
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

              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
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

                {!clientProfileEditMode ? (
                  <button
                    type="button"
                    onClick={() => {
                      setClientProfileEditMode(true);
                      setClientDescriptionDraft(description);
                      setClientDescriptionError(null);
                      setClientDescriptionSavedAt("");
                    }}
                    style={{
                      border: `1px solid ${UI.border}`,
                      background: UI.panelBg,
                      borderRadius: 10,
                      padding: "6px 10px",
                      cursor: "pointer",
                      fontWeight: 900,
                      fontSize: 12,
                      whiteSpace: "nowrap",
                    }}
                  >
                    Edit Description
                  </button>
                ) : null}
              </div>
            </div>

            {location ? (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 11.5, fontWeight: 950, color: UI.textDim }}>
                  Location
                </div>
                <div
                  style={{
                    marginTop: 3,
                    fontSize: 13,
                    color: UI.text,
                    whiteSpace: "pre-wrap",
                    lineHeight: 1.35,
                  }}
                >
                  {location}
                </div>
              </div>
            ) : null}

            <div style={{ marginTop: 10 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <div style={{ fontSize: 11.5, fontWeight: 950, color: UI.textDim }}>
                  Description
                </div>

                {clientDescriptionSavedAt ? (
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 900,
                      color: "#065f46",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Saved
                  </div>
                ) : null}
              </div>

              {!clientProfileEditMode ? (
                <div
                  style={{
                    marginTop: 3,
                    fontSize: 13,
                    color: UI.text,
                    whiteSpace: "pre-wrap",
                    lineHeight: 1.35,
                  }}
                >
                  {description || "—"}
                </div>
              ) : (
                <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                  <textarea
                    value={clientDescriptionDraft}
                    onChange={(e) => setClientDescriptionDraft(e.target.value)}
                    rows={8}
                    style={{
                      width: "100%",
                      resize: "vertical",
                      border: `1px solid ${UI.border}`,
                      borderRadius: 12,
                      padding: 10,
                      fontSize: 13,
                      color: UI.text,
                      background: "#fff",
                      lineHeight: 1.4,
                    }}
                  />

                  {clientDescriptionError ? (
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 900,
                        color: "#b91c1c",
                      }}
                    >
                      {clientDescriptionError}
                    </div>
                  ) : null}

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      gap: 8,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setClientProfileEditMode(false);
                        setClientDescriptionDraft(description);
                        setClientDescriptionError(null);
                        setClientDescriptionSavedAt("");
                      }}
                      disabled={clientDescriptionSaving}
                      style={{
                        border: `1px solid ${UI.border}`,
                        background: UI.panelBg,
                        color: UI.text,
                        borderRadius: 10,
                        padding: "8px 12px",
                        fontSize: 12,
                        fontWeight: 900,
                        cursor: clientDescriptionSaving ? "default" : "pointer",
                      }}
                    >
                      Cancel
                    </button>

                    <button
                      type="button"
                      onClick={handleSaveClientDescription}
                      disabled={clientDescriptionSaving}
                      style={{
                        border: `1px solid ${UI.border}`,
                        background: "#111827",
                        color: "#fff",
                        borderRadius: 10,
                        padding: "8px 12px",
                        fontSize: 12,
                        fontWeight: 900,
                        cursor: clientDescriptionSaving ? "default" : "pointer",
                      }}
                    >
                      {clientDescriptionSaving ? "Saving..." : "Save Description"}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div style={{ marginTop: 14 }}>
              <div
                style={{
                  fontSize: 11.5,
                  fontWeight: 950,
                  color: UI.textDim,
                }}
              >
                Caregiver History
              </div>

              {histLoading ? (
                <div style={{ marginTop: 6, fontSize: 12, color: UI.textDim }}>
                  Loading caregiver history...
                </div>
              ) : histError ? (
                <div
                  style={{
                    marginTop: 6,
                    fontSize: 12,
                    fontWeight: 900,
                    color: "salmon",
                  }}
                >
                  Historical data error: {histError}
                </div>
              ) : clientHistory.length === 0 ? (
                <div style={{ marginTop: 6, fontSize: 12, color: UI.textDim }}>
                  No caregiver history found.
                </div>
              ) : (
                <div
                  style={{
                    marginTop: 8,
                    display: "grid",
                    gap: 8,
                  }}
                >
                 {clientHistory.map((item) => {
  const caregiverId = norm(item.caregiverId);
  const caregiverNameKey = normalizeKey(item.caregiverName);

  const isScheduledActive = scheduleRows.some((s) => {
    if (norm(s.status).toLowerCase().includes("cancel")) return false;

    const rowCaregiverId = norm(s.caregiverId);
    const rowCaregiverNameKey = normalizeKey(s.caregiver);

    if (caregiverId && rowCaregiverId) {
      return caregiverId === rowCaregiverId;
    }

    return caregiverNameKey && caregiverNameKey === rowCaregiverNameKey;
  });

  return (
    <div
      key={`${item.caregiverId || item.caregiverName}__${item.lastDate}`}
      style={{
        border: `1px solid ${UI.borderSoft}`,
        borderRadius: 12,
        padding: "10px 12px",
        background: "#f8fafc",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 12,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
            minWidth: 0,
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: 900,
              color: UI.text,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={item.caregiverName}
          >
            {item.caregiverName}
          </div>

          <div
            style={{
              fontSize: 10.5,
              fontWeight: 950,
              padding: "4px 8px",
              borderRadius: 999,
              border: `1px solid ${
                isScheduledActive ? "rgba(16,185,129,0.35)" : "rgba(239,68,68,0.35)"
              }`,
              background: isScheduledActive
                ? "rgba(16,185,129,0.12)"
                : "rgba(239,68,68,0.12)",
              color: isScheduledActive ? "#065f46" : "#b91c1c",
              whiteSpace: "nowrap",
            }}
          >
            {isScheduledActive ? "Active" : "Inactive"}
          </div>
        </div>

        <div
          style={{
            marginTop: 2,
            fontSize: 11.5,
            color: UI.textDim,
          }}
        >
          Last worked: {item.lastDate || "—"}
        </div>
      </div>

      <div
        style={{
          flex: "0 0 auto",
          fontSize: 12,
          fontWeight: 950,
          padding: "6px 10px",
          borderRadius: 999,
          border: `1px solid ${UI.borderSoft}`,
          background: "#fff",
          color: UI.text,
          whiteSpace: "nowrap",
        }}
      >
        {item.visitCount} visit{item.visitCount === 1 ? "" : "s"}
      </div>
    </div>
  );
})}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  })()}
</Modal>

   <Modal
  open={Boolean(editHistoryModalTarget)}
  title={
    editHistoryModalTarget
      ? `Edit History + Rate • ${editHistoryModalTarget.clientName} • ${editHistoryModalTarget.dayLabel}`
      : "Edit History + Rate"
  }
  onClose={() => {
    setEditHistoryModalTarget(null);
    setShiftRateError(null);
    setShiftRateReason("");
    setShiftRateCustomReason("");
  }}
>
  {editHistoryModalTarget ? (
    <div style={{ display: "grid", gap: 10 }}>
      <div
        style={{
          border: `1px solid ${UI.borderSoft}`,
          borderRadius: 12,
          padding: 12,
          background: "rgba(255,255,255,0.88)",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
            gap: 12,
            alignItems: "start",
          }}
        >
          <div>
            <div style={{ fontSize: 11, fontWeight: 950, color: UI.textDim }}>Cell</div>
            <div style={{ marginTop: 3, fontSize: 14, fontWeight: 950 }}>
              {editHistoryModalTarget.a1}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 950, color: UI.textDim }}>Client</div>
            <div style={{ marginTop: 3, fontSize: 14, fontWeight: 900 }}>
              {editHistoryModalTarget.clientName}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 950, color: UI.textDim }}>Date</div>
            <div style={{ marginTop: 3, fontSize: 14, fontWeight: 900 }}>
              {editHistoryModalTarget.dateStr}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 950, color: UI.textDim }}>Time</div>
            <div style={{ marginTop: 3, fontSize: 14, fontWeight: 900 }}>
              {formatTimeRangeForDisplay(
                editHistoryModalTarget.startTime,
                editHistoryModalTarget.endTime
              )}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 950, color: UI.textDim }}>Caregiver</div>
            <div style={{ marginTop: 3, fontSize: 14, fontWeight: 900 }}>
              {editHistoryModalTarget.caregiverName || "Open"}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 950, color: UI.textDim }}>Week</div>
            <div style={{ marginTop: 3, fontSize: 14, fontWeight: 900 }}>
              {editHistoryModalTarget.week.toUpperCase()}
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          border: `1px solid ${UI.borderSoft}`,
          borderRadius: 12,
          padding: 12,
          background: "#fffdf7",
          display: "grid",
          gap: 10,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 950, color: UI.text }}>
          Shift Rate
        </div>

        {shiftRateLoading ? (
          <div style={{ color: UI.textDim, fontSize: 13, fontWeight: 800 }}>
            Loading shift rate…
          </div>
        ) : (
          <>
            <div
              style={{
                display: "grid",
                gap: 12,
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                  gap: 10,
                }}
              >
                <div
                  style={{
                    border: `1px solid ${UI.borderSoft}`,
                    borderRadius: 10,
                    padding: 10,
                    background: "rgba(248,250,252,0.9)",
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 800, color: UI.textDim }}>
                    Shift Time
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 900, color: UI.text }}>
                    {formatTimeRangeForDisplay(
                      editHistoryModalTarget.startTime,
                      editHistoryModalTarget.endTime
                    )}
                  </div>
                </div>

                <div
                  style={{
                    border: `1px solid ${UI.borderSoft}`,
                    borderRadius: 10,
                    padding: 10,
                    background: "rgba(248,250,252,0.9)",
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 800, color: UI.textDim }}>
                    Total Hours
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 900, color: UI.text }}>
                    {shiftRateHours > 0 ? shiftRateHours.toFixed(2) : "—"}
                  </div>
                </div>

                <div
                  style={{
                    border: `1px solid ${UI.borderSoft}`,
                    borderRadius: 10,
                    padding: 10,
                    background: "rgba(248,250,252,0.9)",
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 800, color: UI.textDim }}>
                    Calculated Hourly Rate
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 900, color: UI.text }}>
                    {shiftRateCalculatedHourly != null
                      ? `$${shiftRateCalculatedHourly.toFixed(2)}`
                      : shiftRateParsedHourly != null
                      ? `$${shiftRateParsedHourly.toFixed(2)}`
                      : "—"}
                  </div>
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gap: 8,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 800, color: UI.textDim }}>
                  Reason
                </div>

                <select
                  value={shiftRateReason}
                  onChange={(e) => {
                    const next = e.target.value;
                    setShiftRateReason(next);
                    if (next !== "Other") {
                      setShiftRateCustomReason("");
                    }
                  }}
                  style={{
                    width: "100%",
                    border: `1px solid ${UI.border}`,
                    borderRadius: 10,
                    padding: "10px 12px",
                    fontSize: 14,
                    fontWeight: 700,
                    color: UI.text,
                    background: "#fff",
                  }}
                >
                  <option value="">Select a reason</option>
                  {SHIFT_RATE_REASON_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>

                {shiftRateReason === "Other" ? (
                  <input
                    value={shiftRateCustomReason}
                    onChange={(e) => setShiftRateCustomReason(e.target.value)}
                    placeholder="Type custom reason"
                    style={{
                      width: "100%",
                      border: `1px solid ${UI.border}`,
                      borderRadius: 10,
                      padding: "10px 12px",
                      fontSize: 14,
                      fontWeight: 700,
                      color: UI.text,
                      background: "#fff",
                    }}
                  />
                ) : null}
              </div>

              <div
                style={{
                  display: "grid",
                  gap: 6,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 800, color: UI.textDim }}>
                  Hourly Rate
                </div>
                <input
                  value={
                    shiftRateCalculatedHourly != null
                      ? shiftRateCalculatedHourly.toFixed(2)
                      : shiftRateValue
                  }
                  readOnly
                  placeholder="Calculated automatically"
                  style={{
                    width: "100%",
                    border: `1px solid ${UI.border}`,
                    borderRadius: 10,
                    padding: "10px 12px",
                    fontSize: 14,
                    fontWeight: 800,
                    color: UI.text,
                    background: "#f9fafb",
                  }}
                />
              </div>

              <div
                style={{
                  display: "grid",
                  gap: 6,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 800, color: UI.textDim }}>
                  Total Pay for Entire Shift
                </div>
                <input
                  value={shiftRateTotalValue}
                  onChange={(e) => setShiftRateTotalValue(e.target.value)}
                  placeholder="Enter total shift pay"
                  inputMode="decimal"
                  style={{
                    width: "100%",
                    border: `1px solid ${UI.border}`,
                    borderRadius: 10,
                    padding: "10px 12px",
                    fontSize: 14,
                    fontWeight: 800,
                    color: UI.text,
                    background: "#fff",
                  }}
                />
                <div style={{ fontSize: 11, color: UI.textDim, fontWeight: 700 }}>
                  The hourly rate will be calculated automatically from the total and shift hours.
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 12,
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div style={{ fontSize: 12, color: UI.textDim, fontWeight: 700 }}>
                  {shiftRateOriginalValue
                    ? (
                        shiftRateUpdatedAt || shiftRateUpdatedBy
                          ? `Last updated${shiftRateUpdatedBy ? ` by ${shiftRateUpdatedBy}` : ""}${
                              shiftRateUpdatedAt ? ` • ${formatIsoTimestampForDisplay(shiftRateUpdatedAt)}` : ""
                            }`
                          : "Saved shift rate found."
                      )
                    : "No saved shift rate found yet."}
                </div>

                <button
                  type="button"
                  onClick={handleSaveShiftRate}
                  disabled={shiftRateSaving || shiftRateLoading}
                  style={{
                    border: `1px solid ${UI.border}`,
                    background: "#111827",
                    color: "#fff",
                    borderRadius: 10,
                    padding: "8px 12px",
                    cursor: shiftRateSaving || shiftRateLoading ? "default" : "pointer",
                    fontWeight: 900,
                    fontSize: 13,
                    opacity: shiftRateSaving || shiftRateLoading ? 0.7 : 1,
                  }}
                >
                  {shiftRateSaving ? "Saving..." : "Save Rate"}
                </button>
              </div>

              {shiftRateError ? (
                <div
                  style={{
                    border: `1px dashed #fca5a5`,
                    borderRadius: 10,
                    padding: 10,
                    color: "#991b1b",
                    background: "#fef2f2",
                    fontSize: 12.5,
                    fontWeight: 800,
                  }}
                >
                  {shiftRateError}
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>

      {editHistoryLoading ? (
        <div
          style={{
            border: `1px dashed ${UI.border}`,
            borderRadius: 12,
            padding: 12,
            color: UI.textDim,
            fontSize: 13,
            fontWeight: 800,
            background: "rgba(248,250,252,0.9)",
          }}
        >
          Loading edit history…
        </div>
      ) : editHistoryError ? (
        <div
          style={{
            border: `1px dashed #fca5a5`,
            borderRadius: 12,
            padding: 12,
            color: "#991b1b",
            fontSize: 13,
            fontWeight: 800,
            background: "#fef2f2",
          }}
        >
          {editHistoryError}
        </div>
      ) : selectedCellHistoryRows.length === 0 ? (
        <div
          style={{
            border: `1px dashed ${UI.border}`,
            borderRadius: 12,
            padding: 12,
            color: UI.textDim,
            fontSize: 13,
            fontWeight: 800,
            background: "rgba(248,250,252,0.9)",
          }}
        >
          No edit history found for this cell.
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gap: 10,
            maxHeight: "44vh",
            overflowY: "auto",
            paddingRight: 4,
          }}
        >
          {selectedCellHistoryRows.map((row, idx) => (
            <div
              key={`${row.timestamp}-${idx}`}
              style={{
                border: `1px solid ${UI.borderSoft}`,
                borderRadius: 12,
                padding: 12,
                background: idx % 2 === 0 ? "#fff" : "#fafafa",
              }}
            >
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ fontWeight: 900, fontSize: 13 }}>
                  {row.actionType || "Edit"}
                </div>
                <div style={{ fontSize: 12, color: UI.textDim, fontWeight: 700 }}>
                  {row.user || "Unknown user"} • {formatIsoTimestampForDisplay(row.timestamp)}
                </div>
                <div style={{ fontSize: 12.5 }}>
                  <strong>Old:</strong> {row.oldValue || "—"}
                </div>
                <div style={{ fontSize: 12.5 }}>
                  <strong>New:</strong> {row.newValue || "—"}
                </div>
                {row.notes ? (
                  <div style={{ fontSize: 12.5 }}>
                    <strong>Notes:</strong> {row.notes}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  ) : null}
</Modal>

    <OnboardingPanel open={onboardingOpen} onClose={() => setOnboardingOpen(false)} />

    {!loading && !error && data?.ok && (
      <>
       <div
  className="scheduleLayout"
  style={{
    marginTop: 14,
    display: "block",
  }}
>
          <div className="scheduleMain" style={{ minWidth: 0 }}>
            <div
              style={{
                border: `1px solid ${UI.border}`,
                borderRadius: 12,
                background: UI.panelBg,
                overflow: "hidden",
                position: "relative",
              }}
            >
              <div
                style={{
                  overflowX: "auto",
                  overflowY: "visible",
                  WebkitOverflowScrolling: "touch",
                  position: "relative",
                  background: UI.panelBg,
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
                          zIndex: STICKY_DAY_Z + 5,
                          background: UI.headerBg,
                          backgroundClip: "padding-box",
                          boxShadow: `0 1px 0 ${UI.border}`,
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
                            backgroundClip: "padding-box",
                            boxShadow: `0 1px 0 ${UI.border}`,
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
                          zIndex: STICKY_DATE_Z + 5,
                          background: UI.headerBg,
                          backgroundClip: "padding-box",
                          boxShadow: `0 1px 0 ${UI.border}`,
                          textAlign: "left",
                          padding: "8px 12px",
                          borderBottom: `1px solid ${UI.border}`,
                          width: CLIENT_COL_WIDTH,
                          maxWidth: CLIENT_COL_WIDTH,
                          fontSize: 12,
                          color: UI.textDim,
                          borderRight: `1px solid ${UI.borderSoft}`,
                          height: STICKY_DATE_ROW_HEIGHT,
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
                            backgroundClip: "padding-box",
                            boxShadow: `0 1px 0 ${UI.border}`,
                            textAlign: "left",
                            padding: "8px 10px",
                            borderBottom: `1px solid ${UI.border}`,
                            fontSize: 12,
                            color: UI.textDim,
                            borderRight:
                              dow === visibleDows[visibleDows.length - 1]
                                ? "none"
                                : `1px solid ${UI.borderSoft}`,
                            height: STICKY_DATE_ROW_HEIGHT,
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
                                title={
                                  status === "none"
                                    ? undefined
                                    : `Status: ${status} • Double click for profile`
                                }
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
                                  <div
                                    style={{
                                      display: "flex",
                                      gap: 8,
                                      alignItems: "baseline",
                                      minWidth: 0,
                                      flex: "1 1 auto",
                                    }}
                                  >
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

                                  <button
  type="button"
  onClick={() =>
    openInsertRowModal({
      anchorRow: r.row,
      anchorClientName: r.clientName || "",
    })
  }
  title={`Add row near ${r.clientName || "this row"}`}
  aria-label={`Add row near ${r.clientName || "this row"}`}
  style={{
    width: 22,
    height: 22,
    border: `1px solid ${UI.border}`,
    background: "#fff8e1",
    color: UI.text,
    borderRadius: 999,
    padding: 0,
    fontSize: 14,
    fontWeight: 1000,
    cursor: "pointer",
    lineHeight: "20px",
    textAlign: "center",
    flex: "0 0 auto",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  }}
>
  +
</button>

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
                                              background: isCovered ? "#22c55e" : "#ef4444",
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
                                const originalValue = norm(c?.value);
                                const value =
                                  draftMode && a1
                                    ? norm(
                                        getDraftValue({
                                          a1,
                                          week,
                                          originalValue,
                                        })
                                      )
                                    : originalValue;

                                const isDraftChanged =
                                  draftMode && a1
                                    ? isCellChanged({
                                        a1,
                                        week,
                                      })
                                    : false;

                                const isSaving = a1 ? isCellSaving(a1) : false;
                                const cellStatus = statusFromCellValue(value);
                                const dateStrForDow = norm(dateHeaders?.[dow + 1]);
                                const dayLabel = dayHeaders?.[dow + 1] || DOW_LABELS[dow];

                                const isExpanded = Boolean(a1) && expandedA1.has(a1);
                                const isEditing = Boolean(a1) && editingA1 === a1;

                                const ck = normalizeKey(name);
                                const dk = dateKey(dateStrForDow);
                                const ghostKey = `${ck}__${dk}`;
                                const ghostShiftsForCell = ghostByCell[ghostKey] ?? [];

                                const isBulkSelected = a1 ? isBulkCellSelected(a1) : false;

                                return (
                                  <td
                                    key={a1 || `${r.row}_${dow}`}
                                    onClick={() => {
                                      if (!bulkMode || !a1) return;

                                      toggleBulkCellSelection({
                                        a1,
                                        week,
                                        clientName: name,
                                        dateStr: dateStrForDow,
                                        dayLabel,
                                        originalValue: value,
                                      });
                                    }}
                                    onDoubleClick={() => {
                                      if (bulkMode) return;
                                      if (!a1 || isSaving) return;
                                      startInlineEdit(a1, value);
                                    }}
                                    onDragEnter={(e) => {
                                      if (!a1 || bulkMode) return;
                                      e.preventDefault();
                                      setDragOverA1(a1);
                                    }}
                                    onDragOver={(e) => {
                                      if (!a1 || bulkMode) return;
                                      e.preventDefault();
                                      e.dataTransfer.dropEffect = "move";
                                      if (dragOverA1 !== a1) setDragOverA1(a1);
                                    }}
                                    onDragLeave={(e) => {
                                      if (!a1 || bulkMode) return;

                                      const nextTarget = e.relatedTarget as Node | null;
                                      if (nextTarget && e.currentTarget.contains(nextTarget)) return;

                                      setDragOverA1((prev) => (prev === a1 ? null : prev));
                                    }}
                                    onDrop={async (e) => {
                                      if (!a1 || bulkMode) return;
                                      await handleCaregiverDropToShift({
                                        dropEvent: e,
                                        a1,
                                        clientName: name,
                                        dateStrForDow,
                                        dayLabel,
                                        originalCellValue: originalValue,
                                      });
                                    }}
                                    style={{
                                      verticalAlign: "top",
                                      padding: rowIsEmpty ? 4 : 10,
                                      borderBottom: `1px solid ${UI.borderSoft}`,
                                      background:
                                        dragOverA1 === a1
                                          ? "#dbeafe"
                                          : isBulkSelected
                                          ? "#fef3c7"
                                          : isDraftChanged
                                          ? "#eff6ff"
                                          : groupBg,
                                      borderRight:
                                        idx === visibleDows.length - 1
                                          ? "none"
                                          : `1px solid ${UI.borderSoft}`,
                                      cursor: bulkMode ? "pointer" : "default",
                                      whiteSpace: "pre-wrap",
                                      boxShadow:
                                        dragOverA1 === a1
                                          ? "inset 0 0 0 3px #2563eb"
                                          : isBulkSelected
                                          ? "inset 0 0 0 3px #f59e0b"
                                          : isDraftChanged
                                          ? "inset 0 0 0 2px #3b82f6"
                                          : undefined,
                                      outline:
                                        dragOverA1 === a1
                                          ? "2px dashed #60a5fa"
                                          : isBulkSelected
                                          ? "2px solid #fbbf24"
                                          : "1px dashed rgba(59,130,246,0.18)",
                                      transition:
                                        "background 120ms ease, box-shadow 120ms ease, outline 120ms ease",
                                    }}
                                  >
                                    {isEditing && !bulkMode ? (
                                      <div
                                        style={{
                                          display: "grid",
                                          gap: 8,
                                          padding: 6,
                                          border: `1px solid ${UI.border}`,
                                          borderRadius: 10,
                                          background: "#fff",
                                        }}
                                      >
                                        <div
                                          style={{
                                            display: "flex",
                                            justifyContent: "space-between",
                                            alignItems: "center",
                                            gap: 8,
                                            flexWrap: "wrap",
                                          }}
                                        >
                                          <div
                                            style={{
                                              fontSize: 11,
                                              fontWeight: 900,
                                              color: UI.textDim,
                                            }}
                                          >
                                            {name} • {dayLabel} • {a1}
                                          </div>

                                          {draftMode ? (
                                            <span
                                              style={{
                                                fontSize: 10,
                                                fontWeight: 1000,
                                                color: "#1d4ed8",
                                                background: "#dbeafe",
                                                border: "1px solid #93c5fd",
                                                borderRadius: 999,
                                                padding: "2px 8px",
                                              }}
                                            >
                                              Draft Edit
                                            </span>
                                          ) : null}
                                        </div>

                                        <textarea
                                          value={draftByA1[a1] ?? ""}
                                          onChange={(e) =>
                                            setDraftByA1((prev) => ({
                                              ...prev,
                                              [a1]: e.target.value,
                                            }))
                                          }
                                          rows={4}
                                          autoFocus
                                          disabled={isSaving}
                                          onKeyDown={(e) => {
                                            if (e.key === "Escape") {
                                              e.preventDefault();
                                              cancelInlineEdit(a1);
                                            }

                                            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                                              e.preventDefault();
                                              saveInlineEdit({
                                                a1,
                                                newVal: draftByA1[a1] ?? "",
                                                clientName: name,
                                                shiftDateForSave: dateStrForDow,
                                                dayLabel,
                                                weekOf: weekStartYmd,
                                              });
                                            }
                                          }}
                                          style={{
                                            width: "100%",
                                            boxSizing: "border-box",
                                            border: `1px solid ${UI.border}`,
                                            borderRadius: 10,
                                            padding: "8px 10px",
                                            fontSize: 13,
                                            outline: "none",
                                            background: "#fff",
                                            color: UI.text,
                                            resize: "vertical",
                                            fontFamily: "inherit",
                                            whiteSpace: "pre-wrap",
                                          }}
                                        />

                                        <div
                                          style={{
                                            display: "flex",
                                            gap: 8,
                                            justifyContent: "flex-end",
                                            flexWrap: "wrap",
                                          }}
                                        >
                                          <button
                                            type="button"
                                            onClick={() => cancelInlineEdit(a1)}
                                            disabled={isSaving}
                                            style={{
                                              border: `1px solid ${UI.border}`,
                                              background: UI.panelBg,
                                              color: UI.text,
                                              borderRadius: 8,
                                              padding: "6px 10px",
                                              cursor: isSaving ? "default" : "pointer",
                                              fontWeight: 900,
                                              fontSize: 12,
                                            }}
                                          >
                                            Cancel
                                          </button>

                                          <button
                                            type="button"
                                            onClick={() =>
                                              saveInlineEdit({
                                                a1,
                                                newVal: draftByA1[a1] ?? "",
                                                clientName: name,
                                                shiftDateForSave: dateStrForDow,
                                                dayLabel,
                                                weekOf: weekStartYmd,
                                              })
                                            }
                                            disabled={isSaving}
                                            style={{
                                              border: "1px solid #111827",
                                              background: "#111827",
                                              color: "#fff",
                                              borderRadius: 8,
                                              padding: "6px 10px",
                                              cursor: isSaving ? "default" : "pointer",
                                              fontWeight: 900,
                                              fontSize: 12,
                                            }}
                                          >
                                            {draftMode ? "Save to Draft" : isSaving ? "Saving..." : "Save"}
                                          </button>
                                        </div>

                                        <div
                                          style={{
                                            fontSize: 11,
                                            color: UI.textDim,
                                            fontWeight: 800,
                                            lineHeight: 1.35,
                                          }}
                                        >
                                          Double click a shift to edit • Esc = cancel • Ctrl/Cmd + Enter ={" "}
                                          {draftMode ? "save to draft" : "save"}
                                        </div>
                                      </div>
                                    ) : (
                                      <ShiftCard
  a1Key={a1 || `${r.row}_${dow}`}
  value={value}
  status={cellStatus}
  disabled={isSaving}
  onRequestEdit={() => {
    if (bulkMode) return;
    if (!a1 || isSaving) return;
    startInlineEdit(a1, value);
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
  hasEditHistory={true}
  onOpenEditHistory={handleOpenEditHistory}
  messagesUI={messagesUI}
  clientDescription={clientDescription}
  requests={ghostShiftsForCell}
/>
                                    )}
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
        </div>

        <CaregiverWebSchedulePanel
          open={panelOpen}
          onClose={() => setPanelOpen(false)}
          width={panelWidth}
          onResize={handlePanelResize}
          caregiversError={caregiversError}
          availLoading={availLoading}
          availError={availError}
          caregiverPanelRows={caregiverPanelRows}
          panelSearch={panelSearch ?? ""}
          setPanelSearch={(v: any) => setPanelSearch(String(v ?? ""))}
          panelSelectedDow={panelSelectedDow}
          setPanelSelectedDow={setPanelSelectedDow}
          draftMode={draftMode}
          applicants={applicants}
          applicantsLoading={applicantsLoading}
          applicantsError={applicantsError}
          applicantSearch={applicantSearch ?? ""}
          setApplicantSearch={(v: string) => setApplicantSearch(v)}
        />

        <style jsx>{`
          .scheduleLayout {
            width: 100%;
            min-width: 0;
          }
        `}</style>
      </>
    )}

    <ServiceRequestsPanel
      open={svcPanelOpen}
      onClose={() => setSvcPanelOpen(false)}
      clientName={svcClientName}
      weekStartYmd={weekStartYmd}
      weekKind={week}
    />
     <SupraesophagealGanglionPanel
        open={ganglionOpen}
        onClose={() => setGanglionOpen(false)}
        week={week}
        onWeekChange={setWeekAndUrl}
      />
  </main>
);
}
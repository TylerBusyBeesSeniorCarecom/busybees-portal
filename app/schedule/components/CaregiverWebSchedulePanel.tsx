"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

/** Local util */
function norm(v: any) {
  return (v ?? "").toString().trim();
}
function normLower(v: any) {
  return norm(v).toLowerCase();
}
function includesCI(hay: string, needle: string) {
  return hay.toLowerCase().includes(needle.toLowerCase());
}
function parseMaybeNumber(v: any): number | null {
  const s = norm(v);
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function clampNum(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function isOpenLikeCaregiverName(value: any) {
  const cleaned = norm(value)
    .replace(/^["'(]+/, "")
    .replace(/["')]+$/, "")
    .replace(/,$/, "")
    .trim()
    .toLowerCase();

  return cleaned === "open" || cleaned === "";
}

/** Robust header matching (same idea as Applicants page normalization) */
function normHeader(s: string) {
  return (s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
}

/**
 * Gets a value from a raw ApplicantRow using:
 * - exact key matches, then
 * - normalized header matches (handles casing/punctuation differences)
 */
function getRawField(raw: ApplicantRow, ...candidates: string[]) {
  for (const k of candidates) {
    if (raw && Object.prototype.hasOwnProperty.call(raw, k)) return (raw as any)[k];
  }
  const want = new Set(candidates.map(normHeader));
  for (const [k, v] of Object.entries(raw || {})) {
    if (want.has(normHeader(k))) return v;
  }
  return undefined;
}

/** Types copied from CWWebSchedule (panel-facing only) */
export type WeekKind = "cw" | "nw";

export type AvailRow = {
  caregiverName: string;
  caregiverId: string;
  desiredHours: string;
  notes: string;
  byDow: Record<number, string>;
};

export type ScheduleItem = {
  shiftId: string;
  client: string;
  date: string;
  dow: number;
  startTime: string;
  endTime: string;
  status: string;
  flagged: boolean;
  hours: number;
  isDraft?: boolean;
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
  dateInterviewed?: string;
};

export type CaregiverPanelRow = {
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

/** Applicants rows from /api/employees */
export type ApplicantRow = Record<string, any> & {
  __rowNumber?: number;
  __key?: string;
};

type ApplicantMini = {
  id?: string;
  firstName?: string;
  lastName?: string;
  name?: string;

  phone?: string;
  address?: string;

  certification?: string;
  vaccinated?: string;

  availability?: string;
  score10?: number | null;

  dateInterviewed?: string;

  status?: string;
  onboardingStage?: string;

  // raw scores (optional)
  presentation?: any;
  experience?: any;
  personality?: any;
  reliability?: any;
  firstImpression?: any;

  age?: number | null;
  birthYear?: number | null;
};

type PanelSnap = "floating" | "left" | "right" | "top" | "bottom";

type FloatingRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const UI = {
  panelBg: "#fffdf7",
  headerBg: "#fff7db",
  border: "#d6b24c",
  borderSoft: "#ecd98e",
  text: "#1f2937",
  textDim: "#6b7280",

  bgCaregivers: "linear-gradient(180deg, #ffe08a 0%, #ffd24d 100%)",
  bgApplicants: "linear-gradient(180deg, #fff3bf 0%, #ffe08a 100%)",

  chipBg: "#fff8db",
  chipBorder: "#e6c75a",
  chipText: "#4b3b00",

  amberBg: "#fff4cc",
  amberBorder: "#f4c542",
  amberText: "#7a5600",

  greenBg: "#e9f9ee",
  greenBorder: "#7ccf95",
  greenText: "#166534",

  roseBg: "#fff1f2",
  roseBorder: "#f4a7b9",
  roseText: "#9f1239",

  navy: "#16253f",
  beeGold: "#f4c542",
  beeGoldDark: "#c79200",
  sky: "#2f6fed",
  danger: "#dc2626",
};

const DOW_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const MIN_FLOATING_WIDTH = 320;
const MAX_FLOATING_WIDTH = 760;
const MIN_FLOATING_HEIGHT = 360;
const DEFAULT_FLOATING_HEIGHT = 760;
const EDGE_GAP = 14;

/** -------- Caregiver schedule color helpers -------- */
function scheduleStatusKeyFromRowStatus(raw: string): "filled" | "offered" | "considering" | "pending" | "other" {
  const s = normLower(raw);
  if (!s) return "other";
  if (s.includes("fill")) return "filled";
  if (s.includes("offer")) return "offered";
  if (s.includes("consider")) return "considering";
  if (s.includes("pend")) return "pending";
  return "other";
}

const SHEET_COLORS = {
  filled: "#1f7a3a",
  offered: "#2b6fd6",
  considering: "#d08a1a",
  pending: "#7a3db8",
};

function scheduleStatusColor(raw: string): string {
  const k = scheduleStatusKeyFromRowStatus(raw);
  // @ts-ignore
  return SHEET_COLORS[k] || UI.text;
}

/** -------- Date helpers -------- */
function parseSheetDate(v: any): Date | null {
  const s = norm(v);
  if (!s) return null;

  const iso = Date.parse(s);
  if (!Number.isNaN(iso)) return new Date(iso);

  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})/);
  if (!m) return null;

  const mm = parseInt(m[1], 10);
  const dd = parseInt(m[2], 10);
  let yy = parseInt(m[3], 10);
  if (yy < 100) yy = 2000 + yy;

  const d = new Date(yy, mm - 1, dd);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function startOfWeekSunday(d: Date) {
  const x = startOfDay(d);
  const dow = x.getDay();
  x.setDate(x.getDate() - dow);
  return x;
}
function monthStart(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function monthEndExclusive(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 1);
}
function formatMDY(d: Date) {
  const mm = d.getMonth() + 1;
  const dd = d.getDate();
  const yy = String(d.getFullYear()).slice(-2);
  return `${mm}/${dd}/${yy}`;
}
function diffDaysFromToday(d: Date) {
  const today = startOfDay(new Date()).getTime();
  const then = startOfDay(d).getTime();
  return Math.floor((today - then) / (24 * 60 * 60 * 1000));
}
function formatAgoFromDays(days: number) {
  if (days < 0) return `in ${Math.abs(days)}d`;
  if (days <= 13) return `${days} day${days === 1 ? "" : "s"} ago`;
  if (days <= 59) {
    const w = Math.round((days / 7) * 10) / 10;
    return `${w} week${w === 1 ? "" : "s"} ago`;
  }
  const m = Math.round((days / 30) * 10) / 10;
  return `${m} month${m === 1 ? "" : "s"} ago`;
}

function clampRectToViewport(rect: FloatingRect): FloatingRect {
  if (typeof window === "undefined") return rect;

  const maxWidth = Math.max(MIN_FLOATING_WIDTH, window.innerWidth - EDGE_GAP * 2);
  const maxHeight = Math.max(MIN_FLOATING_HEIGHT, window.innerHeight - EDGE_GAP * 2);

  const width = clampNum(rect.width, MIN_FLOATING_WIDTH, Math.min(MAX_FLOATING_WIDTH, maxWidth));
  const height = clampNum(rect.height, MIN_FLOATING_HEIGHT, maxHeight);

  const maxX = Math.max(EDGE_GAP, window.innerWidth - width - EDGE_GAP);
  const maxY = Math.max(EDGE_GAP, window.innerHeight - height - EDGE_GAP);

  return {
    x: clampNum(rect.x, EDGE_GAP, maxX),
    y: clampNum(rect.y, EDGE_GAP, maxY),
    width,
    height,
  };
}

function getDefaultFloatingRect(width: number): FloatingRect {
  if (typeof window === "undefined") {
    return {
      x: 100,
      y: 80,
      width: clampNum(width || 420, MIN_FLOATING_WIDTH, MAX_FLOATING_WIDTH),
      height: DEFAULT_FLOATING_HEIGHT,
    };
  }

  const w = clampNum(width || 420, MIN_FLOATING_WIDTH, Math.min(MAX_FLOATING_WIDTH, window.innerWidth - EDGE_GAP * 2));
  const h = clampNum(DEFAULT_FLOATING_HEIGHT, MIN_FLOATING_HEIGHT, window.innerHeight - EDGE_GAP * 2);

  return clampRectToViewport({
    x: window.innerWidth - w - EDGE_GAP,
    y: EDGE_GAP,
    width: w,
    height: h,
  });
}

/** -------- Simple chips -------- */
function Chip({
  text,
  bg,
  border,
  color,
  title,
}: {
  text: string;
  bg: string;
  border: string;
  color: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        borderRadius: 999,
        border: `1px solid ${border}`,
        background: bg,
        color,
        padding: "2px 8px",
        fontSize: 12,
        fontWeight: 900,
        lineHeight: 1.2,
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
}

function StatusChip({ value }: { value: string }) {
  const v = norm(value);
  const low = v.toLowerCase();

  if (low.includes("pending")) {
    return <Chip text={v || "—"} bg={UI.amberBg} border={UI.amberBorder} color={UI.amberText} />;
  }
  if (low.includes("on staff")) {
    return <Chip text={v || "—"} bg={UI.greenBg} border={UI.greenBorder} color={UI.greenText} />;
  }
  if (low.includes("released") || low.includes("rejected")) {
    return <Chip text={v || "—"} bg={UI.roseBg} border={UI.roseBorder} color={UI.roseText} />;
  }
  return <Chip text={v || "—"} bg={UI.chipBg} border={UI.chipBorder} color={UI.chipText} />;
}

function formatScore10(score10: number | null | undefined) {
  if (score10 == null || Number.isNaN(score10)) return "—";
  const clamped = Math.max(0, Math.min(10, score10));
  return clamped.toFixed(1);
}
function scoreColor(score10: number | null | undefined) {
  if (score10 == null || Number.isNaN(score10)) return "#9ca3af";
  const s = Math.max(0, Math.min(10, score10));
  if (s <= 5) return "#b91c1c";
  if (s <= 7.5) return "#b45309";
  return "#166534";
}

function ScorePill({ score10, title }: { score10: number | null; title?: string }) {
  if (score10 === null) return <span style={{ fontWeight: 900, color: "#94a3b8" }}>—</span>;
  const c = scoreColor(score10);
  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 46,
        padding: "3px 8px",
        borderRadius: 999,
        border: `1px solid ${c}33`,
        background: `${c}14`,
        color: c,
        fontWeight: 950,
        fontSize: 12,
        whiteSpace: "nowrap",
      }}
    >
      {formatScore10(score10)}
    </span>
  );
}

/** -------- Availability cell -------- */
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

  return <span style={{ fontWeight: 800, fontSize: 11, color: UI.text, whiteSpace: "pre-wrap" }}>{v}</span>;
}

/** -------- UI buttons -------- */
function DayChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: `1px solid ${active ? UI.navy : UI.border}`,
        background: active ? UI.navy : "rgba(255,255,255,0.92)",
        color: active ? "#fff" : UI.text,
        borderRadius: 999,
        padding: "6px 11px",
        fontSize: 12,
        cursor: "pointer",
        fontWeight: 900,
        whiteSpace: "nowrap",
        boxShadow: active ? "0 4px 10px rgba(22,37,63,0.18)" : "none",
      }}
    >
      {label}
    </button>
  );
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: `1px solid ${active ? UI.beeGoldDark : UI.border}`,
        background: active ? UI.beeGold : "rgba(255,255,255,0.95)",
        color: active ? UI.navy : UI.text,
        borderRadius: 999,
        padding: "7px 12px",
        fontSize: 12,
        cursor: "pointer",
        fontWeight: 950,
        whiteSpace: "nowrap",
        boxShadow: active ? "0 4px 12px rgba(244,197,66,0.30)" : "none",
      }}
    >
      {label}
    </button>
  );
}

/** -------- Applicants helpers -------- */
function pickApplicantMini(r: ApplicantRow): ApplicantMini {
  return {
    id: norm(r.id) || norm(r.__key) || (typeof r.__rowNumber === "number" ? `row_${r.__rowNumber}` : undefined),

    firstName: norm(r.firstName) || norm(r["First Name"]) || undefined,
    lastName: norm(r.lastName) || norm(r["Last Name"]) || undefined,
    name: norm(r.name) || norm(r["Name"]) || undefined,

    phone: norm(r.phone) || norm(r["Phone Number"]) || norm(r["Phone"]) || undefined,
    address: norm(r.address) || norm(r["Location"]) || norm(r["Address"]) || undefined,

    certification: norm(r.certification) || norm(r["Certification"]) || undefined,
    vaccinated: norm(r.vaccinated) || norm(r["Vaccinated"]) || undefined,

    availability: norm(r.availability) || norm(r["Availability"]) || undefined,

    score10: parseMaybeNumber(getRawField(r, "score10", "Score 10", "Score")),

    dateInterviewed: norm(r.dateInterviewed) || norm(r["Date Interviewed"]) || norm(r["Interview Date"]) || undefined,

    status: norm(r.status) || norm(r["Status"]) || undefined,
    onboardingStage: norm(r.onboardingStage) || norm(r["Onboarding Stage"]) || undefined,

    age: parseMaybeNumber(getRawField(r, "age", "Age")),
    birthYear: parseMaybeNumber(getRawField(r, "birthYear", "Birth Year")),

    presentation: r.presentation ?? getRawField(r, "Presentation", "presentation"),
    experience: r.experience ?? getRawField(r, "Experience", "experience"),
    personality: r.personality ?? getRawField(r, "Personality", "personality"),
    reliability: r.reliability ?? getRawField(r, "Reliability", "reliability"),
    firstImpression: r.firstImpression ?? getRawField(r, "First Impression", "First Impression Score", "first impression"),
  };
}

function applicantDisplayName(a: ApplicantMini) {
  const n1 = norm(a.name);
  if (n1) return n1;
  const n2 = [norm(a.firstName), norm(a.lastName)].filter(Boolean).join(" ").trim();
  return n2 || "Applicant";
}

function computeScorePartsFromRaw(mini: ApplicantMini, raw: ApplicantRow) {
  const p = parseMaybeNumber(mini.presentation ?? getRawField(raw, "Presentation", "presentation"));
  const e = parseMaybeNumber(mini.experience ?? getRawField(raw, "Experience", "experience"));
  const pe = parseMaybeNumber(mini.personality ?? getRawField(raw, "Personality", "personality"));
  const rel = parseMaybeNumber(mini.reliability ?? getRawField(raw, "Reliability", "reliability"));

  const nums = [
    { key: "Presentation", val: p },
    { key: "Experience", val: e },
    { key: "Personality", val: pe },
    { key: "Reliability", val: rel },
  ];

  const present = nums.filter((x) => typeof x.val === "number") as Array<{ key: string; val: number }>;

  if (present.length > 0) {
    const avg = present.reduce((a, b) => a + b.val, 0) / present.length;
    const rounded = Math.round(avg * 4) / 4;
    return {
      score10: clampNum(rounded, 0, 10),
      breakdown: nums,
      source: "computed" as const,
    };
  }

  const fallback = parseMaybeNumber(
    mini.firstImpression ?? getRawField(raw, "First Impression", "First Impression Score", "first impression")
  );
  if (fallback !== null) {
    return {
      score10: clampNum(fallback, 0, 10),
      breakdown: nums,
      source: "stored" as const,
    };
  }

  return {
    score10: null as number | null,
    breakdown: nums,
    source: "none" as const,
  };
}

function notesFromRaw(raw: ApplicantRow) {
  return (
    norm(getRawField(raw, "Interview Notes", "Interview Note", "interviewNotes")) ||
    norm(getRawField(raw, "Notes", "Note")) ||
    ""
  );
}

function ageFromBirthYear(birthYear: number | null | undefined): number | null {
  if (birthYear == null || !Number.isFinite(birthYear)) return null;
  const cy = new Date().getFullYear();
  const y = Math.round(Number(birthYear));
  if (y < 1900 || y > cy) return null;
  const age = cy - y;
  return age < 0 || age > 120 ? null : age;
}

/** Applicants filter presets */
type DatePreset = "Last week" | "This month" | "Last month" | "Last 3 months" | "This year" | "All";
type ScoreMin = number | null;

function clampHalf(n: number) {
  return Math.round(n * 2) / 2;
}

function buildScoreOptionsHalf(): Array<{ label: string; value: ScoreMin }> {
  const out: Array<{ label: string; value: ScoreMin }> = [{ label: "All", value: null }];
  for (let s = 0; s <= 10.0001; s += 0.5) {
    const v = clampHalf(s);
    out.push({ label: `≥ ${v.toFixed(1)}`, value: v });
  }
  return out;
}

function dateRangeFromPreset(preset: DatePreset) {
  const now = new Date();
  const today = startOfDay(now);

  if (preset === "All") return { min: null as Date | null, maxExcl: null as Date | null };

  if (preset === "Last week") {
    const thisSun = startOfWeekSunday(today);
    const min = new Date(thisSun);
    min.setDate(min.getDate() - 7);
    const maxExcl = new Date(thisSun);
    maxExcl.setDate(maxExcl.getDate() + 7);
    return { min, maxExcl };
  }

  if (preset === "This month") {
    const min = monthStart(today);
    const maxExcl = monthEndExclusive(today);
    return { min, maxExcl };
  }

  if (preset === "Last month") {
    const d = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const min = monthStart(d);
    const maxExcl = monthEndExclusive(d);
    return { min, maxExcl };
  }

  if (preset === "Last 3 months") {
    const min = new Date(today.getFullYear(), today.getMonth() - 2, 1);
    const maxExcl = monthEndExclusive(today);
    return { min, maxExcl };
  }

  const min = new Date(today.getFullYear(), 0, 1);
  const maxExcl = new Date(today.getFullYear() + 1, 0, 1);
  return { min, maxExcl };
}

/** -------- Availability preset picker -------- */
type AvailPreset =
  | "All"
  | "Mornings"
  | "Afternoon"
  | "Evening"
  | "Overnight"
  | "Weekend"
  | "Flexible"
  | "Limited"
  | "Can't Start Right Away"
  | "Open";

function isOpenAvailability(availText: string) {
  const s = normLower(availText);
  return s === "open" || s.includes(" open ") || s.includes("anytime") || s.includes("available all day") || s.includes("open availability");
}

function matchesAvailPreset(availText: string, preset: AvailPreset): boolean {
  const a = normLower(availText);
  if (!preset || preset === "All") return true;

  if (isOpenAvailability(a)) return true;
  if (preset === "Open") return false;

  const keywords: Record<Exclude<AvailPreset, "All" | "Open">, string[]> = {
    Mornings: ["morning", "mornings", "am", "a.m", "7am", "8am", "9am", "10am", "11am"],
    Afternoon: ["afternoon", "early afternoon", "late afternoon", "noon", "12pm", "1pm", "2pm", "3pm", "4pm", "5pm"],
    Evening: ["evening", "evenings", "pm", "6pm", "7pm", "8pm", "9pm", "10pm"],
    Overnight: ["overnight", "over night", "night", "nights", "10pm", "11pm", "12am", "1am", "2am", "3am", "4am", "5am", "6am"],
    Weekend: ["weekend", "weekends", "sat", "saturday", "sun", "sunday"],
    Flexible: ["flexible", "any", "varies", "as needed", "most days"],
    Limited: ["limited", "few", "only", "some", "restricted"],
    "Can't Start Right Away": ["cant start right away", "can't start right away", "can’t start right away", "not right away", "in two weeks", "in 2 weeks", "later", "after", "start date"],
  };

  const ks = keywords[preset as Exclude<AvailPreset, "All" | "Open">] || [];
  return ks.some((k) => a.includes(k));
}

function toggleAvailPreset(cur: AvailPreset[], next: AvailPreset): AvailPreset[] {
  const set = new Set(cur);
  if (next === "All") return ["All"];
  set.delete("All");
  if (set.has(next)) set.delete(next);
  else set.add(next);
  const out = Array.from(set);
  return out.length ? out : ["All"];
}

function matchesAvailPresets(availText: string, presets: AvailPreset[]): boolean {
  const selected: AvailPreset[] = presets.length ? presets : ["All"];
  if (selected.includes("All")) return true;

  const open = isOpenAvailability(availText);

  if (selected.includes("Open")) return open;
  if (open) return true;

  return selected.some((p) => matchesAvailPreset(availText, p));
}

/** -------- Main component -------- */
export default function CaregiverWebSchedulePanel({
  open,
  onClose,
  width,
  onResize,

  caregiversError,
  availLoading,
  availError,

  caregiverPanelRows,

  panelSearch,
  setPanelSearch,
  panelSelectedDow,
  setPanelSelectedDow,

  draftMode,

  applicants,
  applicantsLoading,
  applicantsError,
  applicantSearch,
  setApplicantSearch,
}: {
  open: boolean;
  onClose: () => void;
  width: number;
  onResize: (nextWidth: number) => void;

  caregiversError: string | null;
  availLoading: boolean;
  availError: string | null;

  caregiverPanelRows: CaregiverPanelRow[];

  panelSearch: string;
  setPanelSearch: (v: string) => void;
  panelSelectedDow: number | null;
  setPanelSelectedDow: (v: number | null) => void;

  draftMode: boolean;

  applicants: ApplicantRow[];
  applicantsLoading: boolean;
  applicantsError: string | null;
  applicantSearch: string;
  setApplicantSearch: (v: string) => void;
}) {
  const [tab, setTab] = useState<"caregivers" | "applicants">("caregivers");
  const [snap, setSnap] = useState<PanelSnap>("right");
  const [peekMode, setPeekMode] = useState(false);
  const [floatingRect, setFloatingRect] = useState<FloatingRect>(() => getDefaultFloatingRect(width));

  const dragRef = useRef<null | {
    startX: number;
    startY: number;
    startRect: FloatingRect;
  }>(null);

  const resizeRef = useRef<
    | null
    | {
        startX: number;
        startY: number;
        startRect: FloatingRect;
        mode: "left" | "right" | "bottom" | "bottom-right";
      }
  >(null);

  useEffect(() => {
    if (!open) return;
    setFloatingRect((prev) => {
      const next = prev?.width ? prev : getDefaultFloatingRect(width);
      return clampRectToViewport({
        ...next,
        width: clampNum(width || next.width, MIN_FLOATING_WIDTH, MAX_FLOATING_WIDTH),
      });
    });
  }, [open, width]);

  useEffect(() => {
    function handleWindowResize() {
      setFloatingRect((prev) => clampRectToViewport(prev));
    }

    window.addEventListener("resize", handleWindowResize);
    return () => window.removeEventListener("resize", handleWindowResize);
  }, []);

  function handleCaregiverDragStart(
    e: React.DragEvent<HTMLElement>,
    args: {
      caregiverId: string;
      caregiverName: string;
      nameOnSchedule: string;
    }
  ) {
    const payload = {
      type: "caregiver-panel-drag",
      caregiverId: args.caregiverId || "",
      caregiverName: args.caregiverName || "",
      nameOnSchedule: args.nameOnSchedule || args.caregiverName || "",
    };

    e.dataTransfer.effectAllowed = "copyMove";
    e.dataTransfer.setData("application/json", JSON.stringify(payload));
    e.dataTransfer.setData("text/plain", args.nameOnSchedule || args.caregiverName || "");

    const dragEl = document.createElement("div");
    dragEl.innerText = args.nameOnSchedule || args.caregiverName || "Caregiver";
    dragEl.style.position = "absolute";
    dragEl.style.top = "-9999px";
    dragEl.style.left = "-9999px";
    dragEl.style.padding = "7px 11px";
    dragEl.style.background = "#f4c542";
    dragEl.style.color = "#16253f";
    dragEl.style.border = "1px solid #c79200";
    dragEl.style.borderRadius = "999px";
    dragEl.style.fontWeight = "900";
    dragEl.style.fontSize = "12px";
    dragEl.style.boxShadow = "0 8px 20px rgba(22,37,63,0.22)";

    document.body.appendChild(dragEl);
    e.dataTransfer.setDragImage(dragEl, 10, 10);

    setTimeout(() => {
      if (document.body.contains(dragEl)) document.body.removeChild(dragEl);
    }, 0);
  }

  function snapTo(nextSnap: PanelSnap) {
    if (nextSnap === "floating") {
      setSnap("floating");
      setFloatingRect((prev) => clampRectToViewport(prev));
      return;
    }

    if (snap === "floating") {
      setFloatingRect((prev) => clampRectToViewport(prev));
    }

    setSnap(nextSnap);
  }

  function startPanelDrag(e: React.MouseEvent<HTMLDivElement>) {
    if (snap !== "floating") return;
    if ((e.target as HTMLElement)?.closest("[data-no-panel-drag='true']")) return;

    e.preventDefault();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startRect: floatingRect,
    };

    function onMove(ev: MouseEvent) {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;

      setFloatingRect(
        clampRectToViewport({
          ...dragRef.current.startRect,
          x: dragRef.current.startRect.x + dx,
          y: dragRef.current.startRect.y + dy,
        })
      );
    }

    function onUp() {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function startResize(
    e: React.MouseEvent<HTMLDivElement>,
    mode: "left" | "right" | "bottom" | "bottom-right"
  ) {
    e.preventDefault();
    e.stopPropagation();

    if (snap !== "floating") {
      if (snap === "right" || snap === "left") {
        const startX = e.clientX;
        const startWidth = width;

        function handleMove(ev: MouseEvent) {
          const delta = snap === "right" ? startX - ev.clientX : ev.clientX - startX;
          onResize(clampNum(startWidth + delta, MIN_FLOATING_WIDTH, Math.min(MAX_FLOATING_WIDTH, window.innerWidth - 40)));
        }

        function handleUp() {
          window.removeEventListener("mousemove", handleMove);
          window.removeEventListener("mouseup", handleUp);
        }

        window.addEventListener("mousemove", handleMove);
        window.addEventListener("mouseup", handleUp);
      }

      return;
    }

    resizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startRect: floatingRect,
      mode,
    };

    function onMove(ev: MouseEvent) {
      if (!resizeRef.current) return;

      const { startRect, startX, startY, mode } = resizeRef.current;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;

      let next: FloatingRect = { ...startRect };

      if (mode === "left") {
        const newWidth = clampNum(startRect.width - dx, MIN_FLOATING_WIDTH, MAX_FLOATING_WIDTH);
        const consumed = startRect.width - newWidth;
        next.width = newWidth;
        next.x = startRect.x + consumed;
      }

      if (mode === "right") {
        next.width = clampNum(startRect.width + dx, MIN_FLOATING_WIDTH, MAX_FLOATING_WIDTH);
      }

      if (mode === "bottom") {
        next.height = clampNum(startRect.height + dy, MIN_FLOATING_HEIGHT, window.innerHeight - EDGE_GAP * 2);
      }

      if (mode === "bottom-right") {
        next.width = clampNum(startRect.width + dx, MIN_FLOATING_WIDTH, MAX_FLOATING_WIDTH);
        next.height = clampNum(startRect.height + dy, MIN_FLOATING_HEIGHT, window.innerHeight - EDGE_GAP * 2);
      }

      setFloatingRect(clampRectToViewport(next));
      onResize(next.width);
    }

    function onUp() {
      resizeRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const [appLocationQ, setAppLocationQ] = useState("");
  const [appAvailPresets, setAppAvailPresets] = useState<AvailPreset[]>(["All"]);
  const [appDatePreset, setAppDatePreset] = useState<DatePreset>("All");
  const [appStatusFilter, setAppStatusFilter] = useState<string>("All");
  const [appMinScore, setAppMinScore] = useState<ScoreMin>(null);
  const [expandedAppId, setExpandedAppId] = useState<string | null>(null);

  const applicantStatusOptions = useMemo(() => {
    const set = new Set<string>();
    (applicants || []).forEach((r) => {
      const s = norm(r.status) || norm(r["Status"]);
      if (s) set.add(s);
    });
    return ["All", ...Array.from(set).sort()];
  }, [applicants]);

  const filteredApplicants = useMemo(() => {
    const q = normLower(applicantSearch);
    const locNeedle = norm(appLocationQ);
    const { min, maxExcl } = dateRangeFromPreset(appDatePreset);
    const minScore10 = appMinScore;

    const views = (applicants || []).map((raw) => {
      const mini = pickApplicantMini(raw);
      const scoreInfo = computeScorePartsFromRaw(mini, raw);

      const score10 =
        scoreInfo.score10 != null
          ? scoreInfo.score10
          : typeof mini.score10 === "number" && Number.isFinite(mini.score10)
            ? mini.score10
            : null;

      const dateStr = mini.dateInterviewed || norm(getRawField(raw, "Date Interviewed", "Interview Date")) || "";
      const dateObj = parseSheetDate(dateStr);

      return { raw, mini, scoreInfo, score10, dateObj };
    });

    const nonEmpty = views.filter((v) => {
      const a = v.mini;
      const name = applicantDisplayName(a);
      const hasRealName = name && name !== "Applicant";
      return (
        hasRealName ||
        Boolean(norm(a.phone)) ||
        Boolean(norm(a.address)) ||
        Boolean(norm(a.availability)) ||
        v.score10 != null ||
        Boolean(norm(notesFromRaw(v.raw))) ||
        (a.birthYear != null && ageFromBirthYear(a.birthYear) != null)
      );
    });

    const afterFilters = nonEmpty.filter((v) => {
      const a = v.mini;

      const status = norm(a.status);
      if (appStatusFilter !== "All" && status !== appStatusFilter) return false;

      if (min && maxExcl) {
        if (!v.dateObj) return false;
        const x = startOfDay(v.dateObj);
        if (x < min || x >= maxExcl) return false;
      }

      if (minScore10 !== null) {
        if (v.score10 == null) return false;
        if (v.score10 < minScore10) return false;
      }

      if (locNeedle) {
        const locHay = norm(a.address);
        if (!includesCI(locHay, locNeedle)) return false;
      }

      const availHay = norm(a.availability);
      if (!matchesAvailPresets(availHay, appAvailPresets)) return false;

      if (!q) return true;

      const hay = [
        applicantDisplayName(a),
        a.phone,
        a.address,
        a.availability,
        a.status,
        a.certification,
        a.onboardingStage,
        a.dateInterviewed,
        a.vaccinated,
        v.score10 != null ? String(v.score10) : "",
        notesFromRaw(v.raw),
        a.birthYear != null ? String(ageFromBirthYear(a.birthYear) ?? "") : "",
      ]
        .map(norm)
        .join(" | ")
        .toLowerCase();

      return hay.includes(q);
    });

    afterFilters.sort((A, B) => {
      const at = A.dateObj ? A.dateObj.getTime() : -Infinity;
      const bt = B.dateObj ? B.dateObj.getTime() : -Infinity;
      if (at === bt) return 0;
      if (at === -Infinity) return 1;
      if (bt === -Infinity) return -1;
      return bt - at;
    });

    return afterFilters;
  }, [applicants, applicantSearch, appLocationQ, appAvailPresets, appDatePreset, appStatusFilter, appMinScore]);

  const visibleCaregiverPanelRows = useMemo(() => {
    return (caregiverPanelRows || []).filter((cg) => {
      const p = cg.profile;

      const displayName =
        norm(p?.name) ||
        norm(cg.nameOnSchedule) ||
        norm(p?.nameOnSchedule) ||
        norm(cg.caregiverId) ||
        "";

      return !isOpenLikeCaregiverName(displayName);
    });
  }, [caregiverPanelRows]);

  if (!open) return null;

  const caregiverCount = visibleCaregiverPanelRows.length;
const applicantCount = applicants?.length || 0;
const shellBg = tab === "applicants" ? UI.bgApplicants : UI.bgCaregivers;

const isGhost = peekMode;

const bodyBg = isGhost
  ? tab === "applicants"
    ? "linear-gradient(180deg, rgba(255,243,191,0.22) 0%, rgba(255,224,138,0.16) 100%)"
    : "linear-gradient(180deg, rgba(255,224,138,0.20) 0%, rgba(255,210,77,0.14) 100%)"
  : shellBg;

const panelGlassBg = isGhost ? "rgba(255, 248, 219, 0.18)" : bodyBg;
const panelHeaderBg = isGhost
  ? "linear-gradient(180deg, rgba(255,255,255,0.24) 0%, rgba(255,248,219,0.18) 100%)"
  : "linear-gradient(180deg, rgba(255,255,255,0.78) 0%, rgba(255,248,219,0.95) 100%)";

const panelSoftBoxBg = isGhost ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.92)";
const panelCardBg = isGhost ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.82)";
const panelCardHeaderBg = isGhost
  ? "linear-gradient(180deg, rgba(255,255,255,0.20) 0%, rgba(255,249,230,0.14) 100%)"
  : "linear-gradient(180deg, rgba(255,255,255,0.96) 0%, rgba(255,249,230,0.96) 100%)";

const panelInlineRowBg = isGhost ? "rgba(255,255,255,0.12)" : "#fff";
const panelBlur = "none";
const panelBorderSoft = isGhost ? "rgba(214,178,76,0.38)" : "rgba(214,178,76,0.65)";
const panelDivider = isGhost ? "rgba(22,37,63,0.12)" : "rgba(22,37,63,0.12)";

  const panelStyle: React.CSSProperties =
    snap === "floating"
      ? {
          position: "fixed",
          left: floatingRect.x,
          top: floatingRect.y,
          width: floatingRect.width,
          height: floatingRect.height,
        }
      : snap === "right"
        ? {
            position: "fixed",
            top: EDGE_GAP,
            right: EDGE_GAP,
            bottom: EDGE_GAP,
            width,
            maxWidth: `calc(100vw - ${EDGE_GAP * 2}px)`,
          }
        : snap === "left"
          ? {
              position: "fixed",
              top: EDGE_GAP,
              left: EDGE_GAP,
              bottom: EDGE_GAP,
              width,
              maxWidth: `calc(100vw - ${EDGE_GAP * 2}px)`,
            }
          : snap === "top"
            ? {
                position: "fixed",
                top: EDGE_GAP,
                left: EDGE_GAP,
                right: EDGE_GAP,
                height: 360,
                maxHeight: "42vh",
              }
            : {
                position: "fixed",
                left: EDGE_GAP,
                right: EDGE_GAP,
                bottom: EDGE_GAP,
                height: 360,
                maxHeight: "42vh",
              };

  const canDrag = snap === "floating";
  const showSideResizeHandle = snap === "right" || snap === "left";
  const showFloatingResizeHandles = snap === "floating";

  return (
  <aside
  className="caregiverAside"
  style={{
    ...panelStyle,
    zIndex: 3001,
    display: "flex",
    flexDirection: "column",
    border: `2px solid ${UI.beeGoldDark}`,
    background: panelGlassBg,
    borderRadius: 20,
    overflow: "hidden",
    boxShadow: isGhost
      ? "0 20px 60px rgba(22,37,63,0.20)"
      : "0 24px 80px rgba(22,37,63,0.28)",
    pointerEvents: "auto",
  }}
>
      {showSideResizeHandle ? (
        <div
          onMouseDown={(e) => startResize(e, snap === "right" ? "left" : "right")}
          title="Drag to resize"
          style={{
            position: "absolute",
            [snap === "right" ? "left" : "right"]: 0,
            top: 0,
            bottom: 0,
            width: 12,
            cursor: "ew-resize",
            zIndex: 20,
            background: "transparent",
            userSelect: "none",
          }}
        >
          <div
            style={{
              position: "absolute",
              [snap === "right" ? "left" : "right"]: 3,
              top: "50%",
              transform: "translateY(-50%)",
              width: 4,
              height: 64,
              borderRadius: 999,
              background: "rgba(22,37,63,0.16)",
            }}
          />
        </div>
      ) : null}

      {showFloatingResizeHandles ? (
        <>
          <div
            onMouseDown={(e) => startResize(e, "left")}
            title="Resize"
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: 10,
              cursor: "ew-resize",
              zIndex: 20,
            }}
          />
          <div
            onMouseDown={(e) => startResize(e, "right")}
            title="Resize"
            style={{
              position: "absolute",
              right: 0,
              top: 0,
              bottom: 0,
              width: 10,
              cursor: "ew-resize",
              zIndex: 20,
            }}
          />
          <div
            onMouseDown={(e) => startResize(e, "bottom")}
            title="Resize"
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: 10,
              cursor: "ns-resize",
              zIndex: 20,
            }}
          />
          <div
            onMouseDown={(e) => startResize(e, "bottom-right")}
            title="Resize"
            style={{
              position: "absolute",
              right: 0,
              bottom: 0,
              width: 18,
              height: 18,
              cursor: "nwse-resize",
              zIndex: 21,
            }}
          />
        </>
      ) : null}

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          height: "100%",
        }}
      >
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "auto",
          }}
        >
          <div
  onMouseDown={startPanelDrag}
  style={{
    padding: 14,
    borderBottom: `2px solid ${panelDivider}`,
    background: panelHeaderBg,
    cursor: canDrag ? "grab" : "default",
    userSelect: "none",
  }}
>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 950, fontSize: 14 }}>Caregiver Panel</div>
                <div style={{ marginTop: 4, fontSize: 12, color: UI.textDim, fontWeight: 800 }}>
                  {tab === "caregivers"
                    ? `Showing ${caregiverCount} caregivers`
                    : `Showing ${filteredApplicants.length} of ${applicantCount} applicants`}
                </div>

                {tab === "caregivers" ? (
                 <div
  style={{
    marginTop: 8,
    fontSize: 11.5,
    color: UI.navy,
    fontWeight: 900,
    background: isGhost ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.55)",
    border: `1px solid ${isGhost ? "rgba(22,37,63,0.08)" : "rgba(22,37,63,0.10)"}`,
    borderRadius: 10,
    padding: "7px 9px",
    backdropFilter: isGhost ? "blur(.5px)" : "none",
    WebkitBackdropFilter: isGhost ? "blur(.5px)" : "none",
  }}
>
                    {draftMode
                      ? "Draft Mode: drag a caregiver onto a shift to replace it as considering."
                      : "Drag a caregiver onto a shift to save it directly to the schedule as considering."}
                  </div>
                ) : null}
              </div>

              <div
                data-no-panel-drag="true"
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  flexWrap: "wrap",
                  justifyContent: "flex-end",
                }}
              >
                <button
                  type="button"
                  onClick={() => setPeekMode((v) => !v)}
                  style={{
                    border: `1px solid ${peekMode ? UI.beeGoldDark : UI.border}`,
                    background: peekMode ? UI.beeGold : "#fff",
                    color: UI.navy,
                    borderRadius: 999,
                    padding: "7px 10px",
                    cursor: "pointer",
                    fontWeight: 900,
                    fontSize: 12,
                  }}
                >
                  {peekMode ? "Solid" : "Ghost"}
                </button>

                <button
                  type="button"
                  onClick={() => snapTo("floating")}
                  style={{
                    border: `1px solid ${snap === "floating" ? UI.navy : UI.border}`,
                    background: snap === "floating" ? UI.navy : "#fff",
                    color: snap === "floating" ? "#fff" : UI.text,
                    borderRadius: 999,
                    padding: "7px 10px",
                    cursor: "pointer",
                    fontWeight: 900,
                    fontSize: 12,
                  }}
                  title="Floating mode"
                >
                  Float
                </button>

                <button
                  type="button"
                  onClick={onClose}
                  style={{
                    border: `1px solid ${UI.navy}`,
                    background: UI.navy,
                    color: "#fff",
                    borderRadius: 999,
                    padding: "7px 12px",
                    cursor: "pointer",
                    fontWeight: 950,
                    fontSize: 13,
                    boxShadow: "0 4px 12px rgba(22,37,63,0.18)",
                  }}
                >
                  Close
                </button>
              </div>
            </div>

            <div
              data-no-panel-drag="true"
              style={{
                marginTop: 10,
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <TabButton
                label={`Caregivers (${caregiverCount})`}
                active={tab === "caregivers"}
                onClick={() => setTab("caregivers")}
              />
              <TabButton
                label={`Applicants (${applicantCount})`}
                active={tab === "applicants"}
                onClick={() => setTab("applicants")}
              />

              <div style={{ width: 1, height: 22, background: "rgba(22,37,63,0.12)", margin: "0 2px" }} />

              <button
                type="button"
                onClick={() => snapTo("left")}
                style={snapButtonStyle(snap === "left")}
              >
                Left
              </button>
              <button
                type="button"
                onClick={() => snapTo("right")}
                style={snapButtonStyle(snap === "right")}
              >
                Right
              </button>
              <button
                type="button"
                onClick={() => snapTo("top")}
                style={snapButtonStyle(snap === "top")}
              >
                Top
              </button>
              <button
                type="button"
                onClick={() => snapTo("bottom")}
                style={snapButtonStyle(snap === "bottom")}
              >
                Bottom
              </button>
            </div>

            {tab === "caregivers" ? (
              <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                <input
                  value={panelSearch ?? ""}
                  onChange={(e) => setPanelSearch(e.target.value)}
                  placeholder="Search caregivers…"
                 style={{
  border: `1px solid ${UI.border}`,
  borderRadius: 14,
  padding: "10px 12px",
  fontSize: 13,
  outline: "none",
  background: panelSoftBoxBg,
  boxShadow: isGhost ? "none" : "inset 0 1px 2px rgba(0,0,0,0.04)",
  backdropFilter: isGhost ? "blur(.5px)" : "none",
  WebkitBackdropFilter: isGhost ? "blur(.5px)" : "none",
}}
                />

                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  <DayChip label="All" active={panelSelectedDow == null} onClick={() => setPanelSelectedDow(null)} />
                  {DOW_LABELS.map((d, idx) => (
                    <DayChip
                      key={`cp_${d}`}
                      label={d.slice(0, 3)}
                      active={panelSelectedDow === idx}
                      onClick={() => setPanelSelectedDow(idx)}
                    />
                  ))}
                </div>

                {caregiversError ? (
                  <div style={{ marginTop: 10, fontSize: 12, color: "salmon", fontWeight: 800 }}>
                    Caregivers error: {caregiversError}
                  </div>
                ) : null}
              </div>
            ) : (
              <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                <input
                  value={applicantSearch ?? ""}
                  onChange={(e) => setApplicantSearch(e.target.value)}
                  placeholder="Search applicants…"
                  style={{
                    border: `1px solid ${UI.border}`,
                    borderRadius: 12,
                    padding: "8px 10px",
                    fontSize: 13,
                    outline: "none",
                    background: UI.panelBg,
                  }}
                />

                <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
                  <input
                    value={appLocationQ}
                    onChange={(e) => setAppLocationQ(e.target.value)}
                    placeholder="Location filter…"
                    style={{
                      border: `1px solid ${UI.border}`,
                      borderRadius: 12,
                      padding: "8px 10px",
                      fontSize: 13,
                      outline: "none",
                      background: "rgba(255,255,255,0.95)",
                      boxShadow: "inset 0 1px 2px rgba(0,0,0,0.04)",
                    }}
                  />

                  <div
                    style={{
                      border: `1px solid ${UI.border}`,
                      borderRadius: 12,
                      padding: "8px 10px",
                      background: UI.panelBg,
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 950, color: UI.textDim, marginBottom: 6 }}>
                      Availability (multi-select)
                    </div>

                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {(
                        [
                          "All",
                          "Mornings",
                          "Afternoon",
                          "Evening",
                          "Overnight",
                          "Weekend",
                          "Flexible",
                          "Limited",
                          "Can't Start Right Away",
                          "Open",
                        ] as AvailPreset[]
                      ).map((p) => {
                        const active = appAvailPresets.includes(p);
                        return (
                          <button
                            key={`avail_${p}`}
                            type="button"
                            onClick={() => setAppAvailPresets((cur) => toggleAvailPreset(cur, p))}
                            style={{
                              border: `1px solid ${active ? UI.beeGoldDark : UI.border}`,
                              background: active ? UI.beeGold : "#fff",
                              color: active ? UI.navy : UI.text,
                              borderRadius: 999,
                              padding: "6px 10px",
                              fontSize: 12,
                              cursor: "pointer",
                              fontWeight: 950,
                              whiteSpace: "nowrap",
                              boxShadow: active ? "0 3px 10px rgba(244,197,66,0.22)" : "none",
                            }}
                            title={p === "Open" ? "If selected, ONLY Open applicants show" : undefined}
                          >
                            {p}
                          </button>
                        );
                      })}
                    </div>

                    <div style={{ marginTop: 6, fontSize: 11.5, color: UI.textDim, fontWeight: 800 }}>
                      Tip: Open applicants show in all filters unless you select “Open” (then it becomes exclusive).
                    </div>
                  </div>

                  <select
                    value={appDatePreset}
                    onChange={(e) => setAppDatePreset(e.target.value as DatePreset)}
                    style={selectStyle()}
                  >
                    {(["Last week", "This month", "Last month", "Last 3 months", "This year", "All"] as DatePreset[]).map(
                      (p) => (
                        <option key={p} value={p}>
                          Dates: {p}
                        </option>
                      )
                    )}
                  </select>

                  <select
                    value={appStatusFilter}
                    onChange={(e) => setAppStatusFilter(e.target.value)}
                    style={selectStyle()}
                  >
                    {applicantStatusOptions.map((s) => (
                      <option key={s} value={s}>
                        Status: {s}
                      </option>
                    ))}
                  </select>

                  <select
                    value={appMinScore == null ? "All" : String(appMinScore)}
                    onChange={(e) => {
                      const v = e.target.value;
                      setAppMinScore(v === "All" ? null : clampHalf(Number(v)));
                    }}
                    style={selectStyle()}
                  >
                    {buildScoreOptionsHalf().map((opt) => (
                      <option key={opt.label} value={opt.value == null ? "All" : String(opt.value)}>
                        Score: {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                {applicantsError ? (
                  <div style={{ marginTop: 2, fontSize: 12, color: "salmon", fontWeight: 800 }}>
                    Applicants error: {applicantsError}
                  </div>
                ) : null}
              </div>
            )}
          </div>

          {tab === "caregivers" ? (
            availLoading ? (
              <div style={{ padding: 12, fontSize: 13, color: UI.textDim }}>Loading caregiver panel…</div>
            ) : availError ? (
              <div style={{ padding: 12, fontSize: 13, color: "salmon" }}>{availError}</div>
            ) : visibleCaregiverPanelRows.length === 0 ? (
              <div style={{ padding: 12, fontSize: 13, color: UI.textDim }}>No caregivers match this filter.</div>
            ) : (
              <div style={{ display: "grid", gap: 10, padding: 12 }}>
                {visibleCaregiverPanelRows.map((cg, idx) => {
                  const p = cg.profile;

                  const displayName =
                    norm(p?.name) ||
                    norm(cg.nameOnSchedule) ||
                    norm(p?.nameOnSchedule) ||
                    norm(cg.caregiverId) ||
                    "Caregiver";

                  const showDows = panelSelectedDow == null ? [0, 1, 2, 3, 4, 5, 6] : [panelSelectedDow];

                  const certRaw = norm(p?.certification);
                  const certLower = certRaw.toLowerCase();
                  const hasCert = Boolean(certRaw) && certLower !== "none";

                  const totalHoursLabel = `${cg.totalHours.toFixed(1)}h`;
                  const availability = cg.availability;
                  const hasAvailability = cg.hasAvailability;

                  const schedByDow: Record<number, ScheduleItem[]> = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
                  for (const s of cg.schedule) {
                    schedByDow[s.dow] = schedByDow[s.dow] || [];
                    schedByDow[s.dow].push(s);
                  }

                  return (
                   <div
  key={`${cg.kind}:${cg.caregiverId || displayName}:${idx}`}
  style={{
    border: `1px solid ${panelBorderSoft}`,
    borderRadius: 16,
    padding: 10,
    background: panelCardBg,
    boxShadow: isGhost ? "none" : "0 8px 18px rgba(22,37,63,0.06)",
    backdropFilter: isGhost ? "blur(.5px)" : "none",
    WebkitBackdropFilter: isGhost ? "blur(.5px)" : "none",
  }}
>
                     <div
  style={{
    position: "sticky",
    top: 0,
    zIndex: 12,
    background: panelCardHeaderBg,
    borderRadius: 12,
    padding: "10px 10px",
    border: `1px solid ${isGhost ? "rgba(214,178,76,0.30)" : "rgba(214,178,76,0.55)"}`,
    boxShadow: isGhost ? "none" : "0 2px 8px rgba(22,37,63,0.05)",
  }}
>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                            <div style={{ fontWeight: 950, fontSize: 16, lineHeight: 1.15 }}>{displayName}</div>

                            <button
                              type="button"
                              draggable
                              onDragStart={(e) =>
                                handleCaregiverDragStart(e, {
                                  caregiverId: cg.caregiverId,
                                  caregiverName: displayName,
                                  nameOnSchedule: cg.nameOnSchedule || displayName,
                                })
                              }
                              style={{
                                border: `1px solid ${UI.beeGoldDark}`,
                                background: UI.beeGold,
                                color: UI.navy,
                                borderRadius: 999,
                                padding: "4px 10px",
                                fontSize: 11,
                                fontWeight: 1000,
                                cursor: "grab",
                                whiteSpace: "nowrap",
                                boxShadow: "0 3px 8px rgba(244,197,66,0.24)",
                              }}
                            >
                              Drag to Shift
                            </button>

                            {hasCert && (
                              <span
                                style={{
                                  fontSize: 11,
                                  fontWeight: 900,
                                  padding: "2px 8px",
                                  borderRadius: 999,
                                  border: `1px solid ${UI.borderSoft}`,
                                  background: isGhost ? "rgba(248,250,252,0.16)" : "#f8fafc",
                                  color: UI.textDim,
                                  whiteSpace: "nowrap",
                                }}
                                title="Certification"
                              >
                                {certRaw}
                              </span>
                            )}

                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 950,
                                padding: "2px 8px",
                                borderRadius: 999,
                                border: `1px solid ${UI.borderSoft}`,
                               background: isGhost ? "rgba(255,255,255,0.14)" : "#fff",
                                color: UI.text,
                                whiteSpace: "nowrap",
                              }}
                              title="Total scheduled hours (this week)"
                            >
                              {totalHoursLabel}
                            </span>
                          </div>
                        </div>

                        {!hasAvailability && (
                          <div style={{ marginTop: 6, fontSize: 11.5, color: "salmon", fontWeight: 900 }}>
                            No availability submitted
                          </div>
                        )}
                      </div>

                     <div style={{ marginTop: 12 }}>
                        {showDows.map((dow, ix) => {
                          const daySchedule = schedByDow[dow] || [];
                          const dayAvail = availability?.byDow?.[dow] ?? "—";

                          return (
                            <div
                              key={`${displayName}_${dow}_${ix}`}
                              style={{
                                paddingTop: ix === 0 ? 0 : 10,
                                marginTop: ix === 0 ? 0 : 10,
                                borderTop: ix === 0 ? "none" : `1px solid rgba(0,0,0,0.08)`,
                              }}
                            >
                              <div style={{ fontSize: 12, fontWeight: 950, color: UI.textDim }}>{DOW_LABELS[dow]}</div>

                              <div
                                style={{
                                  marginTop: 8,
                                  display: "grid",
                                  gridTemplateColumns: "1fr 1fr",
                                  gap: 10,
                                  alignItems: "start",
                                }}
                              >
                                <div style={{ display: "grid", gap: 4 }}>
                                  <div style={{ fontSize: 10.5, fontWeight: 950, color: UI.textDim }}>Availability</div>
                                  <div>
                                    <AvailabilityCell value={dayAvail} />
                                  </div>
                                </div>

                                <div style={{ display: "grid", gap: 6 }}>
                                  <div style={{ fontSize: 10.5, color: UI.textDim, fontWeight: 950 }}>Schedule</div>

                                  {daySchedule.length === 0 ? (
                                    <div style={{ fontSize: 11.5, color: "#9ca3af" }}>—</div>
                                  ) : (
                                    <div style={{ display: "grid", gap: 6 }}>
                                      {daySchedule.map((s, jx) => {
                                        const color = scheduleStatusColor(s.status);
                                        return (
                                          <div
                                            key={`${s.shiftId || `${s.client}_${s.startTime}_${s.endTime}_${s.date}`}:${jx}`}
                                            style={{
                                              display: "flex",
                                              justifyContent: "space-between",
                                              gap: 10,
                                              alignItems: "baseline",
                                              border: `1px solid rgba(0,0,0,0.08)`,
                                              borderRadius: 10,
                                              padding: "6px 8px",
                                             background: panelInlineRowBg,
                                            }}
                                            title={s.status ? `Status: ${s.status}` : undefined}
                                          >
                                            <div
                                              style={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: 6,
                                                minWidth: 0,
                                              }}
                                            >
                                              <div
                                                style={{
                                                  fontWeight: 950,
                                                  fontSize: 11.5,
                                                  overflow: "hidden",
                                                  textOverflow: "ellipsis",
                                                  whiteSpace: "nowrap",
                                                  color,
                                                }}
                                              >
                                                {s.client || "Client"}
                                              </div>

                                              {s.isDraft ? (
                                                <span
                                                  style={{
                                                    fontSize: 10,
                                                    fontWeight: 1000,
                                                    color: "#1d4ed8",
                                                    background: "#dbeafe",
                                                    border: "1px solid #93c5fd",
                                                    borderRadius: 999,
                                                    padding: "1px 6px",
                                                    whiteSpace: "nowrap",
                                                  }}
                                                >
                                                  Draft
                                                </span>
                                              ) : null}
                                            </div>

                                            <div style={{ fontSize: 11.5, fontWeight: 950, whiteSpace: "nowrap", color, opacity: 0.95 }}>
                                              {s.startTime}-{s.endTime}
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div style={{ marginTop: 10, borderTop: `1px solid rgba(0,0,0,0.08)`, paddingTop: 10 }}>
                        <div style={{ fontSize: 10.5, color: UI.textDim, fontWeight: 950 }}>Notes</div>
                        <div style={{ marginTop: 4, fontSize: 11.5, color: UI.text, whiteSpace: "pre-wrap" }}>
                          {availability?.notes ? availability.notes : <span style={{ color: "#9ca3af" }}>—</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          ) : applicantsLoading ? (
            <div style={{ padding: 12, fontSize: 13, color: UI.textDim }}>Loading applicants…</div>
          ) : filteredApplicants.length === 0 ? (
            <div style={{ padding: 12, fontSize: 13, color: UI.textDim }}>No applicants match this filter.</div>
          ) : (
            <div style={{ display: "grid", gap: 10, padding: 12 }}>
              {filteredApplicants.map((v, idx) => {
                const a = v.mini;
                const raw = v.raw;

                const id = norm(a.id) || `idx_${idx}`;
                const expanded = expandedAppId === id;

                const name = applicantDisplayName(a);
                const phone = norm(a.phone);
                const loc = norm(a.address);
                const avail = norm(a.availability);
                const status = norm(a.status);
                const cert = norm(a.certification);
                const stage = norm(a.onboardingStage);
                const vaccinated = norm(a.vaccinated);

                const age =
                  typeof a.age === "number" && Number.isFinite(a.age)
                    ? a.age
                    : ageFromBirthYear(a.birthYear ?? null);

                const notes = notesFromRaw(raw);
                const notesTooltip = notes || "No interview notes";

                const scoreInfo = v.scoreInfo;
                const score10 = v.score10;
                const scoreTooltip =
                  `Presentation: ${scoreInfo.breakdown[0].val ?? "—"}\n` +
                  `Experience: ${scoreInfo.breakdown[1].val ?? "—"}\n` +
                  `Personality: ${scoreInfo.breakdown[2].val ?? "—"}\n` +
                  `Reliability: ${scoreInfo.breakdown[3].val ?? "—"}\n` +
                  (score10 !== null ? `\nDisplayed: ${score10.toFixed(1)} / 10` : "");

                const diStr = norm(a.dateInterviewed);
                const di = diStr ? parseSheetDate(diStr) : null;
                const diLabel = di ? `${formatMDY(di)} (${formatAgoFromDays(diffDaysFromToday(di))})` : diStr || "—";

                return (
                  <div
                    key={`app:${id}:${idx}`}
                    title={notesTooltip}
                    onClick={() => setExpandedAppId((cur) => (cur === id ? null : id))}
                    style={{
                      border: `1px solid rgba(0,0,0,0.10)`,
                      borderRadius: 12,
                     padding: 10,
scrollMarginTop: 80,
                      background: panelCardBg,
backdropFilter: isGhost ? "blur(.5px)" : "none",
WebkitBackdropFilter: isGhost ? "blur(.5px)" : "none",
                      cursor: "pointer",
                      boxShadow: expanded ? "0 6px 18px rgba(30,58,138,0.10)" : "none",
                      transition: "box-shadow 140ms ease",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontWeight: 950,
                            fontSize: 15,
                            lineHeight: 1.2,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            color: UI.text,
                          }}
                        >
                          {name}
                        </div>

                        <div style={{ marginTop: 6, fontSize: 12, fontWeight: 850, color: UI.textDim }}>
                          Date interviewed: <span style={{ color: UI.text }}>{diLabel}</span>
                        </div>
                      </div>

                      <div style={{ display: "grid", gap: 6, justifyItems: "end", whiteSpace: "nowrap" }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end" }}>
                          <ScorePill score10={score10} title={scoreTooltip} />
                          <StatusChip value={status} />
                        </div>
                        <div style={{ fontSize: 11.5, fontWeight: 900, color: UI.textDim }}>
                          {expanded ? "Click to collapse" : "Click to expand"}
                        </div>
                      </div>
                    </div>

                    <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
                      <div style={{ fontSize: 12, color: UI.textDim, fontWeight: 900 }}>
                        {phone ? `📞 ${phone}` : "📞 —"}
                      </div>

                      <div style={{ fontSize: 12, color: UI.text, fontWeight: 900 }}>{loc ? `📍 ${loc}` : "📍 —"}</div>

                      <div style={{ fontSize: 12, color: UI.textDim, fontWeight: 900 }}>
                        <span style={{ marginRight: 6 }}>Availability:</span>
                        <AvailabilityCell value={avail || "—"} />
                      </div>
                    </div>

                    {expanded ? (
                      <div style={{ marginTop: 12, borderTop: `1px solid rgba(0,0,0,0.08)`, paddingTop: 12 }}>
                        <div style={{ fontSize: 12, fontWeight: 950, color: UI.textDim }}>Score breakdown</div>
                        <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                          {scoreInfo.breakdown.map((b) => (
                            <div
                              key={b.key}
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                gap: 10,
                                fontSize: 12,
                                fontWeight: 900,
                                color: UI.text,
                              }}
                            >
                              <span style={{ color: UI.textDim }}>{b.key}</span>
                              <span>{b.val == null ? "—" : String(b.val)}</span>
                            </div>
                          ))}
                        </div>

                        <div style={{ marginTop: 12, fontSize: 12, fontWeight: 950, color: UI.textDim }}>Applicant details</div>

                        <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                          <div style={{ fontSize: 12, fontWeight: 900, color: UI.textDim }}>
                            Certification
                            <div style={{ marginTop: 2, color: UI.text, fontWeight: 900 }}>{cert || "—"}</div>
                          </div>

                          <div style={{ fontSize: 12, fontWeight: 900, color: UI.textDim }}>
                            Vaccinated
                            <div style={{ marginTop: 2, color: UI.text, fontWeight: 900 }}>{vaccinated || "—"}</div>
                          </div>

                          <div style={{ fontSize: 12, fontWeight: 900, color: UI.textDim }}>
                            Stage
                            <div style={{ marginTop: 2, color: UI.text, fontWeight: 900 }}>{stage || "—"}</div>
                          </div>

                          <div style={{ fontSize: 12, fontWeight: 900, color: UI.textDim }}>
                            Age
                            <div style={{ marginTop: 2, color: UI.text, fontWeight: 900 }}>{age == null ? "—" : String(age)}</div>
                          </div>
                        </div>

                        <div style={{ marginTop: 12 }}>
                          <div style={{ fontSize: 12, fontWeight: 950, color: UI.textDim }}>Notes</div>
                          <div style={{ marginTop: 6, fontSize: 12, fontWeight: 850, color: UI.text, whiteSpace: "pre-wrap" }}>
                            {notes ? notes : <span style={{ color: "#9ca3af" }}>—</span>}
                          </div>
                        </div>

                        <div style={{ marginTop: 12 }}>
                          <div style={{ fontSize: 12, fontWeight: 950, color: UI.textDim }}>Age</div>
                          <div style={{ marginTop: 6, fontSize: 12, fontWeight: 850, color: UI.text }}>
                            {age == null ? <span style={{ color: "#9ca3af" }}>—</span> : `${age}`}
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ height: 6 }} />
        </div>
      </div>
    </aside>
  );
}

function snapButtonStyle(active: boolean): React.CSSProperties {
  return {
    border: `1px solid ${active ? UI.navy : UI.border}`,
    background: active ? UI.navy : "#fff",
    color: active ? "#fff" : UI.text,
    borderRadius: 999,
    padding: "6px 10px",
    cursor: "pointer",
    fontWeight: 900,
    fontSize: 12,
    whiteSpace: "nowrap",
  };
}

function selectStyle(): React.CSSProperties {
  return {
    border: `1px solid ${UI.border}`,
    borderRadius: 12,
    padding: "8px 10px",
    fontSize: 13,
    fontWeight: 900,
    outline: "none",
    background: "rgba(255,255,255,0.95)",
    boxShadow: "inset 0 1px 2px rgba(0,0,0,0.04)",
    cursor: "pointer",
  };
}
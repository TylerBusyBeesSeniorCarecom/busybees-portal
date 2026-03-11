// app/schedule/useShiftInfo.ts
import { useMemo } from "react";

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
  dow: number;
};

type ClockEntry = {
  clockInTime: string | null;
  clockOutTime: string | null;
};
type ClockMap = Record<string, ClockEntry>;

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

function norm(v: any) {
  return (v ?? "").toString().trim();
}
function normalizeKey(v: string) {
  return norm(v).toLowerCase();
}

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

type ShiftTimeState = "future" | "in_progress" | "past" | "unknown";
function shiftTimeState(scheduledStart: Date | null, scheduledEnd: Date | null, nowMs: number): ShiftTimeState {
  if (!scheduledStart || !scheduledEnd) return "unknown";
  const start = scheduledStart.getTime();
  const end = scheduledEnd.getTime();
  if (nowMs < start) return "future";
  if (nowMs >= start && nowMs <= end) return "in_progress";
  return "past";
}

function normVerdict(v: any) {
  return norm(v).toLowerCase();
}
function isBadVerdict(v: string | null) {
  const x = normVerdict(v);
  if (!x) return false;
  return x === "off_site" || x === "offsite" || x === "no_geofence" || x === "location_unavailable";
}
function isOnSite(v: string | null) {
  const x = normVerdict(v);
  return x === "on_site" || x === "onsite" || x === "on site";
}

function makeShiftLookupKey(args: { client: string; date: string; start: string; end: string; caregiver: string }) {
  const client = normalizeKey(args.client);
  const date = dateKey(args.date);
  const start = norm(args.start).replace(/\s+/g, "").toUpperCase();
  const end = norm(args.end).replace(/\s+/g, "").toUpperCase();
  const caregiver = normalizeKey(args.caregiver.replace(/[()"]/g, "").trim());
  return `${client}__${date}__${start}__${end}__${caregiver}`;
}

function evalClockForShift(
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

export function useShiftInfo(args: {
  week: WeekKind;
  scheduleRows: ShiftRow[];
  shiftIdLookup: Record<string, string>;
  clockMap: ClockMap;
  locationMap: LocationMap;
}) {
  const { scheduleRows, shiftIdLookup, clockMap, locationMap } = args;

  // Optional: index schedule rows for faster direct matching if needed later.
  const scheduleIndex = useMemo(() => {
    // key: client__date__start__end__caregiver (caregiver included)
    const m = new Map<string, ShiftRow>();
    for (const s of scheduleRows) {
      const key = makeShiftLookupKey({
        client: s.client,
        date: s.date,
        start: s.startTime,
        end: s.endTime,
        caregiver: s.caregiver || "",
      });
      m.set(key, s);
    }
    return m;
  }, [scheduleRows]);

  function getGridShiftInfo(input: {
    clientName: string;
    dateStr: string;
    startTime: string;
    endTime: string;
    caregiverName: string; // "" for open shifts is ok
    isCancelled: boolean;
  }) {
    const clientName = norm(input.clientName);
    const dateStr = norm(input.dateStr);
    const startTime = norm(input.startTime);
    const endTime = norm(input.endTime);
    const caregiverName = norm(input.caregiverName);

    if (!clientName || !dateStr || !startTime || !endTime || input.isCancelled) {
      // cancelled or missing inputs: still return stable object if needed
      const clockEval = evalClockForShift(dateStr, startTime, endTime, null, clockMap, 15);
      const timeState = shiftTimeState(clockEval.scheduledStart, clockEval.scheduledEnd, Date.now());
      return {
        shiftId: "",
        clockEval,
        timeState,
        inVerdict: null as string | null,
        outVerdict: null as string | null,
        hasClockIssue: false,
        hasLocationIssue: false,
        isPastNoClocks: false,
        isVerified: false,
        showFlag: false,
      };
    }

    const key = makeShiftLookupKey({
      client: clientName,
      date: dateStr,
      start: startTime,
      end: endTime,
      caregiver: caregiverName || "",
    });

    const shiftId = shiftIdLookup[key] || scheduleIndex.get(key)?.shiftId || "";

    const clockEval = evalClockForShift(dateStr, startTime, endTime, shiftId || null, clockMap, 15);
    const timeState = shiftTimeState(clockEval.scheduledStart, clockEval.scheduledEnd, Date.now());

    const loc = shiftId ? locationMap[shiftId] : undefined;
    const inVerdict = loc?.clockIn?.verdict ?? null;
    const outVerdict = loc?.clockOut?.verdict ?? null;

    const hasLocationIssue = Boolean(isBadVerdict(inVerdict) || isBadVerdict(outVerdict));

    // clock issue rules (match your main file logic)
    const hasClockIssueRaw = clockEval.state === "bad";
    const inIsGoodOrOk = Boolean(clockEval.clockIn) && (clockEval.diffInMin == null || Math.abs(clockEval.diffInMin) <= 15);
    const isInProgressMissingOutButOk = timeState === "in_progress" && inIsGoodOrOk && !clockEval.clockOut;
    const hasClockIssue = hasClockIssueRaw && !isInProgressMissingOutButOk;

    const isPastNoClocks = timeState === "past" && !clockEval.clockIn && !clockEval.clockOut;

    const isVerified =
      timeState === "past" &&
      Boolean(clockEval.clockIn && clockEval.clockOut) &&
      clockEval.state === "good" &&
      isOnSite(inVerdict) &&
      isOnSite(outVerdict) &&
      !hasLocationIssue;

    const showFlag = (hasClockIssue || hasLocationIssue || isPastNoClocks) && !isVerified;

    return {
      shiftId,
      clockEval,
      timeState,
      inVerdict,
      outVerdict,
      hasClockIssue,
      hasLocationIssue,
      isPastNoClocks,
      isVerified,
      showFlag,
    };
  }

  return { getGridShiftInfo };
}

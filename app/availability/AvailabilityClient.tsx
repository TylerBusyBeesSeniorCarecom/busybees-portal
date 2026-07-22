"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type RawValues = string[][];
type WeekKind = "cw" | "nw";

const UI = {
  pageBg: "#f3f4f6",
  panelBg: "#ffffff",
  headerBg: "#f9fafb",
  border: "#d1d5db",
  borderSoft: "#e5e7eb",
  text: "#111827",
  textDim: "#6b7280",
};

function norm(s: any) {
  return (s ?? "").toString().trim();
}

function containsCI(haystack: string, needle: string) {
  const h = (haystack || "").toLowerCase();
  const n = (needle || "").toLowerCase().trim();
  if (!n) return true;
  return h.includes(n);
}

// Small “chip” renderer for availability cells
function AvailabilityCell({ value }: { value: string }) {
  const v = (value || "").trim();
  if (!v || v === "—") return <span style={{ color: "#9ca3af" }}>—</span>;

  const lower = v.toLowerCase();

  const isOff =
    lower === "off" ||
    lower.includes("not available") ||
    lower.includes("unavailable");

  const isOpen =
    lower === "open" ||
    lower.includes("anytime") ||
    lower.includes("available all day");

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
    <span style={{ fontWeight: 700, color: UI.text, whiteSpace: "pre-wrap" }}>
      {v}
    </span>
  );
}

/** ---------- Schedule parsing ---------- */

type ShiftRow = {
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

const DOW_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function parseDateToDow(dateStr: string): number {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return 0;
  return d.getDay();
}

function toDateSafe(dateStr: string): Date | null {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function normalizeSchedule(values: RawValues): ShiftRow[] {
  if (!values || values.length === 0) return [];
  const headers = values[0].map((h) => (h || "").trim());
  const rows = values.slice(1);

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

function fmtShiftLine(s: ShiftRow): string {
  const client = s.client?.trim() || "Client";
  const time = s.startTime && s.endTime ? `${s.startTime}–${s.endTime}` : "";
  return `${client}${time ? ` • ${time}` : ""}`;
}

function statusTag(statusRaw: string): { bg: string; fg: string; border: string } {
  const s = (statusRaw || "").toLowerCase();
  if (s.includes("filled")) return { bg: "#ecfdf5", fg: "#065f46", border: "#a7f3d0" };
  if (s.includes("offered")) return { bg: "#eff6ff", fg: "#1d4ed8", border: "#bfdbfe" };
  if (s.includes("consider")) return { bg: "#fff7ed", fg: "#9a3412", border: "#fed7aa" };
  if (s.includes("open")) return { bg: "#fef2f2", fg: "#991b1b", border: "#fecaca" };
  return { bg: "#f3f4f6", fg: "#374151", border: "#e5e7eb" };
}

function dayHeaderToDow(h: string): number | null {
  const raw = (h || "").trim().toLowerCase();
  if (!raw) return null;

  // headers like "Sunday (2/1)"
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

// ---- hours calc (handles overnight) ----

function parseTimeToMinutes(t: string): number | null {
  const raw = (t || "").trim();
  if (!raw) return null;

  const normalized = raw.replace(/\s+/g, " ").replace(/([AP]M)$/i, " $1").trim();
  const m = normalized.match(/^(\d{1,2})(?::(\d{2}))?\s*([AP]M)$/i);
  if (!m) return null;

  let hh = parseInt(m[1], 10);
  let mm = m[2] ? parseInt(m[2], 10) : 0;
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
  if (end <= start) end += 24 * 60; // overnight
  return Math.max(0, (end - start) / 60);
}

function isFilled(statusRaw: string): boolean {
  return (statusRaw || "").toLowerCase().includes("filled");
}
function isOpen(statusRaw: string): boolean {
  return (statusRaw || "").toLowerCase().includes("open");
}

function availCategory(raw: string): "has_avail" | "no_avail" | "not_avail" {
  const v = (raw || "").trim();
  if (!v || v === "—") return "no_avail";

  const lower = v.toLowerCase();
  const isOff =
    lower === "off" ||
    lower.includes("not available") ||
    lower.includes("unavailable") ||
    lower === "none";

  if (isOff) return "not_avail";

  // anything else counts as "has availability filled out"
  return "has_avail";
}

function safeNumber(n: any): number {
  const x = typeof n === "number" ? n : parseFloat((n ?? "").toString());
  return Number.isFinite(x) ? x : 0;
}

/** ---------- Desired Hours handling (special case: "As Many as possible") ---------- */

function isAsManyAsPossible(raw: string): boolean {
  const v = (raw || "").trim().toLowerCase();
  return (
    v === "as many as possible" ||
    v.includes("as many as possible") ||
    v.includes("as much as possible") ||
    v.includes("as many as")
  );
}

function desiredHoursSortValue(
  r: string[],
  desiredHoursIdx: number
): { wantsMax: boolean; hours: number } {
  if (desiredHoursIdx < 0) return { wantsMax: false, hours: 0 };

  const raw = norm(r[desiredHoursIdx]);
  const wantsMax = isAsManyAsPossible(raw);

  if (wantsMax) return { wantsMax: true, hours: 0 }; // hours unused when wantsMax is true
  return { wantsMax: false, hours: safeNumber(raw) };
}

/** ---------- Component ---------- */

export default function AvailabilityClient() {
  const [week, setWeek] = useState<WeekKind>("cw");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<RawValues>([]);
  const [tabName, setTabName] = useState<string>("");

  // schedule cache
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [scheduleValues, setScheduleValues] = useState<RawValues>([]);

  // ✅ Needs panel show/hide
  const [needsOpen, setNeedsOpen] = useState(true);

  // ✅ Day filter: null = All days, 0..6 = that day only
  const [selectedDow, setSelectedDow] = useState<number | null>(null);

  // ✅ Search
  const [caregiverSearch, setCaregiverSearch] = useState("");
  const [needsClientSearch, setNeedsClientSearch] = useState("");
  const [needsCaregiverSearch, setNeedsCaregiverSearch] = useState("");

  // ✅ Needs panel mode
  type DrawerMode = "open" | "unconfirmed" | "both";
  const [drawerMode, setDrawerMode] = useState<DrawerMode>("both");
  const [drawerCollapsed, setDrawerCollapsed] = useState<Record<number, boolean>>({
    0: false,
    1: false,
    2: false,
    3: false,
    4: false,
    5: false,
    6: false,
  });

  // ✅ New: selected shift from drawer (for smart sorting)
  const [selectedShiftKey, setSelectedShiftKey] = useState<string | null>(null);

  // ✅ New: table sorting
  type SortMode = "smart" | "desired_desc" | "total_asc" | "gap_desc" | "name_asc";
  const [sortMode, setSortMode] = useState<SortMode>("smart");

  // ✅ refs for synced horizontal scrollbar
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const topHScrollRef = useRef<HTMLDivElement | null>(null);
  const topHScrollInnerRef = useRef<HTMLDivElement | null>(null);

  // Fetch availability
  useEffect(() => {
    let alive = true;

    async function run() {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch(`/api/availability?week=${week}`, { cache: "no-store" });
        const data = await res.json();

        if (!data?.ok) throw new Error(data?.error || "Failed to load availability");
        if (alive) {
          setValues(data.values ?? []);
          setTabName(data.tabName ?? "");
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

  // ✅ Whenever Unconfirmed Shifts panel is open, force Schedule ON
  useEffect(() => {
    if (needsOpen && !showSchedule) setShowSchedule(true);
  }, [needsOpen, showSchedule]);

  // ✅ Also prevent turning schedule OFF while panel is open
  useEffect(() => {
    if (needsOpen && showSchedule === false) setShowSchedule(true);
  }, [needsOpen, showSchedule]);

  // Fetch schedule when showSchedule is true
  useEffect(() => {
    let alive = true;

    async function runSchedule() {
      if (!showSchedule) return;

      try {
        setScheduleLoading(true);
        setScheduleError(null);

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

        if (alive) setScheduleValues(data.values ?? []);
      } catch (e: any) {
        if (alive) setScheduleError(e?.message ?? "Unknown error");
      } finally {
        if (alive) setScheduleLoading(false);
      }
    }

    runSchedule();
    return () => {
      alive = false;
    };
  }, [showSchedule, week]);

  const headers = useMemo(() => (values?.[0] ?? []).map((h) => norm(h)), [values]);
  const rowsAll = useMemo(() => (values?.length ? values.slice(1) : []), [values]);

  // Find key column indexes (availability sheet)
  const caregiverNameIdx = useMemo(
    () => headers.findIndex((h) => h.toLowerCase() === "caregiver name"),
    [headers]
  );
  const caregiverIdIdx = useMemo(
    () => headers.findIndex((h) => h.toLowerCase() === "caregiver id"),
    [headers]
  );
  const weekStartIdx = useMemo(() => {
    const a = headers.findIndex((h) => h.toLowerCase() === "week start date");
    if (a !== -1) return a;
    return headers.findIndex((h) => h.toLowerCase() === "week start");
  }, [headers]);

  const saturdayIdx = useMemo(() => headers.findIndex((h) => dayHeaderToDow(h) === 6), [headers]);
  const desiredHoursIdx = useMemo(() => headers.findIndex((h) => h.toLowerCase() === "desired hours"), [headers]);

  // Identify which columns are day columns in availability sheet
  const dayCols = useMemo(() => {
    const out: Array<{ colIndex: number; dow: number }> = [];
    headers.forEach((h, colIndex) => {
      const dow = dayHeaderToDow(h);
      if (dow != null) out.push({ colIndex, dow });
    });
    return out;
  }, [headers]);

  // Build visible columns (hide caregiver id + week start date)
  const baseVisibleColIndexes = useMemo(() => {
    const hidden = new Set<number>([caregiverIdIdx, weekStartIdx, desiredHoursIdx].filter((n) => n >= 0));
    const idxs: number[] = [];

    for (let i = 0; i < headers.length; i++) {
      if (hidden.has(i)) continue;
      idxs.push(i);
    }

    // Ensure Caregiver Name first (sticky)
    if (caregiverNameIdx >= 0) {
      const filtered = idxs.filter((i) => i !== caregiverNameIdx);
      return [caregiverNameIdx, ...filtered];
    }
    return idxs;
  }, [headers, caregiverIdIdx, weekStartIdx, caregiverNameIdx, desiredHoursIdx]);

  type ColSpec = { kind: "real"; colIndex: number };

  const visibleColsAllDays: ColSpec[] = useMemo(() => {
    return baseVisibleColIndexes.map((i) => ({ kind: "real", colIndex: i }));
  }, [baseVisibleColIndexes]);

  const visibleCols = useMemo((): ColSpec[] => {
    if (selectedDow == null) return visibleColsAllDays;

    const dayCol = dayCols.find((d) => d.dow === selectedDow);
    const dayColIndex = dayCol?.colIndex ?? -1;

    const out: ColSpec[] = [];
    if (caregiverNameIdx >= 0) out.push({ kind: "real", colIndex: caregiverNameIdx });

    if (dayColIndex >= 0 && dayColIndex !== caregiverNameIdx) {
      out.push({ kind: "real", colIndex: dayColIndex });
    }

    return out;
  }, [selectedDow, visibleColsAllDays, dayCols, caregiverNameIdx]);

  const visibleHeaders = useMemo(() => {
    return visibleCols.map((c) => headers[c.colIndex] ?? "");
  }, [visibleCols, headers]);

  function colWidthPx(col: ColSpec): number {
    const i = col.colIndex;
    if (i === caregiverNameIdx) return 160;

    const isDay = dayCols.some((d) => d.colIndex === i);
    if (isDay) return 190;

    return 110;
  }

  const tableContentWidth = useMemo(() => {
    return visibleCols.reduce((sum, c) => sum + colWidthPx(c), 0);
  }, [visibleCols, dayCols, caregiverNameIdx]);

  // Schedule normalized rows
  const shiftsAll = useMemo(() => normalizeSchedule(scheduleValues), [scheduleValues]);

  // schedule map: caregiverKey -> dow -> shifts[]
  const scheduleMap = useMemo(() => {
    const map: Record<string, Record<number, ShiftRow[]>> = {};
    for (const s of shiftsAll) {
      const cgId = (s.caregiverId || "").trim();
      const cgName = (s.caregiver || "").trim();

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
  }, [shiftsAll]);

  const scheduleHoursByCaregiverKey = useMemo(() => {
    const out: Record<string, number> = {};
    for (const s of shiftsAll) {
      const cgId = (s.caregiverId || "").trim();
      const cgName = (s.caregiver || "").trim();
      if (cgId.toLowerCase() === "open") continue;
      if (!cgId && cgName.toLowerCase() === "open") continue;

      const key = (cgId || cgName).trim();
      if (!key) continue;

      out[key] = (out[key] ?? 0) + shiftDurationHours(s.startTime, s.endTime);
    }
    return out;
  }, [shiftsAll]);

  /** --------- Unconfirmed Shifts panel shifts --------- */

  const needShiftsBase = useMemo(() => {
    if (!showSchedule) return [];

    return shiftsAll.filter((s) => {
      const st = (s.status || "").trim();
      const open = isOpen(st);
      const unconfirmed = !isFilled(st);

      if (drawerMode === "open") return open;
      if (drawerMode === "unconfirmed") return unconfirmed;
      return open || unconfirmed;
    });
  }, [showSchedule, shiftsAll, drawerMode]);

  const needShifts = useMemo(() => {
    return needShiftsBase.filter((s) => {
      if (selectedDow != null && s.dow !== selectedDow) return false;
      if (needsClientSearch.trim() && !containsCI(s.client, needsClientSearch)) return false;

      const cg = `${s.caregiver || ""} ${s.caregiverId || ""}`.trim();
      if (needsCaregiverSearch.trim() && !containsCI(cg, needsCaregiverSearch)) return false;

      return true;
    });
  }, [needShiftsBase, selectedDow, needsClientSearch, needsCaregiverSearch]);

  const needByDow = useMemo(() => {
    const groups: Array<{ dow: number; items: ShiftRow[]; dateLabel: string }> = [];
    for (let dow = 0; dow <= 6; dow++) {
      if (selectedDow != null && dow !== selectedDow) {
        groups.push({ dow, items: [], dateLabel: "" });
        continue;
      }

      const items = needShifts.filter((s) => s.dow === dow);
      items.sort((a, b) => (a.startTime || "").localeCompare(b.startTime || ""));

      let earliest: Date | null = null;
      for (const s of items) {
        const d = toDateSafe(s.date);
        if (!d) continue;
        if (!earliest || d.getTime() < earliest.getTime()) earliest = d;
      }
      const dateLabel = earliest ? `${earliest.getMonth() + 1}/${earliest.getDate()}` : "";

      groups.push({ dow, items, dateLabel });
    }
    return groups;
  }, [needShifts, selectedDow]);

  const drawerCounts = useMemo(() => {
    let open = 0;
    let unconfirmed = 0;
    for (const s of shiftsAll) {
      const st = (s.status || "").trim();
      if (isOpen(st)) open += 1;
      if (!isFilled(st)) unconfirmed += 1;
    }
    return { open, unconfirmed };
  }, [shiftsAll]);

  // ✅ Caregiver search filter for table rows (base filter only)
  const rowsFiltered = useMemo(() => {
    if (!caregiverSearch.trim()) return rowsAll;
    const q = caregiverSearch.trim().toLowerCase();
    return rowsAll.filter((r) => {
      const name = caregiverNameIdx >= 0 ? norm(r[caregiverNameIdx]) : "";
      return name.toLowerCase().includes(q);
    });
  }, [rowsAll, caregiverSearch, caregiverNameIdx]);

  // --- helpers for sorting ---
  const dayColIndexForSelectedDow = useMemo(() => {
    if (selectedDow == null) return -1;
    const dc = dayCols.find((d) => d.dow === selectedDow);
    return dc?.colIndex ?? -1;
  }, [selectedDow, dayCols]);

  function caregiverKeyFromRow(r: string[]): string {
    const caregiverName = caregiverNameIdx >= 0 ? norm(r[caregiverNameIdx]) : "";
    const caregiverId = caregiverIdIdx >= 0 ? norm(r[caregiverIdIdx]) : "";
    return (caregiverId || caregiverName).trim();
  }

  function caregiverNameFromRow(r: string[]): string {
    return caregiverNameIdx >= 0 ? norm(r[caregiverNameIdx]) : "";
  }

  function desiredHoursFromRow(r: string[]): number {
    return desiredHoursSortValue(r, desiredHoursIdx).hours;
  }

  function dayAvailFromRow(r: string[]): string {
    if (dayColIndexForSelectedDow < 0) return "";
    return norm(r[dayColIndexForSelectedDow]);
  }

  function dayShiftCountForKey(key: string): number {
    if (selectedDow == null) return 0;
    return (scheduleMap[key]?.[selectedDow] ?? []).length;
  }

  // ✅ SMART SORT:
  // 1) Has availability filled out for that day AND has 0 shifts that day -> order by desired hours (desc, "As many as possible" first)
  // 2) Has availability filled out for that day AND has shifts -> order by least shifts to most shifts (then desired desc; "As many as possible" first)
  // 3) No availability / blank -> later
  // 4) Not available / none -> last
  function smartRankRow(r: string[]) {
    const key = caregiverKeyFromRow(r);
    const desiredMeta = desiredHoursSortValue(r, desiredHoursIdx);
    const availRaw = dayAvailFromRow(r);
    const cat = availCategory(availRaw);
    const shiftCount = key ? dayShiftCountForKey(key) : 0;

    let group = 2;
    if (cat === "has_avail" && shiftCount === 0) group = 0;
    else if (cat === "has_avail" && shiftCount > 0) group = 1;
    else if (cat === "no_avail") group = 2;
    else if (cat === "not_avail") group = 3;

    return {
      group,
      wantsMax: desiredMeta.wantsMax,
      desired: desiredMeta.hours,
      shiftCount,
      name: caregiverNameFromRow(r).toLowerCase(),
    };
  }

  // ✅ apply sorting AFTER search filter
  const rows = useMemo(() => {
    const base = [...rowsFiltered];

    const getTotal = (r: string[]) => {
      const key = caregiverKeyFromRow(r);
      return key ? (scheduleHoursByCaregiverKey[key] ?? 0) : 0;
    };

    const getGap = (r: string[]) => {
      const meta = desiredHoursSortValue(r, desiredHoursIdx);
      const total = getTotal(r);

      // If they want max hours, always float to top for Gap sort
      if (meta.wantsMax) return Number.POSITIVE_INFINITY;

      return meta.hours - total;
    };

    base.sort((a, b) => {
      // Always keep deterministic tiebreakers
      const nameA = caregiverNameFromRow(a).toLowerCase();
      const nameB = caregiverNameFromRow(b).toLowerCase();

      if (sortMode === "name_asc") return nameA.localeCompare(nameB);

      if (sortMode === "desired_desc") {
        const da = desiredHoursSortValue(a, desiredHoursIdx);
        const db = desiredHoursSortValue(b, desiredHoursIdx);

        // "As Many as possible" should be top
        if (da.wantsMax !== db.wantsMax) return da.wantsMax ? -1 : 1;

        // numeric high → low
        if (db.hours !== da.hours) return db.hours - da.hours;

        return nameA.localeCompare(nameB);
      }

      if (sortMode === "total_asc") {
        const tA = getTotal(a);
        const tB = getTotal(b);
        if (tA !== tB) return tA - tB;
        return nameA.localeCompare(nameB);
      }

      if (sortMode === "gap_desc") {
        const gA = getGap(a);
        const gB = getGap(b);
        if (gB !== gA) return gB - gA;
        return nameA.localeCompare(nameB);
      }

      // SMART
      // If no day selected, fall back to name
      if (selectedDow == null || dayColIndexForSelectedDow < 0) {
        return nameA.localeCompare(nameB);
      }

      const ra = smartRankRow(a);
      const rb = smartRankRow(b);

      if (ra.group !== rb.group) return ra.group - rb.group;

      // group 0: desired desc (As many as possible first)
      if (ra.group === 0) {
        if (ra.wantsMax !== rb.wantsMax) return ra.wantsMax ? -1 : 1;
        if (rb.desired !== ra.desired) return rb.desired - ra.desired;
        return nameA.localeCompare(nameB);
      }

      // group 1: least shifts first, then desired desc (As many as possible first)
      if (ra.group === 1) {
        if (ra.shiftCount !== rb.shiftCount) return ra.shiftCount - rb.shiftCount;
        if (ra.wantsMax !== rb.wantsMax) return ra.wantsMax ? -1 : 1;
        if (rb.desired !== ra.desired) return rb.desired - ra.desired;
        return nameA.localeCompare(nameB);
      }

      // groups 2/3: alphabetical
      return nameA.localeCompare(nameB);
    });

    return base;
  }, [
    rowsFiltered,
    sortMode,
    selectedDow,
    dayColIndexForSelectedDow,
    caregiverNameIdx,
    caregiverIdIdx,
    desiredHoursIdx,
    scheduleHoursByCaregiverKey,
    scheduleMap,
  ]);

  // UI: day chips
  const DayChip = ({
    label,
    active,
    onClick,
  }: {
    label: string;
    active: boolean;
    onClick: () => void;
  }) => (
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

  /** ---------- Always-visible horizontal scrollbar syncing ---------- */

  useEffect(() => {
    const tableEl = tableScrollRef.current;
    const topEl = topHScrollRef.current;
    if (!tableEl || !topEl) return;

    let syncingFrom: "table" | "top" | null = null;

    const onTableScroll = () => {
      if (!topEl) return;
      if (syncingFrom === "top") return;
      syncingFrom = "table";
      topEl.scrollLeft = tableEl.scrollLeft;
      syncingFrom = null;
    };

    const onTopScroll = () => {
      if (!tableEl) return;
      if (syncingFrom === "table") return;
      syncingFrom = "top";
      tableEl.scrollLeft = topEl.scrollLeft;
      syncingFrom = null;
    };

    tableEl.addEventListener("scroll", onTableScroll, { passive: true });
    topEl.addEventListener("scroll", onTopScroll, { passive: true });

    topEl.scrollLeft = tableEl.scrollLeft;

    return () => {
      tableEl.removeEventListener("scroll", onTableScroll);
      topEl.removeEventListener("scroll", onTopScroll);
    };
  }, [tableContentWidth, needsOpen, selectedDow, week, showSchedule]);

  /** ---------- Click behavior from Unconfirmed shifts ---------- */

  function selectShiftFromDrawer(s: ShiftRow) {
    // 1) filter by that day
    setSelectedDow(s.dow);

    // 2) switch to smart sort (so it uses the day ranking)
    setSortMode("smart");

    // 3) store selected shift key (for visual highlight)
    const k = s.shiftId || `${s.client}|${s.date}|${s.startTime}|${s.endTime}`;
    setSelectedShiftKey(k);

    // (optional) clear caregiver search so they see the full prioritized list
    setCaregiverSearch("");
  }

  /** ---------- Render ---------- */

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
      {/* ✅ Sticky top bar */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 50,
          background: UI.pageBg,
          paddingBottom: 10,
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: 22 }}>Availability</h1>
            <p style={{ opacity: 0.8, marginTop: 6, fontSize: 13 }}>
              Source:{" "}
              <code>{tabName || (week === "cw" ? "CW Availability" : "NW Availability")}</code>
              {showSchedule && (
                <span style={{ marginLeft: 10, fontSize: 12, color: UI.textDim }}>
                  (Schedule: {scheduleLoading ? "loading…" : scheduleError ? "error" : "ready"})
                </span>
              )}
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {/* Week toggle */}
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
                  padding: "8px 12px",
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
                  padding: "8px 12px",
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

            {/* Unconfirmed Shifts toggle */}
            <button
              type="button"
              onClick={() => {
                setNeedsOpen((v) => {
                  const next = !v;
                  if (next) setShowSchedule(true);
                  return next;
                });
              }}
              style={{
                border: `1px solid ${UI.border}`,
                background: needsOpen ? "#111827" : UI.headerBg,
                color: needsOpen ? "#fff" : UI.text,
                borderRadius: 12,
                padding: "8px 12px",
                fontSize: 13,
                cursor: "pointer",
                fontWeight: 900,
              }}
              title="Show/hide Unconfirmed Shifts panel (opening forces Schedule ON)"
            >
              Unconfirmed: {needsOpen ? "ON" : "OFF"}
            </button>

            {/* Schedule toggle (disabled when panel is open) */}
            <button
              type="button"
              onClick={() => {
                if (needsOpen) return;
                setShowSchedule((v) => !v);
              }}
              style={{
                border: `1px solid ${UI.border}`,
                background: showSchedule ? "#111827" : UI.headerBg,
                color: showSchedule ? "#fff" : UI.text,
                borderRadius: 12,
                padding: "8px 12px",
                fontSize: 13,
                cursor: needsOpen ? "not-allowed" : "pointer",
                opacity: needsOpen ? 0.55 : 1,
                fontWeight: 900,
              }}
              title={needsOpen ? "Unconfirmed panel is ON, schedule stays ON" : "Toggle schedule overlay"}
            >
              {showSchedule ? "Schedule: ON" : "Schedule: OFF"}
            </button>

            <a
              href={`/api/availability?week=${week}`}
              style={{ textDecoration: "underline", opacity: 0.9, fontSize: 13 }}
            >
              Test API
            </a>

            <a href="/schedule" style={{ textDecoration: "underline", opacity: 0.9, fontSize: 13 }}>
              Back to Schedule
            </a>
          </div>
        </header>

        {/* ✅ Day filter chips + caregiver search + sort */}
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
              <DayChip key={d} label={d} active={selectedDow === idx} onClick={() => setSelectedDow(idx)} />
            ))}
          </div>

          <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            {/* ✅ Sort */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 900, color: UI.textDim }}>Sort:</div>
              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as any)}
                style={{
                  border: `1px solid ${UI.border}`,
                  borderRadius: 12,
                  padding: "8px 10px",
                  fontSize: 13,
                  outline: "none",
                  background: UI.panelBg,
                  fontWeight: 800,
                }}
              >
                <option value="smart">Smart (selected day)</option>
                <option value="desired_desc">Desired Hours (high → low)</option>
                <option value="total_asc">Total Hours (low → high)</option>
                <option value="gap_desc">Desired - Total (high → low)</option>
                <option value="name_asc">Name (A → Z)</option>
              </select>
            </div>

            <input
              value={caregiverSearch}
              onChange={(e) => setCaregiverSearch(e.target.value)}
              placeholder="Search caregivers…"
              style={{
                width: 260,
                border: `1px solid ${UI.border}`,
                borderRadius: 12,
                padding: "8px 10px",
                fontSize: 13,
                outline: "none",
                background: UI.panelBg,
              }}
            />
          </div>
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

      {!loading && !error && showSchedule && scheduleError && (
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
          Schedule error: {scheduleError}
        </pre>
      )}

      {!loading && !error && (
        <div style={{ marginTop: 14, display: "flex", gap: 12, alignItems: "flex-start" }}>
          {/* LEFT: availability table */}
          <div style={{ flex: 1, minWidth: needsOpen ? 860 : 980 }}>
            <div
              style={{
                border: `1px solid ${UI.border}`,
                borderRadius: 12,
                background: UI.panelBg,
                overflow: "hidden",
              }}
            >
              {/* ✅ Always-visible horizontal scrollbar (synced to table) */}
              <div
                style={{
                  borderBottom: `1px solid ${UI.borderSoft}`,
                  background: UI.headerBg,
                  padding: "6px 10px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ fontSize: 12, color: UI.textDim, fontWeight: 800, whiteSpace: "nowrap" }}>
                    Scroll columns →
                  </div>

                  <div
                    ref={topHScrollRef}
                    style={{
                      flex: 1,
                      overflowX: "scroll",
                      overflowY: "hidden",
                      height: 16,
                      borderRadius: 10,
                      border: `1px solid ${UI.borderSoft}`,
                      background: UI.panelBg,
                    }}
                    aria-label="Horizontal column scroll"
                  >
                    <div
                      ref={topHScrollInnerRef}
                      style={{
                        width: Math.max(tableContentWidth, 1),
                        height: 1,
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* ✅ Table scroll area */}
              <div
                ref={tableScrollRef}
                style={{
                  overflowX: "auto",
                  overflowY: "auto",
                  maxHeight: "calc(100vh - 240px)",
                }}
              >
                <table
                  style={{
                    width: tableContentWidth,
                    borderCollapse: "separate",
                    borderSpacing: 0,
                    tableLayout: "fixed",
                  }}
                >
                  <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
                    <tr>
                      {visibleHeaders.map((h, vIdx) => {
                        const col = visibleCols[vIdx];
                        const width = colWidthPx(col);
                        const sticky = col?.kind === "real" && (col as any).colIndex === caregiverNameIdx;

                        return (
                          <th
                            key={`${h}_${vIdx}`}
                            style={{
                              top: 0,
                              position: "sticky",
                              left: sticky ? 0 : undefined,
                              zIndex: sticky ? 30 : 20,
                              background: UI.headerBg,
                              textAlign: "left",
                              padding: "8px 8px",
                              borderBottom: `1px solid ${UI.border}`,
                              fontSize: 12,
                              width,
                              minWidth: width,
                              maxWidth: width,
                              boxShadow: "0 1px 0 rgba(0,0,0,0.06)",
                            }}
                          >
                            <div style={{ fontWeight: 900 }}>{h}</div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>

                  <tbody>
                    {rows.length === 0 ? (
                      <tr>
                        <td colSpan={Math.max(1, visibleHeaders.length)} style={{ padding: 12, opacity: 0.85 }}>
                          No caregivers match this search.
                        </td>
                      </tr>
                    ) : (
                      rows.map((r, rowIndex) => {
                        const zebraBg = rowIndex % 2 === 0 ? "#ffffff" : "#f6f7f9";

                        const caregiverName = caregiverNameIdx >= 0 ? norm(r[caregiverNameIdx]) : "";
                        const caregiverId = caregiverIdIdx >= 0 ? norm(r[caregiverIdIdx]) : "";
                        const caregiverKey = (caregiverId || caregiverName).trim();

                        const totalHrs = caregiverKey ? (scheduleHoursByCaregiverKey[caregiverKey] ?? 0) : 0;

                        const desiredMeta = desiredHoursSortValue(r, desiredHoursIdx);
                        const desiredRaw = desiredHoursIdx >= 0 ? norm(r[desiredHoursIdx]) : "";
                        const hoursLine = [showSchedule ? `${totalHrs.toFixed(1)}h` : null, desiredRaw || null]
                          .filter(Boolean)
                          .join(" / ");

                        return (
                          <tr key={`row_${rowIndex}`}>
                            {visibleCols.map((col, vColIdx) => {
                              const width = colWidthPx(col);
                              const colIndex = col.colIndex;
                              const val = norm(r[colIndex]);
                              const sticky = colIndex === caregiverNameIdx;

                              const dayCol = dayCols.find((d) => d.colIndex === colIndex);
                              const dow = dayCol?.dow ?? null;

                              const scheduled =
                                showSchedule && dow != null && caregiverKey
                                  ? scheduleMap[caregiverKey]?.[dow] ?? []
                                  : [];

                              return (
                                <td
                                  key={`cell_${rowIndex}_${colIndex}_${vColIdx}`}
                                  style={{
                                    position: sticky ? "sticky" : "static",
                                    left: sticky ? 0 : undefined,
                                    zIndex: sticky ? 25 : 1,
                                    background: zebraBg,
                                    padding: "8px 8px",
                                    borderBottom: `1px solid ${UI.borderSoft}`,
                                    fontSize: 12,
                                    fontWeight: sticky ? 900 : 500,
                                    color: val ? UI.text : "#9ca3af",
                                    width,
                                    minWidth: width,
                                    maxWidth: width,
                                    whiteSpace: "pre-wrap",
                                    lineHeight: 1.25,
                                    verticalAlign: "top",
                                  }}
                                >
                                  {sticky ? (
                                    <div style={{ display: "grid", gap: 4 }}>
                                      <div style={{ fontWeight: 900, color: val ? UI.text : "#9ca3af" }}>
                                        {val || "—"}
                                      </div>
                                      {hoursLine ? (
                                        <div
                                          style={{
                                            fontSize: 11,
                                            fontWeight: 700,
                                            color: UI.textDim,
                                            lineHeight: 1.3,
                                          }}
                                        >
                                          {hoursLine}
                                        </div>
                                      ) : null}
                                    </div>
                                  ) : (
                                    <div style={{ display: "grid", gap: 8 }}>
                                      <div>
                                        <AvailabilityCell value={val || "—"} />
                                      </div>

                                      {showSchedule && dow != null && (
                                        <div style={{ display: "grid", gap: 6 }}>
                                          {scheduleLoading ? (
                                            <div style={{ fontSize: 12, color: UI.textDim, opacity: 0.9 }}>
                                              Loading schedule…
                                            </div>
                                          ) : scheduled.length === 0 ? (
                                            <div style={{ fontSize: 12, color: UI.textDim, opacity: 0.75 }}>
                                              (No shifts)
                                            </div>
                                          ) : (
                                            scheduled.slice(0, 4).map((s) => {
                                              const tag = statusTag(s.status);
                                              return (
                                                <div
                                                  key={`${s.shiftId || `${s.client}-${s.startTime}-${s.endTime}`}`}
                                                  style={{
                                                    border: `1px solid ${tag.border}`,
                                                    background: tag.bg,
                                                    color: tag.fg,
                                                    borderRadius: 9,
                                                    padding: "5px 6px",
                                                    lineHeight: 1.2,
                                                  }}
                                                  title={s.status || undefined}
                                                >
                                                  <div style={{ fontWeight: 900, fontSize: 12 }}>
                                                    {fmtShiftLine(s)}
                                                  </div>
                                                  {s.status && (
                                                    <div style={{ fontSize: 11, opacity: 0.85, fontWeight: 800 }}>
                                                      {s.status}
                                                    </div>
                                                  )}
                                                </div>
                                              );
                                            })
                                          )}

                                          {scheduled.length > 4 && !scheduleLoading && (
                                            <div style={{ fontSize: 12, color: UI.textDim }}>
                                              +{scheduled.length - 4} more…
                                            </div>
                                          )}
                                        </div>
                                      )}
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
          </div>

          {/* RIGHT: Unconfirmed Shifts panel */}
          {needsOpen && (
            <aside style={{ width: 320, position: "sticky", top: 110, alignSelf: "flex-start" }}>
              <div
                style={{
                  border: `1px solid ${UI.border}`,
                  background: UI.panelBg,
                  borderRadius: 12,
                  overflow: "hidden",
                }}
              >
                {/* Drawer header */}
                <div style={{ padding: 12, borderBottom: `1px solid ${UI.borderSoft}`, background: UI.headerBg }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                    <div>
                      <div style={{ fontWeight: 900, fontSize: 14 }}>Unconfirmed Shifts</div>
                      <div style={{ fontSize: 12, color: UI.textDim, marginTop: 2 }}>
                        Tap a shift to auto-filter that day + smart-sort caregivers
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 8 }}>
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 900,
                          borderRadius: 999,
                          padding: "2px 8px",
                          background: "#fef2f2",
                          border: "1px solid #fecaca",
                          color: "#991b1b",
                        }}
                        title="Open shifts"
                      >
                        Open {drawerCounts.open}
                      </span>
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 900,
                          borderRadius: 999,
                          padding: "2px 8px",
                          background: "#fff7ed",
                          border: "1px solid #fed7aa",
                          color: "#9a3412",
                        }}
                        title="Unconfirmed shifts (not filled)"
                      >
                        Unconf {drawerCounts.unconfirmed}
                      </span>
                    </div>
                  </div>

                  {/* Drawer mode toggle */}
                  <div
                    style={{
                      marginTop: 10,
                      display: "inline-flex",
                      border: `1px solid ${UI.border}`,
                      background: UI.panelBg,
                      borderRadius: 12,
                      overflow: "hidden",
                    }}
                  >
                    {(["both", "open", "unconfirmed"] as DrawerMode[]).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setDrawerMode(m)}
                        style={{
                          padding: "7px 10px",
                          fontSize: 13,
                          cursor: "pointer",
                          border: "none",
                          background: drawerMode === m ? "#111827" : "transparent",
                          color: drawerMode === m ? "#fff" : UI.text,
                          fontWeight: 900,
                        }}
                      >
                        {m === "both" ? "Both" : m === "open" ? "Open" : "Unconfirmed"}
                      </button>
                    ))}
                  </div>

                  {/* Searches */}
                  <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                    <input
                      value={needsClientSearch}
                      onChange={(e) => setNeedsClientSearch(e.target.value)}
                      placeholder="Search clients…"
                      style={{
                        border: `1px solid ${UI.border}`,
                        borderRadius: 12,
                        padding: "8px 10px",
                        fontSize: 13,
                        outline: "none",
                        background: UI.panelBg,
                      }}
                    />
                    <input
                      value={needsCaregiverSearch}
                      onChange={(e) => setNeedsCaregiverSearch(e.target.value)}
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
                  </div>

                  {/* Day chips */}
                  <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <DayChip label="All" active={selectedDow == null} onClick={() => setSelectedDow(null)} />
                    {DOW_LABELS.map((d, idx) => (
                      <DayChip
                        key={`needs_${d}`}
                        label={d.slice(0, 3)}
                        active={selectedDow === idx}
                        onClick={() => setSelectedDow(idx)}
                      />
                    ))}
                  </div>

                  {/* ✅ clear selection */}
                  {selectedDow != null && (
                    <div style={{ marginTop: 10 }}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedDow(null);
                          setSelectedShiftKey(null);
                        }}
                        style={{
                          width: "100%",
                          border: `1px solid ${UI.border}`,
                          borderRadius: 12,
                          padding: "8px 10px",
                          background: UI.panelBg,
                          fontSize: 12,
                          fontWeight: 900,
                          cursor: "pointer",
                        }}
                      >
                        Clear day selection
                      </button>
                    </div>
                  )}
                </div>

                {/* Drawer body */}
                <div style={{ maxHeight: "calc(100vh - 300px)", overflow: "auto" }}>
                  {scheduleLoading ? (
                    <div style={{ padding: 12, fontSize: 13, color: UI.textDim }}>Loading schedule…</div>
                  ) : needShifts.length === 0 ? (
                    <div style={{ padding: 12, fontSize: 13, color: UI.textDim }}>
                      No {drawerMode === "both" ? "open/unconfirmed" : drawerMode} shifts found ✅
                    </div>
                  ) : (
                    <div style={{ display: "grid" }}>
                      {needByDow.map((g) => {
                        if (selectedDow != null && g.dow !== selectedDow) return null;

                        const collapsed = drawerCollapsed[g.dow];
                        const count = g.items.length;

                        return (
                          <div key={`dow_${g.dow}`} style={{ borderTop: `1px solid ${UI.borderSoft}` }}>
                            <button
                              type="button"
                              onClick={() =>
                                setDrawerCollapsed((prev) => ({
                                  ...prev,
                                  [g.dow]: !prev[g.dow],
                                }))
                              }
                              style={{
                                width: "100%",
                                textAlign: "left",
                                padding: "10px 12px",
                                border: "none",
                                background: UI.panelBg,
                                cursor: "pointer",
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                gap: 10,
                              }}
                              title="Collapse/expand"
                            >
                              <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                                <div style={{ fontWeight: 900 }}>{DOW_LABELS[g.dow]}</div>
                                <div style={{ fontSize: 12, color: UI.textDim }}>
                                  {g.dateLabel ? `(${g.dateLabel})` : ""}
                                </div>
                              </div>

                              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                <span
                                  style={{
                                    fontSize: 12,
                                    fontWeight: 900,
                                    borderRadius: 999,
                                    padding: "2px 8px",
                                    background: UI.headerBg,
                                    border: `1px solid ${UI.borderSoft}`,
                                    color: UI.text,
                                  }}
                                >
                                  {count}
                                </span>
                                <span style={{ fontSize: 12, color: UI.textDim }}>{collapsed ? "▸" : "▾"}</span>
                              </div>
                            </button>

                            {!collapsed && (
                              <div style={{ padding: "0 12px 12px", display: "grid", gap: 8 }}>
                                {g.items.map((s) => {
                                  const tag = statusTag(s.status);
                                  const hours = shiftDurationHours(s.startTime, s.endTime);
                                  const key = s.shiftId || `${s.client}|${s.date}|${s.startTime}|${s.endTime}`;
                                  const isSelected = selectedShiftKey === key;

                                  return (
                                    <button
                                      key={key}
                                      type="button"
                                      onClick={() => selectShiftFromDrawer(s)}
                                      style={{
                                        textAlign: "left",
                                        border: `2px solid ${isSelected ? "#111827" : tag.border}`,
                                        background: tag.bg,
                                        color: tag.fg,
                                        borderRadius: 12,
                                        padding: 10,
                                        lineHeight: 1.2,
                                        cursor: "pointer",
                                      }}
                                      title="Tap to filter to this day + smart-sort caregivers"
                                    >
                                      <div style={{ fontWeight: 900, fontSize: 13 }}>{s.client || "Client"}</div>

                                      <div style={{ marginTop: 6, fontSize: 12, fontWeight: 800, color: UI.text }}>
                                        {s.startTime}–{s.endTime}{" "}
                                        <span style={{ color: UI.textDim, fontWeight: 900 }}>• {hours.toFixed(1)}h</span>
                                      </div>

                                      <div
                                        style={{
                                          marginTop: 6,
                                          fontSize: 12,
                                          display: "flex",
                                          gap: 8,
                                          flexWrap: "wrap",
                                        }}
                                      >
                                        <span
                                          style={{
                                            display: "inline-block",
                                            padding: "2px 8px",
                                            borderRadius: 999,
                                            border: `1px solid ${tag.border}`,
                                            background: tag.bg,
                                            color: tag.fg,
                                            fontWeight: 900,
                                          }}
                                        >
                                          {s.status || "No status"}
                                        </span>

                                        <span style={{ fontSize: 12, color: UI.textDim, fontWeight: 900 }}>
                                          {DOW_LABELS[s.dow]}
                                        </span>
                                      </div>

                                      {(s.caregiver || s.caregiverId) && (
                                        <div style={{ marginTop: 6, fontSize: 12, color: UI.text }}>
                                          <span style={{ fontWeight: 900 }}>Caregiver:</span>{" "}
                                          <span style={{ color: UI.textDim, fontWeight: 800 }}>
                                            {s.caregiver || "—"} {s.caregiverId ? `(${s.caregiverId})` : ""}
                                          </span>
                                        </div>
                                      )}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Drawer footer */}
                <div style={{ padding: 12, borderTop: `1px solid ${UI.borderSoft}`, background: UI.headerBg }}>
                  <div style={{ fontSize: 12, color: UI.textDim }}>
                    Smart sort groups: (1) has avail + 0 shifts, (2) has avail + shifts, (3) no avail, (4) not available.
                  </div>
                </div>
              </div>
            </aside>
          )}
        </div>
      )}
    </main>
  );
}

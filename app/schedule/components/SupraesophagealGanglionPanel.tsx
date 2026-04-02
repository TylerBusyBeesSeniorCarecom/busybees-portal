"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type WeekKind = "cw" | "nw";

type Cell = {
  a1: string;
  value: string;
  fontColor: string;
};

type GridRow = {
  row: number;
  clientName: string;
  clientA1: string;
  cells: Cell[];
};

type GridResponse = {
  ok: boolean;
  apiVersion?: string;
  meta?: { sheet?: string; fetchedAt?: string };
  headers: {
    dayHeaders: string[];
    dateHeaders: string[];
  };
  body: {
    startRow: number;
    endRow: number;
    rows: GridRow[];
  };
  error?: string;
};

type ClientsApiResponse =
  | { ok: true; meta: any; headers: string[]; rows: string[][] }
  | { ok: false; error: string };

type ClientProfile = {
  name: string;
  location: string;
  description: string;
  rate: string;
  raw?: Record<string, string>;
};

type ClientStatusLabel =
  | "Needs Attention"
  | "Considering"
  | "Offered"
  | "Pending Client Approval"
  | "Scheduled"
  | "Finished";

type ClientShiftDetail = {
  key: string;
  dayLabel: string;
  dateLabel: string;
  startTime: string;
  endTime: string;
  hours: number;
  statusLabel: ClientStatusLabel | "Cancelled" | "Unknown";
  caregiverName: string | null;
  rawText: string;
  sortTime: number;
};

type ClientSummary = {
  clientName: string;
  location: string;
  description: string;
  rate: string;
  totalShiftCount: number;
  openShiftCount: number;
  offeredShiftCount: number;
  consideringShiftCount: number;
  pendingClientApprovalCount: number;
  filledShiftCount: number;
  totalRequiredHours: number;
  totalConfirmedHours: number;
  nextNonConfirmedShift: string | null;
  allPast: boolean;
  statusLabel: ClientStatusLabel;
  shifts: ClientShiftDetail[];
};

type Props = {
  open: boolean;
  onClose: () => void;
  week: WeekKind;
  onWeekChange?: (week: WeekKind) => void;
};

const UI = {
  pageBg: "#f3f4f6",
  panelBg: "#ffffff",
  panelBgSoft: "#f9fafb",
  border: "#d1d5db",
  borderSoft: "#e5e7eb",
  text: "#111827",
  textDim: "#6b7280",

  greenBg: "#ecfdf5",
  greenText: "#065f46",
  greenBorder: "#a7f3d0",

  yellowBg: "#fffbeb",
  yellowText: "#92400e",

  redBg: "#fef2f2",
  redText: "#991b1b",
  redBorder: "#fecaca",

  blueBg: "#eff6ff",
  blueText: "#1d4ed8",
  blueBorder: "#bfdbfe",

  orangeBg: "#fff7ed",
  orangeText: "#c2410c",
  orangeBorder: "#fed7aa",

  purpleBg: "#faf5ff",
  purpleText: "#7e22ce",
  purpleBorder: "#d8b4fe",

  beeGold: "#f4c542",
  beeGoldDark: "#c79200",
  navy: "#16253f",
};

function norm(v: any) {
  return (v ?? "").toString().trim();
}

function normalizeKey(v: string) {
  return norm(v).toLowerCase();
}

function fullNameSortKey(fullName: string) {
  const s = norm(fullName).replace(/\s+/g, " ").trim();
  const parts = s.split(" ").filter(Boolean);
  const first = parts[0] || "";
  const last = parts.length > 1 ? parts[parts.length - 1] : first;
  return `${normalizeKey(last)}__${normalizeKey(first)}__${normalizeKey(s)}`;
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
    headers.forEach((h, idx) => {
      raw[h || `col_${idx}`] = norm(r[idx]);
    });

    map[normalizeKey(name)] = {
      name,
      location,
      description,
      rate,
      raw,
    };
  }

  return map;
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

function durationHours(startTime: string, endTime: string): number {
  const start = parseTimeToMinutes(startTime);
  const endRaw = parseTimeToMinutes(endTime);

  if (start == null || endRaw == null) return 0;

  let end = endRaw;
  if (end <= start) end += 24 * 60;

  return (end - start) / 60;
}

function toDateSafe(dateStr: string): Date | null {
  const raw = norm(dateStr);
  if (!raw) return null;

  const d0 = new Date(raw);
  if (!Number.isNaN(d0.getTime())) return d0;

  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+.*)?$/);
  if (m) {
    const mm = parseInt(m[1], 10);
    const dd = parseInt(m[2], 10);
    let yyyy = parseInt(m[3], 10);
    if (yyyy < 100) yyyy += 2000;

    const d = new Date(yyyy, mm - 1, dd);
    if (!Number.isNaN(d.getTime())) return d;
  }

  return null;
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

type ParsedShift = {
  rawText: string;
  baseStatus:
    | "Open"
    | "Filled"
    | "Offered"
    | "Considering"
    | "PendingClientApproval"
    | "Unknown";
  isCancelled: boolean;
  caregiverName: string | null;
  startTime: string | null;
  endTime: string | null;
  timeText: string | null;
};

function collapseSpaces(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripOuterDoubleQuotes(value: string): string {
  let s = value.trim();
  while (s.startsWith('"')) s = s.slice(1).trimStart();
  return s;
}

function stripOuterDollar(value: string): string {
  let s = value.trim();
  while (s.startsWith("$")) s = s.slice(1).trimStart();
  return s;
}

function stripOuterParens(value: string): string {
  let s = value.trim();
  if (s.startsWith("(")) s = s.slice(1).trimStart();
  if (s.endsWith(")")) s = s.slice(0, -1).trimEnd();
  return s.trim();
}

function removeTrailingCancelledMarker(value: string): { text: string; isCancelled: boolean } {
  const s = value.trim();
  if (!s.endsWith("*")) return { text: s, isCancelled: false };
  return { text: s.slice(0, -1).trimEnd(), isCancelled: true };
}

function looksLikeTimePart(value: string): boolean {
  const s = collapseSpaces(value);
  return /^(\d{1,2})(:\d{2})?\s*(AM|PM)?\s*-\s*(\d{1,2})(:\d{2})?\s*(AM|PM)?$/i.test(s);
}

function splitNameAndTime(value: string): {
  caregiverName: string | null;
  timeText: string | null;
} {
  const s = collapseSpaces(value);

  if (looksLikeTimePart(s)) {
    return { caregiverName: null, timeText: s };
  }

  const commaIndex = s.lastIndexOf(",");
  if (commaIndex === -1) {
    return { caregiverName: null, timeText: null };
  }

  const left = collapseSpaces(s.slice(0, commaIndex));
  const right = collapseSpaces(s.slice(commaIndex + 1));

  if (!left || !right || !looksLikeTimePart(right)) {
    return { caregiverName: null, timeText: null };
  }

  return {
    caregiverName: left,
    timeText: right,
  };
}

function splitTimeRange(timeText: string | null): {
  startTime: string | null;
  endTime: string | null;
} {
  const s = norm(timeText);
  if (!s) return { startTime: null, endTime: null };

  const parts = s.split("-");
  if (parts.length !== 2) return { startTime: null, endTime: null };

  const startTime = collapseSpaces(parts[0]);
  const endTime = collapseSpaces(parts[1]);

  if (!startTime || !endTime) {
    return { startTime: null, endTime: null };
  }

  return { startTime, endTime };
}

function detectBaseStatus(rawTextWithoutCancelled: string): {
  baseStatus: ParsedShift["baseStatus"];
  unwrappedText: string;
} {
  const s = rawTextWithoutCancelled.trim();

  if (!s) return { baseStatus: "Unknown", unwrappedText: s };
  if (s.startsWith("(")) return { baseStatus: "Considering", unwrappedText: stripOuterParens(s) };
  if (s.startsWith('"')) return { baseStatus: "Offered", unwrappedText: stripOuterDoubleQuotes(s) };
  if (s.startsWith("$")) {
    return { baseStatus: "PendingClientApproval", unwrappedText: stripOuterDollar(s) };
  }
  if (looksLikeTimePart(s)) return { baseStatus: "Open", unwrappedText: s };
  if (s.includes(",")) return { baseStatus: "Filled", unwrappedText: s };

  return { baseStatus: "Unknown", unwrappedText: s };
}

function parseScheduleShiftCell(rawText: string): ParsedShift {
  const original = String(rawText ?? "");
  const trimmed = original.trim();

  if (!trimmed) {
    return {
      rawText: original,
      baseStatus: "Unknown",
      isCancelled: false,
      caregiverName: null,
      startTime: null,
      endTime: null,
      timeText: null,
    };
  }

  const cancelledInfo = removeTrailingCancelledMarker(trimmed);
  const statusInfo = detectBaseStatus(cancelledInfo.text);
  const split = splitNameAndTime(statusInfo.unwrappedText);
  const timeParts = splitTimeRange(split.timeText);

  return {
    rawText: original,
    baseStatus: statusInfo.baseStatus,
    isCancelled: cancelledInfo.isCancelled,
    caregiverName: split.caregiverName,
    startTime: timeParts.startTime,
    endTime: timeParts.endTime,
    timeText: split.timeText,
  };
}

function splitCellIntoShiftStrings(value: string): string[] {
  const raw = norm(value);
  if (!raw) return [];

  return raw
    .split(/\n+/)
    .map((part: string) => part.trim())
    .filter((part: string) => part.length > 0);
}

function statusBadgeColors(status: ClientStatusLabel) {
  switch (status) {
    case "Needs Attention":
      return { bg: UI.redBg, color: UI.redText };
    case "Considering":
      return { bg: UI.orangeBg, color: UI.orangeText };
    case "Offered":
      return { bg: UI.blueBg, color: UI.blueText };
    case "Pending Client Approval":
      return { bg: UI.purpleBg, color: UI.purpleText };
    case "Finished":
      return { bg: UI.greenBg, color: UI.greenText };
    case "Scheduled":
    default:
      return { bg: UI.greenBg, color: UI.greenText };
  }
}

function clientCardColors(status: ClientStatusLabel, isGhost: boolean) {
  if (isGhost) {
    switch (status) {
      case "Needs Attention":
        return { bg: "rgba(254,242,242,0.20)", border: "rgba(254,202,202,0.40)" };
      case "Considering":
        return { bg: "rgba(255,247,237,0.20)", border: "rgba(254,215,170,0.40)" };
      case "Offered":
        return { bg: "rgba(239,246,255,0.20)", border: "rgba(191,219,254,0.40)" };
      case "Pending Client Approval":
        return { bg: "rgba(250,245,255,0.20)", border: "rgba(216,180,254,0.40)" };
      case "Finished":
      case "Scheduled":
      default:
        return { bg: "rgba(236,253,245,0.20)", border: "rgba(167,243,208,0.40)" };
    }
  }

  switch (status) {
    case "Needs Attention":
      return { bg: UI.redBg, border: UI.redBorder };
    case "Considering":
      return { bg: UI.orangeBg, border: UI.orangeBorder };
    case "Offered":
      return { bg: UI.blueBg, border: UI.blueBorder };
    case "Pending Client Approval":
      return { bg: UI.purpleBg, border: UI.purpleBorder };
    case "Finished":
    case "Scheduled":
    default:
      return { bg: UI.greenBg, border: UI.greenBorder };
  }
}

function clientStatusRank(status: ClientStatusLabel) {
  switch (status) {
    case "Needs Attention":
      return 0;
    case "Considering":
      return 1;
    case "Offered":
      return 2;
    case "Pending Client Approval":
      return 3;
    case "Scheduled":
      return 4;
    case "Finished":
      return 5;
    default:
      return 99;
  }
}

function parsedShiftToClientStatusLabel(
  parsed: ParsedShift,
  allPastForShift: boolean
): ClientShiftDetail["statusLabel"] {
  if (parsed.isCancelled) return "Cancelled";

  switch (parsed.baseStatus) {
    case "Open":
      return "Needs Attention";
    case "Considering":
      return "Considering";
    case "Offered":
      return "Offered";
    case "PendingClientApproval":
      return "Pending Client Approval";
    case "Filled":
      return allPastForShift ? "Finished" : "Scheduled";
    default:
      return "Unknown";
  }
}

function shiftRowColors(status: ClientShiftDetail["statusLabel"], isGhost: boolean) {
  if (status === "Cancelled") {
    return {
      bg: isGhost ? "rgba(17,24,39,0.10)" : "rgba(17,24,39,0.06)",
      border: isGhost ? "rgba(17,24,39,0.20)" : "rgba(17,24,39,0.12)",
      color: UI.textDim,
    };
  }

  if (status === "Unknown") {
    return {
      bg: isGhost ? "rgba(255,255,255,0.14)" : "#fff",
      border: UI.borderSoft,
      color: UI.text,
    };
  }

  const badge = statusBadgeColors(status as ClientStatusLabel);

  return {
    bg: isGhost ? "rgba(255,255,255,0.14)" : badge.bg,
    border: isGhost ? "rgba(22,37,63,0.14)" : UI.borderSoft,
    color: badge.color,
  };
}

function fetchGridRoute(week: WeekKind) {
  return week === "cw" ? "/api/current-week" : "/api/next-week";
}

function fetchGridAction(week: WeekKind) {
  return week === "cw" ? "getCurrentWeekGrid" : "getNextWeekGrid";
}

async function fetchGrid(week: WeekKind): Promise<GridResponse> {
  const route = fetchGridRoute(week);
  const action = fetchGridAction(week);

  const res = await fetch(`${route}?action=${encodeURIComponent(action)}`, {
    cache: "no-store",
  });

  const text = await res.text();
  const data = text ? (JSON.parse(text) as GridResponse) : null;

  if (!res.ok) throw new Error(data?.error || `Failed to load grid (${res.status})`);
  if (!data?.ok) throw new Error(data?.error || "Failed to load grid");

  return data;
}

async function fetchClients(): Promise<ClientsApiResponse> {
  const res = await fetch("/api/clients", { cache: "no-store" });
  const text = await res.text();

  let data: ClientsApiResponse | null = null;
  try {
    data = text ? (JSON.parse(text) as ClientsApiResponse) : null;
  } catch {
    throw new Error(`Non-JSON clients response (${res.status})`);
  }

  if (!res.ok) {
    throw new Error((data as any)?.error || `Failed to load clients (${res.status})`);
  }

  return data as ClientsApiResponse;
}

function formatNextIssue(dayLabel: string, dateLabel: string, startTime: string, endTime: string) {
  return [norm(dayLabel), norm(dateLabel), `${norm(startTime)}-${norm(endTime)}`]
    .filter(Boolean)
    .join(" • ");
}

function workpadSectionStyle(isGhost: boolean): React.CSSProperties {
  return {
    background: isGhost ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.92)",
    border: `1px solid ${isGhost ? "rgba(22,37,63,0.12)" : UI.borderSoft}`,
    borderRadius: 14,
    padding: 12,
    display: "grid",
    gap: 10,
  };
}

export default function SupraesophagealGanglionPanel({
  open,
  onClose,
  week,
  onWeekChange,
}: Props) {
  const [gridData, setGridData] = useState<GridResponse | null>(null);
  const [clientsData, setClientsData] = useState<ClientsApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [peekMode, setPeekMode] = useState(false);
  const [selectedClientName, setSelectedClientName] = useState<string | null>(null);

  const [panelPos, setPanelPos] = useState({ x: 980, y: 92 });
  const [panelSize] = useState({ width: 620, height: 780 });

  const dragRef = useRef<{
    dragging: boolean;
    offsetX: number;
    offsetY: number;
  }>({
    dragging: false,
    offsetX: 0,
    offsetY: 0,
  });

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError("");

        const [grid, clients] = await Promise.all([fetchGrid(week), fetchClients()]);

        if (cancelled) return;

        setGridData(grid);
        setClientsData(clients);
      } catch (err: any) {
        if (cancelled) return;
        setError(err?.message || "Failed to load workpad.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [open, week]);

  useEffect(() => {
    if (!open) return;

    function onMouseMove(e: MouseEvent) {
      if (!dragRef.current.dragging) return;

      const nextX = e.clientX - dragRef.current.offsetX;
      const nextY = e.clientY - dragRef.current.offsetY;

      const maxX = Math.max(12, window.innerWidth - panelSize.width - 12);
      const maxY = Math.max(12, window.innerHeight - panelSize.height - 12);

      setPanelPos({
        x: Math.min(Math.max(12, nextX), maxX),
        y: Math.min(Math.max(12, nextY), maxY),
      });
    }

    function onMouseUp() {
      dragRef.current.dragging = false;
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [open, panelSize.height, panelSize.width]);

  useEffect(() => {
    setSelectedClientName(null);
  }, [week]);

  function beginDrag(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement | null;
    if (target?.closest("button") || target?.closest("input")) return;

    dragRef.current.dragging = true;
    dragRef.current.offsetX = e.clientX - panelPos.x;
    dragRef.current.offsetY = e.clientY - panelPos.y;
    e.preventDefault();
  }

  const clientSummaries = useMemo<ClientSummary[]>(() => {
    const rows = gridData?.body?.rows ?? [];
    const headers = gridData?.headers?.dayHeaders ?? [];
    const dateHeaders = gridData?.headers?.dateHeaders ?? [];
    const searchLower = search.trim().toLowerCase();
    const now = Date.now();

    const clientsByName =
      clientsData && clientsData.ok ? buildClientsByName(clientsData) : {};

    return rows
      .filter((row) => {
        const name = norm(row.clientName);
        if (!name) return false;
        if (!searchLower) return true;
        return name.toLowerCase().includes(searchLower);
      })
      .map((row) => {
        const profile = clientsByName[normalizeKey(row.clientName)];

        let totalShiftCount = 0;
        let openShiftCount = 0;
        let offeredShiftCount = 0;
        let consideringShiftCount = 0;
        let pendingClientApprovalCount = 0;
        let filledShiftCount = 0;
        let totalRequiredHours = 0;
        let totalConfirmedHours = 0;
        let nextNonConfirmedShift: string | null = null;
        let allPast = true;

        const shifts: ClientShiftDetail[] = [];

        row.cells.forEach((cell, cellIndex) => {
          const shiftStrings = splitCellIntoShiftStrings(cell.value);
          const dayLabel = headers[cellIndex + 1] || "";
          const dateLabel = dateHeaders[cellIndex + 1] || "";

          shiftStrings.forEach((shiftText, shiftIndex) => {
            const parsed = parseScheduleShiftCell(shiftText);
            if (!parsed.startTime || !parsed.endTime) return;
            if (parsed.isCancelled) return;

            const hours = durationHours(parsed.startTime, parsed.endTime);
            totalShiftCount += 1;
            totalRequiredHours += hours;

            const scheduledStart = buildScheduledDate(dateLabel, parsed.startTime);
            let scheduledEnd = buildScheduledDate(dateLabel, parsed.endTime);

            const startMin = parseTimeToMinutes(parsed.startTime);
            const endMin = parseTimeToMinutes(parsed.endTime);

            if (
              scheduledStart &&
              scheduledEnd &&
              startMin != null &&
              endMin != null &&
              endMin <= startMin
            ) {
              scheduledEnd = addDays(scheduledEnd, 1);
            }

            const isPastShift = !!scheduledEnd && scheduledEnd.getTime() < now;

            if (!scheduledEnd || scheduledEnd.getTime() >= now) {
              allPast = false;
            }

            switch (parsed.baseStatus) {
              case "Open":
                openShiftCount += 1;
                break;
              case "Offered":
                offeredShiftCount += 1;
                break;
              case "Considering":
                consideringShiftCount += 1;
                break;
              case "PendingClientApproval":
                pendingClientApprovalCount += 1;
                break;
              case "Filled":
                filledShiftCount += 1;
                totalConfirmedHours += hours;
                break;
              default:
                break;
            }

            const isNonConfirmed =
              parsed.baseStatus !== "Filled" && parsed.baseStatus !== "Unknown";

            if (!nextNonConfirmedShift && isNonConfirmed) {
              nextNonConfirmedShift = formatNextIssue(
                dayLabel,
                dateLabel,
                parsed.startTime,
                parsed.endTime
              );
            }

            shifts.push({
              key: `${row.clientName}-${cell.a1}-${shiftIndex}-${parsed.startTime}-${parsed.endTime}`,
              dayLabel,
              dateLabel,
              startTime: parsed.startTime,
              endTime: parsed.endTime,
              hours,
              statusLabel: parsedShiftToClientStatusLabel(parsed, isPastShift),
              caregiverName: parsed.caregiverName,
              rawText: parsed.rawText,
              sortTime: startMin ?? 0,
            });
          });
        });

        if (totalShiftCount === 0) {
          allPast = false;
        }

        let statusLabel: ClientStatusLabel = "Scheduled";
        if (openShiftCount > 0) {
          statusLabel = "Needs Attention";
        } else if (consideringShiftCount > 0) {
          statusLabel = "Considering";
        } else if (offeredShiftCount > 0) {
          statusLabel = "Offered";
        } else if (pendingClientApprovalCount > 0) {
          statusLabel = "Pending Client Approval";
        } else if (allPast) {
          statusLabel = "Finished";
        } else {
          statusLabel = "Scheduled";
        }

        shifts.sort((a, b) => {
          const da = toDateSafe(a.dateLabel)?.getTime() ?? 0;
          const db = toDateSafe(b.dateLabel)?.getTime() ?? 0;
          if (da !== db) return da - db;
          return a.sortTime - b.sortTime;
        });

        return {
          clientName: row.clientName,
          location: profile?.location || "",
          description: profile?.description || "",
          rate: profile?.rate || "",
          totalShiftCount,
          openShiftCount,
          offeredShiftCount,
          consideringShiftCount,
          pendingClientApprovalCount,
          filledShiftCount,
          totalRequiredHours,
          totalConfirmedHours,
          nextNonConfirmedShift,
          allPast,
          statusLabel,
          shifts,
        };
      })
      .sort((a, b) => {
        const diff = clientStatusRank(a.statusLabel) - clientStatusRank(b.statusLabel);
        if (diff !== 0) return diff;
        return fullNameSortKey(a.clientName).localeCompare(fullNameSortKey(b.clientName));
      });
  }, [gridData, clientsData, search]);

  const selectedClient = useMemo(() => {
    if (!selectedClientName) return null;
    return (
      clientSummaries.find(
        (client) => normalizeKey(client.clientName) === normalizeKey(selectedClientName)
      ) || null
    );
  }, [clientSummaries, selectedClientName]);

  if (!open) return null;

  const isGhost = peekMode;

  const bodyBg = isGhost
    ? "linear-gradient(180deg, rgba(255,224,138,0.20) 0%, rgba(255,210,77,0.14) 100%)"
    : "linear-gradient(180deg, #ffe08a 0%, #ffd24d 100%)";

  const panelGlassBg = isGhost ? "rgba(255, 248, 219, 0.18)" : bodyBg;
  const panelHeaderBg = isGhost
    ? "linear-gradient(180deg, rgba(255,255,255,0.24) 0%, rgba(255,248,219,0.18) 100%)"
    : "linear-gradient(180deg, rgba(255,255,255,0.78) 0%, rgba(255,248,219,0.95) 100%)";

  const panelSoftBoxBg = isGhost ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.92)";
  const panelDivider = "rgba(22,37,63,0.12)";

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(17,24,39,0.10)",
          zIndex: 1200,
        }}
      />

      <aside
        style={{
          position: "fixed",
          top: panelPos.y,
          left: panelPos.x,
          width: panelSize.width,
          height: panelSize.height,
          background: panelGlassBg,
          border: `2px solid ${UI.beeGoldDark}`,
          borderRadius: 20,
          boxShadow: isGhost
            ? "0 20px 60px rgba(22,37,63,0.20)"
            : "0 24px 80px rgba(22,37,63,0.28)",
          zIndex: 1201,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          backdropFilter: "none",
          WebkitBackdropFilter: "none",
        }}
      >
        <div
          onMouseDown={beginDrag}
          style={{
            padding: 12,
            borderBottom: `2px solid ${panelDivider}`,
            background: panelHeaderBg,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            cursor: "move",
            userSelect: "none",
          }}
        >
          <div>
            <div style={{ fontSize: 17, fontWeight: 1000, color: UI.text }}>
              🧠 Supraesophageal Ganglion
            </div>
            <div style={{ marginTop: 2, fontSize: 12, color: UI.textDim, fontWeight: 700 }}>
              {selectedClient ? "Client shift workpad" : "Scheduling workpad"}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => setPeekMode((v) => !v)}
              style={ghostButtonStyle(peekMode)}
            >
              {peekMode ? "Solid" : "Glass"}
            </button>

            <button
              type="button"
              onClick={() => onWeekChange?.("cw")}
              style={weekPill(week === "cw")}
            >
              CW
            </button>
            <button
              type="button"
              onClick={() => onWeekChange?.("nw")}
              style={weekPill(week === "nw")}
            >
              NW
            </button>

            <button
              type="button"
              onClick={onClose}
              style={{
                border: `1px solid ${UI.border}`,
                background: "#fff",
                color: UI.text,
                borderRadius: 10,
                padding: "8px 10px",
                fontWeight: 900,
                cursor: "pointer",
              }}
            >
              Close
            </button>
          </div>
        </div>

        {selectedClient ? (
          <>
            <div
              style={{
                padding: "10px 10px 0 10px",
                borderBottom: `1px solid ${UI.borderSoft}`,
                display: "grid",
                gap: 10,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: 10,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <button
                    type="button"
                    onClick={() => setSelectedClientName(null)}
                    style={{
                      border: `1px solid ${UI.border}`,
                      background: panelSoftBoxBg,
                      color: UI.text,
                      borderRadius: 999,
                      padding: "7px 10px",
                      fontWeight: 900,
                      cursor: "pointer",
                      fontSize: 12,
                      marginBottom: 8,
                    }}
                  >
                    ← Back to clients
                  </button>

                  <div
                    style={{
                      fontSize: 22,
                      fontWeight: 1000,
                      color: UI.text,
                      lineHeight: 1.1,
                    }}
                  >
                    {selectedClient.clientName}
                  </div>

                  <div
                    style={{
                      marginTop: 4,
                      fontSize: 12.5,
                      color: UI.textDim,
                      fontWeight: 700,
                    }}
                  >
                    Dedicated shift workpad
                  </div>
                </div>

                <span
                  style={{
                    background: statusBadgeColors(selectedClient.statusLabel).bg,
                    color: statusBadgeColors(selectedClient.statusLabel).color,
                    borderRadius: 999,
                    padding: "6px 10px",
                    fontWeight: 950,
                    fontSize: 11,
                    whiteSpace: "nowrap",
                    flex: "0 0 auto",
                  }}
                >
                  {selectedClient.statusLabel}
                </span>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                  gap: 8,
                }}
              >
                <MiniStat
                  label="Open"
                  value={String(selectedClient.openShiftCount)}
                  danger={selectedClient.openShiftCount > 0}
                />
                <MiniStat
                  label="Shifts"
                  value={String(selectedClient.totalShiftCount)}
                />
                <MiniStat
                  label="Hours"
                  value={selectedClient.totalRequiredHours.toFixed(1)}
                />
                <MiniStat
                  label="Confirmed"
                  value={selectedClient.totalConfirmedHours.toFixed(1)}
                />
              </div>
            </div>

            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: 10,
                display: "grid",
                gap: 10,
              }}
            >
              <section style={workpadSectionStyle(isGhost)}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 1000,
                    color: UI.text,
                    textTransform: "uppercase",
                    letterSpacing: 0.2,
                  }}
                >
                  Client info
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                    gap: 10,
                  }}
                >
                  <InfoBlock label="Location" value={selectedClient.location || "—"} />
                  <InfoBlock label="Rate" value={selectedClient.rate || "—"} />
                  <InfoBlock
                    label="Next Issue"
                    value={selectedClient.nextNonConfirmedShift || "None"}
                  />
                </div>

                {selectedClient.description ? (
                  <div
                    style={{
                      fontSize: 12.5,
                      color: UI.textDim,
                      fontWeight: 700,
                      lineHeight: 1.45,
                    }}
                  >
                    {selectedClient.description}
                  </div>
                ) : null}
              </section>

              <section style={workpadSectionStyle(isGhost)}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 1000,
                    color: UI.text,
                    textTransform: "uppercase",
                    letterSpacing: 0.2,
                  }}
                >
                  Shifts for this client
                </div>

                {selectedClient.shifts.length === 0 ? (
                  <div
                    style={{
                      fontSize: 12.5,
                      color: UI.textDim,
                      fontWeight: 700,
                    }}
                  >
                    No active shifts found for this client this week.
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 8 }}>
                    {selectedClient.shifts.map((shift) => {
                      const rowColors = shiftRowColors(shift.statusLabel, isGhost);

                      return (
                        <div
                          key={shift.key}
                          style={{
                            background: rowColors.bg,
                            border: `1px solid ${rowColors.border}`,
                            borderRadius: 12,
                            padding: 12,
                            display: "grid",
                            gap: 8,
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              gap: 10,
                            }}
                          >
                            <div style={{ minWidth: 0 }}>
                              <div
                                style={{
                                  fontSize: 15,
                                  fontWeight: 1000,
                                  color: UI.text,
                                }}
                              >
                                {selectedClient.clientName}
                              </div>
                              <div
                                style={{
                                  marginTop: 2,
                                  fontSize: 12,
                                  fontWeight: 800,
                                  color: UI.textDim,
                                }}
                              >
                                {[shift.dayLabel, shift.dateLabel].filter(Boolean).join(" • ")}
                              </div>
                            </div>

                            <span
                              style={{
                                background:
                                  shift.statusLabel === "Cancelled"
                                    ? "rgba(17,24,39,0.10)"
                                    : shift.statusLabel === "Unknown"
                                    ? "rgba(255,255,255,0.50)"
                                    : statusBadgeColors(
                                        shift.statusLabel as ClientStatusLabel
                                      ).bg,
                                color:
                                  shift.statusLabel === "Cancelled"
                                    ? UI.textDim
                                    : shift.statusLabel === "Unknown"
                                    ? UI.text
                                    : statusBadgeColors(
                                        shift.statusLabel as ClientStatusLabel
                                      ).color,
                                borderRadius: 999,
                                padding: "4px 9px",
                                fontWeight: 900,
                                fontSize: 10.5,
                                whiteSpace: "nowrap",
                              }}
                            >
                              {shift.statusLabel}
                            </span>
                          </div>

                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "minmax(0, 1fr) auto auto",
                              gap: 10,
                              alignItems: "center",
                            }}
                          >
                            <div style={{ minWidth: 0 }}>
                              <div
                                style={{
                                  fontSize: 16,
                                  fontWeight: 1000,
                                  color: rowColors.color,
                                }}
                              >
                                {shift.startTime} - {shift.endTime}
                              </div>
                              <div
                                style={{
                                  marginTop: 3,
                                  fontSize: 12.5,
                                  fontWeight: 800,
                                  color: UI.textDim,
                                }}
                              >
                                {shift.caregiverName || "Open shift"}
                              </div>
                            </div>

                            <div
                              style={{
                                fontSize: 12.5,
                                fontWeight: 900,
                                color: UI.textDim,
                                whiteSpace: "nowrap",
                              }}
                            >
                              {shift.hours.toFixed(1)}h
                            </div>

                            <button
                              type="button"
                              style={{
                                border: `1px solid ${UI.border}`,
                                background: "#fff",
                                color: UI.text,
                                borderRadius: 10,
                                padding: "8px 10px",
                                fontWeight: 900,
                                fontSize: 12,
                                cursor: "pointer",
                                whiteSpace: "nowrap",
                              }}
                              onClick={() => {
                                // placeholder for future shift focus behavior
                                console.log("Focus shift", shift.key);
                              }}
                            >
                              Open Shift Pad
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              <section style={workpadSectionStyle(isGhost)}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 1000,
                    color: UI.text,
                    textTransform: "uppercase",
                    letterSpacing: 0.2,
                  }}
                >
                  Caregiver availability
                </div>

                <div
                  style={{
                    fontSize: 12.5,
                    color: UI.textDim,
                    fontWeight: 700,
                    lineHeight: 1.45,
                  }}
                >
                  Placeholder section. Next we can load the available caregivers for this
                  client’s shifts and show them here by day and time.
                </div>
              </section>

              <section style={workpadSectionStyle(isGhost)}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 1000,
                    color: UI.text,
                    textTransform: "uppercase",
                    letterSpacing: 0.2,
                  }}
                >
                  Best fit suggestions
                </div>

                <div
                  style={{
                    fontSize: 12.5,
                    color: UI.textDim,
                    fontWeight: 700,
                    lineHeight: 1.45,
                  }}
                >
                  Placeholder section. This is where the algorithm results can go next,
                  ranked from best fit to lowest fit for each shift.
                </div>
              </section>

              <section style={workpadSectionStyle(isGhost)}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 1000,
                    color: UI.text,
                    textTransform: "uppercase",
                    letterSpacing: 0.2,
                  }}
                >
                  Actions
                </div>

                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8,
                  }}
                >
                  <button type="button" style={actionButtonStyle()}>
                    Send Message
                  </button>
                  <button type="button" style={actionButtonStyle()}>
                    Reassign Shift
                  </button>
                  <button type="button" style={actionButtonStyle()}>
                    Open Drag/Drop Mode
                  </button>
                </div>

                <div
                  style={{
                    fontSize: 12.5,
                    color: UI.textDim,
                    fontWeight: 700,
                    lineHeight: 1.45,
                  }}
                >
                  These buttons are placeholders for the next step so everything can live on
                  this client workpad page.
                </div>
              </section>
            </div>
          </>
        ) : (
          <>
            <div
              style={{
                padding: "10px 10px 0 10px",
                background: "transparent",
                borderBottom: `1px solid ${UI.borderSoft}`,
              }}
            >
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search clients..."
                style={{
                  width: "100%",
                  border: `1px solid ${UI.border}`,
                  borderRadius: 14,
                  padding: "10px 12px",
                  fontSize: 13,
                  fontWeight: 700,
                  outline: "none",
                  color: UI.text,
                  background: panelSoftBoxBg,
                  boxShadow: isGhost ? "none" : "inset 0 1px 2px rgba(0,0,0,0.04)",
                  backdropFilter: isGhost ? "blur(.5px)" : "none",
                  WebkitBackdropFilter: isGhost ? "blur(.5px)" : "none",
                }}
              />
            </div>

            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: 10,
                display: "grid",
                gap: 8,
                background: "transparent",
              }}
            >
              {loading ? (
                <PanelMessage isGhost={isGhost}>Loading workpad…</PanelMessage>
              ) : error ? (
                <PanelMessage isGhost={isGhost} danger>
                  {error}
                </PanelMessage>
              ) : clientSummaries.length === 0 ? (
                <PanelMessage isGhost={isGhost}>No client data found.</PanelMessage>
              ) : (
                clientSummaries.map((client) => {
                  const badge = statusBadgeColors(client.statusLabel);
                  const card = clientCardColors(client.statusLabel, isGhost);

                  return (
                    <button
                      key={client.clientName}
                      type="button"
                      onClick={() => setSelectedClientName(client.clientName)}
                      style={{
                        background: card.bg,
                        border: `1px solid ${card.border}`,
                        borderRadius: 12,
                        padding: "12px 14px",
                        display: "grid",
                        gap: 8,
                        backdropFilter: isGhost ? "blur(.5px)" : "none",
                        WebkitBackdropFilter: isGhost ? "blur(.5px)" : "none",
                        textAlign: "left",
                        cursor: "pointer",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 10,
                        }}
                      >
                        <div
                          style={{
                            fontSize: 16,
                            fontWeight: 1000,
                            color: UI.text,
                            minWidth: 0,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          title={client.clientName}
                        >
                          {client.clientName}
                        </div>

                        <span
                          style={{
                            background: badge.bg,
                            color: badge.color,
                            borderRadius: 999,
                            padding: "4px 8px",
                            fontWeight: 950,
                            fontSize: 10.5,
                            whiteSpace: "nowrap",
                            flex: "0 0 auto",
                          }}
                        >
                          {client.statusLabel}
                        </span>
                      </div>

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "72px minmax(0, 1fr) 70px 70px",
                          gap: 10,
                          alignItems: "center",
                        }}
                      >
                        <MiniStat
                          label="Open"
                          value={String(client.openShiftCount)}
                          danger={client.openShiftCount > 0}
                        />

                        <div style={{ minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: 10.5,
                              color: UI.textDim,
                              fontWeight: 800,
                              textTransform: "uppercase",
                              letterSpacing: 0.2,
                            }}
                          >
                            When
                          </div>
                          <div
                            style={{
                              marginTop: 2,
                              fontSize: 12.5,
                              color: UI.text,
                              fontWeight: 800,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                            title={client.nextNonConfirmedShift || "None"}
                          >
                            {client.nextNonConfirmedShift || "None"}
                          </div>
                        </div>

                        <MiniStat
                          label="Hours"
                          value={client.totalRequiredHours.toFixed(1)}
                        />

                        <MiniStat
                          label="Shifts"
                          value={String(client.totalShiftCount)}
                        />
                      </div>

                      <div
                        style={{
                          fontSize: 12,
                          color: UI.textDim,
                          fontWeight: 800,
                        }}
                      >
                        Open dedicated workpad →
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </>
        )}
      </aside>
    </>
  );
}

function weekPill(active: boolean): React.CSSProperties {
  return {
    border: `1px solid ${active ? UI.navy : UI.border}`,
    background: active ? UI.navy : "rgba(255,255,255,0.92)",
    color: active ? "#fff" : UI.text,
    borderRadius: 999,
    padding: "8px 10px",
    fontWeight: 900,
    cursor: "pointer",
    fontSize: 12,
    lineHeight: 1,
  };
}

function ghostButtonStyle(active: boolean): React.CSSProperties {
  return {
    border: `1px solid ${active ? UI.beeGoldDark : UI.border}`,
    background: active ? UI.beeGold : "rgba(255,255,255,0.92)",
    color: active ? UI.navy : UI.text,
    borderRadius: 999,
    padding: "8px 10px",
    fontWeight: 900,
    cursor: "pointer",
    fontSize: 12,
    lineHeight: 1,
  };
}

function actionButtonStyle(): React.CSSProperties {
  return {
    border: `1px solid ${UI.border}`,
    background: "#fff",
    color: UI.text,
    borderRadius: 10,
    padding: "9px 11px",
    fontWeight: 900,
    fontSize: 12,
    cursor: "pointer",
  };
}

function PanelMessage({
  children,
  danger,
  isGhost,
}: {
  children: React.ReactNode;
  danger?: boolean;
  isGhost?: boolean;
}) {
  return (
    <div
      style={{
        background: danger
          ? isGhost
            ? "rgba(254,242,242,0.18)"
            : UI.redBg
          : isGhost
          ? "rgba(255,255,255,0.16)"
          : "#fff",
        color: danger ? UI.redText : UI.textDim,
        border: `1px solid ${danger ? "#fecaca" : UI.border}`,
        borderRadius: 14,
        padding: 16,
        fontWeight: 800,
        backdropFilter: isGhost ? "blur(.5px)" : "none",
        WebkitBackdropFilter: isGhost ? "blur(.5px)" : "none",
      }}
    >
      {children}
    </div>
  );
}

function MiniStat({
  label,
  value,
  danger,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          fontSize: 10.5,
          color: UI.textDim,
          fontWeight: 800,
          textTransform: "uppercase",
          letterSpacing: 0.2,
        }}
      >
        {label}
      </div>
      <div
        style={{
          marginTop: 2,
          fontSize: 15,
          fontWeight: 1000,
          color: danger ? UI.redText : UI.text,
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function InfoBlock({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.55)",
        border: `1px solid ${UI.borderSoft}`,
        borderRadius: 12,
        padding: 10,
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontSize: 10.5,
          color: UI.textDim,
          fontWeight: 800,
          textTransform: "uppercase",
          letterSpacing: 0.2,
        }}
      >
        {label}
      </div>
      <div
        style={{
          marginTop: 4,
          fontSize: 13,
          color: UI.text,
          fontWeight: 900,
          wordBreak: "break-word",
        }}
      >
        {value}
      </div>
    </div>
  );
}
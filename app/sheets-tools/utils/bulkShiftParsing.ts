"use client";

// Bulk Edit needs a tolerant parser because weekly rollover can prepend duplicate
// status symbols like ("Name... or ((Name... . We keep this copy local to
// /sheets-tools so /schedule behavior stays unchanged.

export type BulkShiftStatus =
  | "filled"
  | "offered"
  | "offering"
  | "considering"
  | "open"
  | "canceled"
  | "pending"
  | "none";

export type BulkBaseShiftStatus =
  | "Open"
  | "Filled"
  | "Offered"
  | "Offering"
  | "Considering"
  | "PendingClientApproval"
  | "Unknown";

export type ParsedBulkShiftCell = {
  rawText: string;
  normalizedText: string | null;
  status: BulkShiftStatus;
  baseStatus: BulkBaseShiftStatus;
  isCancelled: boolean;
  caregiverName: string | null;
  startTime: string | null;
  endTime: string | null;
  timeText: string | null;
};

const LEADING_STATUS_SYMBOLS = new Set(["(", '"', "$", "^"]);

function norm(value: unknown): string {
  return String(value ?? "").trim();
}

function collapseSpaces(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeCellText(raw: unknown): string {
  return String(raw ?? "").replace(/[“”]/g, '"');
}

function stripLeadingStatusSymbols(value: string): string {
  let s = value.trimStart();
  while (s && LEADING_STATUS_SYMBOLS.has(s[0])) {
    s = s.slice(1).trimStart();
  }
  return s.trim();
}

function getLeadingBaseStatus(value: string): BulkBaseShiftStatus | null {
  const s = value.trimStart();
  for (const char of s) {
    if (!LEADING_STATUS_SYMBOLS.has(char)) break;
    if (char === "(") return "Considering";
    if (char === '"') return "Offered";
    if (char === "$") return "PendingClientApproval";
    if (char === "^") return "Offering";
  }
  return null;
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
  if (!startTime || !endTime) return { startTime: null, endTime: null };
  return { startTime, endTime };
}

export function parseFirstTimeRangeBulk(cellValue: string): { start: string; end: string } | null {
  const s = normalizeCellText(cellValue);
  const match = s.match(
    /(\d{1,2}:\d{2}\s?[APMapm]{2})\s*-\s*(\d{1,2}:\d{2}\s?[APMapm]{2})/
  );
  if (!match) return null;
  return {
    start: match[1].replace(/\s+/g, ""),
    end: match[2].replace(/\s+/g, ""),
  };
}

export function parseBulkShiftCell(rawText: string): ParsedBulkShiftCell {
  const original = normalizeCellText(rawText);
  const trimmed = original.trim();
  if (!trimmed) {
    return {
      rawText: original,
      normalizedText: null,
      status: "none",
      baseStatus: "Unknown",
      isCancelled: false,
      caregiverName: null,
      startTime: null,
      endTime: null,
      timeText: null,
    };
  }

  const isCancelled = trimmed.includes("*");
  const withoutCancelled = collapseSpaces(trimmed.replace(/\*/g, " "));
  const leadingBaseStatus = getLeadingBaseStatus(withoutCancelled);
  const stripped = stripLeadingStatusSymbols(withoutCancelled);
  const timeRange = parseFirstTimeRangeBulk(stripped);
  const commaIndex = stripped.indexOf(",");

  let baseStatus: BulkBaseShiftStatus = "Unknown";
  if (leadingBaseStatus) {
    baseStatus = leadingBaseStatus;
  } else if (timeRange && commaIndex === -1) {
    baseStatus = "Open";
  } else if (commaIndex !== -1) {
    baseStatus = "Filled";
  }

  let caregiverName: string | null = null;
  let timeText: string | null = null;

  if (commaIndex !== -1) {
    caregiverName = collapseSpaces(stripLeadingStatusSymbols(stripped.slice(0, commaIndex))) || null;
    timeText = collapseSpaces(stripped.slice(commaIndex + 1)) || null;
  } else if (timeRange) {
    timeText = `${timeRange.start}-${timeRange.end}`;
  }

  const splitTime = splitTimeRange(timeText);
  const normalizedText =
    baseStatus === "Unknown"
      ? null
      : formatBulkShiftCell({
          caregiverName,
          startTime: splitTime.startTime,
          endTime: splitTime.endTime,
          baseStatus,
          isCancelled,
        });

  let status: BulkShiftStatus = "none";
  if (isCancelled) {
    status = "canceled";
  } else if (baseStatus === "Open") {
    status = "open";
  } else if (baseStatus === "Filled") {
    status = "filled";
  } else if (baseStatus === "Offered") {
    status = "offered";
  } else if (baseStatus === "Offering") {
    status = "offering";
  } else if (baseStatus === "Considering") {
    status = "considering";
  } else if (baseStatus === "PendingClientApproval") {
    status = "pending";
  }

  return {
    rawText: original,
    normalizedText,
    status,
    baseStatus,
    isCancelled,
    caregiverName,
    startTime: splitTime.startTime,
    endTime: splitTime.endTime,
    timeText,
  };
}

export function statusFromBulkCellValue(raw: unknown): BulkShiftStatus {
  return parseBulkShiftCell(String(raw ?? "")).status;
}

export function parseBulkCaregiverFromCell(cellValue: string): string {
  const parsed = parseBulkShiftCell(cellValue);
  return norm(parsed.caregiverName);
}

export function parseBulkCaregiverNameFromAnyShiftText(cellValue: string): string {
  return parseBulkCaregiverFromCell(cellValue);
}

export function formatBulkShiftCell(args: {
  caregiverName: string | null;
  startTime: string | null;
  endTime: string | null;
  baseStatus: Exclude<BulkBaseShiftStatus, "Unknown">;
  isCancelled?: boolean;
}): string {
  const caregiverName = collapseSpaces(norm(args.caregiverName));
  const startTime = collapseSpaces(norm(args.startTime));
  const endTime = collapseSpaces(norm(args.endTime));
  const isCancelled = Boolean(args.isCancelled);
  const timeText = startTime && endTime ? `${startTime}-${endTime}` : "";

  if (!timeText) {
    throw new Error("Cannot format shift without a time range.");
  }

  let core = "";
  switch (args.baseStatus) {
    case "Open":
      core = timeText;
      break;
    case "Filled":
      core = `${caregiverName}, ${timeText}`;
      break;
    case "Offered":
      core = `"${caregiverName}, ${timeText}`;
      break;
    case "Offering":
      core = `^${caregiverName}, ${timeText}`;
      break;
    case "Considering":
      core = `(${caregiverName}, ${timeText}`;
      break;
    case "PendingClientApproval":
      core = `$${caregiverName}, ${timeText}`;
      break;
  }

  return isCancelled ? `${core}*` : core;
}

export function cleanBulkCellValue(args: {
  rawText: string;
  targetBaseStatus: Exclude<BulkBaseShiftStatus, "Unknown">;
  targetCancelled?: boolean;
  caregiverNameOverride?: string | null;
}): string {
  const parsed = parseBulkShiftCell(args.rawText);
  const caregiverName =
    args.targetBaseStatus === "Open"
      ? null
      : collapseSpaces(norm(args.caregiverNameOverride || parsed.caregiverName));
  return formatBulkShiftCell({
    caregiverName,
    startTime: parsed.startTime,
    endTime: parsed.endTime,
    baseStatus: args.targetBaseStatus,
    isCancelled: Boolean(args.targetCancelled),
  });
}

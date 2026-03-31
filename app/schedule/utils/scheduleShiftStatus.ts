// app/schedule/utils/scheduleShiftStatus.ts

export type BaseShiftStatus =
  | "Open"
  | "Filled"
  | "Offered"
  | "Considering"
  | "PendingClientApproval"
  | "Unknown";

export type ParsedScheduleShift = {
  rawText: string;
  baseStatus: BaseShiftStatus;
  isCancelled: boolean;
  caregiverName: string | null;
  startTime: string | null;
  endTime: string | null;
  timeText: string | null;
  normalizedText: string | null;
  warnings: string[];
  errors: string[];
};

export type ConvertScheduleShiftStatusArgs = {
  rawText: string;
  targetBaseStatus: Exclude<BaseShiftStatus, "Unknown">;
  targetCancelled?: boolean;
  caregiverNameOverride?: string | null;
};

export type ConvertScheduleShiftStatusResult = {
  ok: boolean;
  newText: string | null;
  error?: string;
  before: ParsedScheduleShift;
  after?: ParsedScheduleShift;
};

export type CanConvertScheduleShiftResult = {
  allowed: boolean;
  reason?: string;
};

function norm(value: unknown): string {
  return String(value ?? "").trim();
}

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

  if (s.startsWith("(")) {
    s = s.slice(1).trimStart();
  }

  if (s.endsWith(")")) {
    s = s.slice(0, -1).trimEnd();
  }

  return s.trim();
}

function safeParenWrap(value: string): string {
  return `(${value})`;
}

function removeTrailingCancelledMarker(value: string): { text: string; isCancelled: boolean } {
  const s = value.trim();
  if (!s.endsWith("*")) return { text: s, isCancelled: false };
  return { text: s.slice(0, -1).trimEnd(), isCancelled: true };
}

function looksLikeTimePart(value: string): boolean {
  const s = collapseSpaces(value);

  // Accepts:
  // 12:30-5:30
  // 12:30PM-5:30PM
  // 9:00 AM - 12:00 PM
  // 7AM-3PM
  return /^(\d{1,2})(:\d{2})?\s*(AM|PM)?\s*-\s*(\d{1,2})(:\d{2})?\s*(AM|PM)?$/i.test(s);
}

function splitNameAndTime(value: string): {
  caregiverName: string | null;
  timeText: string | null;
} {
  const s = collapseSpaces(value);

  // Open shift
  if (looksLikeTimePart(s)) {
    return {
      caregiverName: null,
      timeText: s,
    };
  }

  const commaIndex = s.lastIndexOf(",");
  if (commaIndex === -1) {
    return {
      caregiverName: null,
      timeText: null,
    };
  }

  const left = collapseSpaces(s.slice(0, commaIndex));
  const right = collapseSpaces(s.slice(commaIndex + 1));

  if (!left || !right || !looksLikeTimePart(right)) {
    return {
      caregiverName: null,
      timeText: null,
    };
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
  if (!s) {
    return { startTime: null, endTime: null };
  }

  const parts = s.split("-");
  if (parts.length !== 2) {
    return { startTime: null, endTime: null };
  }

  const startTime = collapseSpaces(parts[0]);
  const endTime = collapseSpaces(parts[1]);

  if (!startTime || !endTime) {
    return { startTime: null, endTime: null };
  }

  return { startTime, endTime };
}

function detectBaseStatus(rawTextWithoutCancelled: string): {
  baseStatus: BaseShiftStatus;
  unwrappedText: string;
  warnings: string[];
} {
  const warnings: string[] = [];
  const s = rawTextWithoutCancelled.trim();

  if (!s) {
    return {
      baseStatus: "Unknown",
      unwrappedText: s,
      warnings: ["Shift text is empty after removing cancelled marker."],
    };
  }

    // Considering:
  // (Tammy G, 12:30-5:30
  // or
  // (Tammy G, 12:30-5:30)
  if (s.startsWith("(")) {
    return {
      baseStatus: "Considering",
      unwrappedText: stripOuterParens(s),
      warnings,
    };
  }

  // Offered: "Tammy G, 12:30-5:30
  if (s.startsWith('"')) {
    return {
      baseStatus: "Offered",
      unwrappedText: stripOuterDoubleQuotes(s),
      warnings,
    };
  }

  // Pending Client Approval: $Tammy G, 12:30-5:30
  if (s.startsWith("$")) {
    return {
      baseStatus: "PendingClientApproval",
      unwrappedText: stripOuterDollar(s),
      warnings,
    };
  }

  // Open or Filled
  if (looksLikeTimePart(s)) {
    return {
      baseStatus: "Open",
      unwrappedText: s,
      warnings,
    };
  }

  if (s.includes(",")) {
    return {
      baseStatus: "Filled",
      unwrappedText: s,
      warnings,
    };
  }

  return {
    baseStatus: "Unknown",
    unwrappedText: s,
    warnings: [...warnings, "Could not determine shift status from text."],
  };
}

export function parseScheduleShiftCell(rawText: string): ParsedScheduleShift {
  const original = String(rawText ?? "");
  const trimmed = original.trim();
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!trimmed) {
    return {
      rawText: original,
      baseStatus: "Unknown",
      isCancelled: false,
      caregiverName: null,
      startTime: null,
      endTime: null,
      timeText: null,
      normalizedText: null,
      warnings,
      errors: ["Shift cell is empty."],
    };
  }

  const cancelledInfo = removeTrailingCancelledMarker(trimmed);
  const statusInfo = detectBaseStatus(cancelledInfo.text);

  warnings.push(...statusInfo.warnings);

  const split = splitNameAndTime(statusInfo.unwrappedText);
  const timeParts = splitTimeRange(split.timeText);

  if (statusInfo.baseStatus === "Open") {
    if (!split.timeText) {
      errors.push("Open shift is missing a valid time range.");
    }
  } else if (statusInfo.baseStatus !== "Unknown") {
    if (!split.caregiverName) {
      errors.push("Shift is missing a caregiver name.");
    }
    if (!split.timeText) {
      errors.push("Shift is missing a valid time range.");
    }
  }

  let normalizedText: string | null = null;
  if (statusInfo.baseStatus !== "Unknown" && split.timeText) {
    normalizedText = formatScheduleShift({
      caregiverName: split.caregiverName,
      startTime: timeParts.startTime ?? split.timeText.split("-")[0]?.trim() ?? null,
      endTime: timeParts.endTime ?? split.timeText.split("-")[1]?.trim() ?? null,
      timeText: split.timeText,
      baseStatus: statusInfo.baseStatus,
      isCancelled: cancelledInfo.isCancelled,
    });
  }

  return {
    rawText: original,
    baseStatus: statusInfo.baseStatus,
    isCancelled: cancelledInfo.isCancelled,
    caregiverName: split.caregiverName,
    startTime: timeParts.startTime,
    endTime: timeParts.endTime,
    timeText: split.timeText,
    normalizedText,
    warnings,
    errors,
  };
}

export function formatScheduleShift(args: {
  caregiverName: string | null;
  startTime: string | null;
  endTime: string | null;
  timeText?: string | null;
  baseStatus: Exclude<BaseShiftStatus, "Unknown">;
  isCancelled?: boolean;
}): string {
  const caregiverName = collapseSpaces(norm(args.caregiverName));
  const explicitTimeText = collapseSpaces(norm(args.timeText));
  const startTime = collapseSpaces(norm(args.startTime));
  const endTime = collapseSpaces(norm(args.endTime));
  const isCancelled = Boolean(args.isCancelled);

  const timeText =
    explicitTimeText || (startTime && endTime ? `${startTime}-${endTime}` : "");

  if (!timeText) {
    throw new Error("Cannot format shift without a time range.");
  }

  const needsCaregiver = args.baseStatus !== "Open";
  if (needsCaregiver && !caregiverName) {
    throw new Error(`Cannot format ${args.baseStatus} shift without a caregiver name.`);
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
    case "Considering":
      core = safeParenWrap(`${caregiverName}, ${timeText}`);
      break;
    case "PendingClientApproval":
      core = `$${caregiverName}, ${timeText}`;
      break;
    default:
      throw new Error(`Unsupported shift status: ${args.baseStatus satisfies never}`);
  }

  return isCancelled ? `${core}*` : core;
}

export function canConvertScheduleShift(args: {
  parsed: ParsedScheduleShift;
  targetBaseStatus: Exclude<BaseShiftStatus, "Unknown">;
  caregiverNameOverride?: string | null;
}): CanConvertScheduleShiftResult {
  const { parsed, targetBaseStatus, caregiverNameOverride } = args;
  const caregiverName = collapseSpaces(norm(caregiverNameOverride || parsed.caregiverName));

  if (parsed.baseStatus === "Unknown") {
    return {
      allowed: false,
      reason: "Cannot convert a shift with unknown status.",
    };
  }

  if (!parsed.timeText) {
    return {
      allowed: false,
      reason: "Cannot convert a shift without a valid time range.",
    };
  }

  if (targetBaseStatus === "Open") {
    return { allowed: true };
  }

  if (!caregiverName) {
    return {
      allowed: false,
      reason: `Converting to ${targetBaseStatus} requires a caregiver name.`,
    };
  }

  return { allowed: true };
}

export function convertScheduleShiftStatus(
  args: ConvertScheduleShiftStatusArgs
): ConvertScheduleShiftStatusResult {
  const before = parseScheduleShiftCell(args.rawText);

  const conversionCheck = canConvertScheduleShift({
    parsed: before,
    targetBaseStatus: args.targetBaseStatus,
    caregiverNameOverride: args.caregiverNameOverride,
  });

  if (!conversionCheck.allowed) {
    return {
      ok: false,
      newText: null,
      error: conversionCheck.reason || "Shift conversion is not allowed.",
      before,
    };
  }

  const caregiverName =
    args.targetBaseStatus === "Open"
      ? null
      : collapseSpaces(norm(args.caregiverNameOverride || before.caregiverName));

  try {
    const newText = formatScheduleShift({
      caregiverName,
      startTime: before.startTime,
      endTime: before.endTime,
      timeText: before.timeText,
      baseStatus: args.targetBaseStatus,
      isCancelled:
        typeof args.targetCancelled === "boolean" ? args.targetCancelled : before.isCancelled,
    });

    const after = parseScheduleShiftCell(newText);

    if (after.baseStatus === "Unknown" || after.errors.length > 0) {
      return {
        ok: false,
        newText: null,
        error:
          after.errors[0] ||
          "Shift converted into an invalid format.",
        before,
      };
    }

    return {
      ok: true,
      newText,
      before,
      after,
    };
  } catch (error) {
    return {
      ok: false,
      newText: null,
      error: error instanceof Error ? error.message : "Unknown conversion error.",
      before,
    };
  }
}

export function changeShiftCancelledState(args: {
  rawText: string;
  isCancelled: boolean;
}): ConvertScheduleShiftStatusResult {
  const before = parseScheduleShiftCell(args.rawText);

  if (before.baseStatus === "Unknown") {
    return {
      ok: false,
      newText: null,
      error: "Cannot change cancelled state for an unknown shift format.",
      before,
    };
  }

  if (!before.timeText) {
    return {
      ok: false,
      newText: null,
      error: "Cannot change cancelled state without a valid time range.",
      before,
    };
  }

  try {
    const newText = formatScheduleShift({
      caregiverName: before.caregiverName,
      startTime: before.startTime,
      endTime: before.endTime,
      timeText: before.timeText,
      baseStatus: before.baseStatus,
      isCancelled: args.isCancelled,
    });

    const after = parseScheduleShiftCell(newText);

    return {
      ok: true,
      newText,
      before,
      after,
    };
  } catch (error) {
    return {
      ok: false,
      newText: null,
      error: error instanceof Error ? error.message : "Unknown cancelled-state error.",
      before,
    };
  }
}

export function getShiftDisplayStatus(parsed: ParsedScheduleShift):
  | "Open"
  | "Filled"
  | "Offered"
  | "Considering"
  | "Pending Client Approval"
  | "Cancelled Open"
  | "Cancelled Filled"
  | "Cancelled Offered"
  | "Cancelled Considering"
  | "Cancelled Pending Client Approval"
  | "Unknown" {
  if (parsed.baseStatus === "Unknown") return "Unknown";
  if (!parsed.isCancelled) {
    switch (parsed.baseStatus) {
      case "Open":
        return "Open";
      case "Filled":
        return "Filled";
      case "Offered":
        return "Offered";
      case "Considering":
        return "Considering";
      case "PendingClientApproval":
        return "Pending Client Approval";
      default:
        return "Unknown";
    }
  }

  switch (parsed.baseStatus) {
    case "Open":
      return "Cancelled Open";
    case "Filled":
      return "Cancelled Filled";
    case "Offered":
      return "Cancelled Offered";
    case "Considering":
      return "Cancelled Considering";
    case "PendingClientApproval":
      return "Cancelled Pending Client Approval";
    default:
      return "Unknown";
  }
}
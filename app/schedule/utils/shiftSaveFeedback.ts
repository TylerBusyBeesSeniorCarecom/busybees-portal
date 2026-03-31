// app/schedule/utils/shiftSaveFeedback.ts

export type ShiftSaveCaregiverInput = {
  caregiverId?: string;
  nameOnSchedule?: string;
  name?: string;
  status?: string;
};

export type ShiftConflictCheckRow = {
  shiftId?: string;
  date?: string;
  caregiverId?: string;
  caregiverName?: string;
  startTime?: string;
  endTime?: string;
  status?: string;
  client?: string;
};

export type ShiftConflictCheckOptions = {
  currentShiftId?: string;
  shiftDate?: string;
  existingShifts?: ShiftConflictCheckRow[];

  // ✅ NEW: lets us detect deletions and show what used to be in the cell
  previousRawText?: string;
};

export type ShiftConflictMatch = {
  shiftId: string;
  client: string;
  startTime: string;
  endTime: string;
  status: string;
  overlapMinutes: number;
  line: string;
};

export type ParsedShiftMeaning = {
  rawText: string;
  status:
    | "Filled"
    | "Offered"
    | "Considering"
    | "Open"
    | "Pending Client Confirmation"
    | "Unknown";
  caregiver: string;
  caregiverId: string | null;
  startTime: string | null;
  endTime: string | null;
  totalHours: number | null;
  warnings: string[];
  errors: string[];
  conflictChecked: boolean;
  conflictCount: number;
  conflictLines: string[];
  conflictMatches: ShiftConflictMatch[];

  // ✅ NEW
  isDeleted: boolean;
  deletedFromText: string;
  missingCommaDetected: boolean;
};

export type ShiftSaveToastModel = {
  kind: "success" | "warning" | "error";
  title: string;
  lines: string[];
};

const SHIFT_CONFLICT_DEBUG = true;

function debugShiftConflict(label: string, payload: any) {
  if (!SHIFT_CONFLICT_DEBUG) return;
  console.log(`[shiftSaveFeedback] ${label}`, payload);
}

function norm(v: unknown): string {
  return String(v ?? "").trim();
}

function normalizeQuotes(value: string): string {
  return value.replace(/[“”]/g, '"').trim();
}

function normalizeKey(value: string): string {
  return norm(value).toLowerCase();
}

function parseTimeToMinutes(timeStr: string): number | null {
  const raw = norm(timeStr);
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

function calculateHours(startTime: string, endTime: string): number | null {
  const start = parseTimeToMinutes(startTime);
  const end0 = parseTimeToMinutes(endTime);
  if (start == null || end0 == null) return null;

  let end = end0;
  if (end <= start) end += 24 * 60;

  return Math.round(((end - start) / 60) * 100) / 100;
}

function isInactiveStatus(status: string | undefined): boolean {
  const s = norm(status).toLowerCase();
  if (!s) return false;
  return s.includes("inactive") || s.includes("terminated");
}

function isNonWorkingShiftStatus(status: string | undefined): boolean {
  const s = norm(status).toLowerCase();
  if (!s) return false;

  return (
    s.includes("cancel") ||
    s.includes("canceled") ||
    s.includes("cancelled") ||
    s.includes("unassigned")
  );
}

function buildCaregiverMap(
  caregivers: ShiftSaveCaregiverInput[]
): Map<string, ShiftSaveCaregiverInput> {
  const map = new Map<string, ShiftSaveCaregiverInput>();

  for (const caregiver of caregivers) {
    const key = normalizeKey(caregiver.nameOnSchedule || caregiver.name || "");
    if (!key) continue;
    map.set(key, caregiver);
  }

  return map;
}

function dateKeyLoose(s: string): string {
  const raw = norm(s);
  if (!raw) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;

  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function timeRangeToMinutes(
  startTime: string,
  endTime: string
): { start: number; end: number } | null {
  const s = parseTimeToMinutes(startTime);
  const e0 = parseTimeToMinutes(endTime);
  if (s == null || e0 == null) return null;

  let e = e0;
  if (e <= s) e += 24 * 60;

  return { start: s, end: e };
}

function overlapMinutes(
  a: { start: number; end: number },
  b: { start: number; end: number }
): number {
  const latestStart = Math.max(a.start, b.start);
  const earliestEnd = Math.min(a.end, b.end);
  return Math.max(0, earliestEnd - latestStart);
}

function formatOverlapDuration(overlapMinutesValue: number): string {
  const mins = Math.max(0, Math.round(overlapMinutesValue));

  if (mins < 60) {
    return `${mins} min overlap`;
  }

  const hours = Math.floor(mins / 60);
  const minsRemainder = mins % 60;

  if (minsRemainder === 0) {
    return `${hours}h overlap`;
  }

  return `${hours}h ${minsRemainder}m overlap`;
}

function formatConflictLine(args: {
  client?: string;
  startTime?: string;
  endTime?: string;
  status?: string;
  overlap: number;
}): string {
  const client = norm(args.client) || "Unknown client";
  const start = norm(args.startTime) || "—";
  const end = norm(args.endTime) || "—";
  const status = norm(args.status) || "Unknown";
  const overlapText = formatOverlapDuration(args.overlap);

  return `Conflicts with ${client} • ${start}-${end} • ${status} • ${overlapText}`;
}

function parseTimeRangeFromText(text: string): { startTime: string; endTime: string } | null {
  const s = normalizeQuotes(text);
  const matches = s.match(/\d{1,2}:\d{2}\s?[APMapm]{2}/g);
  if (!matches || matches.length < 2) return null;

  return {
    startTime: norm(matches[0]),
    endTime: norm(matches[1]),
  };
}

function parseCaregiverFromProperFilledText(text: string): string {
  const s = normalizeQuotes(text);
  const idx = s.indexOf(",");
  if (idx === -1) return "";
  return norm(s.slice(0, idx));
}

function detectMissingCommaPattern(text: string): {
  caregiver: string;
  startTime: string;
  endTime: string;
} | null {
  const s = normalizeQuotes(text);

  // Example:
  // Richelle 5:00AM-2:00PM
  // Richelle B 5:00 AM-2:00 PM
  // No comma between caregiver and time range
  const m = s.match(
    /^(.+?)\s+(\d{1,2}:\d{2}\s?[APMapm]{2})\s*-\s*(\d{1,2}:\d{2}\s?[APMapm]{2})$/
  );

  if (!m) return null;

  const caregiver = norm(m[1]);
  const startTime = norm(m[2]);
  const endTime = norm(m[3]);

  if (!caregiver) return null;

  // If it already has comma-like schedule formatting, do not treat as missing comma
  if (caregiver.includes(",") || caregiver.includes('"') || caregiver.includes("(") || caregiver.includes("^") || caregiver.includes("$")) {
    return null;
  }

  return { caregiver, startTime, endTime };
}

function summarizeDeletedShift(previousRawText?: string): string {
  const prev = normalizeQuotes(norm(previousRawText));
  if (!prev) return "Previous shift: —";

  const properCaregiver = parseCaregiverFromProperFilledText(prev);
  const missingComma = detectMissingCommaPattern(prev);
  const times = parseTimeRangeFromText(prev);

  const caregiver =
    properCaregiver ||
    missingComma?.caregiver ||
    (/^\d/.test(prev) ? "Open" : "Unknown");

  const timeText =
    times ? `${times.startTime}-${times.endTime}` : prev;

  if (times) {
    return `Previous shift: ${caregiver} • ${timeText}`;
  }

  return `Previous shift: ${prev}`;
}

export function findShiftConflicts(params: {
  caregiverId: string | null;
  caregiverName: string;
  startTime: string | null;
  endTime: string | null;
  shiftDate?: string;
  currentShiftId?: string;
  existingShifts?: ShiftConflictCheckRow[];
}): ShiftConflictMatch[] {
  const {
    caregiverId,
    caregiverName,
    startTime,
    endTime,
    shiftDate,
    currentShiftId,
    existingShifts = [],
  } = params;

  debugShiftConflict("START findShiftConflicts", {
    caregiverId,
    caregiverName,
    startTime,
    endTime,
    shiftDate,
    currentShiftId,
    existingShiftsCount: existingShifts.length,
  });

  if (!startTime || !endTime || !shiftDate) {
    debugShiftConflict("EXIT early: missing required input", {
      startTime,
      endTime,
      shiftDate,
    });
    return [];
  }

  const targetRange = timeRangeToMinutes(startTime, endTime);
  if (!targetRange) {
    debugShiftConflict("EXIT early: invalid target range", {
      startTime,
      endTime,
    });
    return [];
  }

  const targetDateKey = dateKeyLoose(shiftDate);
  if (!targetDateKey) {
    debugShiftConflict("EXIT early: invalid target date", {
      shiftDate,
    });
    return [];
  }

  const targetCaregiverId = normalizeKey(caregiverId || "");
  const targetCaregiverName = normalizeKey(caregiverName || "");

  debugShiftConflict("TARGET normalized", {
    targetDateKey,
    targetRange,
    targetCaregiverId,
    targetCaregiverName,
  });

  if (!targetCaregiverId && !targetCaregiverName) {
    debugShiftConflict("EXIT early: no caregiver identity", {
      caregiverId,
      caregiverName,
    });
    return [];
  }

  const matches: ShiftConflictMatch[] = [];

  for (const row of existingShifts) {
    const rowShiftId = norm(row.shiftId);
    const rowDateKey = dateKeyLoose(row.date || "");
    const rowCaregiverId = normalizeKey(row.caregiverId || "");
    const rowCaregiverName = normalizeKey(row.caregiverName || "");
    const rowHasAssignedCaregiver = Boolean(rowCaregiverId || rowCaregiverName);
    const rowStart = norm(row.startTime);
    const rowEnd = norm(row.endTime);

    const skippedSelf =
      Boolean(currentShiftId && rowShiftId && rowShiftId === norm(currentShiftId));

    const skippedDate = !rowDateKey || rowDateKey !== targetDateKey;

    const skippedNonWorking =
      isNonWorkingShiftStatus(row.status) && !rowHasAssignedCaregiver;

    const matchesCaregiver =
      (targetCaregiverId &&
        rowCaregiverId &&
        targetCaregiverId === rowCaregiverId) ||
      (targetCaregiverName &&
        rowCaregiverName &&
        targetCaregiverName === rowCaregiverName) ||
      (!!targetCaregiverId &&
        !rowCaregiverId &&
        targetCaregiverName &&
        rowCaregiverName === targetCaregiverName);

    debugShiftConflict("ROW check", {
      row: {
        shiftId: row.shiftId,
        date: row.date,
        dateKey: rowDateKey,
        caregiverId: row.caregiverId,
        caregiverName: row.caregiverName,
        startTime: row.startTime,
        endTime: row.endTime,
        status: row.status,
        client: row.client,
      },
      skippedSelf,
      skippedDate,
      skippedNonWorking,
      matchesCaregiver,
    });

    if (skippedSelf) continue;
    if (skippedDate) continue;
    if (skippedNonWorking) continue;
    if (!matchesCaregiver) continue;

    if (!rowStart || !rowEnd) {
      debugShiftConflict("ROW skipped: missing row times", {
        rowStart,
        rowEnd,
        row,
      });
      continue;
    }

    const rowRange = timeRangeToMinutes(rowStart, rowEnd);
    if (!rowRange) {
      debugShiftConflict("ROW skipped: invalid row range", {
        rowStart,
        rowEnd,
        row,
      });
      continue;
    }

    const overlap = overlapMinutes(targetRange, rowRange);

    debugShiftConflict("ROW overlap result", {
      row: {
        shiftId: row.shiftId,
        client: row.client,
        startTime: row.startTime,
        endTime: row.endTime,
        status: row.status,
      },
      targetRange,
      rowRange,
      overlap,
    });

    if (overlap > 0) {
      const line = formatConflictLine({
        client: row.client,
        startTime: rowStart,
        endTime: rowEnd,
        status: row.status,
        overlap,
      });

      const match: ShiftConflictMatch = {
        shiftId: rowShiftId,
        client: norm(row.client) || "Unknown client",
        startTime: rowStart,
        endTime: rowEnd,
        status: norm(row.status) || "Unknown",
        overlapMinutes: overlap,
        line,
      };

      debugShiftConflict("ROW conflict FOUND", match);
      matches.push(match);
    }
  }

  debugShiftConflict("END findShiftConflicts", {
    conflictCount: matches.length,
    matches,
  });

  return matches;
}

export function parseShiftTextForFeedback(
  rawInput: string,
  caregivers: ShiftSaveCaregiverInput[],
  conflictOptions?: ShiftConflictCheckOptions
): ParsedShiftMeaning {
  const rawText = String(rawInput ?? "");
  const shiftInfo = normalizeQuotes(rawText);
  const previousRawText = normalizeQuotes(norm(conflictOptions?.previousRawText));

  let status: ParsedShiftMeaning["status"] = "Unknown";
  let caregiver = "Open";
  let caregiverId: string | null = null;
  let startTime: string | null = null;
  let endTime: string | null = null;

  const warnings: string[] = [];
  const errors: string[] = [];

  let conflictChecked = false;
  let conflictCount = 0;
  let conflictLines: string[] = [];
  let conflictMatches: ShiftConflictMatch[] = [];

  let isDeleted = false;
  let deletedFromText = "";
  let missingCommaDetected = false;

  const caregiverMap = buildCaregiverMap(caregivers);

  // ✅ Detect deleted shift first
  if (!norm(shiftInfo)) {
    isDeleted = true;
    deletedFromText = summarizeDeletedShift(previousRawText);

    return {
      rawText,
      status: "Open",
      caregiver: "Open",
      caregiverId: null,
      startTime: null,
      endTime: null,
      totalHours: null,
      warnings: [],
      errors: [],
      conflictChecked: false,
      conflictCount: 0,
      conflictLines: [],
      conflictMatches: [],
      isDeleted,
      deletedFromText,
      missingCommaDetected,
    };
  }

  // ✅ Detect "Richelle 5:00AM-2:00PM" missing comma format
  const missingCommaMatch = detectMissingCommaPattern(shiftInfo);
  if (missingCommaMatch) {
    missingCommaDetected = true;
    caregiver = missingCommaMatch.caregiver;
    startTime = missingCommaMatch.startTime;
    endTime = missingCommaMatch.endTime;
    status = "Unknown";

    warnings.push('Missing comma after caregiver name. Use "Caregiver, 5:00AM-2:00PM".');
    warnings.push("This shift will not show up correctly for the caregiver unless a comma is added.");
  } else if (shiftInfo.includes("$")) {
    caregiver = shiftInfo.replace("$", "").split(",")[0].trim() || "Open";
    status = "Pending Client Confirmation";
  } else if (shiftInfo.includes('"')) {
    const match = shiftInfo.match(/"([^,"]+)/);
    caregiver = match ? match[1].trim() : "Open";
    status = "Offered";
  } else if (shiftInfo.includes("^")) {
    const match = shiftInfo.match(/\^([^,]+)/);
    caregiver = match ? match[1].trim() : "Open";
    status = "Offered";
  } else if (shiftInfo.includes("(")) {
    const match = shiftInfo.match(/\(([^,)]+)/);
    caregiver = match ? match[1].trim() : "Open";
    status = "Considering";
  } else if (
    shiftInfo.match(
      /^[^"*$()^]+,\s?\d{1,2}:\d{2}\s?[APMapm]{2}-\d{1,2}:\d{2}\s?[APMapm]{2}$/
    )
  ) {
    caregiver = shiftInfo.split(",")[0].trim() || "Open";
    status = "Filled";
  } else if (
    shiftInfo.match(
      /^\d{1,2}:\d{2}\s?[APMapm]{2}-\d{1,2}:\d{2}\s?[APMapm]{2}$/
    )
  ) {
    caregiver = "Open";
    status = "Open";
  }

  if (!startTime || !endTime) {
    const timeMatch = shiftInfo.match(/\d{1,2}:\d{2}\s?[APMapm]{2}/g);
    if (timeMatch && timeMatch.length >= 2) {
      startTime = norm(timeMatch[0]);
      endTime = norm(timeMatch[1]);
    }
  }

  if (!startTime || !endTime) {
    errors.push("Could not read the shift start and end time.");
  }

  if (caregiver !== "Open") {
    const matched = caregiverMap.get(normalizeKey(caregiver));
    if (matched) {
      caregiverId = norm(matched.caregiverId) || null;

      if (isInactiveStatus(matched.status)) {
        warnings.push("Caregiver profile exists, but may be inactive.");
      }
    } else {
      warnings.push(`No caregiver profile matches "${caregiver}".`);
    }
  }

  const totalHours =
    startTime && endTime ? calculateHours(startTime, endTime) : null;

  if (startTime && endTime && totalHours == null) {
    errors.push("Could not calculate total hours.");
  }

  if (totalHours != null) {
    if (totalHours <= 0) {
      errors.push("Shift duration looks invalid.");
    } else if (totalHours < 1) {
      warnings.push("Shift duration looks very short.");
    } else if (totalHours > 16) {
      warnings.push("Shift duration looks unusually long.");
    }

    const startMin = startTime ? parseTimeToMinutes(startTime) : null;
    const endMin = endTime ? parseTimeToMinutes(endTime) : null;

    if (startMin != null && endMin != null && endMin <= startMin) {
      warnings.push("Overnight shift detected.");
    }
  }

  if (missingCommaDetected) {
    conflictChecked = false;
    conflictLines = ["Conflict: Not checked (format issue: missing comma after caregiver name)."];
  } else if (caregiver === "Open") {
    conflictChecked = false;
    conflictLines = ["Conflict: Not checked (open shift)."];
  } else if (!startTime || !endTime) {
    conflictChecked = false;
    conflictLines = ["Conflict: Not checked (missing start/end time)."];
  } else if (!conflictOptions?.shiftDate) {
    conflictChecked = false;
    conflictLines = ["Conflict: Not checked (missing shift date from save flow)."];
  } else if (!conflictOptions?.existingShifts?.length) {
    conflictChecked = false;
    conflictLines = ["Conflict: Not checked (no existing shifts passed in)."];
  } else {
    conflictChecked = true;

    debugShiftConflict("parseShiftTextForFeedback input", {
      rawInput,
      parsed: {
        caregiver,
        caregiverId,
        startTime,
        endTime,
        status,
      },
      conflictOptions,
    });

    conflictMatches = findShiftConflicts({
      caregiverId,
      caregiverName: caregiver,
      startTime,
      endTime,
      shiftDate: conflictOptions.shiftDate,
      currentShiftId: conflictOptions.currentShiftId,
      existingShifts: conflictOptions.existingShifts,
    });

    conflictCount = conflictMatches.length;
    conflictLines =
      conflictMatches.length > 0
        ? [`Conflict: Yes (${conflictMatches.length})`, ...conflictMatches.map((m) => m.line)]
        : ["Conflict: No"];

    if (conflictMatches.length > 0) {
      warnings.push("Shift overlaps with another scheduled shift.");
    }
  }

  if (
    (status === "Filled" ||
      status === "Offered" ||
      status === "Considering" ||
      status === "Pending Client Confirmation") &&
    caregiver === "Open"
  ) {
    warnings.push(
      "Formatting suggests a caregiver should be assigned, but none was interpreted."
    );
  }

  if (status === "Unknown" && !missingCommaDetected) {
    warnings.push(
      "Formatting was saved, but the shift meaning could not be confidently interpreted."
    );
  }

  return {
    rawText,
    status,
    caregiver,
    caregiverId,
    startTime,
    endTime,
    totalHours,
    warnings,
    errors,
    conflictChecked,
    conflictCount,
    conflictLines,
    conflictMatches,
    isDeleted,
    deletedFromText,
    missingCommaDetected,
  };
}

export function buildShiftSaveToast(
  parsed: ParsedShiftMeaning
): ShiftSaveToastModel {
  // ✅ Deleted shift toast
  if (parsed.isDeleted) {
    return {
      kind: "success",
      title: "Shift Deleted",
      lines: [
        parsed.deletedFromText || "Previous shift: —",
      ],
    };
  }

  const baseLines = [
    `Caregiver: ${parsed.caregiver || "Open"}`,
    `Status: ${parsed.status}`,
    `Time: ${parsed.startTime || "—"}–${parsed.endTime || "—"}`,
    `Hours: ${parsed.totalHours ?? "—"}`,
    ...parsed.conflictLines,
  ];

  if (parsed.errors.length > 0) {
    return {
      kind: "warning",
      title: "Shift saved with warnings",
      lines: [...baseLines, ...parsed.errors, ...parsed.warnings],
    };
  }

  if (parsed.warnings.length > 0) {
    return {
      kind: "warning",
      title: "Shift saved with warnings",
      lines: [...baseLines, ...parsed.warnings],
    };
  }

  return {
    kind: "success",
    title: "Shift saved",
    lines: baseLines,
  };
}
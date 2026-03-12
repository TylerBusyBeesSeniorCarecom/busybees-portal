// app/schedule/utils/shiftSaveFeedback.ts

export type ShiftSaveCaregiverInput = {
  caregiverId?: string;
  nameOnSchedule?: string;
  name?: string;
  status?: string;
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
};

export type ShiftSaveToastModel = {
  kind: "success" | "warning" | "error";
  title: string;
  lines: string[];
};

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
  if (end <= start) end += 24 * 60; // overnight support

  return Math.round(((end - start) / 60) * 100) / 100;
}

function isInactiveStatus(status: string | undefined): boolean {
  const s = norm(status).toLowerCase();
  if (!s) return false;
  return s.includes("inactive") || s.includes("terminated");
}

function buildCaregiverMap(
  caregivers: ShiftSaveCaregiverInput[]
): Map<string, ShiftSaveCaregiverInput> {
  const map = new Map<string, ShiftSaveCaregiverInput>();

  for (const caregiver of caregivers) {
    const key = normalizeKey(caregiver.nameOnSchedule || "");
    if (!key) continue;
    map.set(key, caregiver);
  }

  return map;
}

export function parseShiftTextForFeedback(
  rawInput: string,
  caregivers: ShiftSaveCaregiverInput[]
): ParsedShiftMeaning {
  const rawText = String(rawInput ?? "");
  const shiftInfo = normalizeQuotes(rawText);

  let status: ParsedShiftMeaning["status"] = "Unknown";
  let caregiver = "Open";
  let caregiverId: string | null = null;
  let startTime: string | null = null;
  let endTime: string | null = null;

  const warnings: string[] = [];
  const errors: string[] = [];

  const caregiverMap = buildCaregiverMap(caregivers);

  if (shiftInfo.includes("$")) {
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
    shiftInfo.match(/^[^"*$()^]+,\s?\d{1,2}:\d{2}\s?[APMapm]{2}-\d{1,2}:\d{2}\s?[APMapm]{2}$/)
  ) {
    caregiver = shiftInfo.split(",")[0].trim() || "Open";
    status = "Filled";
  } else if (
    shiftInfo.match(/^\d{1,2}:\d{2}\s?[APMapm]{2}-\d{1,2}:\d{2}\s?[APMapm]{2}$/)
  ) {
    caregiver = "Open";
    status = "Open";
  }

  const timeMatch = shiftInfo.match(/\d{1,2}:\d{2}\s?[APMapm]{2}/g);
  if (timeMatch && timeMatch.length >= 2) {
    startTime = norm(timeMatch[0]);
    endTime = norm(timeMatch[1]);
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

  if (
    (status === "Filled" ||
      status === "Offered" ||
      status === "Considering" ||
      status === "Pending Client Confirmation") &&
    caregiver === "Open"
  ) {
    warnings.push("Formatting suggests a caregiver should be assigned, but none was interpreted.");
  }

  if (status === "Unknown") {
    warnings.push("Formatting was saved, but the shift meaning could not be confidently interpreted.");
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
  };
}

export function buildShiftSaveToast(
  parsed: ParsedShiftMeaning
): ShiftSaveToastModel {
  if (parsed.errors.length > 0) {
    return {
      kind: "warning",
      title: "Shift saved with warnings",
      lines: [
        `Caregiver: ${parsed.caregiver || "Open"}`,
        `Status: ${parsed.status}`,
        `Time: ${parsed.startTime || "—"}–${parsed.endTime || "—"}`,
        `Hours: ${parsed.totalHours ?? "—"}`,
        ...parsed.errors,
        ...parsed.warnings,
      ],
    };
  }

  if (parsed.warnings.length > 0) {
    return {
      kind: "warning",
      title: "Shift saved with warnings",
      lines: [
        `Caregiver: ${parsed.caregiver || "Open"}`,
        `Status: ${parsed.status}`,
        `Time: ${parsed.startTime || "—"}–${parsed.endTime || "—"}`,
        `Hours: ${parsed.totalHours ?? "—"}`,
        ...parsed.warnings,
      ],
    };
  }

  return {
    kind: "success",
    title: "Shift saved",
    lines: [
      `Caregiver: ${parsed.caregiver || "Open"}`,
      `Status: ${parsed.status}`,
      `Time: ${parsed.startTime || "—"}–${parsed.endTime || "—"}`,
      `Hours: ${parsed.totalHours ?? "—"}`,
    ],
  };
}
"use client";

import { useMemo } from "react";

import { useSheetsToolsShared } from "@/app/sheets-tools/SheetsToolsSharedProvider";
import { timeLabelToMinutes, type ShiftRow } from "@/app/sheets-tools/shared";
import { getShiftsForCaregiver } from "./caregiverSchedule";

type CaregiverContextState = {
  cwHours: number | null;
  nwHours: number | null;
  loading: boolean;
};

function minutesBetween(startTime: string, endTime: string) {
  const start = timeLabelToMinutes(startTime);
  const end = timeLabelToMinutes(endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  if (end === start) return 0;
  return end > start ? end - start : end + 24 * 60 - start;
}

function sumCaregiverHours(args: {
  rows: ShiftRow[];
  caregiverID: string;
  caregiversById: Record<string, { name?: string; nameOnSchedule?: string }>;
  idByNameOnSchedule: Record<string, string>;
}) {
  let totalMinutes = 0;
  let found = false;

  for (const row of getShiftsForCaregiver(args)) {
    const minutes = minutesBetween(row.startTime, row.endTime);
    if (minutes > 0) {
      totalMinutes += minutes;
    }
    found = true;
  }

  return {
    found,
    hours: totalMinutes / 60,
  };
}

export function useCaregiverContext(caregiverID: string): CaregiverContextState {
  const {
    caregiversById,
    idByNameOnSchedule,
    cwLoaded,
    nwLoaded,
    availabilityLoaded,
    cwScheduleRows,
    nwScheduleRows,
  } = useSheetsToolsShared();

  const cw = useMemo(
    () =>
      sumCaregiverHours({
        rows: cwScheduleRows,
        caregiverID,
        caregiversById,
        idByNameOnSchedule,
      }),
    [caregiversById, caregiverID, cwScheduleRows, idByNameOnSchedule]
  );

  const nw = useMemo(
    () =>
      sumCaregiverHours({
        rows: nwScheduleRows,
        caregiverID,
        caregiversById,
        idByNameOnSchedule,
      }),
    [caregiversById, caregiverID, idByNameOnSchedule, nwScheduleRows]
  );

  return {
    cwHours: cw.found ? cw.hours : null,
    nwHours: nw.found ? nw.hours : null,
    loading: Boolean(!cwLoaded || !nwLoaded || !availabilityLoaded),
  };
}

"use client";

import { useEffect, useState } from "react";

import type { WeekKind } from "./shared";
import type { BulkTargetStatus } from "./components/bulkEdit.types";

export type BulkEditMessageHandoff = {
  week: WeekKind;
  shiftIDs: string[];
  shifts: Array<{
    shiftID: string;
    caregiverID: string;
    weekStart: string;
    date: string;
    client: string;
    startTime: string;
    endTime: string;
  }>;
  caregiverName: string;
  source: "message";
  createdAt: number;
  perfStartAt: number;
  targetStatus?: BulkTargetStatus;
};

export function logBulkEditPerf(
  label: string,
  startedAt: number,
  extra?: Record<string, unknown>
) {
  if (typeof window === "undefined" || !Number.isFinite(startedAt)) return;
  const now = window.performance.now();
  const delta = now - startedAt;
  if (extra && Object.keys(extra).length > 0) {
    console.log(`[BulkEditPerf] ${label} +${delta.toFixed(1)}ms`, extra);
    return;
  }
  console.log(`[BulkEditPerf] ${label} +${delta.toFixed(1)}ms`);
}

const listeners = new Set<() => void>();
let currentHandoff: BulkEditMessageHandoff | null = null;

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

export function queueBulkEditMessageHandoff(payload: BulkEditMessageHandoff) {
  currentHandoff = payload;
  emit();
}

export function consumeBulkEditMessageHandoff() {
  const handoff = currentHandoff;
  currentHandoff = null;
  emit();
  return handoff;
}

export function peekBulkEditMessageHandoff() {
  return currentHandoff;
}

export function useBulkEditMessageHandoff() {
  const [handoff, setHandoff] = useState<BulkEditMessageHandoff | null>(currentHandoff);

  useEffect(() => {
    const listener = () => setHandoff(currentHandoff);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return handoff;
}

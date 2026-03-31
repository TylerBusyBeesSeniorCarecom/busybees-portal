"use client";

import React, { useRef } from "react";

/** ---------- Status logic (ported from CWWebSchedule) ---------- */

export type ShiftStatus =
  | "filled"
  | "offered"
  | "offering"
  | "considering"
  | "open"
  | "canceled"
  | "pending"
  | "none";

/**
 * Base colors:
 * - cancelled -> overridden to light gray in the card
 * - future filled -> overridden to brighter green in the card
 */
export const SHEET_COLORS: Record<ShiftStatus, string> = {
  filled: "#1f7a3a",
  offered: "#2b6fd6",
  offering: "#49c9f2",
  considering: "#d08a1a",
  open: "#d64545",
  canceled: "#000000",
  pending: "#7a3db8",
  none: "#111827",
};

function norm(v: any) {
  return (v ?? "").toString().trim();
}

function normalizeCellText(raw: unknown): string {
  const s = String(raw ?? "");
  return s.replace(/[“”]/g, '"');
}

export function statusFromCellValue(raw: unknown): ShiftStatus {
  const cellValue = normalizeCellText(raw).trim();
  if (!cellValue) return "none";

  // marker rules (order matters)
  if (cellValue.includes("*")) return "canceled";
  if (cellValue.includes("$")) return "pending";
  if (cellValue.includes("^")) return "offering";
  if (cellValue.includes('"')) return "offered";
  if (cellValue.includes("(")) return "considering";

  // Filled: "Name, 7:00AM-10:00AM"
  const filledRegex =
    /^[^,*\$\(\)\^"]+,\s?\d{1,2}:\d{2}\s?[APMapm]{2}-\d{1,2}:\d{2}\s?[APMapm]{2}.*$/;

  // Open: "7:00AM-10:00AM"
  const openRegex =
    /^\d{1,2}:\d{2}\s?[APMapm]{2}-\d{1,2}:\d{2}\s?[APMapm]{2}.*$/;

  if (filledRegex.test(cellValue)) return "filled";
  if (openRegex.test(cellValue)) return "open";

  return "none";
}

/** ---------- Parsing helpers (grid cell -> caregiver + times) ---------- */

function parseCaregiverFromCell(cellValue: string): string {
  const v = norm(cellValue);
  if (!v) return "";
  const s = normalizeCellText(v);
  const idx = s.indexOf(",");
  if (idx === -1) return "";
  const cg = s.slice(0, idx).replace(/[(")]/g, "").trim();
  if (!cg) return "";
  if (cg.toLowerCase() === "open") return "";
  return cg;
}

function parseFirstTimeRange(cellValue: string): { start: string; end: string } | null {
  const s = normalizeCellText(cellValue);
  const m = s.match(
    /(\d{1,2}:\d{2}\s?[APMapm]{2})\s*-\s*(\d{1,2}:\d{2}\s?[APMapm]{2})/
  );
  if (!m) return null;
  return { start: m[1].replace(/\s+/g, ""), end: m[2].replace(/\s+/g, "") };
}

function parseCaregiverAndTime(value: string): {
  caregiver: string;
  timeLabel: string;
  start: string;
  end: string;
} | null {
  const v = norm(value);
  if (!v) return null;

  const tr = parseFirstTimeRange(v);
  if (!tr) return null;

  const caregiver = parseCaregiverFromCell(v);
  const timeLabel = `${tr.start}-${tr.end}`;
  return { caregiver, timeLabel, start: tr.start, end: tr.end };
}

/** ---------- Clock & verdict display helpers ---------- */

export type ClockEval = {
  state: "good" | "bad" | "none";
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  clockIn: Date | null;
  clockOut: Date | null;
  diffInMin: number | null;
  diffOutMin: number | null;
  reasons: string[];
};

export type ShiftTimeState = "future" | "in_progress" | "past" | "unknown";

function fmtNiceTime(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function clockDisplayLabelForPastOrProgress(
  which: "in" | "out",
  state: ShiftTimeState,
  clockEval: ClockEval
): string {
  if (which === "in") {
    if (clockEval.clockIn) return fmtNiceTime(clockEval.clockIn);
    return "No Clock In";
  }
  if (clockEval.clockOut) return fmtNiceTime(clockEval.clockOut);
  if (state === "in_progress") return "In progress";
  return "No Clock Out";
}

function normVerdict(v: any) {
  return norm(v).toLowerCase();
}

function verdictLabel(v: string) {
  const x = normVerdict(v);
  if (!x) return "";
  if (x === "on_site" || x === "onsite" || x === "on site") return "On site";
  if (x === "off_site" || x === "offsite" || x === "off site") return "Off site";
  if (x === "no_geofence") return "No geofence";
  if (x === "location_unavailable") return "Location unavailable";
  if (x === "unknown") return "Unknown";
  return v;
}

function isBadVerdict(v: string | null) {
  const x = normVerdict(v);
  if (!x) return false;
  return x === "off_site" || x === "offsite" || x === "no_geofence" || x === "location_unavailable";
}

function isUnderTimeVerdict(v: string | null) {
  const x = normVerdict(v);
  return x === "location_unavailable" || x === "unknown";
}

function isOffSite(v: string | null) {
  const x = normVerdict(v);
  return x === "off_site" || x === "offsite" || x === "off site";
}

function VerdictChip({ verdict }: { verdict: string | null }) {
  if (!verdict) return null;
  if (isUnderTimeVerdict(verdict)) return null;

  const label = verdictLabel(verdict);
  if (!label) return null;

  const offsite = isOffSite(verdict);
  const bad = isBadVerdict(verdict) || offsite;

  const bg = offsite
    ? "rgba(239,68,68,0.42)"
    : bad
    ? "rgba(245,158,11,0.28)"
    : "rgba(255,255,255,0.22)";

  const border = offsite
    ? "1px solid rgba(255,255,255,0.75)"
    : bad
    ? "1px solid rgba(255,255,255,0.55)"
    : "1px solid rgba(255,255,255,0.35)";

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        marginLeft: 4,
        padding: "1px 6px",
        borderRadius: 999,
        fontSize: 9.5,
        fontWeight: 950,
        lineHeight: 1.05,
        background: bg,
        border,
        color: "#fff",
        flex: "0 1 auto",
        minWidth: 0,
        maxWidth: "100%",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
      title={verdict || undefined}
    >
      {label}
    </span>
  );
}

function UnderTimeVerdictLine({ verdict }: { verdict: string | null }) {
  if (!verdict) return null;
  if (!isUnderTimeVerdict(verdict)) return null;

  return (
    <div
      style={{
        marginTop: 2,
        fontSize: 10.5,
        fontWeight: 900,
        opacity: 0.95,
        whiteSpace: "nowrap",
      }}
    >
      {verdictLabel(verdict)}
    </div>
  );
}

function ClockLine({
  label,
  timeText,
  verdict,
}: {
  label: "IN" | "OUT";
  timeText: string;
  verdict: string | null;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 4,
        minWidth: 0,
        maxWidth: "100%",
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", whiteSpace: "nowrap" }}>
        <strong style={{ marginRight: 4 }}>{label}:</strong> {timeText}
        <VerdictChip verdict={verdict} />
      </span>
      <UnderTimeVerdictLine verdict={verdict} />
    </span>
  );
}

/** ---------- ShiftCard ---------- */

export type ShiftInfoEngine = {
  getGridShiftInfo: (args: {
    clientName: string;
    dateStr: string;
    startTime: string;
    endTime: string;
    caregiverName: string; // empty for open
    isCancelled: boolean;
  }) => {
    shiftId: string;
    clockEval: ClockEval;
    timeState: ShiftTimeState;
    inVerdict: string | null;
    outVerdict: string | null;
    hasLocationIssue: boolean;
    hasClockIssue: boolean;
    isPastNoClocks: boolean;
    isVerified: boolean;
    showFlag: boolean;
  };
};

const CARD_COLLAPSED_HEIGHT = 35;
const CARD_EXPANDED_MIN_HEIGHT = 84;
const EMPTY_CELL_HEIGHT = 20;

export function ShiftCard({
  a1Key,
  value,
  status,
  disabled,
  onRequestEdit,
  expanded,
  onToggleExpanded,
  dateStrForDow,
  clientName,
  shiftInfo,
  rowIsEmpty,
  cellBg,
}: {
  a1Key: string;
  value: string;
  status: ShiftStatus;
  disabled?: boolean;
  onRequestEdit: () => void;

  expanded: boolean;
  onToggleExpanded: () => void;

  dateStrForDow: string;
  clientName: string;

  shiftInfo: ShiftInfoEngine;

  rowIsEmpty: boolean;
  cellBg: string;
}) {
  const v = norm(value);
  const isEmpty = !v;

  const parsed = isEmpty ? null : parseCaregiverAndTime(v);
  const timeLabel = parsed?.timeLabel ?? "";
  const caregiver = parsed?.caregiver ?? "";
  const start = parsed?.start ?? "";
  const end = parsed?.end ?? "";

  const displayTime = timeLabel || "—";
  const displayCaregiver = caregiver ? caregiver : "Open";

  const isCancelled = status === "canceled";

  const info = parsed
    ? shiftInfo.getGridShiftInfo({
        clientName,
        dateStr: dateStrForDow,
        startTime: start,
        endTime: end,
        caregiverName: caregiver || "",
        isCancelled,
      })
    : null;

  const shiftId = info?.shiftId ?? "";
  const clockEval =
    info?.clockEval ??
    ({
      state: "none",
      scheduledStart: null,
      scheduledEnd: null,
      clockIn: null,
      clockOut: null,
      diffInMin: null,
      diffOutMin: null,
      reasons: [],
    } as ClockEval);

  const tState = info?.timeState ?? "unknown";
  const inVerdict = info?.inVerdict ?? null;
  const outVerdict = info?.outVerdict ?? null;

  const hasLocationIssue = Boolean(info?.hasLocationIssue);
  const hasClockIssue = Boolean(info?.hasClockIssue);
  const isPastNoClocks = Boolean(info?.isPastNoClocks);

  const isVerified = Boolean(info?.isVerified);
  const showFlag = Boolean(info?.showFlag);

  // base colors
  let bg = SHEET_COLORS[status] || "#111827";
  let fg = "#ffffff";

  // empty cells blend into bg
  if (isEmpty) {
    bg = cellBg;
    fg = "#9ca3af";
  }

  // brighter green for future-filled (not cancelled, not empty)
  if (!isCancelled && !isEmpty && status === "filled" && tState === "future") {
    bg = "#16a34a";
  }

  // cancelled override
  if (isCancelled) {
    bg = "#e5e7eb";
    fg = "#111827";
  }

  const hasClockGood = clockEval.state === "good";

  const border = isEmpty
    ? "none"
    : isCancelled
    ? "1px solid #cbd5e1"
    : hasLocationIssue || hasClockIssue || isPastNoClocks
    ? "2px solid #ef4444"
    : hasClockGood
    ? "2px solid #22c55e"
    : "1px solid rgba(255,255,255,0.35)";

  const shadow = isEmpty
    ? "none"
    : isCancelled
    ? "0 1px 0 rgba(0,0,0,0.06)"
    : hasLocationIssue || hasClockIssue || isPastNoClocks
    ? "0 0 0 2px rgba(239,68,68,0.18)"
    : hasClockGood
    ? "0 0 0 2px rgba(34,197,94,0.18)"
    : "0 1px 0 rgba(0,0,0,0.08)";

  const inText = clockDisplayLabelForPastOrProgress("in", tState, clockEval);
  const outText = clockDisplayLabelForPastOrProgress("out", tState, clockEval);

  const showClockRow =
    expanded && !isEmpty && !isCancelled && tState !== "future" && tState !== "unknown";

  const showCombinedNoClock =
    !isEmpty && !isCancelled && tState === "past" && !clockEval.clockIn && !clockEval.clockOut;

  const tooltip = isEmpty
    ? ""
    : [
        shiftId ? `Shift ID: ${shiftId}` : "Shift ID: (not found)",
        isCancelled ? "Cancelled" : "",
        showFlag ? "Flagged" : "",
      ]
        .filter(Boolean)
        .join(" | ");

  const clickTimerRef = useRef<number | null>(null);

  function handleClick() {
    if (disabled) return;

    if (clickTimerRef.current) window.clearTimeout(clickTimerRef.current);
    clickTimerRef.current = window.setTimeout(() => {
      clickTimerRef.current = null;
      onRequestEdit();
    }, 220);
  }

  function handleDoubleClick(e: React.MouseEvent) {
    if (disabled) return;

    e.preventDefault();
    e.stopPropagation();

    if (clickTimerRef.current) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }

    onToggleExpanded();
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      disabled={disabled}
      style={{
        width: "100%",
        textAlign: "left",
        border: "none",
        background: "transparent",
        padding: 0,
        cursor: disabled ? "default" : "pointer",
      }}
      title={tooltip || "Click to edit • Double click to toggle clocks"}
      aria-label={`Shift ${a1Key}`}
    >
      <div
        style={{
          background: bg,
          color: fg,
          borderRadius: 12,
          padding: isEmpty ? "0px" : "10px 10px",
          boxShadow: shadow,
          opacity: disabled ? 0.6 : 1,
          position: "relative",
          border,
          minHeight: isEmpty
            ? rowIsEmpty
              ? EMPTY_CELL_HEIGHT
              : 34
            : expanded
            ? CARD_EXPANDED_MIN_HEIGHT
            : CARD_COLLAPSED_HEIGHT,
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-start",
          gap: isEmpty ? 0 : 6,
          overflow: "hidden",
        }}
      >
        {isEmpty ? (
          <div
            style={{
              height: "100%",
              minHeight: rowIsEmpty ? EMPTY_CELL_HEIGHT : 34,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 14,
              fontWeight: 900,
              color: "#9ca3af",
              userSelect: "none",
            }}
          >
            —
          </div>
        ) : (
          <>
            {isCancelled && (
              <div style={{ fontSize: 12, fontWeight: 950, letterSpacing: 0.2 }}>Cancelled</div>
            )}

            {showFlag && (
              <span
                style={{
                  position: "absolute",
                  top: 8,
                  right: 10,
                  fontSize: 14,
                  lineHeight: 1,
                  color: fg,
                  filter: isCancelled ? undefined : "drop-shadow(0 1px 0 rgba(0,0,0,0.25))",
                }}
                aria-label="Flagged shift"
                title="Flagged shift"
              >
                🚩
              </span>
            )}

            {isVerified && (
              <span
                style={{
                  position: "absolute",
                  top: 7,
                  right: 8,
                  width: 22,
                  height: 22,
                  borderRadius: 999,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 14,
                  fontWeight: 950,
                  background: "rgba(236,253,245,0.92)",
                  color: "#065f46",
                  border: "1px solid rgba(167,243,208,0.95)",
                }}
                title="Verified"
                aria-label="Verified"
              >
                ✓
              </span>
            )}

            <div style={{ fontSize: 12, fontWeight: 950, letterSpacing: 0.2 }}>{displayTime}</div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 850,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {displayCaregiver}
            </div>
          </>
        )}

        {showClockRow && (
          <div
            style={{
              fontSize: 11,
              marginTop: 2,
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
              alignItems: "flex-start",
              opacity: 0.95,
            }}
          >
            {showCombinedNoClock ? (
              <span style={{ whiteSpace: "nowrap" }}>
                <strong>Clock:</strong> No Clock In/Out
              </span>
            ) : (
              <>
                <ClockLine label="IN" timeText={inText} verdict={inVerdict} />
                <ClockLine label="OUT" timeText={outText} verdict={outVerdict} />
              </>
            )}

            {parsed && !shiftId ? (
              <span style={{ whiteSpace: "nowrap", fontWeight: 900, opacity: 0.95 }}>
                (No Shift ID match)
              </span>
            ) : null}
          </div>
        )}
      </div>
    </button>
  );
}

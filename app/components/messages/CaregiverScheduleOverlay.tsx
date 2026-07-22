"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";

import { UI, getWeekStartYmd } from "@/app/sheets-tools/shared";
import { firebaseDb } from "@/lib/firebase/client";

type WeekKind = "cw" | "nw";

type ShiftRow = {
  date: string;
  client: string;
  startTime: string;
  endTime: string;
  status: string;
  active: boolean;
};

type ShiftTone = {
  bg: string;
  text: string;
  border: string;
  label: string;
};

type DesiredHoursMeta = {
  raw: string;
  wantsMax: boolean;
  min: number | null;
  max: number | null;
};

type ScheduleOverlayProps = {
  caregiverID: string;
  open: boolean;
  week: WeekKind;
  width: number;
  minWidth: number;
  maxWidth: number;
  collapsedWidth: number;
  collapsed: boolean;
  onClose: () => void;
  onWeekChange: (week: WeekKind) => void;
  onCollapsedChange: (collapsed: boolean) => void;
  onWidthChange: (width: number) => void;
};

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DOW_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const TONE_BY_STATUS: Record<string, ShiftTone> = {
  filled: {
    bg: "rgba(33, 136, 56, 0.15)",
    text: "#155724",
    border: "rgba(33, 136, 56, 0.3)",
    label: "Filled",
  },
  considering: {
    bg: "rgba(230, 81, 0, 0.15)",
    text: "#8A3800",
    border: "rgba(230, 81, 0, 0.3)",
    label: "Considering",
  },
  offered: {
    bg: "rgba(21, 101, 192, 0.15)",
    text: "#0A3D75",
    border: "rgba(21, 101, 192, 0.3)",
    label: "Offered",
  },
  pending: {
    bg: "rgba(106, 27, 154, 0.15)",
    text: "#3D1057",
    border: "rgba(106, 27, 154, 0.3)",
    label: "Pending",
  },
  neutral: {
    bg: "#f3f4f6",
    text: "#374151",
    border: "#d1d5db",
    label: "Other",
  },
};

function parseDateYmd(ymd: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatRange(startYmd: string) {
  const start = parseDateYmd(startYmd);
  if (!start) return startYmd;
  const end = addDays(start, 6);
  const fmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
  return `${fmt.format(start)} – ${fmt.format(end)}`;
}

function formatDayShiftTime(raw: string) {
  const normalized = String(raw || "").trim().replace(/\s+/g, "").toUpperCase();
  const match = normalized.match(/^(\d{1,2})(?::(\d{2}))?(AM|PM)$/);
  if (!match) return normalized.toLowerCase();

  let hours = Number(match[1]) % 12;
  const minutes = match[2] || "00";
  const suffix = match[3].toLowerCase();
  if (hours === 0) hours = 12;
  return minutes === "00" ? `${hours}${suffix}` : `${hours}:${minutes}${suffix}`;
}

function parseTimeToMinutes(t: string): number | null {
  const raw = String(t || "").trim();
  if (!raw) return null;
  const normalized = raw.replace(/\s+/g, " ").replace(/([AP]M)$/i, " $1").trim();
  const match = normalized.match(/^(\d{1,2})(?::(\d{2}))?\s*([AP]M)$/i);
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = Number(match[2] || "0");
  const ampm = match[3].toUpperCase();
  if (hours === 12) hours = 0;
  if (ampm === "PM") hours += 12;
  return hours * 60 + minutes;
}

function parseShiftDurationHours(startTime: string, endTime: string): number {
  const start = parseTimeToMinutes(startTime);
  const end = parseTimeToMinutes(endTime);
  if (start == null || end == null) return 0;
  const adjustedEnd = end <= start ? end + 24 * 60 : end;
  return (adjustedEnd - start) / 60;
}

function normalizeStatus(raw: unknown) {
  return String(raw ?? "")
    .replace(/[“”]/g, '"')
    .trim()
    .toLowerCase();
}

function isFalseLike(value: unknown) {
  if (value === false || value === 0) return true;
  const normalized = normalizeStatus(value);
  return normalized === "false" || normalized === "0" || normalized === "no" || normalized === "inactive";
}

function toneForStatus(rawStatus: string): ShiftTone {
  const status = normalizeStatus(rawStatus);
  if (!status) return TONE_BY_STATUS.neutral;
  if (status.includes("cancel")) return TONE_BY_STATUS.neutral;
  if (status.includes("pending")) return TONE_BY_STATUS.pending;
  if (status === "considering") return TONE_BY_STATUS.considering;
  if (status === "offered") return TONE_BY_STATUS.offered;
  if (status.includes("filled")) return TONE_BY_STATUS.filled;
  return TONE_BY_STATUS.neutral;
}

function isCancelledOrHiddenShift(data: Record<string, unknown>) {
  if (isFalseLike(data.active ?? data.isActive ?? true)) return true;
  const status = normalizeStatus(data.status ?? data.shiftStatus ?? data.state ?? data.availabilityStatus);
  return status.includes("cancel");
}

function parseDesiredHoursMeta(raw: string): DesiredHoursMeta {
  const v = String(raw || "").trim();
  if (!v) return { raw: v, wantsMax: false, min: null, max: null };
  const lower = v.toLowerCase();
  if (lower.includes("as many as possible") || lower.includes("as much as possible") || lower.includes("as many as")) {
    return { raw: v, wantsMax: true, min: null, max: null };
  }

  const range = v.match(/(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)/);
  if (range) {
    const min = Number(range[1]);
    const max = Number(range[2]);
    return {
      raw: v,
      wantsMax: false,
      min: Number.isFinite(min) ? min : null,
      max: Number.isFinite(max) ? max : null,
    };
  }

  return { raw: v, wantsMax: false, min: null, max: null };
}

function desiredMidpoint(meta: DesiredHoursMeta): number | null {
  if (meta.wantsMax) return 40;
  if (meta.min == null || meta.max == null) return null;
  return Math.floor((meta.min + meta.max) / 2);
}

function formatHours(value: number) {
  if (!Number.isFinite(value)) return "0";
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

function formatAvailabilityValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean).join(", ");
  }
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    return (
      String(rec.text || rec.value || rec.label || rec.availability || rec.notes || "").trim() ||
      JSON.stringify(value)
    );
  }
  return "";
}

function getAvailabilityForDow(data: Record<string, unknown>, dow: number) {
  const dayKeys = [
    DOW_FULL[dow],
    DOW_LABELS[dow],
    DOW_FULL[dow].toLowerCase(),
    DOW_LABELS[dow].toLowerCase(),
    `day${dow}`,
    `${dow}`,
  ];

  const containers = [
    data,
    (data.availability as Record<string, unknown>) || {},
    (data.days as Record<string, unknown>) || {},
    (data.byDay as Record<string, unknown>) || {},
    (data.availabilityByDay as Record<string, unknown>) || {},
  ];

  for (const container of containers) {
    if (!container || typeof container !== "object") continue;
    for (const key of dayKeys) {
      const candidate = formatAvailabilityValue(container[key]);
      if (candidate) return candidate;
    }
  }

  const fallback = formatAvailabilityValue(data.availabilityText || data.availability || data.notes);
  return fallback;
}

function buildShiftLabel(shift: ShiftRow) {
  return `${formatDayShiftTime(shift.startTime)}-${formatDayShiftTime(shift.endTime)} w/ ${shift.client}`;
}

function formatLegendLabel(status: string) {
  return TONE_BY_STATUS[status]?.label || status;
}

export default function CaregiverScheduleOverlay({
  caregiverID,
  open,
  week,
  width,
  minWidth,
  maxWidth,
  collapsedWidth,
  collapsed,
  onClose,
  onWeekChange,
  onCollapsedChange,
  onWidthChange,
}: ScheduleOverlayProps) {
  const [availabilityData, setAvailabilityData] = useState<Record<string, unknown> | null>(null);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const weekStartYmd = useMemo(() => getWeekStartYmd(week), [week]);
  const desiredMeta = useMemo(() => parseDesiredHoursMeta(String(availabilityData?.desiredHours || "")), [availabilityData]);
  const desiredTarget = useMemo(() => desiredMidpoint(desiredMeta), [desiredMeta]);
  const notes = useMemo(() => String(availabilityData?.notes || "").trim(), [availabilityData]);

  useEffect(() => {
    if (!open || !caregiverID) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    void Promise.all([
      getDocs(
        query(
          collection(firebaseDb, "availability"),
          where("caregiverID", "==", caregiverID),
          where("weekStart", "==", weekStartYmd)
        )
      ),
      getDocs(
        query(
          collection(firebaseDb, "shifts"),
          where("caregiverID", "==", caregiverID),
          where("weekStart", "==", weekStartYmd)
        )
      ),
    ])
      .then(([availabilitySnapshot, shiftsSnapshot]) => {
        if (cancelled) return;

        const sortedAvailability = availabilitySnapshot.docs
          .map((docSnapshot) => {
            const data = docSnapshot.data() as Record<string, unknown>;
            const timestamp = data.timestamp || data.updatedAt || data.createdAt || null;
            const tsDate =
              timestamp && typeof timestamp === "object" && typeof (timestamp as any).toDate === "function"
                ? (timestamp as { toDate: () => Date }).toDate()
                : timestamp instanceof Date
                  ? timestamp
                  : null;
            return { data, tsDate };
          })
          .sort((a, b) => (b.tsDate?.getTime() || 0) - (a.tsDate?.getTime() || 0));

        setAvailabilityData(sortedAvailability[0]?.data || null);

        const unknownStatuses = new Set<string>();

        const nextShifts = shiftsSnapshot.docs
          .map((docSnapshot) => {
            const data = docSnapshot.data() as Record<string, unknown>;
            if (isCancelledOrHiddenShift(data)) return null;

            const date = String(data.date || "").trim();
            const client = String(data.client || "").trim();
            const startTime = String(data.startTime || "").trim();
            const endTime = String(data.endTime || "").trim();
            if (!date || !client || !startTime || !endTime) return null;

            const status = String(data.status || data.shiftStatus || data.state || data.availabilityStatus || "").trim();
            if (status) {
              const lowered = normalizeStatus(status);
              const isKnown =
                lowered.includes("cancel") ||
                lowered.includes("pending") ||
                lowered.includes("filled") ||
                lowered === "considering" ||
                lowered === "offered";
              if (!isKnown) unknownStatuses.add(status);
            }

            return {
              date,
              client,
              startTime,
              endTime,
              status,
              active: !isFalseLike(data.active ?? data.isActive ?? true),
            };
          })
          .filter((item): item is ShiftRow => Boolean(item))
          .sort((a, b) => {
            const aDate = parseDateYmd(a.date)?.getTime() || 0;
            const bDate = parseDateYmd(b.date)?.getTime() || 0;
            if (aDate !== bDate) return aDate - bDate;
            return (parseTimeToMinutes(a.startTime) || 0) - (parseTimeToMinutes(b.startTime) || 0);
          });

        if (unknownStatuses.size > 0 && process.env.NODE_ENV !== "production") {
          console.info("Unknown caregiver schedule statuses:", Array.from(unknownStatuses).sort());
        }

        setShifts(nextShifts);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load schedule");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [caregiverID, open, weekStartYmd]);

  const dayRows = useMemo(() => {
    const byDow: Record<number, ShiftRow[]> = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
    for (const shift of shifts) {
      const d = parseDateYmd(shift.date);
      if (!d) continue;
      byDow[d.getDay()].push(shift);
    }
    return byDow;
  }, [shifts]);

  const summary = useMemo(() => {
    const totalHours = shifts.reduce((sum, shift) => sum + parseShiftDurationHours(shift.startTime, shift.endTime), 0);
    const desiredSet = desiredTarget != null;
    const meetsTarget = desiredSet && totalHours >= desiredTarget;
    return {
      totalHours,
      desiredSet,
      desiredLabel: desiredMeta.raw || "—",
      desiredTarget,
      meetsTarget,
      totalLabel: `${formatHours(totalHours)} hrs`,
    };
  }, [desiredMeta.raw, desiredTarget, shifts]);
  const stackedSummary = width < 380;

  const hasContent = useMemo(() => {
    const hasAvailability = DOW_LABELS.some((_, dow) => String(getAvailabilityForDow(availabilityData || {}, dow) || "").trim());
    const hasShifts = shifts.length > 0;
    return hasAvailability || hasShifts || notes.length > 0;
  }, [availabilityData, notes.length, shifts]);

  useEffect(() => {
    if (!collapsed) return;
    const el = railRef.current;
    if (el) {
      el.title = "Expand schedule";
    }
  }, [collapsed]);

  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (collapsed) {
      onCollapsedChange(false);
    }
    if (event.button !== 0) return;
    event.preventDefault();

    dragStateRef.current = {
      startX: event.clientX,
      startWidth: width,
    };

    const handleMove = (moveEvent: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState) return;
      const delta = dragState.startX - moveEvent.clientX;
      const nextWidth = Math.max(minWidth, Math.min(maxWidth, dragState.startWidth + delta));
      onWidthChange(nextWidth);
    };

    const handleUp = () => {
      dragStateRef.current = null;
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
  }

  if (!open) return null;

  const panelWidth = collapsed ? collapsedWidth : Math.max(minWidth, Math.min(maxWidth, width));

  return (
    <aside
      style={{
        ...panelStyle,
        width: panelWidth,
        minWidth: collapsed ? collapsedWidth : minWidth,
      }}
    >
      <div
        ref={railRef}
        onPointerDown={startResize}
        style={{
          ...railStyle,
          width: collapsedWidth,
        }}
      >
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onCollapsedChange(!collapsed);
          }}
          style={railToggleButtonStyle}
          aria-label={collapsed ? "Expand schedule" : "Collapse schedule"}
          title={collapsed ? "Expand schedule" : "Collapse schedule"}
        >
          <CalendarIcon />
          <ChevronIcon collapsed={collapsed} />
        </button>
      </div>

      {!collapsed ? (
        <div style={contentStyle}>
          <div style={headerStyle}>
            <div style={headerTitleStackStyle}>
              <div style={titleStyle}>Caregiver schedule</div>
              <div style={rangeStyle}>{formatRange(weekStartYmd)}</div>
            </div>

            <div style={headerControlsStyle}>
              <div style={toggleRowStyle}>
                {(["cw", "nw"] as const).map((item) => {
                  const active = week === item;
                  return (
                    <button
                      key={item}
                      type="button"
                      onClick={() => onWeekChange(item)}
                      style={{
                        ...toggleButtonStyle,
                        background: active ? UI.accentSoft : "#ffffff",
                        borderColor: active ? UI.accent : UI.borderSoft,
                        color: active ? UI.accentText : UI.textDim,
                      }}
                    >
                      {item === "cw" ? "This Week" : "Next Week"}
                    </button>
                  );
                })}
              </div>

              <button type="button" onClick={onClose} style={closeButtonStyle} title="Close schedule" aria-label="Close schedule">
                ×
              </button>
            </div>
          </div>

          <div style={bodyStyle}>
            {loading ? (
              <div style={emptyStyle}>Loading…</div>
            ) : error ? (
              <div style={{ ...emptyStyle, color: "#b91c1c" }}>{error}</div>
            ) : !hasContent ? (
              <div style={emptyStyle}>No availability or shifts</div>
            ) : (
              <div style={contentStackStyle}>
                <div style={legendRowStyle}>
                  {(["filled", "considering", "offered", "pending", "neutral"] as const).map((key) => {
                    const tone = TONE_BY_STATUS[key];
                    return (
                      <div key={key} style={legendItemStyle}>
                        <span style={{ ...legendDotStyle, background: tone.bg, borderColor: tone.border }} />
                        <span style={legendTextStyle}>{formatLegendLabel(key)}</span>
                      </div>
                    );
                  })}
                </div>

                <div style={stackedSummary ? summaryStackStyle : summaryRowStyle}>
                  <SummaryChip
                    label="DESIRED"
                    value={summary.desiredLabel || "—"}
                    tone="gray"
                    stacked={stackedSummary}
                  />

                  <SummaryChip
                    label="SCHEDULED"
                    value={`${formatHours(summary.totalHours)} / ${summary.desiredTarget != null ? formatHours(summary.desiredTarget) : "—"} hrs`}
                    tone={summary.desiredSet ? (summary.meetsTarget ? "green" : "blue") : "gray"}
                    stacked={stackedSummary}
                    valueAccent={summary.desiredSet && summary.meetsTarget ? "#218838" : undefined}
                  />

                  <SummaryChip
                    label="TOTAL"
                    value={summary.totalLabel}
                    tone="gray"
                    stacked={stackedSummary}
                  />
                </div>

                <div style={gridStyle}>
                  {DOW_FULL.map((label, dow) => {
                    const availability = String(getAvailabilityForDow(availabilityData || {}, dow) || "").trim();
                    const shiftsForDay = dayRows[dow] || [];
                    return (
                      <div key={label} style={dayRowStyle}>
                        <div style={dayLabelStyle}>{label}</div>
                        <div style={dayBodyStyle}>
                          <div style={availabilityRowStyle}>
                            <span style={availabilityLabel}>Availability</span>
                            <span style={availabilityValue}>{availability || "—"}</span>
                          </div>
                          <div style={shiftsBlockStyle}>
                            <span style={availabilityLabel}>Shifts</span>
                            {shiftsForDay.length === 0 ? (
                              <span style={availabilityValue}>—</span>
                            ) : (
                              shiftsForDay.map((shift, index) => {
                                const tone = toneForStatus(shift.status);
                                return (
                                  <div
                                    key={`${shift.date}-${shift.startTime}-${shift.client}-${index}`}
                                    style={{
                                      ...shiftLineStyle,
                                      background: tone.bg,
                                      color: tone.text,
                                      borderColor: tone.border,
                                    }}
                                  >
                                    {buildShiftLabel(shift)}
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {notes ? (
                  <div style={notesSectionStyle}>
                    <div style={notesLabelStyle}>NOTES</div>
                    <div style={notesBodyStyle}>{notes}</div>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </aside>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false" style={calendarIconStyle}>
      <rect x="3" y="4.2" width="14" height="12.2" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 2.8v3M14 2.8v3M3 7.2h14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M7 10.2h2.4M7 13h5.8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ChevronIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      focusable="false"
      style={{
        ...chevronIconStyle,
        transform: collapsed ? "rotate(180deg)" : "rotate(0deg)",
      }}
    >
      <path d="M5 7.5 10 12.5 15 7.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const panelStyle: CSSProperties = {
  height: "100%",
  minHeight: 0,
  display: "flex",
  flexDirection: "row",
  alignItems: "stretch",
  flex: "0 0 auto",
  background: "#ffffff",
  borderLeft: `1px solid ${UI.borderSoft}`,
  boxShadow: "-12px 0 24px rgba(15,23,42,0.08)",
  overflow: "hidden",
};

const railStyle: CSSProperties = {
  height: "100%",
  flex: "0 0 auto",
  background: "#f9fafb",
  borderLeft: `1px solid ${UI.borderSoft}`,
  display: "flex",
  alignItems: "stretch",
  justifyContent: "center",
  cursor: "ew-resize",
  userSelect: "none",
};

const railToggleButtonStyle: CSSProperties = {
  width: "100%",
  border: "none",
  background: "transparent",
  color: UI.textDim,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  cursor: "pointer",
  padding: "8px 0",
};

const contentStyle: CSSProperties = {
  height: "100%",
  minHeight: 0,
  flex: "1 1 auto",
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  background: "rgba(255,255,255,0.98)",
};

const headerStyle: CSSProperties = {
  minHeight: 52,
  padding: "10px 12px",
  borderBottom: `1px solid ${UI.borderSoft}`,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
};

const headerTitleStackStyle: CSSProperties = {
  minWidth: 0,
  display: "grid",
  gap: 2,
};

const titleStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 800,
  color: UI.text,
};

const rangeStyle: CSSProperties = {
  fontSize: 11,
  color: UI.textDim,
};

const headerControlsStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
  justifyContent: "flex-end",
};

const toggleRowStyle: CSSProperties = {
  display: "flex",
  gap: 6,
};

const toggleButtonStyle: CSSProperties = {
  minHeight: 28,
  padding: "0 10px",
  borderRadius: 999,
  border: `1px solid ${UI.borderSoft}`,
  background: "#ffffff",
  fontSize: 12,
  fontWeight: 800,
  cursor: "pointer",
};

const closeButtonStyle: CSSProperties = {
  width: 24,
  height: 24,
  borderRadius: 8,
  border: `1px solid ${UI.borderSoft}`,
  background: "#ffffff",
  color: UI.textDim,
  cursor: "pointer",
  fontSize: 18,
  lineHeight: 1,
  padding: 0,
};

const bodyStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  padding: 12,
};

const contentStackStyle: CSSProperties = {
  display: "grid",
  gap: 12,
};

const legendRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 10,
  alignItems: "center",
};

const legendItemStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
};

const legendDotStyle: CSSProperties = {
  width: 9,
  height: 9,
  borderRadius: 999,
  border: "1px solid transparent",
  boxSizing: "border-box",
};

const legendTextStyle: CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  color: UI.textDim,
  textTransform: "uppercase",
  letterSpacing: 0.4,
};

const summaryRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: 8,
};

const summaryStackStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr",
  gap: 8,
};

const summaryChipStyle: CSSProperties = {
  minHeight: 44,
  borderRadius: 14,
  border: `1px solid ${UI.borderSoft}`,
  padding: "8px 10px",
  display: "grid",
  gap: 3,
  alignContent: "start",
};

const grayChipStyle: CSSProperties = {
  background: "#f9fafb",
  borderColor: UI.borderSoft,
};

const greenChipStyle: CSSProperties = {
  background: "rgba(33, 136, 56, 0.08)",
  borderColor: "rgba(33, 136, 56, 0.28)",
};

const blueChipStyle: CSSProperties = {
  background: "rgba(21, 101, 192, 0.08)",
  borderColor: "rgba(21, 101, 192, 0.28)",
};

const summaryLabelStyle: CSSProperties = {
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: 0.35,
  textTransform: "uppercase",
  color: UI.textDim,
};

const summaryValueStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: UI.text,
  lineHeight: 1.2,
};

const summaryMidpointStyle: CSSProperties = {
  color: UI.text,
};

const summaryValueColor: CSSProperties["color"] = UI.text;

type SummaryChipProps = {
  label: string;
  value: string;
  tone: "gray" | "blue" | "green";
  stacked: boolean;
  valueAccent?: string;
};

function SummaryChip({ label, value, tone, stacked, valueAccent }: SummaryChipProps) {
  const chipBase =
    tone === "green" ? greenChipStyle : tone === "blue" ? blueChipStyle : grayChipStyle;

  if (stacked) {
    return (
      <div
        style={{
          ...summaryChipStyle,
          ...chipBase,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <span style={summaryLabelStackedStyle}>{label}</span>
        <span
          style={{
            ...summaryValueStackedStyle,
            color: valueAccent || UI.text,
          }}
        >
          {value}
        </span>
      </div>
    );
  }

  return (
    <div style={{ ...summaryChipStyle, ...chipBase }}>
      <span style={summaryLabelStyle}>{label}</span>
      <span style={{ ...summaryValueStyle, color: valueAccent || UI.text }}>{value}</span>
    </div>
  );
}

const summaryLabelStackedStyle: CSSProperties = {
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: 0.35,
  textTransform: "uppercase",
  color: UI.textDim,
  flex: "0 0 auto",
  whiteSpace: "nowrap",
};

const summaryValueStackedStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: UI.text,
  lineHeight: 1.2,
  minWidth: 0,
  textAlign: "right",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const gridStyle: CSSProperties = {
  display: "grid",
  gap: 10,
};

const dayRowStyle: CSSProperties = {
  border: `1px solid ${UI.borderSoft}`,
  borderRadius: 14,
  padding: 10,
  background: "#ffffff",
};

const dayLabelStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 800,
  color: UI.text,
  marginBottom: 6,
};

const dayBodyStyle: CSSProperties = {
  display: "grid",
  gap: 8,
};

const availabilityRowStyle: CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "baseline",
  flexWrap: "wrap",
};

const shiftsBlockStyle: CSSProperties = {
  display: "grid",
  gap: 6,
};

const availabilityLabel: CSSProperties = {
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: 0.4,
  textTransform: "uppercase",
  color: UI.textDim,
  flex: "0 0 auto",
};

const availabilityValue: CSSProperties = {
  fontSize: 12,
  color: UI.text,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

const shiftLineStyle: CSSProperties = {
  fontSize: 12,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  borderRadius: 12,
  border: "1px solid transparent",
  padding: "6px 8px",
  lineHeight: 1.35,
};

const notesSectionStyle: CSSProperties = {
  borderTop: `1px solid ${UI.borderSoft}`,
  paddingTop: 10,
  display: "grid",
  gap: 6,
};

const notesLabelStyle: CSSProperties = {
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: 1,
  textTransform: "uppercase",
  color: UI.textDim,
};

const notesBodyStyle: CSSProperties = {
  fontSize: 13,
  color: UI.text,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  lineHeight: 1.45,
};

const emptyStyle: CSSProperties = {
  minHeight: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: UI.textDim,
  fontSize: 13,
  textAlign: "center",
};

const calendarIconStyle: CSSProperties = {
  width: 14,
  height: 14,
};

const chevronIconStyle: CSSProperties = {
  width: 14,
  height: 14,
};

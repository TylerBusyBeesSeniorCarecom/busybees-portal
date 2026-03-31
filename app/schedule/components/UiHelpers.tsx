"use client";

import React from "react";

/**
 * uihelpers.tsx
 * Central UI helpers used across CWWebSchedule, History, Billing/Payroll, etc.
 *
 * ✅ Keeps existing exports:
 *   - VerdictChip
 *   - UnderTimeVerdictLine
 *   - ClockLine
 *   - AvailabilityCell
 *
 * ➕ Adds common helpers you’ll use in CWWebSchedule updates:
 *   - status parsing (from cell text markers)
 *   - consistent status colors
 *   - VerifiedMark (✓ only — no “Verified” text)
 *   - small generic chips + formatting helpers
 */

/* ----------------------------- normalization ----------------------------- */

export function norm(v: any) {
  return (v ?? "").toString().trim();
}

export function lower(v: any) {
  return norm(v).toLowerCase();
}

/* ------------------------------ verdict logic ---------------------------- */

function normVerdict(v: any) {
  return lower(v);
}

export function verdictLabel(v: string) {
  const x = normVerdict(v);
  if (!x) return "";
  if (x === "on_site" || x === "onsite" || x === "on site") return "On site";
  if (x === "off_site" || x === "offsite" || x === "off site") return "Off site";
  if (x === "no_geofence") return "No geofence";
  if (x === "location_unavailable") return "Location unavailable";
  if (x === "unknown") return "Unknown";
  return v;
}

export function isBadVerdict(v: string | null) {
  const x = normVerdict(v);
  if (!x) return false;
  return x === "off_site" || x === "offsite" || x === "no_geofence" || x === "location_unavailable";
}

export function isUnderTimeVerdict(v: string | null) {
  const x = normVerdict(v);
  return x === "location_unavailable" || x === "unknown";
}

export function isOffSite(v: string | null) {
  const x = normVerdict(v);
  return x === "off_site" || x === "offsite" || x === "off site";
}

/* ------------------------------ status logic ----------------------------- */

export type ShiftStatus =
  | "open"
  | "considering"
  | "offered"
  | "filled"
  | "canceled"
  | "pending_client_approval"
  | "unknown";

export const UI = {
  text: "#111827",
  textDim: "#6b7280",
  border: "#e5e7eb",

  // Status colors (keep these consistent everywhere)
  status: {
    open: { bg: "rgba(239,68,68,0.16)", border: "rgba(239,68,68,0.38)", text: "#7f1d1d" }, // red-ish
    considering: { bg: "rgba(245,158,11,0.16)", border: "rgba(245,158,11,0.42)", text: "#7c2d12" }, // orange-ish
    offered: { bg: "rgba(59,130,246,0.16)", border: "rgba(59,130,246,0.42)", text: "#1e3a8a" }, // blue-ish
    filled: { bg: "rgba(34,197,94,0.16)", border: "rgba(34,197,94,0.42)", text: "#14532d" }, // green-ish
    canceled: { bg: "rgba(17,24,39,0.10)", border: "rgba(17,24,39,0.26)", text: "#111827" }, // gray/black
    pending_client_approval: { bg: "rgba(168,85,247,0.16)", border: "rgba(168,85,247,0.42)", text: "#4c1d95" }, // purple
    unknown: { bg: "rgba(255,255,255,0.10)", border: "rgba(255,255,255,0.18)", text: "#111827" },
  },

  // Brighter “future filled” green (requested)
  futureFilled: { bg: "rgba(34,197,94,0.26)", border: "rgba(34,197,94,0.58)", text: "#064e3b" },
};

export function getStatusColors(status: ShiftStatus, opts?: { isFutureFilled?: boolean }) {
  if (status === "filled" && opts?.isFutureFilled) return UI.futureFilled;
  return UI.status[status] ?? UI.status.unknown;
}

/**
 * Parse status from the shift text conventions you defined:
 * - Open: time-only (no name, no wrappers)
 * - Considering: (Name, time)
 * - Offered: "Name, time" OR caret '^' variant if you use it
 * - Filled: Name, time
 * - Canceled: contains '*'
 * - Pending client approval: contains '$'
 */
export function inferShiftStatusFromText(raw: string): ShiftStatus {
  const v = norm(raw);
  const x = v.toLowerCase();

  if (!v) return "unknown";
  if (x.includes("*")) return "canceled";
  if (x.includes("$")) return "pending_client_approval";

  // considering: parentheses
  if (v.includes("(") && v.includes(")")) return "considering";

  // offered: quotes or caret marker
  if (v.includes('"') || v.includes("“") || v.includes("”") || v.includes("^")) return "offered";

  // filled: "Name, 7:00AM-10:00AM" (contains comma before time)
  // open: "7:00AM-10:00AM" (no comma name prefix)
  if (v.includes(",")) return "filled";

  // if it looks like a time range, treat as open; otherwise unknown
  // (simple heuristic; CWWebSchedule can use its stronger regex)
  const looksLikeTime = /\d{1,2}(:\d{2})?\s?(am|pm)?\s*-\s*\d{1,2}(:\d{2})?\s?(am|pm)?/i.test(v);
  return looksLikeTime ? "open" : "unknown";
}

/* ------------------------------ small UI bits ---------------------------- */

export function Pill({
  children,
  title,
  bg,
  border,
  color,
  style,
}: {
  children: React.ReactNode;
  title?: string;
  bg?: string;
  border?: string;
  color?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 10.5,
        fontWeight: 900,
        lineHeight: 1.1,
        background: bg ?? "rgba(255,255,255,0.16)",
        border: border ?? "1px solid rgba(255,255,255,0.22)",
        color: color ?? "#fff",
        whiteSpace: "nowrap",
        maxWidth: "100%",
        overflow: "hidden",
        textOverflow: "ellipsis",
        ...style,
      }}
    >
      {children}
    </span>
  );
}

/** ✅ “Verified” requested to be checkmark-only. */
export function VerifiedMark({
  ok,
  title = "Verified",
}: {
  ok: boolean;
  title?: string;
}) {
  if (!ok) return null;
  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        marginLeft: 6,
        width: 16,
        height: 16,
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 1000,
        lineHeight: 1,
        background: "rgba(34,197,94,0.35)",
        border: "1px solid rgba(34,197,94,0.55)",
        color: "#fff",
        flex: "0 0 auto",
      }}
      aria-label="Verified"
    >
      ✓
    </span>
  );
}

/* ----------------------------- verdict components ------------------------ */

export function VerdictChip({ verdict }: { verdict: string | null }) {
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

export function UnderTimeVerdictLine({ verdict }: { verdict: string | null }) {
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

export function ClockLine({
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

/* --------------------------- availability rendering ---------------------- */

export function AvailabilityCell({ value }: { value: string }) {
  const v = norm(value);
  if (!v || v === "—") return <span style={{ color: "#9ca3af" }}>—</span>;

  const x = v.toLowerCase();
  const isOff = x === "off" || x.includes("not available") || x.includes("unavailable");
  const isOpen = x === "open" || x.includes("anytime") || x.includes("available all day");

  const chipStyle: React.CSSProperties = {
    display: "inline-block",
    padding: "3px 7px",
    borderRadius: 999,
    fontSize: 10.5,
    fontWeight: 900,
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
    <span style={{ fontWeight: 800, fontSize: 11, color: UI.text, whiteSpace: "pre-wrap" }}>
      {v}
    </span>
  );
}

/* ------------------------------ misc helpers ----------------------------- */

export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function safeJsonParse<T = any>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export default {} as any;

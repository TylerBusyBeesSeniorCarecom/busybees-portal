"use client";

import type { CSSProperties } from "react";

import { useSheetsToolsShared } from "@/app/sheets-tools/SheetsToolsSharedProvider";
import { useCaregiverContext } from "@/lib/messages/useCaregiverContext";

type CaregiverContextChipsProps = {
  caregiverID: string;
  variant?: "row" | "header";
  visible?: boolean;
};

function formatHours(hours: number | null) {
  if (hours == null) return "—";
  const rounded = Math.round(hours * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}h` : `${rounded.toFixed(1)}h`;
}

function availabilityDotStyle(args: { submitted: boolean; loaded: boolean }) {
  return {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: !args.loaded ? "#d1d5db" : args.submitted ? "#218838" : "#cc1919",
    flex: "0 0 auto",
  } satisfies CSSProperties;
}

function chipStyle(args: { variant: "row" | "header"; tone: "neutral" | "danger" | "success" }) {
  const isHeader = args.variant === "header";
  const base: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    borderRadius: 999,
    border: "1px solid transparent",
    whiteSpace: "nowrap",
    fontWeight: 700,
    lineHeight: 1,
    flex: "0 0 auto",
  };

  if (args.tone === "success") {
    return {
      ...base,
      fontSize: isHeader ? 12 : 10,
      minHeight: isHeader ? 20 : 14,
      padding: isHeader ? "0 8px" : "0 6px",
      background: "#dcfce7",
      color: "#14532d",
      borderColor: "#86efac",
    } satisfies CSSProperties;
  }

  if (args.tone === "danger") {
    return {
      ...base,
      fontSize: isHeader ? 12 : 10,
      minHeight: isHeader ? 20 : 14,
      padding: isHeader ? "0 8px" : "0 6px",
      background: "#ffffff",
      color: "#b91c1c",
      borderColor: "#fca5a5",
    } satisfies CSSProperties;
  }

  return {
    ...base,
    fontSize: isHeader ? 12 : 10,
    minHeight: isHeader ? 20 : 14,
    padding: isHeader ? "0 8px" : "0 6px",
    background: "#f3f4f6",
    color: "#374151",
    borderColor: "#e5e7eb",
  } satisfies CSSProperties;
}

export default function CaregiverContextChips({
  caregiverID,
  variant = "row",
  visible = true,
}: CaregiverContextChipsProps) {
  const { cwHours, nwHours, loading } = useCaregiverContext(caregiverID);
  const {
    cwAvailabilitySubmitters,
    nwAvailabilitySubmitters,
    availabilityLoaded,
  } = useSheetsToolsShared();

  const cwSubmitted = cwAvailabilitySubmitters.has(caregiverID);
  const nwSubmitted = nwAvailabilitySubmitters.has(caregiverID);

  if (!visible || !caregiverID || caregiverID === "System-Group-1") {
    return null;
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        flexWrap: "wrap",
        opacity: loading ? 0.88 : 1,
      }}
    >
      <span style={chipStyle({ variant, tone: cwHours == null || cwHours === 0 ? "danger" : "neutral" })}>
        CW {formatHours(cwHours)}
      </span>
      <span style={chipStyle({ variant, tone: nwHours == null || nwHours === 0 ? "danger" : "neutral" })}>
        NW {formatHours(nwHours)}
      </span>
      <span style={availabilityChipStyle({ variant })}>
        <span style={availabilityLabelStyle}>TW</span>
        <span style={availabilityDotStyle({ submitted: cwSubmitted, loaded: availabilityLoaded })} />
        <span style={availabilityLabelStyle}>NW</span>
        <span style={availabilityDotStyle({ submitted: nwSubmitted, loaded: availabilityLoaded })} />
      </span>
    </div>
  );
}

function availabilityChipStyle(args: { variant: "row" | "header" }) {
  const isHeader = args.variant === "header";
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    border: "1px solid #e5e7eb",
    whiteSpace: "nowrap",
    fontWeight: 700,
    lineHeight: 1,
    flex: "0 0 auto",
    fontSize: isHeader ? 12 : 10,
    minHeight: isHeader ? 20 : 14,
    padding: isHeader ? "0 8px" : "0 6px",
    background: "#f3f4f6",
    color: "#6b7280",
  } satisfies CSSProperties;
}

const availabilityLabelStyle: CSSProperties = {
  letterSpacing: 0.7,
};

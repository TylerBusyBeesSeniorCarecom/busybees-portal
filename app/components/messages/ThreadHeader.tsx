"use client";

import type { CSSProperties } from "react";

import { UI } from "@/app/sheets-tools/shared";

import CaregiverContextChips from "./CaregiverContextChips";

type ThreadHeaderProps = {
  recipientName: string;
  caregiverID?: string;
  showScheduleButton?: boolean;
  onShowSchedule?: () => void;
  showBackButton?: boolean;
  onBack?: () => void;
  onClose: () => void;
};

export default function ThreadHeader({
  recipientName,
  caregiverID,
  showScheduleButton = false,
  onShowSchedule,
  showBackButton = false,
  onBack,
  onClose,
}: ThreadHeaderProps) {
  return (
    <div
      style={{
        minHeight: 48,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "10px 14px",
        borderBottom: `1px solid ${UI.borderSoft}`,
        background: UI.panelBg,
      }}
    >
      <div
        style={{
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          gap: 8,
          flex: "1 1 auto",
          flexWrap: "wrap",
        }}
      >
        {showBackButton ? (
          <button type="button" onClick={onBack} style={backButtonStyle}>
            ◀ Back
          </button>
        ) : null}

        <div
          style={{
            minWidth: 0,
            fontSize: 15,
            fontWeight: 700,
            color: "#1a1a1a",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {recipientName}
        </div>

        {showScheduleButton ? (
          <button
            type="button"
            onClick={onShowSchedule}
            title="Show schedule"
            aria-label="Show schedule"
            style={headerIconButtonStyle}
          >
            <CalendarIcon />
          </button>
        ) : null}

        {caregiverID ? <CaregiverContextChips caregiverID={caregiverID} variant="header" /> : null}
      </div>

      <button
        type="button"
        onClick={onClose}
        aria-label="Close thread"
        title="Close thread"
        style={closeButtonStyle}
      >
        ×
      </button>
    </div>
  );
}

const closeButtonStyle: CSSProperties = {
  width: 24,
  height: 24,
  borderRadius: 8,
  border: `1px solid ${UI.borderSoft}`,
  background: "#ffffff",
  color: UI.textDim,
  cursor: "pointer",
  lineHeight: 1,
  fontSize: 18,
  fontWeight: 400,
  padding: 0,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

const headerIconButtonStyle: CSSProperties = {
  width: 24,
  height: 24,
  borderRadius: 8,
  border: `1px solid ${UI.borderSoft}`,
  background: "#ffffff",
  color: UI.textDim,
  cursor: "pointer",
  padding: 0,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flex: "0 0 auto",
};

function CalendarIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false" style={calendarIconStyle}>
      <rect x="3" y="4.2" width="14" height="12.2" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 2.8v3M14 2.8v3M3 7.2h14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M7 10.2h2.4M7 13h5.8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

const calendarIconStyle: CSSProperties = {
  width: 14,
  height: 14,
};

const backButtonStyle: CSSProperties = {
  border: `1px solid ${UI.borderSoft}`,
  background: "#ffffff",
  color: UI.textDim,
  cursor: "pointer",
  borderRadius: 8,
  padding: "4px 8px",
  fontSize: 11,
  fontWeight: 700,
  lineHeight: 1,
};

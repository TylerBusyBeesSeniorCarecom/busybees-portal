"use client";

import { useState, type CSSProperties } from "react";

import { UI } from "@/app/sheets-tools/shared";
import type { HiveConversation } from "@/lib/messages/types";

import CaregiverContextChips from "./CaregiverContextChips";

const BEE_YELLOW = "#f8ba00";
const BEE_YELLOW_TINT = "#fef7dc";
const UNREAD_RED = "#dc2626";

type ConversationRowProps = {
  conversation: HiveConversation;
  selected: boolean;
  onSelect: (conversationID: string) => void;
  showContextChips?: boolean;
};

function formatConversationTimestamp(timestamp: Date | null): string {
  if (!timestamp) return "";

  const now = new Date();
  const diffMs = now.getTime() - timestamp.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);

  if (diffMinutes < 1) return "now";
  if (diffMinutes < 60) return `${diffMinutes}m`;

  const sameDay =
    now.getFullYear() === timestamp.getFullYear() &&
    now.getMonth() === timestamp.getMonth() &&
    now.getDate() === timestamp.getDate();

  if (sameDay) {
    return timestamp.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    yesterday.getFullYear() === timestamp.getFullYear() &&
    yesterday.getMonth() === timestamp.getMonth() &&
    yesterday.getDate() === timestamp.getDate();

  if (isYesterday) return "Yesterday";
  if (diffMs < 7 * 24 * 60 * 60 * 1000) {
    return timestamp.toLocaleDateString(undefined, { weekday: "short" });
  }

  return timestamp.toLocaleDateString(undefined, {
    month: "numeric",
    day: "numeric",
  });
}

export default function ConversationRow({
  conversation,
  selected,
  onSelect,
  showContextChips = true,
}: ConversationRowProps) {
  const [hovered, setHovered] = useState(false);
  const timestampLabel = formatConversationTimestamp(conversation.lastTimestamp);
  const snippet = conversation.lastMessage.trim() || "(no message)";

  return (
    <button
      type="button"
      onClick={() => onSelect(conversation.id)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        ...rowStyle,
        background: selected ? BEE_YELLOW_TINT : hovered ? UI.headerBg : UI.panelBg,
        borderLeft: `3px solid ${selected ? BEE_YELLOW : "transparent"}`,
      }}
    >
      <div style={middleColumnStyle}>
        <div style={nameStyle}>{conversation.displayName}</div>
        <div style={snippetStyle}>{snippet}</div>
        <CaregiverContextChips
          caregiverID={conversation.id}
          visible={showContextChips && conversation.section !== "clients"}
          variant="row"
        />
      </div>

      <div style={rightColumnStyle}>
        <div style={timestampStyle}>{timestampLabel}</div>
        {conversation.unreadCount > 0 ? (
          <div style={unreadBadgeStyle}>{conversation.unreadCount}</div>
        ) : (
          <div style={{ minHeight: 18 }} />
        )}
      </div>
    </button>
  );
}

const rowStyle: CSSProperties = {
  width: "100%",
  minHeight: 72,
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "12px 14px 12px 11px",
  border: "none",
  borderBottom: `1px solid ${UI.borderSoft}`,
  cursor: "pointer",
  textAlign: "left",
  transition: "background-color 120ms ease",
};

const middleColumnStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  gap: 2,
};

const nameStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: "#1a1a1a",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const snippetStyle: CSSProperties = {
  fontSize: 12,
  color: UI.textDim,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const rightColumnStyle: CSSProperties = {
  flex: "0 0 auto",
  minWidth: 54,
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-end",
  justifyContent: "space-between",
  gap: 6,
};

const timestampStyle: CSSProperties = {
  fontSize: 10,
  color: UI.textDim,
  whiteSpace: "nowrap",
};

const unreadBadgeStyle: CSSProperties = {
  minWidth: 18,
  height: 18,
  borderRadius: 999,
  padding: "0 6px",
  background: UNREAD_RED,
  color: "#ffffff",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 11,
  fontWeight: 700,
  lineHeight: 1,
};

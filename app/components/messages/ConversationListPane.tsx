"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";

import { UI } from "@/app/sheets-tools/shared";
import type { HiveConversation } from "@/lib/messages/types";

import ConversationRow from "./ConversationRow";

const SECTION_LABELS: Record<HiveConversation["section"], string> = {
  top: "Top",
  staff: "Staff",
  caregivers: "Caregivers",
  clients: "Clients",
};

const SECTION_ORDER: HiveConversation["section"][] = ["top", "staff", "caregivers", "clients"];

type ConversationListPaneProps = {
  conversations: HiveConversation[];
  loading: boolean;
  error: string | null;
  selectedConvID: string | null;
  onSelect: (conversationID: string) => void;
  width?: number;
  fillPanel?: boolean;
  showContextChips?: boolean;
};

export default function ConversationListPane({
  conversations,
  loading,
  error,
  selectedConvID,
  onSelect,
  width = 320,
  fillPanel = false,
  showContextChips = true,
}: ConversationListPaneProps) {
  const [query, setQuery] = useState("");
  const [syncVisible, setSyncVisible] = useState(false);

  useEffect(() => {
    if (loading) return;
    setSyncVisible(true);
    const timeout = window.setTimeout(() => setSyncVisible(false), 900);
    return () => window.clearTimeout(timeout);
  }, [conversations, loading]);

  const filteredConversations = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return conversations;
    return conversations.filter((conversation) =>
      conversation.displayName.toLowerCase().includes(normalizedQuery)
    );
  }, [conversations, query]);

  const groupedConversations = useMemo(() => {
    return SECTION_ORDER.map((section) => ({
      section,
      label: SECTION_LABELS[section],
      items: filteredConversations.filter((conversation) => conversation.section === section),
    })).filter((group) => group.items.length > 0);
  }, [filteredConversations]);

  return (
    <aside
      style={{
        width: fillPanel ? "100%" : width,
        flex: fillPanel ? "1 1 auto" : `0 0 ${width}px`,
        borderRight: fillPanel ? "none" : `1px solid ${UI.borderSoft}`,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        background: UI.panelBg,
      }}
    >
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 1,
          padding: 12,
          borderBottom: `1px solid ${UI.borderSoft}`,
          background: UI.panelBg,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search conversations…"
            style={{
              width: "100%",
              border: `1px solid ${UI.borderSoft}`,
              borderRadius: 10,
              padding: "10px 12px",
              fontSize: 14,
              outline: "none",
              color: "#1a1a1a",
              background: "#ffffff",
            }}
          />
          <div
            title={syncVisible ? "Live sync updated" : "Waiting for updates"}
            aria-label={syncVisible ? "Live sync updated" : "Waiting for updates"}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              flex: "0 0 auto",
              color: UI.textDim,
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: syncVisible ? "#22c55e" : "#d1d5db",
              }}
            />
            Sync
          </div>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {loading ? (
          <div style={statusStyle}>Loading…</div>
        ) : error ? (
          <div style={{ ...statusStyle, color: "#b91c1c" }}>Failed to load conversations</div>
        ) : filteredConversations.length === 0 ? (
          <div style={statusStyle}>
            {conversations.length === 0 ? "No conversations yet" : "No matching conversations"}
          </div>
        ) : (
          groupedConversations.map((group) => (
            <section key={group.section}>
              <div
                style={{
                  padding: "8px 12px 4px",
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                  color: "#9ca3af",
                }}
              >
                {group.label}
              </div>
              {group.items.map((conversation) => (
                <ConversationRow
                  key={conversation.id}
                  conversation={conversation}
                  selected={conversation.id === selectedConvID}
                  onSelect={onSelect}
                  showContextChips={showContextChips}
                />
              ))}
            </section>
          ))
        )}
      </div>
    </aside>
  );
}

const statusStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 120,
  padding: 20,
  fontSize: 13,
  color: UI.textDim,
};

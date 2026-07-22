"use client";

import { useEffect, useMemo, useRef } from "react";
import { useState } from "react";
import { useSession } from "next-auth/react";
import type { CSSProperties } from "react";

import { UI } from "@/app/sheets-tools/shared";
import { markThreadRead } from "@/lib/messages/firestoreClient";
import { useThread } from "@/lib/messages/useMessages";

import MessageBubble from "./MessageBubble";
import MessageComposer from "./MessageComposer";
import CaregiverScheduleOverlay from "./CaregiverScheduleOverlay";
import ThreadHeader from "./ThreadHeader";
import { findLatestScheduleOffer } from "./scheduleOffer";

type ThreadPaneProps = {
  conversationID: string;
  recipientName: string;
  showContextChips?: boolean;
  showBackButton?: boolean;
  onBack?: () => void;
  onClose: () => void;
};

const SCHEDULE_WIDTH_KEY = "messages-v2.scheduleWidth";
const SCHEDULE_COLLAPSED_KEY = "messages-v2.scheduleCollapsed";
const SCHEDULE_MIN_WIDTH = 280;
const SCHEDULE_MAX_WIDTH = 500;
const SCHEDULE_DEFAULT_WIDTH = 320;
const SCHEDULE_COLLAPSED_WIDTH = 28;

function readSessionNumber(key: string, fallback: number) {
  if (typeof window === "undefined") return fallback;
  const raw = window.sessionStorage.getItem(key);
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function readSessionBool(key: string, fallback: boolean) {
  if (typeof window === "undefined") return fallback;
  const raw = window.sessionStorage.getItem(key);
  if (raw == null) return fallback;
  return raw === "true";
}

export default function ThreadPane({
  conversationID,
  recipientName,
  showContextChips = true,
  showBackButton = false,
  onBack,
  onClose,
}: ThreadPaneProps) {
  const { data: session } = useSession();
  const myUserID =
    String(session?.user?.caregiverId || "").trim() ||
    String(session?.user?.email || "").trim() ||
    "Admin";
  const { messages, loading, error } = useThread(conversationID);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleCollapsed, setScheduleCollapsed] = useState(() => readSessionBool(SCHEDULE_COLLAPSED_KEY, false));
  const [scheduleWidth, setScheduleWidth] = useState(() =>
    Math.min(SCHEDULE_MAX_WIDTH, Math.max(SCHEDULE_MIN_WIDTH, readSessionNumber(SCHEDULE_WIDTH_KEY, SCHEDULE_DEFAULT_WIDTH)))
  );
  const isCaregiverThread = conversationID.startsWith("CG-");
  const [scheduleWeek, setScheduleWeek] = useState<"cw" | "nw">("cw");

  const scheduleOfferCandidate = useMemo(
    () => findLatestScheduleOffer(messages, myUserID, recipientName),
    [messages, myUserID, recipientName]
  );

  useEffect(() => {
    window.sessionStorage.setItem(SCHEDULE_WIDTH_KEY, String(scheduleWidth));
  }, [scheduleWidth]);

  useEffect(() => {
    window.sessionStorage.setItem(SCHEDULE_COLLAPSED_KEY, String(scheduleCollapsed));
  }, [scheduleCollapsed]);

  useEffect(() => {
    if (!conversationID || !myUserID) return;
    void markThreadRead(conversationID, myUserID).catch(() => {
      // Keep the thread usable even if read marking fails.
    });
  }, [conversationID, myUserID]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || loading) return;

    el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

  useEffect(() => {
    if (!isCaregiverThread) {
      setScheduleOpen(false);
    }
  }, [isCaregiverThread]);

  return (
    <section style={threadShellStyle}>
      <ThreadHeader
        recipientName={recipientName}
        caregiverID={showContextChips ? conversationID : undefined}
        showScheduleButton={isCaregiverThread}
        onShowSchedule={() => setScheduleOpen(true)}
        showBackButton={showBackButton}
        onBack={onBack}
        onClose={onClose}
      />

      <div style={contentRowStyle}>
        <div style={threadColumnStyle}>
          <div ref={scrollRef} style={messagesAreaStyle}>
            {loading ? (
              <div style={statusStyle}>Loading messages…</div>
            ) : error ? (
              <div style={{ ...statusStyle, color: "#b91c1c" }}>Failed to load messages</div>
            ) : messages.length === 0 ? (
              <div style={statusStyle}>No messages yet</div>
            ) : (
              <div style={messageListStyle}>
                {messages.map((message) => (
                  <MessageBubble key={message.id} message={message} myUserID={myUserID} />
                ))}
              </div>
            )}
          </div>
        </div>

        {scheduleOpen && isCaregiverThread ? (
          <CaregiverScheduleOverlay
            open
            caregiverID={conversationID}
            week={scheduleWeek}
            collapsed={scheduleCollapsed}
            width={scheduleWidth}
            minWidth={SCHEDULE_MIN_WIDTH}
            maxWidth={SCHEDULE_MAX_WIDTH}
            collapsedWidth={SCHEDULE_COLLAPSED_WIDTH}
            onClose={() => setScheduleOpen(false)}
            onWeekChange={setScheduleWeek}
            onCollapsedChange={setScheduleCollapsed}
            onWidthChange={setScheduleWidth}
          />
        ) : null}
      </div>

      <MessageComposer
        conversationID={conversationID}
        recipientName={recipientName}
        scheduleOfferCandidate={scheduleOfferCandidate}
      />
    </section>
  );
}

const threadShellStyle: CSSProperties = {
  height: "100%",
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  background: UI.panelBg,
};

const contentRowStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: "flex",
  alignItems: "stretch",
  overflow: "hidden",
};

const threadColumnStyle: CSSProperties = {
  flex: "1 1 auto",
  minWidth: 0,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
};

const messagesAreaStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  padding: 16,
  background: "#ffffff",
};

const messageListStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const statusStyle: CSSProperties = {
  minHeight: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: UI.textDim,
  fontSize: 13,
};

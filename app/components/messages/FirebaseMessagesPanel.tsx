"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { CSSProperties } from "react";

import { UI } from "@/app/sheets-tools/shared";
import { useConversations } from "@/lib/messages/useMessages";
import { useSheetsToolsShared } from "@/app/sheets-tools/SheetsToolsSharedProvider";

import ConversationListPane from "./ConversationListPane";
import EmptyThreadPlaceholder from "./EmptyThreadPlaceholder";
import ThreadPane from "./ThreadPane";

const PANEL_BREAKPOINT = 760;
const LIST_WIDTH_KEY = "messages-v2.listWidth";
const LIST_MIN_WIDTH = 200;
const LIST_MAX_WIDTH = 400;
const LIST_DEFAULT_WIDTH = 260;

function readSessionNumber(key: string, fallback: number) {
  if (typeof window === "undefined") return fallback;
  const raw = window.sessionStorage.getItem(key);
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function clampListWidth(width: number) {
  return Math.max(LIST_MIN_WIDTH, Math.min(LIST_MAX_WIDTH, width));
}

export default function FirebaseMessagesPanel() {
  const [selectedConvID, setSelectedConvID] = useState<string | null>(null);
  const [panelWidth, setPanelWidth] = useState(0);
  const [mobileView, setMobileView] = useState<"list" | "thread">("list");
  const [listWidth, setListWidth] = useState(() =>
    clampListWidth(readSessionNumber(LIST_WIDTH_KEY, LIST_DEFAULT_WIDTH))
  );
  const { conversations, loading, error } = useConversations();
  const { loadWeekBundle, refreshCaregivers } = useSheetsToolsShared();
  const panelRef = useRef<HTMLElement | null>(null);
  const listResizeCleanupRef = useRef<(() => void) | null>(null);

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedConvID) || null,
    [conversations, selectedConvID]
  );
  const selectedConversationDisplayName = selectedConversation?.displayName || selectedConvID || "";
  const selectedConversationHasContext =
    Boolean(selectedConversation) &&
    selectedConversation?.section !== "clients" &&
    selectedConversation?.id !== "System-Group-1";
  const isNarrow = panelWidth > 0 && panelWidth < PANEL_BREAKPOINT;
  const showListContextChips = panelWidth >= 560;

  useEffect(() => {
    window.sessionStorage.setItem(LIST_WIDTH_KEY, String(listWidth));
  }, [listWidth]);

  useEffect(() => {
    return () => {
      listResizeCleanupRef.current?.();
    };
  }, []);

  useEffect(() => {
    const element = panelRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;

    const updateWidth = () => {
      setPanelWidth(element.getBoundingClientRect().width);
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    void Promise.all([refreshCaregivers(), loadWeekBundle("cw"), loadWeekBundle("nw")]).catch(() => {
      // Keep the panel functional even if shared schedule loading is delayed.
    });
  }, [loadWeekBundle, refreshCaregivers]);

  useEffect(() => {
    if (!isNarrow) return;
    if (selectedConvID) {
      setMobileView("thread");
    } else {
      setMobileView("list");
    }
  }, [isNarrow, selectedConvID]);

  function handleSelectConversation(conversationID: string) {
    setSelectedConvID(conversationID);
    if (isNarrow) {
      setMobileView("thread");
    }
  }

  function handleBackToList() {
    setMobileView("list");
  }

  function handleClosePanel() {
    setSelectedConvID(null);
    setMobileView("list");
  }

  function startListResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startWidth = listWidth;

    const onMove = (moveEvent: PointerEvent) => {
      const nextWidth = clampListWidth(startWidth + (moveEvent.clientX - startX));
      setListWidth(nextWidth);
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      listResizeCleanupRef.current = null;
    };

    listResizeCleanupRef.current = onUp;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  return (
    <section
      ref={panelRef}
      style={{
        display: "flex",
        minHeight: 500,
        height: "100%",
        borderRadius: 18,
        overflow: "hidden",
        background: UI.panelBg,
        border: `1px solid ${UI.borderSoft}`,
        boxShadow: "0 10px 30px rgba(15, 23, 42, 0.08)",
      }}
    >
      {isNarrow ? (
        <div
          style={{
            position: "relative",
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            overflow: "hidden",
            background: "#ffffff",
          }}
        >
          <div
            style={{
              ...narrowPaneStyle,
              opacity: mobileView === "list" || !selectedConvID ? 1 : 0,
              transform:
                mobileView === "list" || !selectedConvID ? "translateX(0)" : "translateX(-8px)",
              pointerEvents: mobileView === "list" || !selectedConvID ? "auto" : "none",
            }}
          >
            <ConversationListPane
              conversations={conversations}
              loading={loading}
              error={error}
              selectedConvID={selectedConvID}
              onSelect={handleSelectConversation}
              fillPanel
              showContextChips={showListContextChips}
            />
          </div>

          {selectedConvID ? (
            <div
              style={{
                ...narrowPaneStyle,
                opacity: mobileView === "thread" ? 1 : 0,
                transform: mobileView === "thread" ? "translateX(0)" : "translateX(8px)",
                pointerEvents: mobileView === "thread" ? "auto" : "none",
              }}
            >
              <ThreadPane
                key={selectedConvID}
                conversationID={selectedConvID}
                recipientName={selectedConversationDisplayName}
                showContextChips={selectedConversationHasContext}
                showBackButton
                onBack={handleBackToList}
                onClose={handleClosePanel}
              />
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <ConversationListPane
            conversations={conversations}
            loading={loading}
            error={error}
            selectedConvID={selectedConvID}
            onSelect={handleSelectConversation}
            width={listWidth}
            showContextChips={showListContextChips}
          />
          <div
            onPointerDown={startListResize}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize conversation list"
            style={listDividerStyle}
          >
            <div style={listDividerGripStyle} />
          </div>
          <div style={widePaneStyle}>
            {selectedConvID ? (
              <ThreadPane
                key={selectedConvID}
                conversationID={selectedConvID}
                recipientName={selectedConversationDisplayName}
                showContextChips={selectedConversationHasContext}
                onClose={handleClosePanel}
              />
            ) : (
              <EmptyThreadPlaceholder />
            )}
          </div>
        </>
      )}
    </section>
  );
}

const widePaneStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  background: "#ffffff",
};

const narrowPaneStyle: CSSProperties = {
  position: "absolute" as const,
  inset: 0,
  display: "flex",
  flexDirection: "column" as const,
  transition: "opacity 150ms ease, transform 150ms ease",
  willChange: "opacity, transform",
};

const listDividerStyle: CSSProperties = {
  width: 10,
  flex: "0 0 auto",
  cursor: "col-resize",
  display: "flex",
  alignItems: "stretch",
  justifyContent: "center",
  background: UI.panelBg,
  borderRight: `1px solid ${UI.borderSoft}`,
  borderLeft: `1px solid ${UI.borderSoft}`,
  touchAction: "none",
  userSelect: "none",
};

const listDividerGripStyle: CSSProperties = {
  width: 2,
  borderRadius: 999,
  background: "#d1d5db",
  margin: "0 auto",
};

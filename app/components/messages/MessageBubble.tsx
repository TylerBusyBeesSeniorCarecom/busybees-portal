"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { UI } from "@/app/sheets-tools/shared";
import { updateMessage } from "@/lib/messages/firestoreClient";
import { formatBubbleTimestamp } from "@/lib/messages/messageTime";
import type { HiveMessage } from "@/lib/messages/types";

import ReadReceipts from "./ReadReceipts";

type MessageBubbleProps = {
  message: HiveMessage;
  myUserID: string;
};

function getBubbleTheme(message: HiveMessage): { background: string; color: string } {
  const category = message.category.trim().toLowerCase();
  if (category === "scheduling") return { background: "#e9d5ff", color: "#312e81" };
  if (category === "payroll") return { background: "#e8f5e9", color: "#2e7d32" };
  if (category === "case specific") return { background: "#ffedd5", color: "#9a3412" };
  return { background: "#f3f4f6", color: "#1f2937" };
}

export default function MessageBubble({ message, myUserID }: MessageBubbleProps) {
  const isMine = message.senderID === myUserID;
  const bubbleTheme = isMine ? { background: "#3b82f6", color: "#ffffff" } : getBubbleTheme(message);
  const category = message.category.trim().toLowerCase();
  const outlineColor = isMine
    ? category === "scheduling"
      ? "#a855f7"
      : category === "payroll"
        ? "#22c55e"
        : "transparent"
    : "transparent";

  const [menuOpen, setMenuOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(message.body);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!isEditing) {
      setDraft(message.body);
    }
  }, [isEditing, message.body]);

  useEffect(() => {
    if (!menuOpen) return;

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      const bubble = bubbleRef.current;
      const menu = menuRef.current;
      if (bubble?.contains(target) || menu?.contains(target)) return;
      setMenuOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [menuOpen]);

  useEffect(() => {
    if (!isEditing) return;
    editTextareaRef.current?.focus();
    editTextareaRef.current?.setSelectionRange(draft.length, draft.length);
  }, [isEditing, draft.length]);

  const bubbleStyle = useMemo(
    () => ({
      ...bubbleBaseStyle,
      background: bubbleTheme.background,
      color: bubbleTheme.color,
      borderColor: outlineColor,
      borderWidth: outlineColor === "transparent" ? 0 : 2,
    }),
    [bubbleTheme.background, bubbleTheme.color, outlineColor]
  );

  async function handleSaveEdit() {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === message.body.trim() || saving) {
      setIsEditing(false);
      setMenuOpen(false);
      setError(null);
      setDraft(message.body);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      console.log("[messages] editing message", { messageID: message.id, myUserID, trimmed });
      await updateMessage(message.id, trimmed);
      console.log("[messages] edit saved", { messageID: message.id });
      setIsEditing(false);
      setMenuOpen(false);
    } catch (saveError) {
      console.error("[messages] edit save failed", { messageID: message.id, saveError });
      setError(saveError instanceof Error ? saveError.message : "Failed to save edit");
    } finally {
      setSaving(false);
    }
  }

  function handleCancelEdit() {
    setDraft(message.body);
    setIsEditing(false);
    setMenuOpen(false);
    setError(null);
  }

  function startEditing() {
    if (!isMine) return;
    setMenuOpen(false);
    setError(null);
    setDraft(message.body);
    setIsEditing(true);
  }

  function handleBubbleClick() {
    if (!isMine || isEditing) return;
    setMenuOpen((value) => !value);
  }

  if (message.deletedForAll) {
    return (
      <div style={{ display: "flex", justifyContent: isMine ? "flex-end" : "flex-start" }}>
        <div style={deletedBubbleStyle}>This message was deleted</div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: isMine ? "flex-end" : "flex-start",
        position: "relative",
      }}
    >
      {!isMine ? <div style={senderStyle}>{message.senderName || message.senderID}</div> : null}

      <div style={{ ...bubbleRowStyle, justifyContent: isMine ? "flex-end" : "flex-start" }}>
        <div
          ref={bubbleRef}
          role={isMine ? "button" : undefined}
          tabIndex={isMine ? 0 : -1}
          onClick={handleBubbleClick}
          onKeyDown={(event) => {
            if (!isMine || isEditing) return;
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setMenuOpen((value) => !value);
            }
          }}
          style={{
            ...bubbleStyle,
            cursor: isMine ? "pointer" : "default",
            position: "relative",
          }}
        >
          {menuOpen && isMine && !isEditing ? (
            <div
              ref={menuRef}
              style={bubbleMenuStyle}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  startEditing();
                }}
                style={bubbleMenuItemStyle}
              >
                Edit message
              </button>
            </div>
          ) : null}

          {isEditing ? (
            <div style={editShellStyle} onClick={(event) => event.stopPropagation()}>
              <textarea
                ref={editTextareaRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                disabled={saving}
                rows={3}
                style={editTextareaStyle}
              />
              {error ? <div style={editErrorStyle}>{error}</div> : null}
              <div style={editActionsStyle}>
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  disabled={saving}
                  style={editSecondaryButtonStyle}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleSaveEdit()}
                  disabled={saving || !draft.trim() || draft.trim() === message.body.trim()}
                  style={editPrimaryButtonStyle}
                >
                  Save
                </button>
              </div>
            </div>
          ) : (
            <>
              <div style={bodyStyle}>{message.body}</div>
            </>
          )}
        </div>
      </div>

      {!isEditing ? (
        <div style={{ ...bubbleMetaRowStyle, justifyContent: isMine ? "flex-end" : "flex-start" }}>
          <span style={bubbleTimestampStyle}>{formatBubbleTimestamp(message.timestamp)}</span>
          {message.editedAt ? <span style={editedStyle}>(edited)</span> : null}
        </div>
      ) : null}

      <ReadReceipts message={message} myUserID={myUserID} />
    </div>
  );
}

const senderStyle: CSSProperties = {
  fontSize: 11,
  color: UI.textDim,
  marginBottom: 4,
  paddingLeft: 4,
};

const bubbleRowStyle: CSSProperties = {
  width: "100%",
  display: "flex",
};

const bubbleMetaRowStyle: CSSProperties = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  gap: 6,
  marginTop: 4,
  fontSize: 10,
  color: UI.textDim,
};

const bubbleBaseStyle: CSSProperties = {
  maxWidth: "70%",
  borderRadius: 16,
  padding: "10px 14px",
  borderStyle: "solid",
  borderColor: "transparent",
  borderWidth: 0,
  boxShadow: "none",
};

const bubbleMenuStyle: CSSProperties = {
  position: "absolute",
  top: "calc(100% + 6px)",
  right: 0,
  zIndex: 8,
  minWidth: 136,
  background: "#ffffff",
  border: `1px solid ${UI.borderSoft}`,
  borderRadius: 12,
  boxShadow: "0 12px 24px rgba(15,23,42,0.12)",
  padding: 6,
};

const bubbleMenuItemStyle: CSSProperties = {
  width: "100%",
  border: "none",
  borderRadius: 10,
  padding: "8px 10px",
  background: "#ffffff",
  color: "#1a1a1a",
  textAlign: "left",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
};

const editShellStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const editTextareaStyle: CSSProperties = {
  width: "100%",
  minHeight: 88,
  resize: "vertical",
  border: `1px solid ${UI.borderSoft}`,
  borderRadius: 12,
  padding: "10px 12px",
  fontSize: 14,
  lineHeight: 1.45,
  color: "#1a1a1a",
  background: "#ffffff",
  outline: "none",
};

const editActionsStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
};

const editSecondaryButtonStyle: CSSProperties = {
  height: 30,
  borderRadius: 10,
  border: `1px solid ${UI.borderSoft}`,
  background: "#ffffff",
  color: UI.textDim,
  padding: "0 12px",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 700,
};

const editPrimaryButtonStyle: CSSProperties = {
  height: 30,
  borderRadius: 10,
  border: "none",
  background: "#f8ba00",
  color: "#1a1a1a",
  padding: "0 12px",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 700,
};

const deletedBubbleStyle: CSSProperties = {
  maxWidth: "70%",
  borderRadius: 16,
  padding: "10px 14px",
  background: "#f3f4f6",
  color: UI.textDim,
  fontStyle: "italic",
};

const bodyStyle: CSSProperties = {
  fontSize: 14,
  lineHeight: 1.45,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

const bubbleTimestampStyle: CSSProperties = {
  color: UI.textDim,
};

const editedStyle: CSSProperties = {
  fontStyle: "italic",
  color: UI.textDim,
};

const editErrorStyle: CSSProperties = {
  color: "#b91c1c",
  fontSize: 11,
};

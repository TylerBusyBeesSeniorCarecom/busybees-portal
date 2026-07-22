"use client";

import { useEffect, useRef } from "react";
import { UI } from "../shared";
import { useFloatingWindows } from "../useFloatingWindows";

const TOOLBAR_Z = 10100;

export default function FloatingToolbar() {
  const {
    openPanel,
    panels,
    setToolbarBounds,
    toolbarBounds,
    toolbarMinimized,
    setToolbarMinimized,
  } = useFloatingWindows();
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => cleanupRef.current?.();
  }, []);

  function startDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const startBounds = toolbarBounds;

    const onMove = (moveEvent: PointerEvent) => {
      setToolbarBounds({
        x: startBounds.x + (moveEvent.clientX - startX),
        y: startBounds.y + (moveEvent.clientY - startY),
      });
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      cleanupRef.current = null;
    };

    cleanupRef.current = onUp;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <div
      style={{
        position: "fixed",
        left: toolbarBounds.x,
        top: toolbarBounds.y,
        zIndex: TOOLBAR_Z,
        width: toolbarMinimized ? 44 : 292,
        height: toolbarMinimized ? 36 : 52,
        display: "flex",
        alignItems: "center",
        gap: 8,
        justifyContent: toolbarMinimized ? "center" : "flex-start",
        padding: toolbarMinimized ? 4 : "8px 10px",
        background: "rgba(255,255,255,0.94)",
        border: `1px solid ${UI.borderSoft}`,
        borderRadius: 14,
        boxShadow: "0 18px 50px rgba(15,23,42,0.16)",
        backdropFilter: "blur(8px)",
      }}
    >
      {toolbarMinimized ? (
        <button
          type="button"
          title="Expand toolbar"
          aria-label="Expand toolbar"
          onClick={() => setToolbarMinimized(false)}
          style={{
            width: 32,
            height: 28,
            borderRadius: 999,
            border: `1px solid ${UI.border}`,
            background: UI.panelBg,
            color: UI.text,
            display: "grid",
            placeItems: "center",
            cursor: "pointer",
            padding: 0,
          }}
        >
          <SquaresIcon />
        </button>
      ) : (
        <>
        <div
          onPointerDown={startDrag}
          title="Drag toolbar"
          style={{
            width: 18,
            alignSelf: "stretch",
            display: "grid",
            placeItems: "center",
            cursor: "grab",
            color: UI.textDim,
            userSelect: "none",
            fontSize: 14,
            fontWeight: 900,
          }}
        >
          ⋮⋮
        </div>

        <ToolbarIconButton
          title="Messages"
          icon="💬"
          open={panels.messages.open}
          onClick={() => openPanel("messages")}
          dataAttr="data-sheets-tools-toolbar-message"
        />

        <div
          aria-hidden="true"
          style={{
            width: 1,
            alignSelf: "stretch",
            background: UI.borderSoft,
          }}
        />

        <ToolbarIconButton
          title="Bulk Edit"
          icon="📋"
          open={panels["bulk-edit"].open}
          onClick={() => openPanel("bulk-edit")}
        />
        <ToolbarIconButton
          title="Recommendations"
          icon="💡"
          open={panels.recommendations.open}
          onClick={() => openPanel("recommendations")}
        />

        <button
          type="button"
          title="Minimize toolbar"
          aria-label="Minimize toolbar"
          onClick={() => setToolbarMinimized(true)}
          style={{
            marginLeft: "auto",
            width: 30,
            height: 30,
            borderRadius: 10,
            border: `1px solid ${UI.borderSoft}`,
            background: UI.panelBg,
            color: UI.textDim,
            display: "grid",
            placeItems: "center",
            cursor: "pointer",
            padding: 0,
          }}
        >
          <ChevronDoubleLeftIcon />
        </button>
        </>
      )}
    </div>
  );
}

function ToolbarIconButton({
  title,
  icon,
  open,
  onClick,
  dataAttr,
}: {
  title: string;
  icon: string;
  open: boolean;
  onClick: () => void;
  dataAttr?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      {...(dataAttr ? { [dataAttr]: "true" } : {})}
      style={{
        position: "relative",
        width: 32,
        height: 32,
        borderRadius: 10,
        border: `1px solid ${open ? UI.accent : UI.borderSoft}`,
        background: open ? UI.accentSoft : UI.panelBg,
        color: UI.text,
        fontSize: 16,
        lineHeight: 1,
        cursor: "pointer",
        padding: 0,
      }}
    >
      {icon}
      {open ? (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            right: 4,
            bottom: 4,
            width: 6,
            height: 6,
            borderRadius: 999,
            background: UI.accent,
          }}
        />
      ) : null}
    </button>
  );
}

function ChevronDoubleLeftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M13.5 6 7.5 12l6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 6 14 12l6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SquaresIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="4" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="2" />
      <rect x="14" y="4" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="2" />
      <rect x="4" y="14" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="2" />
      <rect x="14" y="14" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

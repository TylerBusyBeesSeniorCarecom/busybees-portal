"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { UI } from "../shared";
import { type PanelId, useFloatingWindows } from "../useFloatingWindows";

const PANEL_BASE_Z = 500;

export default function FloatingPanel({
  id,
  title,
  children,
  onRefresh,
}: {
  id: PanelId;
  title: string;
  children: ReactNode;
  onRefresh?: () => void;
}) {
  const { panels, closePanel, focusPanel, minimizePanel, openPanel, setPanelBounds } =
    useFloatingWindows();
  const panel = panels[id];
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
      resizeCleanupRef.current?.();
    };
  }, []);

  if (!panel.open) return null;

  function startDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    focusPanel(id);

    const startX = event.clientX;
    const startY = event.clientY;
    const startBounds = { x: panel.x, y: panel.y };

    const onMove = (moveEvent: PointerEvent) => {
      setPanelBounds(id, {
        x: startBounds.x + (moveEvent.clientX - startX),
        y: startBounds.y + (moveEvent.clientY - startY),
      });
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      dragCleanupRef.current = null;
    };

    dragCleanupRef.current = onUp;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function startResize(event: React.PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    focusPanel(id);

    const startX = event.clientX;
    const startY = event.clientY;
    const startBounds = { w: panel.w, h: panel.h };

    const onMove = (moveEvent: PointerEvent) => {
      setPanelBounds(id, {
        w: startBounds.w + (moveEvent.clientX - startX),
        h: startBounds.h + (moveEvent.clientY - startY),
      });
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      resizeCleanupRef.current = null;
    };

    resizeCleanupRef.current = onUp;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  const headerHeight = 40;
  const zIndex = Math.min(PANEL_BASE_Z + panel.z, 10099);

  function snapToPhone() {
    setPanelBounds(id, { w: 380, h: 720 });
    openPanel(id);
  }

  return (
    <section
      onPointerDown={() => focusPanel(id)}
      style={{
        position: "fixed",
        left: panel.x,
        top: panel.y,
        width: panel.w,
        height: panel.minimized ? headerHeight : panel.h,
        zIndex,
        display: "flex",
        flexDirection: "column",
        background: UI.panelBg,
        border: `1px solid ${UI.borderSoft}`,
        borderRadius: 16,
        overflow: "hidden",
        boxShadow: "0 18px 50px rgba(15,23,42,0.16)",
        color: UI.text,
        transition: "box-shadow 100ms ease",
      }}
    >
      <div
        onPointerDown={startDrag}
        style={{
          minHeight: headerHeight,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          padding: "0 10px 0 12px",
          background: UI.headerBg,
          borderBottom: panel.minimized ? "none" : `1px solid ${UI.borderSoft}`,
          cursor: "grab",
          userSelect: "none",
        }}
      >
        <div
          style={{
            fontSize: 13,
            fontWeight: 900,
            color: UI.text,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {title}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {onRefresh ? (
            <button
              type="button"
              title="Refresh"
              onClick={(event) => {
                event.stopPropagation();
                onRefresh();
              }}
              style={panelButtonStyle}
              >
              ↻
            </button>
          ) : null}
          <button
            type="button"
            title="Phone preset"
            onClick={(event) => {
              event.stopPropagation();
              snapToPhone();
            }}
            style={panelButtonStyle}
          >
            <PhoneIcon />
          </button>
          <button
            type="button"
            title={panel.minimized ? "Restore" : "Minimize"}
            onClick={(event) => {
              event.stopPropagation();
              if (panel.minimized) openPanel(id);
              else minimizePanel(id);
            }}
            style={panelButtonStyle}
          >
            —
          </button>
          <button
            type="button"
            title="Close"
            onClick={(event) => {
              event.stopPropagation();
              closePanel(id);
            }}
            style={panelButtonStyle}
          >
            ×
          </button>
        </div>
      </div>

      {!panel.minimized ? (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            background: UI.panelBg,
          }}
        >
          {children}
        </div>
      ) : null}

      {!panel.minimized ? (
        <button
          type="button"
          aria-label="Resize panel"
          onPointerDown={startResize}
          style={{
            position: "absolute",
            right: 2,
            bottom: 2,
            width: 18,
            height: 18,
            border: "none",
            background: "transparent",
            cursor: "nwse-resize",
            color: UI.textDim,
            padding: 0,
            fontSize: 12,
            lineHeight: 1,
          }}
        >
          ◢
        </button>
      ) : null}
    </section>
  );
}

const panelButtonStyle: CSSProperties = {
  width: 24,
  height: 24,
  borderRadius: 8,
  border: `1px solid ${UI.border}`,
  background: UI.panelBg,
  color: UI.text,
  fontSize: 13,
  fontWeight: 900,
  lineHeight: 1,
  cursor: "pointer",
  padding: 0,
};

function PhoneIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false" style={phoneIconStyle}>
      <rect x="5.2" y="2.6" width="9.6" height="14.8" rx="2.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 5.4h4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="10" cy="15.2" r="0.8" fill="currentColor" />
    </svg>
  );
}

const phoneIconStyle: CSSProperties = {
  width: 14,
  height: 14,
};

"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type Rect = { x: number; y: number; w: number; h: number };

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function safeParse(json: string | null): any {
  try {
    return json ? JSON.parse(json) : null;
  } catch {
    return null;
  }
}

function isInteractiveTarget(el: EventTarget | null) {
  const node = el as HTMLElement | null;
  if (!node) return false;
  return Boolean(node.closest("button, a, input, select, textarea, [role='button'], [data-no-drag]"));
}

export default function FloatingPanel({
  open,
  onClose,
  title,
  storageKey,
  initial,
  minW = 360,
  minH = 240,
  children,
  zIndex = 9999,
  rightActions,
  clearMode = false,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  storageKey: string;
  initial?: Partial<Rect>;
  minW?: number;
  minH?: number;
  zIndex?: number;
  rightActions?: React.ReactNode;
  children: React.ReactNode;
  clearMode?: boolean;
}) {
  const defaultRect: Rect = useMemo(() => {
    const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
    const vh = typeof window !== "undefined" ? window.innerHeight : 800;

    const w = clamp(initial?.w ?? 980, minW, vw - 24);
    const h = clamp(initial?.h ?? 740, minH, vh - 24);
    const x = clamp(initial?.x ?? (vw - w) / 2, 12, vw - w - 12);
    const y = clamp(initial?.y ?? (vh - h) / 2, 12, vh - h - 12);

    return { x, y, w, h };
  }, [initial, minW, minH]);

  const [rect, setRect] = useState<Rect>(defaultRect);
  const [dragging, setDragging] = useState(false);

  const panelRef = useRef<HTMLDivElement | null>(null);

  const dragStartRef = useRef<{
    px: number;
    py: number;
    ox: number;
    oy: number;
  } | null>(null);

  const shellBg = clearMode
    ? "rgba(255,255,255,0.04)"
    : "white";

  const shellBorder = clearMode
    ? "1px solid rgba(255,255,255,0.18)"
    : "1px solid rgba(15,23,42,0.14)";

  const shellShadow = clearMode
    ? "0 18px 60px rgba(0,0,0,0.18)"
    : "0 18px 60px rgba(0,0,0,0.28)";

  const shellBackdrop = clearMode
    ? "blur(.5px) saturate(125%)"
    : "none";

  const headerBg = clearMode
    ? "linear-gradient(180deg, rgba(96,165,250,0.26), rgba(59,130,246,0.18))"
    : "linear-gradient(180deg, rgba(96,165,250,0.96), rgba(59,130,246,0.92))";

  const headerBorder = clearMode
    ? "1px solid rgba(255,255,255,0.14)"
    : "1px solid rgba(15,23,42,0.12)";

  const bodyBg = clearMode
    ? "rgba(255,255,255,0.02)"
    : "white";

  const bodyBackdrop = clearMode
    ? "blur(.5px) saturate(120%)"
    : "none";

  const closeButtonBg = clearMode
    ? "rgba(255,255,255,0.10)"
    : "rgba(255,255,255,0.55)";

  const closeButtonBorder = clearMode
    ? "1px solid rgba(255,255,255,0.18)"
    : "1px solid rgba(15,23,42,0.18)";

  useEffect(() => {
    if (!open) return;

    const saved = safeParse(typeof window !== "undefined" ? localStorage.getItem(storageKey) : null);

    if (saved && typeof saved === "object") {
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      const w = clamp(Number(saved.w) || defaultRect.w, minW, vw - 24);
      const h = clamp(Number(saved.h) || defaultRect.h, minH, vh - 24);
      const x = clamp(Number(saved.x) || defaultRect.x, 12, vw - w - 12);
      const y = clamp(Number(saved.y) || defaultRect.y, 12, vh - h - 12);

      setRect({ x, y, w, h });
    } else {
      setRect(defaultRect);
    }
  }, [open, storageKey, defaultRect, minW, minH]);

  useEffect(() => {
    if (!open) return;
    localStorage.setItem(storageKey, JSON.stringify(rect));
  }, [open, storageKey, rect]);

  useEffect(() => {
    if (!open) return;

    const onResize = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      setRect((r) => {
        const w = clamp(r.w, minW, vw - 24);
        const h = clamp(r.h, minH, vh - 24);
        const x = clamp(r.x, 12, vw - w - 12);
        const y = clamp(r.y, 12, vh - h - 12);
        return { x, y, w, h };
      });
    };

    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open, minW, minH]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const el = panelRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;

    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        const { width, height } = el.getBoundingClientRect();
        const w = clamp(Math.round(width), minW, vw - 24);
        const h = clamp(Math.round(height), minH, vh - 24);

        const EPS = 1;

        setRect((r) => {
          const x = clamp(r.x, 12, vw - w - 12);
          const y = clamp(r.y, 12, vh - h - 12);

          const sameSize = Math.abs(r.w - w) <= EPS && Math.abs(r.h - h) <= EPS;
          const samePos = Math.abs(r.x - x) <= EPS && Math.abs(r.y - y) <= EPS;
          if (sameSize && samePos) return r;

          return { x, y, w, h };
        });
      });
    });

    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [open, minW, minH]);

  function onHeaderPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    if (isInteractiveTarget(e.target)) return;

    e.preventDefault();
    e.stopPropagation();

    setDragging(true);
    dragStartRef.current = { px: e.clientX, py: e.clientY, ox: rect.x, oy: rect.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onHeaderPointerMove(e: React.PointerEvent) {
    if (!dragging || !dragStartRef.current) return;
    e.preventDefault();

    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const dx = e.clientX - dragStartRef.current.px;
    const dy = e.clientY - dragStartRef.current.py;

    const nextX = clamp(dragStartRef.current.ox + dx, 12, vw - rect.w - 12);
    const nextY = clamp(dragStartRef.current.oy + dy, 12, vh - rect.h - 12);

    setRect((r) => ({ ...r, x: nextX, y: nextY }));
  }

  function onHeaderPointerUp(e: React.PointerEvent) {
    if (!dragging) return;
    e.preventDefault();
    setDragging(false);
    dragStartRef.current = null;
  }

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      style={{
        position: "fixed",
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        zIndex,
        borderRadius: 16,
        overflow: "hidden",
        boxShadow: shellShadow,
        border: shellBorder,
        background: shellBg,
        backdropFilter: shellBackdrop,
        WebkitBackdropFilter: shellBackdrop,
        boxSizing: "border-box",
        resize: "both",
        minWidth: minW,
        minHeight: minH,
        maxWidth: "calc(100vw - 24px)",
        maxHeight: "calc(100vh - 24px)",
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
        style={{
          userSelect: "none",
          cursor: dragging ? "grabbing" : "grab",
          padding: "10px 12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          background: headerBg,
          color: "#0b1220",
          borderBottom: headerBorder,
          backdropFilter: shellBackdrop,
          WebkitBackdropFilter: shellBackdrop,
        }}
        title="Drag to move • Resize from bottom-right corner"
      >
        <div
          style={{
            fontWeight: 950,
            fontSize: 13,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {rightActions ?? null}

          <button
            type="button"
            data-no-drag
            onPointerDown={(e) => {
              e.stopPropagation();
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }}
            style={{
              border: closeButtonBorder,
              background: closeButtonBg,
              borderRadius: 10,
              padding: "6px 10px",
              fontWeight: 950,
              cursor: "pointer",
              color: "#0b1220",
              backdropFilter: clearMode ? "blur(6px) saturate(120%)" : "none",
              WebkitBackdropFilter: clearMode ? "blur(6px) saturate(120%)" : "none",
            }}
            aria-label="Close"
            title="Close"
          >
            Close
          </button>
        </div>
      </div>

      <div
        style={{
          height: `calc(100% - 44px)`,
          overflow: "auto",
          background: bodyBg,
          backdropFilter: bodyBackdrop,
          WebkitBackdropFilter: bodyBackdrop,
        }}
      >
        {children}
      </div>

      <div
        style={{
          position: "absolute",
          right: 6,
          bottom: 6,
          width: 14,
          height: 14,
          opacity: clearMode ? 0.22 : 0.45,
          pointerEvents: "none",
          background:
            "linear-gradient(135deg, rgba(15,23,42,0) 40%, rgba(15,23,42,0.35) 40%, rgba(15,23,42,0.35) 55%, rgba(15,23,42,0) 55%)",
        }}
      />
    </div>
  );
}
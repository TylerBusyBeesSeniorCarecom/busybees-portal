// app/schedule/components/FloatingPanel.tsx
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

  // Load saved position/size when opened
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

  // Save when rect changes (while open)
  useEffect(() => {
    if (!open) return;
    localStorage.setItem(storageKey, JSON.stringify(rect));
  }, [open, storageKey, rect]);

  // Keep rect clamped on viewport resize (so it never drifts off-screen)
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

  // ESC closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  /**
   * ✅ FIX: Stop "panel keeps expanding"
   * - Use border-box sizing so borders don't change measured width/height.
   * - Measure with getBoundingClientRect() (matches the rendered box).
   * - Ignore tiny 1px jitters to prevent feedback loops.
   */
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

  // Drag handlers
  function onHeaderPointerDown(e: React.PointerEvent) {
    // Only left click / primary pointer
    if (e.button !== 0) return;

    // ✅ Don't start dragging if the user is interacting with a control in the header.
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
        boxShadow: "0 18px 60px rgba(0,0,0,0.28)",
        border: "1px solid rgba(15,23,42,0.14)",
        background: "white",

        // ✅ CRITICAL: prevents border/scrollbar from causing ResizeObserver feedback growth
        boxSizing: "border-box",

        // Native resizing applies to the outer panel so it truly changes size
        resize: "both",
        minWidth: minW,
        minHeight: minH,

        // keeps resize handle visible on mac/chrome
        maxWidth: "calc(100vw - 24px)",
        maxHeight: "calc(100vh - 24px)",
      }}
      // stop accidental clicks behind it (and prevent click leak-through)
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header (drag handle) */}
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
          background: "linear-gradient(180deg, rgba(96,165,250,0.96), rgba(59,130,246,0.92))",
          color: "#0b1220",
          borderBottom: "1px solid rgba(15,23,42,0.12)",
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
          {/* If you render buttons in rightActions, they won't trigger drag because of isInteractiveTarget() */}
          {rightActions ?? null}

          {/* Close */}
          <button
            type="button"
            data-no-drag
            onPointerDown={(e) => {
              // ✅ Prevent the header from capturing pointer on press
              e.stopPropagation();
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }}
            style={{
              border: "1px solid rgba(15,23,42,0.18)",
              background: "rgba(255,255,255,0.55)",
              borderRadius: 10,
              padding: "6px 10px",
              fontWeight: 950,
              cursor: "pointer",
              color: "#0b1220",
            }}
            aria-label="Close"
            title="Close"
          >
            Close
          </button>
        </div>
      </div>

      {/* Body (scroll area) */}
      <div
        style={{
          height: `calc(100% - 44px)`,
          overflow: "auto",
          background: "white",
        }}
      >
        {children}
      </div>

      {/* Resize handle hint (visual) */}
      <div
        style={{
          position: "absolute",
          right: 6,
          bottom: 6,
          width: 14,
          height: 14,
          opacity: 0.45,
          pointerEvents: "none",
          background:
            "linear-gradient(135deg, rgba(15,23,42,0) 40%, rgba(15,23,42,0.35) 40%, rgba(15,23,42,0.35) 55%, rgba(15,23,42,0) 55%)",
        }}
      />
    </div>
  );
}
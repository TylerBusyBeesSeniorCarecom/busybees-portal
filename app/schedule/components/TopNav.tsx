"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

type NavItem = {
  label: string;
  href: (week: string) => string;
  match?: (pathname: string) => boolean;
};

function buildHrefWithWeek(basePath: string, week: string) {
  const u = new URL(basePath, "http://local");
  u.searchParams.set("week", week);
  const qs = u.searchParams.toString();
  return qs ? `${u.pathname}?${qs}` : u.pathname;
}

const UI = {
  pageBg: "#f3f4f6",
  panelBg: "#ffffff",
  headerBg: "#f9fafb",
  rowA: "#ffffff",
  rowB: "#f6f7f9",
  border: "#d1d5db",
  borderSoft: "#e5e7eb",
  text: "#111827",
  textDim: "#6b7280",
};

function ToolsMenu({
  week,
  pathname,
  tools,
  pill,
  activeDot,
}: {
  week: string;
  pathname: string;
  tools: NavItem[];
  pill: (active: boolean) => React.CSSProperties;
  activeDot: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const el = wrapRef.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          ...pill(false),
          cursor: "pointer",
          userSelect: "none",
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Tools"
      >
        <span style={activeDot} />
        Tools ▾
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 8px)",
            minWidth: 220,
            background: "rgba(255,255,255,0.98)",
            border: `1px solid ${UI.border}`,
            borderRadius: 12,
            boxShadow: "0 18px 40px rgba(0,0,0,0.12)",
            padding: 8,
            zIndex: 999,
          }}
        >
          {tools.map((it) => {
            const active = it.match ? it.match(pathname) : false;
            const href = it.href(week as any);
            return (
              <Link
                key={it.label}
                href={href}
                prefetch={false}
                role="menuitem"
                onClick={() => setOpen(false)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 10px",
                  borderRadius: 10,
                  textDecoration: "none",
                  color: UI.text,
                  fontWeight: 900,
                  fontSize: 13,
                  background: active ? "rgba(17,24,39,0.06)" : "transparent",
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 99,
                    background: active ? "#111827" : "rgba(17,24,39,0.25)",
                  }}
                />
                {it.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function TopNav({
  week,
  right,
}: {
  week: string;
  right?: React.ReactNode;
}) {
  const pathname = usePathname() || "";
  const search = useSearchParams();
  const weekParam = search?.get("week") || "";

 const items: NavItem[] = [
  {
    label: "Schedule",
    href: (w) => buildHrefWithWeek("/schedule", w),
    match: (p) => p === "/schedule",
  },
  {
    label: "Availability",
    href: (w) => buildHrefWithWeek("/availability", w),
    match: (p) => p.startsWith("/availability"),
  },
  {
    label: "Billing & Payroll",
    href: (w) => buildHrefWithWeek("/billing-payroll", w),
    match: (p) => p.startsWith("/billing-payroll"),
  },
  {
    label: "History",
    href: (w) => buildHrefWithWeek("/history", w),
    match: (p) => p.startsWith("/history"),
  },

  // ✅ NEW
  {
    label: "Applicants",
    href: (_w) => "/schedule/applicants",
    match: (p) => p.startsWith("/schedule/applicants"),
  },
];

  const tools: NavItem[] = [
    {
      label: "Old School Grid",
      href: (_w) => "/schedule/old-school",
      match: (p) => p.startsWith("/schedule/old-school"),
    },
    {
      label: "Back to Login",
      href: (_w) => "/",
      match: (p) => p === "/",
    },
  ];

  const pill = (active: boolean): React.CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 12px",
    borderRadius: 999,
    border: `1px solid ${active ? "#111827" : UI.border}`,
    background: active ? "#111827" : "rgba(255,255,255,0.85)",
    color: active ? "#fff" : UI.text,
    fontSize: 13,
    fontWeight: 950,
    textDecoration: "none",
    whiteSpace: "nowrap",
    lineHeight: 1,
  });

  const activeDot: React.CSSProperties = {
    width: 7,
    height: 7,
    borderRadius: 999,
    background: "currentColor",
    opacity: 0.9,
  };

  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        marginBottom: 12,
      }}
    >
      <div
        style={{
          border: `1px solid ${UI.border}`,
          background: "rgba(249,250,251,0.92)",
          backdropFilter: "blur(10px)",
          borderRadius: 14,
          padding: 10,
          boxShadow: "0 8px 20px rgba(0,0,0,0.08)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
              <div style={{ fontSize: 12, fontWeight: 950, color: UI.textDim }}>Busy Bees</div>
              <div style={{ fontSize: 16, fontWeight: 1000, letterSpacing: 0.2 }}>
                Scheduler Portal
              </div>
            </div>

            <div
              style={{
                width: 1,
                alignSelf: "stretch",
                background: UI.borderSoft,
                margin: "0 2px",
              }}
            />

            <nav style={{ display: "flex", gap: 8, flexWrap: "wrap" }} aria-label="Primary">
              {items.map((it) => {
                const isActive = it.match ? it.match(pathname) : false;
                const href = it.href(week as any);
                return (
                  <Link
                    key={it.label}
                    href={href}
                    aria-current={isActive ? "page" : undefined}
                    style={pill(isActive)}
                    title={
                      it.label === "Schedule"
                        ? `Schedule (week=${week})`
                        : it.label === "Availability"
                        ? `Availability (week=${week})`
                        : it.label === "Billing & Payroll"
                        ? `Billing & Payroll (week=${week})`
                        : it.label
                    }
                  >
                    <span style={activeDot} />
                    {it.label}
                  </Link>
                );
              })}
            </nav>

            <div
              style={{
                fontSize: 12,
                fontWeight: 900,
                color: UI.textDim,
                padding: "6px 10px",
                borderRadius: 999,
                border: `1px solid ${UI.borderSoft}`,
                background: "rgba(255,255,255,0.55)",
              }}
              title={`Current week param: ${weekParam || "(none)"}`}
            >
              Week: {String(week).toUpperCase()}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {right}

            <div
              style={{
                width: 1,
                alignSelf: "stretch",
                background: UI.borderSoft,
              }}
            />

            <ToolsMenu
              week={week as any}
              pathname={pathname}
              tools={tools}
              pill={pill}
              activeDot={activeDot}
            />

          </div>
        </div>
      </div>
    </div>
  );
}

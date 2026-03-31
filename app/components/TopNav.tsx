"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

export type WeekKind = "cw" | "nw";

type NavItem = {
  label: string;
  href: (week: WeekKind) => string;
  match?: (pathname: string) => boolean;
};

type PortalUser = {
  name: string;
  email: string;
  isCurrentUser?: boolean;
};

function buildHrefWithWeek(basePath: string, week: WeekKind) {
  const u = new URL(basePath, "http://local");
  u.searchParams.set("week", week);
  const qs = u.searchParams.toString();
  return qs ? `${u.pathname}?${qs}` : u.pathname;
}

const UI = {
  pageBg: "#f3f4f6",
  panelBg: "#ffffff",
  headerBg: "#f9fafb",
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
  week: WeekKind;
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
            const href = it.href(week);
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

function PortalUsersChip({
  currentUserName,
  currentUserEmail,
  portalUsersOnline,
}: {
  currentUserName?: string;
  currentUserEmail?: string;
  portalUsersOnline?: PortalUser[];
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const users = useMemo(() => {
    return (portalUsersOnline ?? []).filter((u) => u?.name || u?.email);
  }, [portalUsersOnline]);

  const onlineCount = users.length;
  const hasCurrentUser = Boolean(currentUserName || currentUserEmail);

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

  if (!hasCurrentUser) {
    return (
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          borderRadius: 999,
          border: `1px solid ${UI.border}`,
          background: "rgba(255,255,255,0.85)",
          color: UI.textDim,
          fontSize: 13,
          fontWeight: 900,
          lineHeight: 1,
          whiteSpace: "nowrap",
        }}
        title="Portal user not loaded"
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            background: "#9ca3af",
            opacity: 0.9,
          }}
        />
        Portal User: Loading…
      </div>
    );
  }

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          borderRadius: 999,
          border: `1px solid ${UI.border}`,
          background: "rgba(255,255,255,0.85)",
          color: UI.text,
          fontSize: 13,
          fontWeight: 950,
          lineHeight: 1,
          whiteSpace: "nowrap",
          cursor: "pointer",
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        title={
          currentUserEmail
            ? `${currentUserName || "Signed in"} • ${currentUserEmail}`
            : currentUserName || "Signed in"
        }
      >
        <span
          style={{
            position: "relative",
            width: 18,
            height: 18,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 999,
            background: "rgba(17,24,39,0.08)",
            fontSize: 11,
          }}
        >
          👤
          <span
            style={{
              position: "absolute",
              right: -4,
              top: -4,
              minWidth: 14,
              height: 14,
              padding: "0 4px",
              borderRadius: 999,
              background: "#16a34a",
              color: "#fff",
              fontSize: 9,
              fontWeight: 1000,
              lineHeight: "14px",
              textAlign: "center",
              border: "2px solid #fff",
              boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
            }}
          >
            {onlineCount}
          </span>
        </span>

        <span style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" }}>
          {currentUserName || currentUserEmail}
        </span>

        <span style={{ color: UI.textDim }}>▾</span>
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 8px)",
            width: 320,
            maxWidth: "min(320px, calc(100vw - 24px))",
            background: "rgba(255,255,255,0.98)",
            border: `1px solid ${UI.border}`,
            borderRadius: 12,
            boxShadow: "0 18px 40px rgba(0,0,0,0.12)",
            padding: 10,
            zIndex: 999,
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 1000,
              color: UI.textDim,
              marginBottom: 8,
            }}
          >
            Portal Users Online
          </div>

          <div
            style={{
              display: "grid",
              gap: 8,
            }}
          >
            {users.length === 0 ? (
              <div
                style={{
                  fontSize: 12.5,
                  color: UI.textDim,
                  fontWeight: 800,
                  padding: "6px 2px",
                }}
              >
                No portal users detected.
              </div>
            ) : (
              users.map((user, idx) => {
                const label = user.name || user.email || "Unknown User";
                return (
                  <div
                    key={`${user.email || user.name || "user"}_${idx}`}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      justifyContent: "space-between",
                      gap: 10,
                      padding: "8px 10px",
                      borderRadius: 10,
                      background: user.isCurrentUser
                        ? "rgba(17,24,39,0.05)"
                        : "rgba(255,255,255,0.7)",
                      border: `1px solid ${user.isCurrentUser ? UI.border : UI.borderSoft}`,
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 950,
                          color: UI.text,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={label}
                      >
                        {label}
                      </div>

                      {user.email ? (
                        <div
                          style={{
                            marginTop: 2,
                            fontSize: 11.5,
                            color: UI.textDim,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          title={user.email}
                        >
                          {user.email}
                        </div>
                      ) : null}
                    </div>

                    <div
                      style={{
                        flex: "0 0 auto",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 11,
                        fontWeight: 950,
                        color: user.isCurrentUser ? "#065f46" : UI.textDim,
                        whiteSpace: "nowrap",
                      }}
                    >
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 999,
                          background: "#16a34a",
                          boxShadow: "0 0 0 2px rgba(22,163,74,0.15)",
                        }}
                      />
                      {user.isCurrentUser ? "You" : "Online"}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div
            style={{
              marginTop: 8,
              fontSize: 11,
              color: UI.textDim,
              fontWeight: 800,
              lineHeight: 1.35,
            }}
          >
            For now, this reflects the signed-in portal user data passed from the schedule page.
          </div>
        </div>
      )}
    </div>
  );
}

export default function TopNav({
  week,
  right,
  currentUserName,
  currentUserEmail,
  portalUsersOnline,
}: {
  week: WeekKind;
  right?: React.ReactNode;
  currentUserName?: string;
  currentUserEmail?: string;
  portalUsersOnline?: PortalUser[];
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
    <div style={{ position: "sticky", top: 0, zIndex: 50, marginBottom: 12 }}>
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
          {/* Left: brand + primary nav */}
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
                const href = it.href(week);
                return (
                  <Link
                    key={it.label}
                    href={href}
                    aria-current={isActive ? "page" : undefined}
                    style={pill(isActive)}
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
              Week: {week.toUpperCase()}
            </div>
          </div>

          {/* Right: controls + portal user + tools */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {right}

            <div style={{ width: 1, alignSelf: "stretch", background: UI.borderSoft }} />

            <PortalUsersChip
              currentUserName={currentUserName}
              currentUserEmail={currentUserEmail}
              portalUsersOnline={portalUsersOnline}
            />

            <div style={{ width: 1, alignSelf: "stretch", background: UI.borderSoft }} />

            <ToolsMenu
              week={week}
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
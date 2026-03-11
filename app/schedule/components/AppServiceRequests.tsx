// app/schedule/components/ServiceRequestsPanel.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import FloatingPanel from "@/app/schedule/components/FloatingPanel";

type ReqItem = {
  clientName: string;
  rawDate: string;
  dateKey: string;
  start: string;
  end: string;
  preferredCaregiver: string;
  notes: string;
  status: string;
  timestamp: string;
};

type ApiMeta = {
  fetchedAt?: string;
  beforeCount?: number;
  count?: number;
  weekStart?: string | null;
  weekEnd?: string | null;
};

function normClient(s: string) {
  return (s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function isYmd(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test((s || "").trim());
}

function toDateSafe(s: string): Date | null {
  const raw = (s || "").trim();
  if (!raw) return null;

  // dateKey is usually yyyy-mm-dd; rawDate might be parseable too
  const d0 = new Date(raw);
  if (!Number.isNaN(d0.getTime())) return d0;

  // fallback: mm/dd/yyyy
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    const mm = parseInt(m[1], 10);
    const dd = parseInt(m[2], 10);
    const yyyy = parseInt(m[3], 10);
    const d = new Date(yyyy, mm - 1, dd);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  return null;
}

function fmtDowAndDate(dateKeyOrRaw: string) {
  const d = toDateSafe(dateKeyOrRaw);
  if (!d) return { dow: "(unknown)", date: dateKeyOrRaw || "(unknown date)" };

  const dow = d.toLocaleDateString(undefined, { weekday: "long" });
  const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return { dow, date };
}

function timeRangeText(r: ReqItem) {
  const s = (r.start || "").trim();
  const e = (r.end || "").trim();
  if (s && e) return `${s} – ${e}`;
  return s || "(no time)";
}

export default function ServiceRequestsPanel({
  open,
  onClose,
  clientName,
  weekStartYmd,
  weekKind,
}: {
  open: boolean;
  onClose: () => void;
  clientName: string;
  weekStartYmd: string; // MUST be yyyy-mm-dd for the schedule week
  weekKind: "cw" | "nw";
}) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [requests, setRequests] = useState<ReqItem[]>([]);
  const [meta, setMeta] = useState<ApiMeta | null>(null);

  const canQuery = open && !!clientName && isYmd(weekStartYmd);

  useEffect(() => {
    if (!open) return;

    // Hard guard: if we don't have a valid weekStart, do NOT query
    if (!isYmd(weekStartYmd)) {
      setRequests([]);
      setMeta(null);
      setLoading(false);
      setErr(
        `Missing/invalid weekStartYmd for ${weekKind.toUpperCase()} schedule: "${weekStartYmd}"`
      );
      return;
    }

    let alive = true;
    setLoading(true);
    setErr(null);
    setMeta(null);

    const url =
      `/api/service-requests` +
      `?clientName=${encodeURIComponent(clientName || "")}` +
      `&weekStart=${encodeURIComponent(weekStartYmd)}` +
      `&onlyPending=1`;

    fetch(url, { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => {
        if (!alive) return;
        if (!json?.ok) throw new Error(json?.error || "Failed to load service requests");
        setRequests(Array.isArray(json.requests) ? json.requests : []);
        setMeta(json?.meta || null);
      })
      .catch((e) => alive && setErr(e?.message || "Error"))
      .finally(() => alive && setLoading(false));

    return () => {
      alive = false;
    };
  }, [open, clientName, weekStartYmd, weekKind]);

  // Safety-net: if API ever returns mixed clients, filter again locally
  const visible = useMemo(() => {
    const want = normClient(clientName);
    if (!want) return requests;
    return requests.filter((r) => normClient(r.clientName) === want);
  }, [requests, clientName]);

  const grouped = useMemo(() => {
    const m = new Map<string, ReqItem[]>();
    for (const r of visible) {
      const key = (r.dateKey || r.rawDate || "").trim();
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(r);
    }

    // sort within day by start time string (best-effort)
    const entries = Array.from(m.entries());
    for (const [, items] of entries) {
      items.sort((a, b) => timeRangeText(a).localeCompare(timeRangeText(b)));
    }

    // sort days by actual date if possible
    entries.sort((a, b) => {
      const da = toDateSafe(a[0])?.getTime() ?? Infinity;
      const db = toDateSafe(b[0])?.getTime() ?? Infinity;
      return da - db;
    });

    return entries;
  }, [visible]);

  // ---- UI tokens (local to this component) ----
  const UI = {
    border: "rgba(0,0,0,0.12)",
    soft: "rgba(0,0,0,0.06)",
    text: "#111827",
    dim: "rgba(17,24,39,0.7)",
    yellowBg: "#FEF3C7", // amber-100
    yellowBorder: "#F59E0B", // amber-500
    cardBg: "rgba(0,0,0,0.03)",
  };

  return (
    <FloatingPanel
      open={open}
      onClose={onClose}
      title={
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ fontWeight: 800 }}>Service Requests</div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>
            {clientName} • {weekKind.toUpperCase()} • week of {weekStartYmd || "(missing)"}
          </div>
          {!!meta?.fetchedAt && (
            <div style={{ fontSize: 11, opacity: 0.65 }}>
              {meta.count ?? "?"} shown
              {typeof meta.beforeCount === "number" ? ` (from ${meta.beforeCount})` : ""} •{" "}
              {new Date(meta.fetchedAt).toLocaleString()}
            </div>
          )}
        </div>
      }
      storageKey={`svcReqPanel:${weekKind}:${clientName || "unknown"}`}
      initial={{ x: 80, y: 80, w: 600, h: 520 }}
    >
      <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
        {/* ✅ Yellow top strip (inside panel) */}
        <div
          style={{
            background: UI.yellowBg,
            borderBottom: `1px solid ${UI.border}`,
            padding: "10px 12px",
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
            <div style={{ fontWeight: 950, color: UI.text }}>
              {clientName || "Client"}
            </div>
            <div style={{ fontSize: 12, fontWeight: 900, color: UI.dim, whiteSpace: "nowrap" }}>
              Pending requests • {weekKind.toUpperCase()}
            </div>
          </div>

          <div style={{ marginTop: 4, fontSize: 12, color: UI.dim }}>
            Week start: <strong style={{ color: UI.text }}>{weekStartYmd || "—"}</strong>
          </div>
        </div>

        <div style={{ padding: 12, flex: "1 1 auto", overflow: "auto" }}>
          {!canQuery && !err && (
            <div style={{ opacity: 0.8 }}>
              Waiting for a valid week start date for this schedule…
            </div>
          )}

          {loading && <div style={{ opacity: 0.8 }}>Loading…</div>}

          {err && <div style={{ color: "crimson", whiteSpace: "pre-wrap" }}>{err}</div>}

          {!loading && !err && grouped.length === 0 && (
            <div style={{ opacity: 0.8 }}>No pending service requests for this week.</div>
          )}

          {!loading && !err && grouped.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {grouped.map(([dateKey, dayItems]) => {
                const { dow, date } = fmtDowAndDate(dateKey);

                return (
                  <div
                    key={dateKey}
                    style={{
                      border: `1px solid ${UI.border}`,
                      borderRadius: 14,
                      overflow: "hidden",
                      background: "#fff",
                    }}
                  >
                    {/* Day header */}
                    <div
                      style={{
                        padding: "10px 12px",
                        borderBottom: `1px solid ${UI.soft}`,
                        background: "rgba(0,0,0,0.015)",
                        display: "flex",
                        alignItems: "baseline",
                        justifyContent: "space-between",
                        gap: 10,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 950, color: UI.dim }}>
                          {dow}
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 1000, color: UI.text }}>
                          {date}
                        </div>
                      </div>

                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 950,
                          padding: "4px 10px",
                          borderRadius: 999,
                          border: `1px solid ${UI.border}`,
                          background: "#fff",
                          color: UI.text,
                          whiteSpace: "nowrap",
                        }}
                        title="Requests on this day"
                      >
                        {dayItems.length} request{dayItems.length === 1 ? "" : "s"}
                      </div>
                    </div>

                    {/* Requests list */}
                    <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                      {dayItems.map((r, idx) => {
                        const timeText = timeRangeText(r);
                        const pref = (r.preferredCaregiver || "").trim();

                        return (
                          <div
                            key={`${dateKey}_${idx}`}
                            style={{
                              border: `1px solid ${UI.soft}`,
                              borderRadius: 14,
                              background: UI.cardBg,
                              padding: 12,
                            }}
                          >
                            {/* “Form-like” fields */}
                            <div style={{ display: "grid", gap: 10 }}>
                              {/* Time */}
                              <div>
                                <div style={{ fontSize: 11.5, fontWeight: 950, color: UI.dim }}>
                                  Time
                                </div>
                                <div style={{ marginTop: 2, fontSize: 15, fontWeight: 1000, color: UI.text }}>
                                  {timeText}
                                </div>
                              </div>

                              {/* Preferred caregiver */}
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 8,
                                  padding: "10px 10px",
                                  borderRadius: 12,
                                  border: `1px solid ${UI.border}`,
                                  background: "#fff",
                                }}
                              >
                                <span aria-hidden style={{ fontSize: 16, lineHeight: 1 }}>
                                  👤
                                </span>
                                <div style={{ minWidth: 0 }}>
                                  <div style={{ fontSize: 11.5, fontWeight: 950, color: UI.dim }}>
                                    Preferred caregiver
                                  </div>
                                  <div
                                    style={{
                                      marginTop: 1,
                                      fontSize: 13,
                                      fontWeight: 900,
                                      color: UI.text,
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                      whiteSpace: "nowrap",
                                    }}
                                    title={pref || "(none)"}
                                  >
                                    {pref || "(none)"}
                                  </div>
                                </div>
                              </div>

                              {/* Notes */}
                              <div
                                style={{
                                  padding: 10,
                                  borderRadius: 12,
                                  border: `1px dashed ${UI.border}`,
                                  background: "rgba(255,255,255,0.65)",
                                }}
                              >
                                <div style={{ fontSize: 11.5, fontWeight: 950, color: UI.dim }}>
                                  Notes
                                </div>
                                {r.notes ? (
                                  <div
                                    style={{
                                      marginTop: 4,
                                      whiteSpace: "pre-wrap",
                                      fontSize: 13,
                                      fontWeight: 800,
                                      color: UI.text,
                                      lineHeight: 1.35,
                                    }}
                                  >
                                    {r.notes}
                                  </div>
                                ) : (
                                  <div style={{ marginTop: 4, opacity: 0.7, fontSize: 13, fontWeight: 800 }}>
                                    (no notes)
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Optional bottom bar (nice for future actions like “Create shifts”) */}
        <div
          style={{
            borderTop: `1px solid ${UI.border}`,
            padding: "10px 12px",
            background: "#fff",
            display: "flex",
            justifyContent: "space-between",
            gap: 10,
            alignItems: "center",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 900, color: UI.dim }}>
            Tip: use the red badge to find uncovered request-days.
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: `1px solid ${UI.yellowBorder}`,
              background: UI.yellowBg,
              color: UI.text,
              borderRadius: 12,
              padding: "8px 10px",
              fontSize: 13,
              fontWeight: 950,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            Close
          </button>
        </div>
      </div>
    </FloatingPanel>
  );
}
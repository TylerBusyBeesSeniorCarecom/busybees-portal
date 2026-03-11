// app/history/[weekStart]/HistoryWeekClient.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";

type RawValues = string[][];
type ShiftRow = {
  shiftId: string;
  date: string;
  client: string;
  caregiver: string;
  caregiverId: string;
  startTime: string;
  endTime: string;
  status: string;
  conflict?: string;
  dow: number; // 0=Sun..6=Sat
};

type ClockEntry = { clockInTime: string | null; clockOutTime: string | null };
type ClockMap = Record<string, ClockEntry>;

type LocationEntry = {
  clockIn: { timestamp: string | null; verdict: string | null };
  clockOut: { timestamp: string | null; verdict: string | null };
};
type LocationMap = Record<string, LocationEntry>;

const DOW_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

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

function norm(v: any) {
  return (v ?? "").toString().trim();
}

function toDateSafe(dateStr: string): Date | null {
  const raw = norm(dateStr);
  if (!raw) return null;

  const d0 = new Date(raw);
  if (!Number.isNaN(d0.getTime())) return d0;

  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+.*)?$/);
  if (!m) return null;

  const mm = parseInt(m[1], 10);
  const dd = parseInt(m[2], 10);
  const yyyy = parseInt(m[3], 10);
  const d = new Date(yyyy, mm - 1, dd);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseDateToDow(dateStr: string): number {
  const d = toDateSafe(dateStr);
  return d ? d.getDay() : 0;
}

function formatHeaderDate(d: Date | null): string {
  if (!d) return "";
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function parseTimeToMinutes(t: string): number | null {
  const raw = norm(t);
  if (!raw) return null;
  const normalized = raw.replace(/\s+/g, " ").replace(/([AP]M)$/i, " $1").trim();
  const m = normalized.match(/^(\d{1,2})(?::(\d{2}))?\s*([AP]M)$/i);
  if (!m) return null;

  let hh = parseInt(m[1], 10);
  const mm = m[2] ? parseInt(m[2], 10) : 0;
  const ap = m[3].toUpperCase();

  if (ap === "AM") {
    if (hh === 12) hh = 0;
  } else {
    if (hh !== 12) hh += 12;
  }
  return hh * 60 + mm;
}

function sortByStartTime(a: ShiftRow, b: ShiftRow): number {
  const am = parseTimeToMinutes(a.startTime);
  const bm = parseTimeToMinutes(b.startTime);
  if (am == null && bm == null) return (a.startTime || "").localeCompare(b.startTime || "");
  if (am == null) return 1;
  if (bm == null) return -1;
  return am - bm;
}

function statusToColor(statusRaw: string): { bg: string; fg: string; border: string } {
  const s = (statusRaw || "").toLowerCase();
  if (s.includes("filled")) return { bg: "#1f7a3a", fg: "#ffffff", border: "#1f7a3a" };
  if (s.includes("offered")) return { bg: "#2b6fd6", fg: "#ffffff", border: "#2b6fd6" };
  if (s.includes("consider")) return { bg: "#d08a1a", fg: "#111111", border: "#d08a1a" };
  if (s.includes("open")) return { bg: "#d64545", fg: "#ffffff", border: "#d64545" };
  return { bg: "#3a3a3a", fg: "#ffffff", border: "#555" };
}

function normalize(values: RawValues): ShiftRow[] {
  if (!values || values.length === 0) return [];
  const headers = values[0].map((h) => norm(h));
  const rows = values.slice(1);

  const idx = (name: string) => headers.findIndex((h) => h.toLowerCase() === name.toLowerCase());

  const iShiftId = idx("Shift ID");
  const iDate = idx("Date");
  const iClient = idx("Client");
  const iCaregiver = idx("Caregiver");
  const iCaregiverId = idx("Caregiver ID");
  const iStart = idx("Start Time");
  const iEnd = idx("End Time");
  const iStatus = idx("Status");
  const iConflict = idx("Conflict");

  return rows
    .filter((r) => r.some((cell) => norm(cell) !== ""))
    .map((r) => {
      const date = norm(r[iDate]);
      return {
        shiftId: norm(r[iShiftId]),
        date,
        client: norm(r[iClient]),
        caregiver: norm(r[iCaregiver]),
        caregiverId: norm(r[iCaregiverId]),
        startTime: norm(r[iStart]),
        endTime: norm(r[iEnd]),
        status: norm(r[iStatus]),
        conflict: iConflict >= 0 ? norm(r[iConflict]) : "",
        dow: parseDateToDow(date),
      };
    });
}

export default function HistoryWeekClient({ weekStart }: { weekStart: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [values, setValues] = useState<RawValues>([]);
  const [clockMap, setClockMap] = useState<ClockMap>({});
  const [locationMap, setLocationMap] = useState<LocationMap>({});

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setLoading(true);
        setError(null);

        // 1) shifts
        const res = await fetch(`/api/historical-data?weekStart=${encodeURIComponent(weekStart)}&limit=5000`, {
          cache: "no-store",
        });
        const j = await res.json();
        if (!res.ok || !j?.ok) throw new Error(j?.error || `Failed to load historical-data (${res.status})`);

        // historical-data returns rows[]; convert to a RawValues-like table to reuse normalize()
        const rows = (j.rows || []) as any[];
        const table: RawValues = [
          ["Shift ID", "Date", "Client", "Caregiver", "Caregiver ID", "Start Time", "End Time", "Status", "Conflict"],
          ...rows.map((r) => [
            norm(r.shiftId),
            norm(r.date),
            norm(r.client),
            norm(r.caregiver),
            norm(r.caregiverId),
            norm(r.startTime),
            norm(r.endTime),
            norm(r.status),
            norm(r.conflict),
          ]),
        ];

        // 2) clocks + location verdicts
        const mapsRes = await fetch(`/api/historical-maps?weekStart=${encodeURIComponent(weekStart)}`, {
          cache: "no-store",
        });
        const maps = await mapsRes.json();
        if (!mapsRes.ok || !maps?.ok) throw new Error(maps?.error || `Failed to load historical-maps (${mapsRes.status})`);

        if (!alive) return;
        setValues(table);
        setClockMap(maps.clockMap ?? {});
        setLocationMap(maps.locationMap ?? {});
      } catch (e: any) {
        if (alive) setError(e?.message || "Unknown error");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [weekStart]);

  const shiftsAll = useMemo(() => normalize(values), [values]);

  const clients = useMemo(() => {
    const set = new Set<string>();
    for (const s of shiftsAll) if (s.client) set.add(s.client);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [shiftsAll]);

  const headerDates = useMemo(() => {
    const byDow: Array<Date | null> = [null, null, null, null, null, null, null];
    for (const s of shiftsAll) {
      const d = toDateSafe(s.date);
      if (!d) continue;
      const dow = s.dow ?? d.getDay();
      const current = byDow[dow];
      if (!current || d.getTime() < current.getTime()) byDow[dow] = d;
    }
    return byDow;
  }, [shiftsAll]);

  const grid = useMemo(() => {
    const map: Record<string, Record<number, ShiftRow[]>> = {};
    for (const client of clients) map[client] = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
    for (const s of shiftsAll) {
      const c = s.client || "Unknown Client";
      if (!map[c]) map[c] = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
      map[c][s.dow].push(s);
    }
    for (const c of Object.keys(map)) for (let d = 0; d <= 6; d++) map[c][d].sort(sortByStartTime);
    return map;
  }, [clients, shiftsAll]);

  return (
    <main style={{ padding: 18, maxWidth: 2200, margin: "0 auto", color: UI.text, background: UI.pageBg, minHeight: "100vh" }}>
      <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>History Week</h1>
          <p style={{ opacity: 0.8, marginTop: 6, fontSize: 13 }}>
            weekStart: <code>{weekStart}</code>
          </p>
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <a href="/history" style={{ textDecoration: "underline", fontSize: 13, fontWeight: 900, color: UI.text }}>
            Back to History
          </a>
          <a href="/schedule" style={{ textDecoration: "underline", fontSize: 13, fontWeight: 900, color: UI.text }}>
            Back to Schedule
          </a>
        </div>
      </header>

      {loading && <p style={{ marginTop: 12, opacity: 0.85 }}>Loading…</p>}
      {!loading && error && (
        <pre style={{ whiteSpace: "pre-wrap", background: UI.panelBg, padding: 12, borderRadius: 10, color: "salmon", marginTop: 12 }}>
          {error}
        </pre>
      )}

      {!loading && !error && (
        <div style={{ marginTop: 14 }}>
          <div style={{ border: `1px solid ${UI.border}`, borderRadius: 12, background: UI.panelBg, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, tableLayout: "fixed" }}>
              <thead>
                <tr>
                  <th
                    style={{
                      position: "sticky",
                      top: 0,
                      left: 0,
                      zIndex: 10,
                      background: UI.headerBg,
                      textAlign: "left",
                      padding: "10px 12px",
                      borderBottom: `1px solid ${UI.border}`,
                      width: 240,
                      fontSize: 13,
                      borderRight: `1px solid ${UI.borderSoft}`,
                    }}
                  >
                    Client
                  </th>

                  {DOW_LABELS.map((d, i) => (
                    <th
                      key={d}
                      style={{
                        position: "sticky",
                        top: 0,
                        zIndex: 9,
                        background: UI.headerBg,
                        textAlign: "left",
                        padding: "10px 10px",
                        borderBottom: `1px solid ${UI.border}`,
                        fontSize: 13,
                        borderRight: i === 6 ? "none" : `1px solid ${UI.borderSoft}`,
                      }}
                    >
                      <div style={{ fontWeight: 700 }}>{d}</div>
                      <div style={{ fontSize: 12, color: UI.textDim, marginTop: 2 }}>{formatHeaderDate(headerDates[i])}</div>
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {clients.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ padding: 12, opacity: 0.85 }}>
                      No shifts for this historical week.
                    </td>
                  </tr>
                ) : (
                  clients.map((client, rowIndex) => {
                    const zebraBg = rowIndex % 2 === 0 ? UI.rowA : UI.rowB;

                    return (
                      <tr key={client}>
                        <td
                          style={{
                            position: "sticky",
                            left: 0,
                            zIndex: 2,
                            background: zebraBg,
                            padding: "10px 12px",
                            borderBottom: `1px solid ${UI.borderSoft}`,
                            fontWeight: 900,
                            fontSize: 13,
                            borderRight: `1px solid ${UI.borderSoft}`,
                          }}
                        >
                          {client}
                        </td>

                        {DOW_LABELS.map((_, dow) => {
                          const items = grid[client]?.[dow] ?? [];
                          return (
                            <td
                              key={dow}
                              style={{
                                verticalAlign: "top",
                                padding: 8,
                                borderBottom: `1px solid ${UI.borderSoft}`,
                                background: zebraBg,
                                borderRight: dow === 6 ? "none" : `1px solid ${UI.borderSoft}`,
                              }}
                            >
                              {items.length === 0 ? (
                                <div style={{ opacity: 0.25, fontSize: 12 }}>—</div>
                              ) : (
                                <div style={{ display: "grid", gap: 6 }}>
                                  {items.map((s) => {
                                    const c = statusToColor(s.status);
                                    const loc = s.shiftId ? locationMap[s.shiftId] : undefined;
                                    const inV = loc?.clockIn?.verdict ?? null;
                                    const outV = loc?.clockOut?.verdict ?? null;
                                    const clock = s.shiftId ? clockMap[s.shiftId] : undefined;

                                    return (
                                      <div
                                        key={s.shiftId || `${s.client}_${s.date}_${s.startTime}_${s.endTime}_${s.caregiverId}`}
                                        style={{
                                          background: c.bg,
                                          color: c.fg,
                                          border: `1px solid ${c.border}`,
                                          borderRadius: 10,
                                          padding: "7px 9px",
                                          lineHeight: 1.2,
                                        }}
                                        title={[
                                          clock?.clockInTime ? `Clock In: ${clock.clockInTime}` : "",
                                          clock?.clockOutTime ? `Clock Out: ${clock.clockOutTime}` : "",
                                          inV ? `IN verdict: ${inV}` : "",
                                          outV ? `OUT verdict: ${outV}` : "",
                                        ].filter(Boolean).join(" | ")}
                                      >
                                        <div style={{ fontWeight: 950, fontSize: 12 }}>
                                          {s.startTime}–{s.endTime}
                                        </div>
                                        <div style={{ fontSize: 11, marginTop: 4, opacity: 0.95 }}>
                                          <span style={{ fontWeight: 900 }}>{s.caregiver || (s.status.toLowerCase().includes("open") ? "Open" : "(No caregiver)")}</span>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}

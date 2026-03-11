// app/history/HistoryClient.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";

type WeekItem = {
  weekStart: string; // YYYY-MM-DD (Sunday)
  weekEnd: string; // YYYY-MM-DD (Saturday)
  label: string; // M/D/YYYY - M/D/YYYY
  count: number; // total shifts in slice
  filledHours: number; // total filled hours
  lastDate: string; // YYYY-MM-DD
};

type WeeksApi = {
  ok: boolean;
  weeks?: WeekItem[];
  error?: string;
  meta?: any;
};

const UI = {
  pageBg: "#f3f4f6",
  panelBg: "#ffffff",
  headerBg: "#f9fafb",
  border: "#d1d5db",
  borderSoft: "#e5e7eb",
  text: "#111827",
  textDim: "#6b7280",
};

function fmtHours(n: any) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "0.0";
  return x.toFixed(1);
}

export default function HistoryClient() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [weeks, setWeeks] = useState<WeekItem[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch(`/api/historical-weeks?tailWeeks=12`, { cache: "no-store" });
        const j = (await res.json()) as WeeksApi;

        if (!res.ok) throw new Error(j?.error || `Weeks request failed (${res.status})`);
        if (!j.ok) throw new Error(j.error || "Failed to load weeks");

        if (!alive) return;
        setWeeks(j.weeks ?? []);
      } catch (e: any) {
        if (alive) setError(e?.message ?? "Unknown error");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return weeks;
    return weeks.filter((w) => {
      const hay = `${w.label} ${w.weekStart} ${w.weekEnd}`.toLowerCase();
      return hay.includes(q);
    });
  }, [weeks, search]);

  // ✅ Removed top-level totals (Weeks / Filled Hours / Shifts)

  return (
    <main
      style={{
        padding: 18,
        width: "100%",
        maxWidth: "none", // ✅ remove side bars
        margin: 0, // ✅ remove side bars
        background: UI.pageBg,
        minHeight: "100vh",
        color: UI.text,
      }}
    >
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26 }}>History</h1>
          <p style={{ marginTop: 6, fontSize: 13, color: UI.textDim }}>
            Pick a week (Sunday–Saturday) to view historical shifts. <strong>Showing last 12 weeks.</strong>
          </p>
        </div>

        <a href="/schedule" style={{ textDecoration: "underline", fontSize: 13, fontWeight: 900, color: UI.text }}>
          Back to Schedule
        </a>
      </header>

      {/* ✅ Search only (removed Weeks / Filled Hours / Shifts summary cards) */}
      <div style={{ marginTop: 10 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search week..."
          style={{
            width: 360,
            border: `1px solid ${UI.border}`,
            borderRadius: 12,
            padding: "8px 10px",
            fontSize: 13,
            outline: "none",
            background: UI.panelBg,
          }}
        />
      </div>

      {loading && <p style={{ marginTop: 12, color: UI.textDim }}>Loading…</p>}

      {!loading && error && (
        <pre
          style={{
            marginTop: 12,
            background: UI.panelBg,
            border: `1px solid ${UI.border}`,
            borderRadius: 12,
            padding: 12,
            color: "salmon",
            whiteSpace: "pre-wrap",
          }}
        >
          {error}
        </pre>
      )}

      {!loading && !error && (
        <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
          {filtered.map((w) => (
            <a
              key={w.weekStart}
              href={`/history/${encodeURIComponent(w.weekStart)}`}
              style={{
                display: "block",
                background: UI.panelBg,
                border: `1px solid ${UI.borderSoft}`,
                borderRadius: 12,
                padding: 12,
                textDecoration: "none",
                color: UI.text,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
                <div style={{ fontSize: 16, fontWeight: 950 }}>{w.label}</div>

                {/* ✅ Keep per-week stats on the card */}
                <div style={{ display: "flex", gap: 14, alignItems: "baseline" }}>
                  <div style={{ fontSize: 12, color: UI.textDim, fontWeight: 900 }}>shifts: {w.count}</div>
                  <div style={{ fontSize: 12, color: UI.textDim, fontWeight: 900 }}>
                    filled hrs: {fmtHours(w.filledHours)}
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 6, fontSize: 12, color: UI.textDim, fontWeight: 900 }}>
                weekStart: <code>{w.weekStart}</code>
              </div>
            </a>
          ))}
        </div>
      )}
    </main>
  );
}

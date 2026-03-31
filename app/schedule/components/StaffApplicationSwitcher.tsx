"use client";

import React, { useMemo, useState } from "react";

function norm(v: any) {
  return (v ?? "").toString().trim();
}
function normLower(v: any) {
  return norm(v).toLowerCase();
}
function includesCI(hay: string, needle: string) {
  return hay.toLowerCase().includes(needle.toLowerCase());
}

type ApplicantRow = Record<string, any> & { __key?: string; __rowNumber?: number };

function daysSince(d: Date) {
  const ms = Date.now() - d.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function parseDateLoose(v: any): Date | null {
  const s = norm(v);
  if (!s) return null;

  // Try ISO
  const iso = new Date(s);
  if (!Number.isNaN(iso.getTime())) return iso;

  // Try m/d/yy or m/d/yyyy
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const mm = Number(m[1]);
    const dd = Number(m[2]);
    let yy = Number(m[3]);
    if (yy < 100) yy = 2000 + yy;
    const d = new Date(yy, mm - 1, dd);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  return null;
}

/**
 * ✅ Applicant scoring: 0–10
 * Tune these weights any time without changing UI.
 */
export function scoreApplicant(row: ApplicantRow): number {
  let score = 0;

  const cert = normLower(row["Certification"] ?? row["Certifications"] ?? "");
  const vaccinated = normLower(row["Vaccinated"] ?? "");
  const availability = normLower(row["Availability"] ?? "");
  const status = normLower(row["Status"] ?? "");
  const onboarding = normLower(row["Onboarding Stage"] ?? "");

  // Certification (0–3)
  if (includesCI(cert, "cna")) score += 3;
  else if (includesCI(cert, "hha") || includesCI(cert, "pca")) score += 2;
  else if (cert) score += 1;

  // Vaccinated (0–1)
  if (vaccinated === "yes" || vaccinated === "true") score += 1;

  // Availability keywords (0–3)
  if (includesCI(availability, "open") || includesCI(availability, "flex")) score += 2;
  if (includesCI(availability, "overnight") || includesCI(availability, "weekend")) score += 1;

  // Interview recency (0–2)
  const di = parseDateLoose(row["Date Interviewed"]);
  if (di) {
    const d = daysSince(di);
    if (d <= 7) score += 2;
    else if (d <= 21) score += 1.5;
    else if (d <= 45) score += 1;
  }

  // Status / stage signal (0–2)
  // (You can adjust these strings to match your exact sheet values.)
  if (includesCI(status, "hired") || includesCI(status, "active")) score += 2;
  else if (includesCI(status, "interview")) score += 1;

  if (includesCI(onboarding, "ready") || includesCI(onboarding, "completed")) score += 1;

  // Clamp to 0–10 and round to 0.5 steps
  score = Math.max(0, Math.min(10, score));
  return Math.round(score * 2) / 2;
}

function scoreColor(score: number) {
  // Matches your Applicants page scale: 0 red, 5 yellow, 10 green
  if (score >= 8) return "#16a34a";
  if (score >= 5) return "#ca8a04";
  return "#dc2626";
}

function Segmented({
  value,
  onChange,
}: {
  value: "staff" | "applicants";
  onChange: (v: "staff" | "applicants") => void;
}) {
  const btn = (v: "staff" | "applicants", label: string) => {
    const active = value === v;
    return (
      <button
        type="button"
        onClick={() => onChange(v)}
        style={{
          border: "1px solid rgba(15,23,42,0.20)",
          background: active ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.35)",
          borderRadius: 10,
          padding: "6px 10px",
          fontWeight: 950,
          cursor: "pointer",
          color: "#0b1220",
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      {btn("staff", "Staff")}
      {btn("applicants", "Applicants")}
    </div>
  );
}

export default function StaffApplicantsSwitcher({
  staffView,
  applicants,
}: {
  staffView: React.ReactNode;
  applicants: ApplicantRow[];
}) {
  const [mode, setMode] = useState<"staff" | "applicants">("staff");
  const [q, setQ] = useState("");
  const [minScore, setMinScore] = useState(0);

  const scored = useMemo(() => {
    const rows = applicants || [];
    return rows.map((r, idx) => {
      const s = scoreApplicant(r);
      return { row: r, score: s, __idx: idx };
    });
  }, [applicants]);

  const filtered = useMemo(() => {
    const qq = normLower(q);
    return scored
      .filter(({ row, score }) => {
        if (score < minScore) return false;
        if (!qq) return true;
        const name = `${norm(row["First Name"])} ${norm(row["Last Name"])}`.trim();
        const phone = norm(row["Phone Number"]);
        const addr = norm(row["Address"]);
        return (
          includesCI(name, qq) ||
          includesCI(phone, qq) ||
          includesCI(addr, qq) ||
          includesCI(norm(row["Availability"]), qq) ||
          includesCI(norm(row["Certification"]), qq)
        );
      })
      .sort((a, b) => b.score - a.score);
  }, [scored, q, minScore]);

  return (
    <div style={{ padding: 12 }}>
      {/* Top switch + filters */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <Segmented value={mode} onChange={setMode} />

        {mode === "applicants" ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search applicants…"
              style={{
                border: "1px solid rgba(15,23,42,0.18)",
                borderRadius: 10,
                padding: "7px 10px",
                minWidth: 220,
              }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>Min Score</div>
              <input
                type="range"
                min={0}
                max={10}
                step={0.5}
                value={minScore}
                onChange={(e) => setMinScore(Number(e.target.value))}
              />
              <div style={{ fontSize: 12, fontWeight: 950, width: 34, textAlign: "right" }}>{minScore}</div>
            </div>
          </div>
        ) : null}
      </div>

      <div style={{ height: 10 }} />

      {/* Body */}
      {mode === "staff" ? (
        staffView
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {filtered.map(({ row, score, __idx }) => {
            const name = `${norm(row["First Name"])} ${norm(row["Last Name"])}`.trim() || "Unnamed Applicant";
            const key = row.__key || row["Interview ID"] || `${name}:${row["Phone Number"] || ""}:${__idx}`;

            return (
              <div
                key={key}
                style={{
                  border: "1px solid rgba(15,23,42,0.14)",
                  borderRadius: 14,
                  padding: 12,
                  background: "#fff",
                  boxShadow: "0 6px 18px rgba(15,23,42,0.06)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ fontWeight: 950, color: "#0f172a" }}>{name}</div>
                  <div
                    style={{
                      fontWeight: 950,
                      color: "white",
                      background: scoreColor(score),
                      borderRadius: 999,
                      padding: "4px 10px",
                      fontSize: 12,
                    }}
                    title="Applicant score (0–10)"
                  >
                    {score.toFixed(1)}
                  </div>
                </div>

                <div style={{ height: 8 }} />

                <div style={{ display: "grid", gap: 6, fontSize: 12, color: "#334155" }}>
                  <div>
                    <b>Cert:</b> {norm(row["Certification"])}
                  </div>
                  <div>
                    <b>Avail:</b> {norm(row["Availability"])}
                  </div>
                  <div>
                    <b>Status:</b> {norm(row["Status"])} {norm(row["Onboarding Stage"]) ? `• ${norm(row["Onboarding Stage"])}` : ""}
                  </div>
                  <div>
                    <b>Phone:</b> {norm(row["Phone Number"])}
                  </div>
                  <div>
                    <b>Interviewed:</b> {norm(row["Date Interviewed"])}
                  </div>
                </div>
              </div>
            );
          })}

          {filtered.length === 0 ? (
            <div style={{ padding: 14, color: "#64748b", fontWeight: 800 }}>No applicants match your filters.</div>
          ) : null}
        </div>
      )}
    </div>
  );
}
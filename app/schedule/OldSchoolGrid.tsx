"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";

type Cell = { a1: string; value: string; fontColor: string };
type GridRow = {
  row: number;
  clientName: string;
  clientA1: string;
  cells: Cell[];
};

type GridResponse = {
  ok: boolean;
  headers: { dayHeaders: string[]; dateHeaders: string[] };
  body: { rows: GridRow[] };
  error?: string;
};

// ✅ Match your Sheets status types + colors
type ShiftStatus =
  | "filled"
  | "offered"
  | "offering"
  | "considering"
  | "open"
  | "canceled"
  | "pending"
  | "none";

const SHEET_COLORS: Record<ShiftStatus, string> = {
  filled: "#00FF00",
  offered: "#0000FF",
  offering: "#49c9f2",
  considering: "#FFA500",
  open: "#FF0000",
  canceled: "#000000",
  pending: "#800080",
  none: "#000000",
};

// Worst-first priority (matches how you described “worst” per client)
function worstStatus(statuses: ShiftStatus[]): ShiftStatus {
  if (statuses.includes("open")) return "open";
  if (statuses.includes("considering")) return "considering";
  if (statuses.includes("offered")) return "offered";
  if (statuses.includes("offering")) return "offering";
  if (statuses.includes("pending")) return "pending";
  if (statuses.includes("canceled")) return "canceled";
  if (statuses.includes("filled")) return "filled";
  return "none";
}

// Normalize smart quotes the same way you do in Sheets
function normalizeCellText(raw: unknown): string {
  const s = String(raw ?? "");
  return s.replace(/[“”]/g, '"');
}

/**
 * ✅ EXACT SAME RULES as applyShiftColorFormatting() (ported to TS)
 */
function statusFromCellValue(raw: unknown): ShiftStatus {
  const cellValue = normalizeCellText(raw).trim();
  if (!cellValue) return "none";

  // same marker rules (order matters!)
  if (cellValue.includes("*")) return "canceled";
  if (cellValue.includes("$")) return "pending";
  if (cellValue.includes("^")) return "offering";
  if (cellValue.includes('"')) return "offered";
  if (cellValue.includes("(")) return "considering";

  // Filled: "Name, 7:00AM-10:00AM"
  const filledRegex =
    /^[^,*\$\(\)\^"]+,\s?\d{1,2}:\d{2}\s?[APMapm]{2}-\d{1,2}:\d{2}\s?[APMapm]{2}$/;

  // Open: "7:00AM-10:00AM"
  const openRegex =
    /^\d{1,2}:\d{2}\s?[APMapm]{2}-\d{1,2}:\d{2}\s?[APMapm]{2}$/;

  if (filledRegex.test(cellValue)) return "filled";
  if (openRegex.test(cellValue)) return "open";

  return "none";
}

function normalizeHex(hex?: string) {
  if (!hex) return "";
  let h = hex.trim().toLowerCase();
  if (!h.startsWith("#")) h = "#" + h;
  return h;
}

/**
 * POST to your Next route, which proxies to Apps Script doPost(action=updateCellByA1).
 * We do NOT require sending fontColor; the sheet script can recolor on its side.
 */
async function updateCell(a1: string, value: string) {
  const payload = { action: "updateCellByA1", a1, value };

  const r = await fetch("/api/current-week", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Update failed (${r.status}): ${text}`);
  }

  const j = await r.json();
  if (!j?.ok) throw new Error(j?.error ?? "Update failed");
  return j;
}

const HEADER_ROW_HEIGHT = 38;

const thStyleBase: CSSProperties = {
  background: "#fafafa",
  borderBottom: "1px solid #ddd",
  padding: "8px 10px",
  textAlign: "left",
  fontWeight: 700,
  whiteSpace: "nowrap",
  zIndex: 5,
};

const thStyleTopRow: CSSProperties = {
  position: "sticky",
  top: 0,
};

const thStyleSecondRow: CSSProperties = {
  position: "sticky",
  top: HEADER_ROW_HEIGHT,
  zIndex: 4,
};

const tdStyle: CSSProperties = {
  borderTop: "1px solid #eee",
  padding: "6px 10px",
  verticalAlign: "top",
  whiteSpace: "pre-wrap",
};

export default function OldSchoolGrid() {
  const [data, setData] = useState<GridResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // ✅ editing state
  const [editingA1, setEditingA1] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const [savingA1, setSavingA1] = useState<string | null>(null);

  async function load() {
    const r = await fetch("/api/current-week?action=getCurrentWeekGrid", {
      cache: "no-store",
    });

    if (!r.ok) {
      const text = await r.text();
      throw new Error(`API ${r.status}: ${text}`);
    }

    const j = (await r.json()) as GridResponse;
    setData(j);
  }

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setLoading(true);
        await load();
      } catch (e: any) {
        if (alive) {
          setData({
            ok: false,
            error: e?.message ?? "Fetch failed",
            headers: { dayHeaders: [], dateHeaders: [] },
            body: { rows: [] },
          });
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = useMemo(() => data?.body?.rows ?? [], [data]);

  /**
   * ✅ Build per-client worst status map
   * based on the SAME parsing rules as Sheets.
   */
  const clientWorstStatus = useMemo(() => {
    const map = new Map<string, ShiftStatus>();

    for (const r of rows) {
      const name = (r.clientName ?? "").trim();
      if (!name) continue;

      const statusesForRow = r.cells
        .map((c) => statusFromCellValue(c.value))
        .filter((s) => s !== "none");

      const rowWorst = statusesForRow.length ? worstStatus(statusesForRow) : "none";

      const prev = map.get(name);
      if (!prev) map.set(name, rowWorst);
      else map.set(name, worstStatus([prev, rowWorst]));
    }

    return map;
  }, [rows]);

  if (loading) return <div style={{ padding: 16 }}>Loading Current Week…</div>;
  if (!data?.ok) {
    return (
      <div style={{ padding: 16, color: "red" }}>
        Error: {data?.error ?? "Unknown error"}
      </div>
    );
  }

  const dayHeaders = data.headers.dayHeaders;
  const dateHeaders = data.headers.dateHeaders;

  // Group-zebra toggles only when clientName changes
  let lastClient = "";
  let groupIndex = -1;

  return (
    <div
      style={{
        padding: 12,
        background: "#ffffff",
        minHeight: "100vh",
        color: "#000000",
      }}
    >
      <div
        style={{
          overflow: "auto",
          border: "1px solid #ddd",
          borderRadius: 8,
          background: "#ffffff",
          maxHeight: "calc(100vh - 24px)",
        }}
      >
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 1100 }}>
          <thead>
            <tr>
              {dayHeaders.map((h, i) => (
                <th
                  key={i}
                  style={{
                    ...thStyleBase,
                    ...thStyleTopRow,
                    borderRight: i === dayHeaders.length - 1 ? "none" : "1px solid #ddd",
                  }}
                >
                  {h || ""}
                </th>
              ))}
            </tr>

            <tr>
              {dateHeaders.map((h, i) => (
                <th
                  key={i}
                  style={{
                    ...thStyleBase,
                    ...thStyleSecondRow,
                    borderRight: i === dateHeaders.length - 1 ? "none" : "1px solid #ddd",
                  }}
                >
                  {h || ""}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {rows.map((r) => {
              const name = (r.clientName ?? "").trim();

              if (name !== lastClient) {
                groupIndex += 1;
                lastClient = name;
              }

              const groupBg = groupIndex % 2 === 0 ? "#ffffff" : "#f3f4f6";

              const status = name ? clientWorstStatus.get(name) ?? "none" : "none";
              const clientColor = SHEET_COLORS[status];

              return (
                <tr key={r.row} style={{ background: groupBg }}>
                  {/* Client Name column */}
                  <td
                    style={{
                      ...tdStyle,
                      fontWeight: 700,
                      whiteSpace: "nowrap",
                      color: clientColor,
                      background: groupBg,
                      borderRight: "1px solid #ddd",
                    }}
                    title={status === "none" ? undefined : `Status: ${status}`}
                  >
                    {r.clientName}
                  </td>

                  {/* B–H editable cells */}
                  {r.cells.map((c, i) => {
                    const isEditing = editingA1 === c.a1;
                    const isSaving = savingA1 === c.a1;

                    // ✅ compute cell display color from VALUE using sheet rules
                    const cellStatus = statusFromCellValue(c.value);
                    const cellColor = SHEET_COLORS[cellStatus];

                    return (
                      <td
                        key={c.a1}
                        style={{
                          ...tdStyle,
                          color: cellColor || "#000000",
                          background: groupBg,
                          borderRight: i === r.cells.length - 1 ? "none" : "1px solid #ddd",
                          cursor: "text",
                        }}
                        onClick={() => {
                          setEditingA1(c.a1);
                          setDraftValue(String(c.value ?? ""));
                        }}
                      >
                        {isEditing ? (
                          <input
                            autoFocus
                            value={draftValue}
                            onChange={(e) => setDraftValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Escape") {
                                setEditingA1(null);
                                return;
                              }
                              if (e.key === "Enter") {
                                (e.currentTarget as HTMLInputElement).blur();
                              }
                            }}
                            onBlur={async () => {
                              const newVal = draftValue;

                              if (String(c.value ?? "") === newVal) {
                                setEditingA1(null);
                                return;
                              }

                              try {
                                setSavingA1(c.a1);

                                // ✅ save to Sheet
                                await updateCell(c.a1, newVal);

                                // ✅ optimistic update local value
                                setData((prev) => {
                                  if (!prev?.ok) return prev;
                                  const next = structuredClone(prev);
                                  for (const row of next.body.rows) {
                                    const cell = row.cells.find((x) => x.a1 === c.a1);
                                    if (cell) cell.value = newVal;
                                  }
                                  return next;
                                });

                                // ✅ then re-fetch to guarantee it matches the Sheet
                                await load();
                              } catch (err: any) {
                                alert(err?.message ?? "Save failed");
                              } finally {
                                setSavingA1(null);
                                setEditingA1(null);
                              }
                            }}
                            style={{
                              width: "100%",
                              boxSizing: "border-box",
                              padding: "6px 8px",
                              border: "1px solid #bbb",
                              borderRadius: 6,
                              font: "inherit",
                              color: "#000000",
                              background: "#ffffff",
                            }}
                            disabled={isSaving}
                          />
                        ) : (
                          <span style={{ opacity: isSaving ? 0.5 : 1 }}>{c.value}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// app/schedule/components/ClientProfileModal.tsx
"use client";

import React from "react";
import type { ClientCaregiverHistoryItem, ClientProfile } from "./clientProfileModel";

function norm(v: any) {
  return (v ?? "").toString().trim();
}
function normalizeKey(v: string) {
  return norm(v).toLowerCase();
}

export function ClientProfileModal({
  open,
  onClose,
  ui,
  clientName,
  clientsByName,
  clientsLoading,
  clientsError,
  histLoading,
  histError,
  clientCaregiverHistory,
  caregiversById,
}: {
  open: boolean;
  onClose: () => void;

  // pass your UI palette from CWWebSchedule so it stays consistent
  ui: {
    panelBg: string;
    headerBg: string;
    border: string;
    borderSoft: string;
    text: string;
    textDim: string;
  };

  clientName: string;
  clientsByName: Record<string, ClientProfile>;
  clientsLoading: boolean;
  clientsError: string | null;

  histLoading: boolean;
  histError: string | null;
  clientCaregiverHistory: ClientCaregiverHistoryItem[];

  caregiversById: Record<string, { certification?: string }>;
}) {
  if (!open) return null;

  const key = normalizeKey(clientName);
  const p = key ? clientsByName[key] : undefined;

  const name = p?.name || clientName || "Client";
  const address = norm(p?.address);
  const description = norm(p?.description);
  const rate = norm(p?.rate);

  return (
    <div
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(17,24,39,0.42)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
        zIndex: 9999,
      }}
    >
      <div
        style={{
          width: "min(780px, 96vw)",
          background: ui.panelBg,
          border: `1px solid ${ui.border}`,
          borderRadius: 14,
          overflow: "hidden",
          boxShadow: "0 12px 34px rgba(0,0,0,0.22)",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: 12,
            background: ui.headerBg,
            borderBottom: `1px solid ${ui.borderSoft}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 10,
          }}
        >
          <div style={{ fontWeight: 950, fontSize: 14 }}>Client Profile • {name}</div>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: `1px solid ${ui.border}`,
              background: ui.panelBg,
              borderRadius: 10,
              padding: "6px 10px",
              cursor: "pointer",
              fontWeight: 900,
              fontSize: 13,
            }}
          >
            Close
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 12 }}>
          <div style={{ maxHeight: "70vh", overflowY: "auto", paddingRight: 6 }}>
            <div style={{ display: "grid", gap: 14 }}>
              {/* Client Details */}
              <div
                style={{
                  border: `1px solid ${ui.borderSoft}`,
                  borderRadius: 14,
                  padding: 12,
                  background: "rgba(255,255,255,0.9)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 950, color: ui.textDim }}>Client</div>
                    <div
                      style={{
                        marginTop: 2,
                        fontSize: 18,
                        fontWeight: 1000,
                        letterSpacing: 0.2,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={name}
                    >
                      {name}
                    </div>
                  </div>

                  {rate ? (
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 950,
                        padding: "6px 10px",
                        borderRadius: 999,
                        border: `1px solid ${ui.borderSoft}`,
                        background: "#f8fafc",
                        color: ui.text,
                        whiteSpace: "nowrap",
                      }}
                      title="Hourly rate"
                    >
                      Rate: {rate}
                    </div>
                  ) : null}
                </div>

                <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 11.5, fontWeight: 950, color: ui.textDim }}>Address</div>
                    {address ? (
                      <div style={{ marginTop: 3, fontSize: 13, fontWeight: 850, color: ui.text, whiteSpace: "pre-wrap" }}>
                        {address}
                      </div>
                    ) : (
                      <div style={{ marginTop: 3, fontSize: 13, color: "#9ca3af", fontWeight: 850 }}>—</div>
                    )}
                  </div>

                  <div>
                    <div style={{ fontSize: 11.5, fontWeight: 950, color: ui.textDim }}>Description</div>
                    {description ? (
                      <div style={{ marginTop: 3, fontSize: 13, color: ui.text, whiteSpace: "pre-wrap", lineHeight: 1.35 }}>
                        {description}
                      </div>
                    ) : (
                      <div style={{ marginTop: 3, fontSize: 13, color: "#9ca3af", fontWeight: 850 }}>—</div>
                    )}
                  </div>

                  <div style={{ marginTop: 2, fontSize: 11.5, color: ui.textDim, lineHeight: 1.3 }}>
                    {clientsLoading ? (
                      <span>Client details: loading…</span>
                    ) : clientsError ? (
                      <span style={{ color: "salmon", fontWeight: 900 }}>Client details error: {clientsError}</span>
                    ) : p ? (
                      <span>Client details: loaded from Clients sheet.</span>
                    ) : (
                      <span style={{ color: "salmon", fontWeight: 900 }}>
                        Client details not found in Clients sheet for: <strong>{clientName}</strong>
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Caregiver History */}
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 950, color: ui.textDim }}>Caregivers who have been here</div>

                {histLoading ? (
                  <div style={{ fontSize: 13, color: ui.textDim }}>Loading history…</div>
                ) : histError ? (
                  <div style={{ fontSize: 13, color: "salmon", fontWeight: 800 }}>{histError}</div>
                ) : clientCaregiverHistory.length === 0 ? (
                  <div style={{ fontSize: 13, color: ui.textDim }}>No historical visits found in the loaded window.</div>
                ) : (
                  <div style={{ display: "grid", gap: 8 }}>
                    {clientCaregiverHistory.slice(0, 20).map((h) => {
                      const prof = h.caregiverId ? caregiversById[h.caregiverId] : undefined;
                      const cert = norm(prof?.certification);
                      const certOk = cert && cert.toLowerCase() !== "none";

                      return (
                        <div
                          key={(h.caregiverId || h.caregiverName) + "::" + h.lastDate}
                          style={{
                            border: `1px solid ${ui.borderSoft}`,
                            borderRadius: 12,
                            padding: "8px 10px",
                            background: "rgba(255,255,255,0.85)",
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 10,
                            alignItems: "baseline",
                          }}
                        >
                          <div style={{ minWidth: 0 }}>
                            <div
                              style={{
                                fontWeight: 950,
                                fontSize: 13,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {h.caregiverName}
                              {certOk ? (
                                <span
                                  style={{
                                    marginLeft: 8,
                                    fontSize: 11,
                                    fontWeight: 900,
                                    padding: "2px 8px",
                                    borderRadius: 999,
                                    border: `1px solid ${ui.borderSoft}`,
                                    background: "#f8fafc",
                                    color: ui.textDim,
                                    whiteSpace: "nowrap",
                                  }}
                                  title="Certification"
                                >
                                  {cert}
                                </span>
                              ) : null}
                            </div>

                            <div style={{ marginTop: 2, fontSize: 11.5, color: ui.textDim }}>
                              Last visit: <strong>{h.lastDate || "—"}</strong>
                              {h.caregiverId ? <span style={{ marginLeft: 8 }}>ID: {h.caregiverId}</span> : null}
                            </div>
                          </div>

                          <div style={{ fontSize: 12, fontWeight: 950, whiteSpace: "nowrap" }}>
                            {h.visitCount} visit{h.visitCount === 1 ? "" : "s"}
                          </div>
                        </div>
                      );
                    })}

                    {clientCaregiverHistory.length > 20 ? (
                      <div style={{ fontSize: 12, color: ui.textDim }}>
                        Showing top 20 (of {clientCaregiverHistory.length}) by visits/recentness.
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

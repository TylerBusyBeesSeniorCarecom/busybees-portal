"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  buildShiftSaveToast,
  parseShiftTextForFeedback,
  type ShiftConflictMatch,
  type ShiftSaveCaregiverInput,
} from "@/app/schedule/utils/shiftSaveFeedback";
import BulkEditPanel from "./BulkEditPanel";
import type { BulkSelectedCell } from "./bulkEdit.types";
import FloatingPanel from "./FloatingPanel";
import { useSheetsToolsShared } from "../SheetsToolsSharedProvider";
import {
  buildConflictSummary,
  buildShiftLookupFromRows,
  dateKey,
  makeCellEditHistoryKey,
  normalizeKey,
  norm,
  parseFirstTimeRange,
  reconcileScheduleRowsForCell,
  SHEET_COLORS,
  toYmd,
  UI,
  updateCell,
  logAndSaveScheduleEdit,
  type CellEditHistoryPresenceMap,
  type GridResponse,
  type SaveToast,
  type ShiftRow,
  type WeekKind,
} from "../shared";
import { useFloatingWindows } from "../useFloatingWindows";
import {
  consumeBulkEditMessageHandoff,
  logBulkEditPerf,
  useBulkEditMessageHandoff,
  type BulkEditMessageHandoff,
} from "../bulkEditHandoff";
import {
  parseBulkShiftCell,
  parseBulkCaregiverFromCell,
  statusFromBulkCellValue,
} from "../utils/bulkShiftParsing";

export default function BulkEditToolPanel() {
  const {
    caregiversById,
    currentUserEmail,
    currentUserName,
    cwGrid,
    cwLoaded,
    cwScheduleRows,
    cwShiftIdLookup,
    idByNameOnSchedule,
    loadWeekBundle,
    nwGrid,
    nwLoaded,
    nwScheduleRows,
    nwShiftIdLookup,
    refreshCaregivers,
    refreshScheduleStateInBackground,
  } = useSheetsToolsShared();
  const { panels, openPanel } = useFloatingWindows();
  const panel = panels["bulk-edit"];
  const incomingHandoff = useBulkEditMessageHandoff();
  const panelOpenLoggedRef = useRef(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<GridResponse | null>(null);
  const [scheduleRows, setScheduleRows] = useState<ShiftRow[]>([]);
  const [shiftIdLookup, setShiftIdLookup] = useState<Record<string, string>>({});
  const [saveToast, setSaveToast] = useState<SaveToast | null>(null);
  const [messageHandoff, setMessageHandoff] = useState<BulkEditMessageHandoff | null>(null);
  const [selectedWeek, setSelectedWeek] = useState<WeekKind>("cw");
  const [savingA1Set, setSavingA1Set] = useState<Set<string>>(new Set());
  const [conflictHighlight, setConflictHighlight] = useState<{
    a1: string;
    conflicts: ShiftConflictMatch[];
  } | null>(null);
  const [cellEditHistoryPresence, setCellEditHistoryPresence] =
    useState<CellEditHistoryPresenceMap>({});

  useEffect(() => {
    if (!incomingHandoff) return;
    logBulkEditPerf("handoff received", incomingHandoff.perfStartAt, {
      week: incomingHandoff.week,
      shiftCount: incomingHandoff.shiftIDs.length,
    });
    setMessageHandoff(incomingHandoff);
    setSelectedWeek(incomingHandoff.week);
    void loadWeekBundle(incomingHandoff.week, { syncActive: true }).catch(() => {
      // The normal panel load effect still handles the visible error state.
    });
    openPanel("bulk-edit");
    consumeBulkEditMessageHandoff();
  }, [incomingHandoff, loadWeekBundle, openPanel]);

  useEffect(() => {
    if (!panel.open) {
      panelOpenLoggedRef.current = false;
      return;
    }
    if (panelOpenLoggedRef.current) return;
    panelOpenLoggedRef.current = true;
    if (messageHandoff?.perfStartAt) {
      logBulkEditPerf("panel mounted", messageHandoff.perfStartAt, {
        week: selectedWeek,
        cached: selectedWeek === "cw" ? cwLoaded : nwLoaded,
      });
    } else {
      console.log("[BulkEditPerf] panel mounted", {
        week: selectedWeek,
        cached: selectedWeek === "cw" ? cwLoaded : nwLoaded,
      });
    }
  }, [cwLoaded, messageHandoff?.perfStartAt, nwLoaded, panel.open, selectedWeek]);

  const draftMode = false;

  useEffect(() => {
    if (!panel.open) return;
    let cancelled = false;

    const syncFromShared = async () => {
      const loaded = selectedWeek === "cw" ? cwLoaded : nwLoaded;
      const nextGrid = selectedWeek === "cw" ? cwGrid : nwGrid;
      const nextRows = selectedWeek === "cw" ? cwScheduleRows : nwScheduleRows;
      const nextLookup = selectedWeek === "cw" ? cwShiftIdLookup : nwShiftIdLookup;

      if (loaded && nextGrid) {
        if (messageHandoff?.perfStartAt) {
          logBulkEditPerf("fetch skipped from cache", messageHandoff.perfStartAt, {
            week: selectedWeek,
          });
        }
        setData(nextGrid);
        setScheduleRows(nextRows);
        setShiftIdLookup(nextLookup);
        setLoading(false);
        setError(null);
        return;
      }

      try {
        if (messageHandoff?.perfStartAt) {
          logBulkEditPerf("fetch start", messageHandoff.perfStartAt, {
            week: selectedWeek,
          });
        }
        setLoading(true);
        setError(null);
        if (!Object.keys(caregiversById).length) {
          await refreshCaregivers();
        }
        await loadWeekBundle(selectedWeek, { syncActive: true });
        if (messageHandoff?.perfStartAt) {
          logBulkEditPerf("fetch finished", messageHandoff.perfStartAt, {
            week: selectedWeek,
          });
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message ?? "Failed to load bulk edit data.");
          setLoading(false);
        }
      }
    };

    void syncFromShared();
    return () => {
      cancelled = true;
    };
  }, [
    caregiversById,
    cwGrid,
    cwLoaded,
    cwScheduleRows,
    cwShiftIdLookup,
    loadWeekBundle,
    messageHandoff?.perfStartAt,
    nwGrid,
    nwLoaded,
    nwScheduleRows,
    nwShiftIdLookup,
    panel.open,
    refreshCaregivers,
    selectedWeek,
  ]);

  useEffect(() => {
    if (!saveToast) return;
    if (saveToast.kind === "loading") return;
    const timer = window.setTimeout(() => {
      setSaveToast((prev) => (prev?.id === saveToast.id ? null : prev));
    }, 60000);
    return () => window.clearTimeout(timer);
  }, [saveToast]);

  const shiftSaveCaregivers = useMemo<ShiftSaveCaregiverInput[]>(() => {
    return Object.values(caregiversById).map((caregiver) => ({
      caregiverId: caregiver.caregiverId,
      nameOnSchedule: caregiver.nameOnSchedule,
      name: caregiver.name,
      status: caregiver.status,
    }));
  }, [caregiversById]);

  const weekStartYmd = useMemo(() => {
    const sunday = norm(data?.headers?.dateHeaders?.[1]);
    return toYmd(sunday) || "";
  }, [data?.headers?.dateHeaders]);

  const visibleBulkCandidates = useMemo(() => {
    if (!data?.ok) return [];

    const rows = data.body.rows ?? [];
    const dayHeaders = data.headers?.dayHeaders ?? ["Client Name"];
    const dateHeaders = data.headers?.dateHeaders ?? ["Date"];
    const out: BulkSelectedCell[] = [];

    for (const row of rows) {
      const clientName = norm(row.clientName);

      for (let dow = 0; dow < 7; dow += 1) {
        const cell = row.cells[dow];
        const a1 = cell?.a1 || "";
        const originalValue = norm(cell?.value);
        if (!a1 || !originalValue) continue;

        out.push({
          a1,
          week: selectedWeek,
          clientName,
          dateStr: norm(dateHeaders[dow + 1]),
          dayLabel: dayHeaders[dow + 1] || "",
          originalValue,
        });
      }
    }

    return out;
  }, [data, selectedWeek]);

  const markCellSaving = useCallback((a1: string) => {
    setSavingA1Set((prev) => {
      const next = new Set(prev);
      next.add(a1);
      return next;
    });
  }, []);

  const unmarkCellSaving = useCallback((a1: string) => {
    setSavingA1Set((prev) => {
      const next = new Set(prev);
      next.delete(a1);
      return next;
    });
  }, []);

  const markCellHasEditHistory = useCallback(
    (args: { week: WeekKind; a1: string; clientName: string; dateStr: string }) => {
      const key = makeCellEditHistoryKey(args);
      setCellEditHistoryPresence((prev) => ({
        ...prev,
        [key]: true,
      }));
    },
    []
  );

  const syncLocalScheduleRowsForCell = useCallback(
    (args: {
      clientName: string;
      dateStr: string;
      oldValue: string;
      newValue: string;
      preserveShiftIds?: string[];
    }) => {
      setScheduleRows((prev) => {
        const nextRows = reconcileScheduleRowsForCell({
          currentRows: prev,
          clientName: args.clientName,
          dateStr: args.dateStr,
          oldValue: args.oldValue,
          newValue: args.newValue,
          idByNameOnSchedule,
          preserveShiftIds: args.preserveShiftIds,
        });
        setShiftIdLookup(buildShiftLookupFromRows(nextRows));
        return nextRows;
      });
    },
    [idByNameOnSchedule]
  );

  const updateLocalGridCellValue = useCallback((a1: string, value: string) => {
    setData((prev) => {
      if (!prev?.ok) return prev;
        const next = structuredClone(prev);

      for (const row of next.body.rows) {
        const cell = row.cells.find((item) => item.a1 === a1);
        if (!cell) continue;
        cell.value = value;
        cell.fontColor = (SHEET_COLORS[statusFromBulkCellValue(value)] || "#111827").toLowerCase();
        break;
      }

      return next;
    });
  }, []);

  const setDraftCell = useCallback(
    (_args: {
      a1: string;
      week: "cw" | "nw";
      originalValue: string;
      draftValue: string;
      clientName?: string;
      dateStr?: string;
      dayLabel?: string;
    }) => {},
    []
  );

  const saveInlineEdit = useCallback(
    async (args: {
      a1: string;
      newVal: string;
      clientName: string;
      shiftDateForSave: string;
      dayLabel: string;
      weekOf?: string;
      backgroundRefresh?: boolean;
      keepOpenIfUnchanged?: boolean;
    }): Promise<boolean> => {
      const {
        a1,
        newVal,
        clientName,
        shiftDateForSave,
        dayLabel,
        weekOf,
        backgroundRefresh = true,
      } = args;

      let oldVal = "";
      const snapshot = data;

      if (snapshot?.ok) {
        for (const row of snapshot.body.rows) {
          const cell = row.cells.find((item) => item.a1 === a1);
          if (cell) {
            oldVal = norm(cell.value);
            break;
          }
        }
      }

      if (norm(oldVal) === norm(newVal)) {
        return true;
      }

      if (draftMode) {
        setDraftCell({
          a1,
          week: selectedWeek,
          originalValue: oldVal,
          draftValue: newVal,
          clientName,
          dateStr: shiftDateForSave,
          dayLabel,
        });
        return true;
      }

      const oldTimeRange = parseFirstTimeRange(oldVal);
      const newTimeRange = parseFirstTimeRange(newVal);
      const oldCaregiverName = parseBulkCaregiverFromCell(oldVal);
      const newCaregiverName = parseBulkCaregiverFromCell(newVal);
      const oldStatus = statusFromBulkCellValue(oldVal);
      const newStatus = statusFromBulkCellValue(newVal);
      const oldStatusLabel = oldStatus === "none" ? "" : oldStatus;
      const newStatusLabel = newStatus === "none" ? "" : newStatus;

      const actionType =
        !norm(oldVal) && norm(newVal)
          ? "Created Shift"
          : norm(oldVal) && !norm(newVal)
          ? "Deleted Shift"
          : "Edited Shift";

      const logTimestamp = new Date().toISOString();

      const currentShiftId =
        scheduleRows.find((shift) => {
          const rowDateKey = dateKey(shift.date);
          const targetDateKey = dateKey(shiftDateForSave);

          return (
            rowDateKey === targetDateKey &&
            normalizeKey(shift.client) === normalizeKey(clientName) &&
            normalizeKey(shift.caregiver) === normalizeKey(oldCaregiverName) &&
            norm(shift.startTime).replace(/\s+/g, "").toUpperCase() ===
              norm(oldTimeRange?.start).replace(/\s+/g, "").toUpperCase() &&
            norm(shift.endTime).replace(/\s+/g, "").toUpperCase() ===
              norm(oldTimeRange?.end).replace(/\s+/g, "").toUpperCase()
          );
        })?.shiftId || "";

      const parsed = parseShiftTextForFeedback(newVal, shiftSaveCaregivers, {
        currentShiftId,
        shiftDate: shiftDateForSave,
        existingShifts: scheduleRows.map((shift) => ({
          shiftId: shift.shiftId,
          date: shift.date,
          caregiverId: shift.caregiverId,
          caregiverName: shift.caregiver,
          startTime: shift.startTime,
          endTime: shift.endTime,
          status: shift.status,
          client: shift.client,
        })),
      });

      const notesParts: string[] = [];
      if (parsed.warnings?.length) {
        notesParts.push(`Warnings: ${parsed.warnings.join(" | ")}`);
      }
      if (parsed.errors?.length) {
        notesParts.push(`Errors: ${parsed.errors.join(" | ")}`);
      }
      if (parsed.conflictMatches?.length) {
        notesParts.push(`Conflicts: ${buildConflictSummary(parsed.conflictMatches)}`);
      }

      const toastModel = buildShiftSaveToast(parsed);
      const logNotes = notesParts.join(" || ");
      const normalizedOldVal = parseBulkShiftCell(oldVal).normalizedText ?? oldVal;
      const normalizedNewVal = parseBulkShiftCell(newVal).normalizedText ?? newVal;

      try {
        markCellSaving(a1);
        setConflictHighlight(null);
        updateLocalGridCellValue(a1, newVal);

        syncLocalScheduleRowsForCell({
          clientName,
          dateStr: shiftDateForSave,
          oldValue: normalizedOldVal,
          newValue: normalizedNewVal,
          preserveShiftIds: currentShiftId ? [currentShiftId] : [],
        });

        await updateCell(selectedWeek, a1, newVal);

        try {
          await logAndSaveScheduleEdit({
            timestamp: logTimestamp,
            user: currentUserName,
            userEmail: currentUserEmail,
            actionType,
            weekType: selectedWeek,
            weekOf,
            date: shiftDateForSave,
            client: clientName,
            oldValue: oldVal,
            newValue: newVal,
            cell: a1,
            day: dayLabel,
            oldStatus: oldStatusLabel,
            newStatus: newStatusLabel,
            oldCaregiver: oldCaregiverName,
            newCaregiver: newCaregiverName,
            oldStartTime: oldTimeRange?.start ?? "",
            newStartTime: newTimeRange?.start ?? "",
            oldEndTime: oldTimeRange?.end ?? "",
            newEndTime: newTimeRange?.end ?? "",
            notes: logNotes,
            accessPoint: "SheetsTools bulk edit",
          });
        } catch (logError: any) {
          console.warn("[BulkEditConfirm] schedule edit log failed after successful write", {
            a1,
            clientName,
            dayLabel,
            error: logError?.message ?? logError,
          });
        }

        markCellHasEditHistory({
          week: selectedWeek,
          a1,
          clientName,
          dateStr: shiftDateForSave,
        });

        if (backgroundRefresh) {
          await refreshScheduleStateInBackground({
            includeGrid: true,
            includeEditLog: true,
          });
        }

        if (parsed.conflictMatches.length > 0) {
          setConflictHighlight({
            a1,
            conflicts: parsed.conflictMatches,
          });
        } else {
          setConflictHighlight(null);
        }

        setSaveToast({
          id: Date.now(),
          kind: toastModel.kind,
          title: toastModel.title,
          lines: toastModel.lines,
        });

        return true;
      } catch (err: any) {
        updateLocalGridCellValue(a1, oldVal);

        syncLocalScheduleRowsForCell({
          clientName,
          dateStr: shiftDateForSave,
          oldValue: normalizedNewVal,
          newValue: normalizedOldVal,
          preserveShiftIds: currentShiftId ? [currentShiftId] : [],
        });

        setSaveToast({
          id: Date.now(),
          kind: "error",
          title: "Save failed",
          lines: [
            err?.message ?? "The cell could not be updated.",
            "The cell was restored to its previous value.",
          ],
        });

        return false;
      } finally {
        unmarkCellSaving(a1);
      }
    },
    [
      currentUserEmail,
      currentUserName,
      data,
      draftMode,
      markCellHasEditHistory,
      markCellSaving,
      refreshScheduleStateInBackground,
      scheduleRows,
      selectedWeek,
      setDraftCell,
      shiftSaveCaregivers,
      syncLocalScheduleRowsForCell,
      unmarkCellSaving,
      updateLocalGridCellValue,
    ]
  );

  if (!panel.open) return null;

  return (
    <>
      {saveToast ? <SaveToastView saveToast={saveToast} onDismiss={() => setSaveToast(null)} /> : null}

      <FloatingPanel
        id="bulk-edit"
        title="Bulk Edit"
        onRefresh={() => {
          void refreshScheduleStateInBackground({ includeGrid: true, includeEditLog: true });
        }}
      >
        {loading ? (
          <PanelCenterMessage>Loading…</PanelCenterMessage>
        ) : error ? (
          <PanelErrorMessage
            error={error}
            onRetry={() => {
              void loadWeekBundle(selectedWeek, { syncActive: true });
            }}
          />
        ) : (
          <div style={{ display: "grid", gap: 12, minHeight: 0, height: "100%" }}>
            <div
              role="group"
              aria-label="Bulk Edit week selector"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: 4,
                borderRadius: 999,
                border: `1px solid ${UI.border}`,
                background: UI.panelBg,
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.7)",
                width: "fit-content",
              }}
            >
              {(["cw", "nw"] as const).map((week) => {
                const active = selectedWeek === week;
                return (
                  <button
                    key={week}
                    type="button"
                    onClick={() => setSelectedWeek(week)}
                    style={{
                      border: `1px solid ${active ? UI.accent : UI.borderSoft}`,
                      background: active ? UI.accentSoft : UI.headerBg,
                      color: active ? UI.accentText : UI.textDim,
                      borderRadius: 999,
                      padding: "6px 10px",
                      fontSize: 11,
                      fontWeight: 800,
                      letterSpacing: 0.3,
                      cursor: "pointer",
                      minWidth: 40,
                    }}
                  >
                    {week.toUpperCase()}
                  </button>
                );
              })}
            </div>

            <div style={{ minHeight: 0 }}>
              <BulkEditPanel
                layout="wizard"
                week={selectedWeek}
                visibleBulkCandidates={visibleBulkCandidates}
                draftMode={draftMode}
                weekStartYmd={weekStartYmd}
                preselectedShiftIDs={messageHandoff?.shiftIDs}
                preselectedShifts={messageHandoff?.shifts}
                preselectedCaregiverName={messageHandoff?.caregiverName}
                preselectedHandoffToken={messageHandoff?.createdAt}
                preselectedPerfStartAt={messageHandoff?.perfStartAt}
                preselectedTargetStatus={messageHandoff?.targetStatus}
                scheduleRows={scheduleRows}
                saveInlineEdit={saveInlineEdit}
                setDraftCell={setDraftCell}
                refreshScheduleStateInBackground={refreshScheduleStateInBackground}
                setSaveToast={setSaveToast}
              />
            </div>
          </div>
        )}
      </FloatingPanel>
    </>
  );
}

function SaveToastView({
  onDismiss,
  saveToast,
}: {
  saveToast: SaveToast;
  onDismiss: () => void;
}) {
  return (
    <div
      style={{
        position: "fixed",
        top: 18,
        right: 18,
        zIndex: 10050,
        width: "min(390px, calc(100vw - 24px))",
        background:
          saveToast.kind === "success"
            ? "#ecfdf5"
            : saveToast.kind === "warning"
            ? "#fffbeb"
            : saveToast.kind === "loading"
            ? "#eff6ff"
            : "#fef2f2",
        border:
          saveToast.kind === "success"
            ? "1px solid #86efac"
            : saveToast.kind === "warning"
            ? "1px solid #fcd34d"
            : saveToast.kind === "loading"
            ? "1px solid #93c5fd"
            : "1px solid #fca5a5",
        color: "#111827",
        borderRadius: 14,
        boxShadow: "0 12px 30px rgba(0,0,0,0.18)",
        padding: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 10,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 1000 }}>{saveToast.title}</div>
          <div
            style={{
              marginTop: 6,
              display: "grid",
              gap: 4,
            }}
          >
            {saveToast.lines.map((line, idx) => (
              <div
                key={`${saveToast.id}_${idx}`}
                style={{
                  fontSize: 12,
                  fontWeight: idx < 4 ? 850 : 700,
                  lineHeight: 1.3,
                  color:
                    saveToast.kind === "error"
                      ? "#991b1b"
                      : saveToast.kind === "warning"
                      ? "#92400e"
                      : saveToast.kind === "loading"
                      ? "#1d4ed8"
                      : "#065f46",
                  whiteSpace: "pre-wrap",
                }}
              >
                {line}
              </div>
            ))}
          </div>
          {saveToast.actions?.length ? (
            <div
              style={{
                marginTop: 10,
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
              }}
            >
              {saveToast.actions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  onClick={action.onClick}
                  style={{
                    minHeight: 28,
                    padding: "0 10px",
                    borderRadius: 10,
                    fontSize: 11,
                    fontWeight: 900,
                    cursor: "pointer",
                    border:
                      action.variant === "primary"
                        ? "1px solid #111827"
                        : "1px solid #d1d5db",
                    background: action.variant === "primary" ? "#111827" : "#fff",
                    color: action.variant === "primary" ? "#fff" : "#111827",
                  }}
                >
                  {action.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <button
          type="button"
          onClick={onDismiss}
          style={{
            border: "none",
            background: "transparent",
            cursor: "pointer",
            color: "#6b7280",
            fontSize: 16,
            lineHeight: 1,
            padding: 0,
            fontWeight: 900,
          }}
          aria-label="Dismiss notification"
        >
          ×
        </button>
      </div>
    </div>
  );
}

function PanelCenterMessage({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100%",
        display: "grid",
        placeItems: "center",
        color: UI.textDim,
        fontSize: 15,
        fontWeight: 700,
        padding: 24,
      }}
    >
      {children}
    </div>
  );
}

function PanelErrorMessage({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div
      style={{
        minHeight: "100%",
        display: "grid",
        placeItems: "center",
        padding: 24,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 520,
          textAlign: "center",
          background: UI.panelBg,
          border: `1px solid ${UI.borderSoft}`,
          borderRadius: 18,
          boxShadow: "0 12px 30px rgba(15,23,42,0.08)",
          padding: "28px 32px",
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 900, color: UI.text }}>Load failed</div>
        <div
          style={{
            marginTop: 8,
            color: UI.textDim,
            fontSize: 14,
            lineHeight: 1.5,
            whiteSpace: "pre-wrap",
          }}
        >
          {error}
        </div>
        <button
          type="button"
          onClick={onRetry}
          style={{
            marginTop: 18,
            border: `1px solid ${UI.border}`,
            background: UI.headerBg,
            color: UI.text,
            borderRadius: 10,
            padding: "8px 14px",
            fontSize: 13,
            fontWeight: 900,
            cursor: "pointer",
          }}
        >
          Retry
        </button>
      </div>
    </div>
  );
}

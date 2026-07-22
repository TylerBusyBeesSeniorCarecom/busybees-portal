"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMessagesUI } from "@/app/api/messages/MessagesContext";
import ShiftCard from "@/app/schedule/components/ShiftCard";
import { useShiftInfo } from "@/app/schedule/components/useShiftInfo";
import { bulkStatusTone } from "./BulkEditPanel";
import FloatingPanel from "./FloatingPanel";
import { useSheetsToolsShared } from "../SheetsToolsSharedProvider";
import {
  formatRecommendationsDateLabel,
  normalizeKey,
  norm,
  parseWeek,
  parseCaregiverNameFromAnyShiftText,
  parseFirstTimeRange,
  recommendationStatusLabel,
  SHEET_COLORS,
  splitCellIntoShiftStrings,
  statusFromCellValue,
  timeLabelToMinutes,
  toDateSafe,
  UI,
  weekLabel,
  type PopupShiftTarget,
  type RecommendationStatusFilter,
  type ShiftStatus,
  type WeekKind,
} from "../shared";
import { useFloatingWindows } from "../useFloatingWindows";

function recommendationStatusTone(status: ShiftStatus) {
  if (status === "filled") return bulkStatusTone("Filled");
  if (status === "considering") return bulkStatusTone("Considering");
  if (status === "offered" || status === "offering") return bulkStatusTone("Offered");
  if (status === "pending") return bulkStatusTone("PendingClientApproval");
  if (status === "open") return bulkStatusTone("Open");
  return bulkStatusTone("Unknown");
}

function buildRecommendationCandidatesForGrid(args: {
  grid: ReturnType<typeof useSheetsToolsShared>["cwGrid"];
  idByNameOnSchedule: Record<string, string>;
  shiftInfo: ReturnType<typeof useShiftInfo>;
}): PopupShiftTarget[] {
  if (!args.grid?.ok) return [];

  const rows = args.grid.body.rows ?? [];
  const dateHeaders = args.grid.headers?.dateHeaders ?? ["Date"];
  const out: PopupShiftTarget[] = [];

  for (const row of rows) {
    const clientName = norm(row.clientName);
    if (!clientName) continue;

    for (let dow = 0; dow < 7; dow += 1) {
      const cell = row.cells[dow];
      const cellValue = norm(cell?.value);
      if (!cellValue) continue;

      for (const shiftText of splitCellIntoShiftStrings(cellValue)) {
        const status = statusFromCellValue(shiftText);
        if (status === "none" || status === "canceled") continue;

        const timeRange = parseFirstTimeRange(shiftText);
        if (!timeRange) continue;

        const dateStr = norm(dateHeaders[dow + 1]);
        const caregiverName = parseCaregiverNameFromAnyShiftText(shiftText);
        const caregiverId = caregiverName
          ? args.idByNameOnSchedule[normalizeKey(caregiverName)] || ""
          : "";
        const shiftMeta = args.shiftInfo.getGridShiftInfo({
          clientName,
          dateStr,
          startTime: timeRange.start,
          endTime: timeRange.end,
          caregiverName,
          isCancelled: false,
        });

        if (shiftMeta.timeState !== "future" && shiftMeta.timeState !== "in_progress") continue;

        out.push({
          shiftId: shiftMeta.shiftId || "",
          dateStr,
          clientName,
          caregiverName,
          caregiverId: caregiverId || undefined,
          startTime: timeRange.start,
          endTime: timeRange.end,
          status,
        });
      }
    }
  }

  out.sort((a, b) => {
    const byDate = toDateSafe(a.dateStr)?.getTime() ?? Number.POSITIVE_INFINITY;
    const otherDate = toDateSafe(b.dateStr)?.getTime() ?? Number.POSITIVE_INFINITY;
    if (byDate !== otherDate) return byDate - otherDate;

    const byTime = timeLabelToMinutes(a.startTime) - timeLabelToMinutes(b.startTime);
    if (byTime !== 0) return byTime;

    return a.clientName.localeCompare(b.clientName);
  });

  return out;
}

export default function RecommendationsToolPanel() {
  const pathname = usePathname() || "/sheets-tools";
  const searchParams = useSearchParams();
  const messagesUI = useMessagesUI();
  const {
    cwClockMap,
    cwGrid,
    cwLoaded,
    cwLocationMap,
    cwScheduleRows,
    cwShiftIdLookup,
    idByNameOnSchedule,
    loadWeekBundle,
    nwClockMap,
    nwGrid,
    nwLoaded,
    nwLocationMap,
    nwScheduleRows,
    nwShiftIdLookup,
    refreshCaregivers,
    refreshRecommendationsStateInBackground,
    replaceUrlState,
  } = useSheetsToolsShared();
  const { panels } = useFloatingWindows();
  const panel = panels.recommendations;
  const shiftParam = searchParams.get("shift");

  const [recsWeek, setRecsWeek] = useState<WeekKind>(() => parseWeek(searchParams.get("week")));
  const [recsSearch, setRecsSearch] = useState("");
  const [recsStatusFilter, setRecsStatusFilter] =
    useState<RecommendationStatusFilter>("all");
  const [selectedShiftTarget, setSelectedShiftTarget] = useState<PopupShiftTarget | null>(null);
  const [selectedShiftWeek, setSelectedShiftWeek] = useState<WeekKind>("cw");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const lastCloseTimeRef = useRef(0);

  const cwShiftInfo = useShiftInfo({
    week: "cw",
    scheduleRows: cwScheduleRows,
    shiftIdLookup: cwShiftIdLookup,
    clockMap: cwClockMap,
    locationMap: cwLocationMap,
  });

  const nwShiftInfo = useShiftInfo({
    week: "nw",
    scheduleRows: nwScheduleRows,
    shiftIdLookup: nwShiftIdLookup,
    clockMap: nwClockMap,
    locationMap: nwLocationMap,
  });

  const loadRecommendationsWeeksIfNeeded = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(null);
      if (!Object.keys(idByNameOnSchedule).length) {
        await refreshCaregivers();
      }
      await Promise.all([loadWeekBundle("cw"), loadWeekBundle("nw")]);
    } catch (err: any) {
      setLoadError(err?.message ?? "Failed to load future shifts.");
    } finally {
      setLoading(false);
    }
  }, [idByNameOnSchedule, loadWeekBundle, refreshCaregivers]);

  useEffect(() => {
    if (!panel.open) return;
    void loadRecommendationsWeeksIfNeeded();
  }, [loadRecommendationsWeeksIfNeeded, panel.open]);

  useEffect(() => {
    setSelectedShiftTarget(null);
  }, [recsWeek]);

  const cwRecommendationCandidates = useMemo(
    () =>
      buildRecommendationCandidatesForGrid({
        grid: cwGrid,
        idByNameOnSchedule,
        shiftInfo: cwShiftInfo,
      }),
    [cwGrid, cwShiftInfo, idByNameOnSchedule]
  );

  const nwRecommendationCandidates = useMemo(
    () =>
      buildRecommendationCandidatesForGrid({
        grid: nwGrid,
        idByNameOnSchedule,
        shiftInfo: nwShiftInfo,
      }),
    [idByNameOnSchedule, nwGrid, nwShiftInfo]
  );

  const recommendationCandidates =
    recsWeek === "cw" ? cwRecommendationCandidates : nwRecommendationCandidates;

  const filteredRecommendationCandidates = useMemo(() => {
    const query = normalizeKey(recsSearch);

    return recommendationCandidates.filter((item) => {
      if (recsStatusFilter !== "all") {
        if (recsStatusFilter === "offered") {
          if (item.status !== "offered" && item.status !== "offering") return false;
        } else if (item.status !== recsStatusFilter) {
          return false;
        }
      }

      if (!query) return true;

      return (
        normalizeKey(item.clientName).includes(query) ||
        normalizeKey(item.caregiverName || "Open").includes(query)
      );
    });
  }, [recommendationCandidates, recsSearch, recsStatusFilter]);

  const openRecommendationShift = useCallback(
    (week: WeekKind, target: PopupShiftTarget) => {
      setSelectedShiftWeek(week);
      setSelectedShiftTarget(target);
      replaceUrlState({ shift: target.shiftId || null });
    },
    [replaceUrlState]
  );

  const closeRecommendationShift = useCallback(() => {
    lastCloseTimeRef.current = 0;
    setSelectedShiftTarget(null);
    replaceUrlState({ shift: null });
  }, [replaceUrlState]);

  useEffect(() => {
    if (!panel.open || !shiftParam) return;
    if (!cwLoaded || !nwLoaded) return;

    const match =
      cwRecommendationCandidates.find((item) => item.shiftId === shiftParam) ??
      nwRecommendationCandidates.find((item) => item.shiftId === shiftParam);

    if (!match) {
      if (selectedShiftTarget) {
        setSelectedShiftTarget(null);
      }
      replaceUrlState({ shift: null });
      return;
    }

    const matchWeek = cwRecommendationCandidates.some((item) => item.shiftId === shiftParam)
      ? "cw"
      : "nw";

    setSelectedShiftWeek(matchWeek);
    setSelectedShiftTarget((prev) => {
      if (
        prev?.shiftId === match.shiftId &&
        prev?.dateStr === match.dateStr &&
        prev?.startTime === match.startTime &&
        selectedShiftWeek === matchWeek
      ) {
        return prev;
      }
      return match;
    });
  }, [
    cwLoaded,
    cwRecommendationCandidates,
    nwLoaded,
    nwRecommendationCandidates,
    panel.open,
    replaceUrlState,
    selectedShiftTarget,
    selectedShiftWeek,
    shiftParam,
  ]);

  if (!panel.open) return null;

  const recommendationsReady = cwLoaded && nwLoaded;

  return (
    <FloatingPanel
      id="recommendations"
      title="Recommendations"
      onRefresh={() => {
        void refreshRecommendationsStateInBackground();
      }}
    >
      <div
        style={{
          height: "100%",
          display: "flex",
          flexDirection: "column",
          gap: 14,
          padding: 16,
          background: UI.pageBg,
        }}
      >
        <div
          style={{
            display: selectedShiftTarget ? "none" : "flex",
            flexDirection: "column",
            gap: 14,
            flex: 1,
            minHeight: 0,
          }}
        >
          <div
            style={{
              border: `1px solid ${UI.borderSoft}`,
              borderRadius: 16,
              background: UI.panelBg,
              boxShadow: "0 8px 24px rgba(15,23,42,0.06)",
              padding: 14,
              display: "grid",
              gap: 12,
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
              <div
                role="group"
                aria-label="Recommendations week selector"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: 4,
                  borderRadius: 999,
                  border: `1px solid ${UI.border}`,
                  background: UI.panelBg,
                }}
              >
                {(["cw", "nw"] as WeekKind[]).map((week) => {
                  const active = recsWeek === week;
                  return (
                    <button
                      key={week}
                      type="button"
                      onClick={() => setRecsWeek(week)}
                      style={{
                        border: `1px solid ${active ? UI.accent : UI.borderSoft}`,
                        background: active ? UI.accentSoft : UI.headerBg,
                        color: active ? UI.accentText : UI.textDim,
                        borderRadius: 999,
                        padding: "6px 12px",
                        fontSize: 12,
                        fontWeight: 800,
                        cursor: "pointer",
                        minWidth: 48,
                      }}
                    >
                      {week.toUpperCase()}
                    </button>
                  );
                })}
              </div>

              <div style={{ flex: "1 1 240px", minWidth: 220 }}>
                <input
                  type="search"
                  value={recsSearch}
                  onChange={(event) => setRecsSearch(event.target.value)}
                  placeholder="Search client or caregiver"
                  style={{
                    width: "100%",
                    border: `1px solid ${UI.border}`,
                    borderRadius: 12,
                    padding: "9px 11px",
                    fontSize: 13,
                    color: UI.text,
                    background: UI.panelBg,
                    outline: "none",
                  }}
                />
              </div>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              {(
                [
                  ["all", "All"],
                  ["open", "Open"],
                  ["filled", "Filled"],
                  ["considering", "Considering"],
                  ["offered", "Offered"],
                  ["pending", "Pending"],
                ] as const
              ).map(([value, label]) => {
                const active = recsStatusFilter === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setRecsStatusFilter(value)}
                    style={{
                      border: `1px solid ${active ? UI.accent : UI.border}`,
                      background: active ? UI.accentSoft : UI.panelBg,
                      color: active ? UI.accentText : UI.textDim,
                      borderRadius: 999,
                      padding: "5px 10px",
                      fontSize: 11,
                      fontWeight: 800,
                      cursor: "pointer",
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {loadError ? (
            <CenteredPanelState>{loadError}</CenteredPanelState>
          ) : loading || !recommendationsReady ? (
            <CenteredPanelState>Loading future shifts…</CenteredPanelState>
          ) : recommendationCandidates.length > 0 ? (
            <>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 800,
                  color: UI.textDim,
                  paddingInline: 2,
                }}
              >
                {filteredRecommendationCandidates.length} future{" "}
                {filteredRecommendationCandidates.length === 1 ? "shift" : "shifts"}
              </div>

              {filteredRecommendationCandidates.length > 0 ? (
                <div
                  style={{
                    display: "grid",
                    gap: 10,
                    overflow: "auto",
                    minHeight: 0,
                  }}
                >
                  {filteredRecommendationCandidates.map((item) => {
                    const tone = recommendationStatusTone(item.status);
                    const isSelected =
                      selectedShiftTarget?.shiftId === item.shiftId &&
                      selectedShiftTarget?.clientName === item.clientName &&
                      selectedShiftTarget?.dateStr === item.dateStr &&
                      selectedShiftTarget?.startTime === item.startTime &&
                      selectedShiftWeek === recsWeek;

                    return (
                      <button
                        key={[
                          recsWeek,
                          item.shiftId || item.clientName,
                          item.dateStr,
                          item.startTime,
                          item.endTime,
                        ].join("__")}
                        type="button"
                        onClick={() => openRecommendationShift(recsWeek, item)}
                        style={{
                          width: "100%",
                          textAlign: "left",
                          border: `1px solid ${isSelected ? UI.accent : UI.borderSoft}`,
                          background: isSelected ? "#fffdf4" : UI.panelBg,
                          borderRadius: 14,
                          padding: "12px 14px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 14,
                          cursor: "pointer",
                          boxShadow: isSelected
                            ? "0 8px 24px rgba(244,180,0,0.16)"
                            : "0 6px 18px rgba(15,23,42,0.05)",
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                              flexWrap: "wrap",
                            }}
                          >
                            <div
                              style={{
                                fontSize: 14,
                                fontWeight: 900,
                                color: UI.text,
                              }}
                            >
                              {item.clientName}
                            </div>
                            <div
                              style={{
                                border: `1px solid ${tone.border}`,
                                background: tone.bg,
                                color: tone.text,
                                borderRadius: 999,
                                padding: "2px 8px",
                                fontSize: 11,
                                fontWeight: 900,
                                whiteSpace: "nowrap",
                              }}
                            >
                              {recommendationStatusLabel(item.status)}
                            </div>
                          </div>
                          <div
                            style={{
                              marginTop: 5,
                              fontSize: 12,
                              fontWeight: 700,
                              color: UI.textDim,
                            }}
                          >
                            {formatRecommendationsDateLabel(item.dateStr)} • {item.startTime}-
                            {item.endTime}
                          </div>
                          <div
                            style={{
                              marginTop: 4,
                              fontSize: 12,
                              color: UI.textDim,
                            }}
                          >
                            {item.caregiverName || "Open"}
                          </div>
                        </div>

                        <div
                          style={{
                            flexShrink: 0,
                            border: `1px solid ${UI.border}`,
                            background: UI.headerBg,
                            color: UI.text,
                            borderRadius: 10,
                            padding: "8px 10px",
                            fontSize: 11,
                            fontWeight: 900,
                            whiteSpace: "nowrap",
                          }}
                        >
                          Find Caregivers
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <EmptyState
                  title="No shifts match your filters"
                  actionLabel="Clear Filters"
                  onAction={() => {
                    setRecsSearch("");
                    setRecsStatusFilter("all");
                  }}
                />
              )}
            </>
          ) : (
            <CenteredPanelState>No future shifts for {weekLabel(recsWeek)}</CenteredPanelState>
          )}
        </div>

        <div
          style={{
            display: selectedShiftTarget ? "flex" : "none",
            flexDirection: "column",
            gap: 12,
            flex: 1,
            minHeight: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              minHeight: 38,
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              onClick={closeRecommendationShift}
              style={{
                border: `1px solid ${UI.border}`,
                background: UI.panelBg,
                color: UI.text,
                borderRadius: 999,
                padding: "7px 12px",
                fontSize: 12,
                fontWeight: 900,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              ← Back to shift list
            </button>

            <div
              style={{
                minWidth: 0,
                flex: "1 1 240px",
                textAlign: "right",
                fontSize: 12,
                fontWeight: 700,
                color: UI.textDim,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {selectedShiftTarget
                ? `${selectedShiftTarget.clientName} • ${formatRecommendationsDateLabel(
                    selectedShiftTarget.dateStr
                  )} • ${selectedShiftTarget.startTime}-${selectedShiftTarget.endTime}`
                : ""}
            </div>
          </div>

          {selectedShiftTarget ? (
            <div
              style={{
                flex: 1,
                minHeight: 0,
                border: `1px solid ${UI.borderSoft}`,
                borderRadius: 16,
                overflow: "hidden",
                background: UI.panelBg,
                boxShadow: "0 8px 24px rgba(15,23,42,0.06)",
              }}
            >
              <ShiftCard
                key={[
                  pathname,
                  selectedShiftWeek,
                  selectedShiftTarget.shiftId || selectedShiftTarget.clientName,
                  selectedShiftTarget.dateStr,
                  selectedShiftTarget.startTime,
                  selectedShiftTarget.endTime,
                ].join("__")}
                a1Key={`recs-popup-${selectedShiftWeek}-${selectedShiftTarget.shiftId || selectedShiftTarget.clientName}`}
                value=""
                status={selectedShiftTarget.status}
                onRequestEdit={() => {}}
                expanded={false}
                onToggleExpanded={() => {}}
                dateStrForDow={selectedShiftTarget.dateStr}
                clientName={selectedShiftTarget.clientName}
                shiftInfo={selectedShiftWeek === "cw" ? cwShiftInfo : nwShiftInfo}
                rowIsEmpty={false}
                cellBg="#ffffff"
                sheetColors={SHEET_COLORS}
                week={selectedShiftWeek}
                hasEditHistory={false}
                messagesUI={messagesUI}
                popupOnly
                popupRenderMode="inline"
                popupTarget={selectedShiftTarget}
              />
            </div>
          ) : null}
        </div>
      </div>
    </FloatingPanel>
  );
}

function CenteredPanelState({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "grid",
        placeItems: "center",
        padding: 32,
        textAlign: "center",
        color: UI.textDim,
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 800 }}>{children}</div>
    </div>
  );
}

function EmptyState({
  title,
  actionLabel,
  onAction,
}: {
  title: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "grid",
        placeItems: "center",
        padding: 32,
        textAlign: "center",
        color: UI.textDim,
      }}
    >
      <div>
        <div style={{ fontSize: 15, fontWeight: 800, color: UI.text }}>{title}</div>
        <button
          type="button"
          onClick={onAction}
          style={{
            marginTop: 10,
            border: "none",
            background: "transparent",
            color: UI.accentText,
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 900,
            padding: 0,
          }}
        >
          {actionLabel}
        </button>
      </div>
    </div>
  );
}

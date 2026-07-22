"use client";

import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  cleanBulkCellValue,
  parseBulkShiftCell,
  type BulkBaseShiftStatus,
} from "../utils/bulkShiftParsing";
import { logBulkEditPerf } from "../bulkEditHandoff";
import {
  ping,
  publish,
  type PublishAction,
  type PublishResponse,
} from "../utils/schedulePublishService";
import type {
  BulkEditPanelHandle,
  BulkSelectedCell,
  BulkSmartStatusFilter,
  BulkTargetStatus,
} from "./bulkEdit.types";

type SaveToast = {
  id: number;
  kind: "success" | "warning" | "error" | "loading";
  title: string;
  lines: string[];
  actions?: Array<{
    label: string;
    onClick: () => void;
    variant?: "primary" | "secondary";
  }>;
};

type SaveInlineEditArgs = {
  a1: string;
  newVal: string;
  clientName: string;
  shiftDateForSave: string;
  dayLabel: string;
  weekOf?: string;
  backgroundRefresh?: boolean;
  keepOpenIfUnchanged?: boolean;
};

type SetDraftCellArgs = {
  a1: string;
  week: "cw" | "nw";
  originalValue: string;
  draftValue: string;
  clientName?: string;
  dateStr?: string;
  dayLabel?: string;
};

export type BulkEditPanelProps = {
  layout?: "expanded" | "wizard";
  week: "cw" | "nw";
  visibleBulkCandidates: BulkSelectedCell[];
  draftMode: boolean;
  weekStartYmd: string;
  preselectedShiftIDs?: string[];
  preselectedShifts?: Array<{
    shiftID: string;
    caregiverID: string;
    weekStart: string;
    date: string;
    client: string;
    startTime: string;
    endTime: string;
  }>;
  preselectedCaregiverName?: string;
  preselectedHandoffToken?: number;
  preselectedPerfStartAt?: number;
  preselectedTargetStatus?: BulkTargetStatus;
  currentUserName?: string;
  currentUserEmail?: string;
  shiftSaveCaregivers?: unknown[];
  scheduleRows?: unknown[];
  idByNameOnSchedule?: Record<string, string>;
  caregiversById?: Record<string, unknown>;
  messagesUI?: unknown;
  saveInlineEdit: (args: SaveInlineEditArgs) => Promise<boolean>;
  setDraftCell: (args: SetDraftCellArgs) => void;
  refreshScheduleStateInBackground: (args?: {
    includeGrid?: boolean;
    includeEditLog?: boolean;
  }) => Promise<void>;
  setSaveToast: React.Dispatch<React.SetStateAction<SaveToast | null>>;
  onSelectionChange?: () => void;
};

type PendingBulkConfirmation = {
  title: string;
  tone: { bg: string; border: string; text: string };
  indicator: React.ReactNode;
  targetBaseStatus?: BulkTargetStatus;
  targetCancelled?: "keep" | boolean;
  caregiverNameOverride?: string | null;
  targetStatusLabel: string;
  publishPreferred: boolean;
  rows: Array<{
    a1: string;
    descriptor: string;
    currentStatusLabel: string;
    currentBaseStatus: BulkBaseShiftStatus;
    currentIsCancelled: boolean;
  }>;
  selectedCount: number;
};

type InlineCardEditState = {
  a1: string;
  value: string;
};

type PendingInlineSaveState = {
  value: string;
  previousValue: string;
  requestId: number;
  saving: boolean;
};

const UI = {
  panelBg: "#ffffff",
  headerBg: "#f9fafb",
  border: "#d1d5db",
  borderSoft: "#e5e7eb",
  text: "#111827",
  textDim: "#6b7280",
};

const TOPNAV_Z = 200;
const STATUS_TILE_ORDER: Array<{
  label: string;
  status: BulkTargetStatus | "Cancelled";
}> = [
  { label: "Filled", status: "Filled" },
  { label: "Open", status: "Open" },
  { label: "Considering", status: "Considering" },
  { label: "Offered", status: "Offered" },
  { label: "Pending", status: "PendingClientApproval" },
  { label: "Cancelled", status: "Cancelled" },
];

function norm(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeKey(value: string): string {
  return norm(value).toLowerCase();
}

function toDateSafe(dateStr: string): Date | null {
  const raw = norm(dateStr);
  if (!raw) return null;
  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) return direct;

  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;

  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const parsed = new Date(year, month - 1, day);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dateKey(dateStr: string): string {
  const d = toDateSafe(dateStr);
  if (!d) return norm(dateStr);
  const yyyy = d.getFullYear();
  const mm = `${d.getMonth() + 1}`.padStart(2, "0");
  const dd = `${d.getDate()}`.padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatShortDayDate(dateStr: string): string {
  const d = toDateSafe(dateStr);
  if (!d) return norm(dateStr);
  const weekday = d.toLocaleDateString("en-US", { weekday: "short" });
  const month = d.getMonth() + 1;
  const day = d.getDate();
  return `${weekday} ${month}/${day}`;
}

function parseTimeToMinutes(time: string): number | null {
  const value = norm(time);
  if (!value) return null;

  const twelveHour = value.match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i);
  if (twelveHour) {
    let hours = Number(twelveHour[1]);
    const minutes = Number(twelveHour[2]);
    const meridiem = twelveHour[3].toUpperCase();
    if (hours === 12) hours = 0;
    if (meridiem === "PM") hours += 12;
    return hours * 60 + minutes;
  }

  const twentyFourHour = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!twentyFourHour) return null;
  return Number(twentyFourHour[1]) * 60 + Number(twentyFourHour[2]);
}

function normalizeShiftTimeValue(value: unknown): string {
  return norm(value).replace(/\s+/g, "").toUpperCase();
}

function resolveBulkCellsFromShiftIDs(args: {
  shiftIDs: string[];
  scheduleRows?: unknown[];
  visibleBulkCandidates: BulkSelectedCell[];
}): BulkSelectedCell[] {
  if (!args.shiftIDs.length || !args.visibleBulkCandidates.length) return [];

  const rowByShiftID = new Map<string, any>();
  for (const row of args.scheduleRows || []) {
    const shiftId = norm((row as any)?.shiftId);
    if (!shiftId) continue;
    rowByShiftID.set(shiftId, row);
  }

  const targetIDs = new Set(args.shiftIDs.map((id) => norm(id)).filter(Boolean));
  const selected = new Map<string, BulkSelectedCell>();

  for (const shiftID of targetIDs) {
    const row = rowByShiftID.get(shiftID);
    if (!row) continue;

    const rowClient = normalizeKey((row as any)?.client ?? "");
    const rowDate = dateKey((row as any)?.date ?? "");
    const rowCaregiver = normalizeKey((row as any)?.caregiver ?? "");
    const rowStart = normalizeShiftTimeValue((row as any)?.startTime ?? "");
    const rowEnd = normalizeShiftTimeValue((row as any)?.endTime ?? "");

    const match = args.visibleBulkCandidates.find((cell) => {
      if (selected.has(cell.a1)) return false;
      const parsed = parseBulkShiftCell(cell.originalValue);
      return (
        normalizeKey(cell.clientName) === rowClient &&
        dateKey(cell.dateStr) === rowDate &&
        normalizeKey(parsed.caregiverName || "") === rowCaregiver &&
        normalizeShiftTimeValue(parsed.startTime ?? "") === rowStart &&
        normalizeShiftTimeValue(parsed.endTime ?? "") === rowEnd
      );
    });

    if (match) {
      selected.set(match.a1, match);
    }
  }

  return Array.from(selected.values());
}

export function bulkStatusTone(status: BulkSmartStatusFilter | BulkBaseShiftStatus) {
  if (status === "Filled") {
    return { bg: "#ecfdf5", border: "#22c55e", text: "#166534" };
  }
  if (status === "Considering") {
    return { bg: "#fff7ed", border: "#fb923c", text: "#9a3412" };
  }
  if (status === "Offered") {
    return { bg: "#eff6ff", border: "#60a5fa", text: "#1d4ed8" };
  }
  if (status === "PendingClientApproval") {
    return { bg: "#faf5ff", border: "#c084fc", text: "#7e22ce" };
  }
  if (status === "Open") {
    return { bg: "#fef2f2", border: "#f87171", text: "#b91c1c" };
  }
  return { bg: "#f8fafc", border: UI.border, text: UI.textDim };
}

export function formatBulkMessageDate(dateStr: string) {
  const d = toDateSafe(dateStr);
  if (!d) return dateStr;
  return d.toLocaleDateString(undefined, {
    weekday: "long",
  });
}

function outcomeSummaryMessage(failures: string[]): string {
  if (!failures.length) return "Unable to apply bulk changes.";
  if (failures.length === 1) return failures[0];
  return `${failures[0]} (+${failures.length - 1} more issue${
    failures.length - 1 === 1 ? "" : "s"
  })`;
}

function tokenizeSearchQuery(query: string): string[] {
  return normalizeKey(query)
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function statusSearchLabel(baseStatus: BulkBaseShiftStatus, isCancelled: boolean): string {
  if (isCancelled) return "Cancelled";
  if (baseStatus === "PendingClientApproval") return "Pending Pending Approval";
  if (baseStatus === "Unknown") return "Unknown";
  return baseStatus;
}

function currentStatusTone(baseStatus: BulkBaseShiftStatus, isCancelled: boolean) {
  if (isCancelled) {
    return { bg: "rgba(17,24,39,0.10)", border: "#111827", text: "#111827" };
  }
  if (baseStatus === "PendingClientApproval") return bulkStatusTone(baseStatus);
  if (baseStatus === "Unknown") {
    return { bg: "rgba(107,114,128,0.12)", border: "#6b7280", text: "#4b5563" };
  }
  return bulkStatusTone(baseStatus);
}

function renderStatusIndicator(status: BulkTargetStatus | "Cancelled", size: number) {
  const tone =
    status === "Cancelled"
      ? { bg: "#f8fafc", border: "#111827", text: "#111827" }
      : bulkStatusTone(status);

  if (status === "Filled" || status === "Open") {
    return (
      <span
        aria-hidden="true"
        style={{
          width: size,
          height: size,
          borderRadius: 999,
          background: tone.border,
          display: "inline-block",
          flexShrink: 0,
        }}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      style={{
        color: tone.border,
        fontSize: size + 8,
        fontWeight: 1000,
        lineHeight: 1,
        flexShrink: 0,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      }}
    >
      {status === "Considering"
        ? "("
        : status === "Offered"
        ? '"'
        : status === "PendingClientApproval"
        ? "$"
        : "*"}
    </span>
  );
}

function renderStatusChip(args: {
  label: string;
  tone: { bg: string; border: string; text: string };
  compact?: boolean;
}) {
  return (
    <span
      style={{
        minHeight: args.compact ? 18 : 20,
        borderRadius: 999,
        background: args.tone.border === "#111827" ? "rgba(17,24,39,0.10)" : `${args.tone.border}26`,
        color: args.tone.border,
        padding: args.compact ? "0 6px" : "0 8px",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: args.compact ? 10 : 10.5,
        fontWeight: 1000,
        whiteSpace: "nowrap",
      }}
    >
      {args.label}
    </span>
  );
}

function scheduleRowIsCancelled(status: unknown): boolean {
  return /cancel/i.test(norm(status));
}

const BulkEditPanel = forwardRef<BulkEditPanelHandle, BulkEditPanelProps>(
  function BulkEditPanel(props, ref) {
    const {
      layout = "expanded",
      week,
      visibleBulkCandidates,
      draftMode,
      weekStartYmd,
      saveInlineEdit,
      setDraftCell,
      refreshScheduleStateInBackground,
      setSaveToast,
      onSelectionChange,
    } = props;
    const [selectedBulkCells, setSelectedBulkCells] = useState<Record<string, BulkSelectedCell>>(
      {}
    );
    const [bulkApplying, setBulkApplying] = useState(false);
    const [bulkSmartCaregiver, setBulkSmartCaregiver] = useState("");
    const [bulkSmartClient, setBulkSmartClient] = useState("");
    const [bulkSmartStatus, setBulkSmartStatus] = useState<BulkSmartStatusFilter>("Any");
    const [bulkSelectionMode, setBulkSelectionMode] = useState<"caregiver" | "client" | "status">(
      "caregiver"
    );
    const [bulkStepTwoArmed, setBulkStepTwoArmed] = useState(false);
    const [showCaregiverSuggestions, setShowCaregiverSuggestions] = useState(false);
    const [showClientSuggestions, setShowClientSuggestions] = useState(false);
    const [bulkStepTwoSearch, setBulkStepTwoSearch] = useState("");
    const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);
    const wizardAdvanceTimeoutRef = useRef<number | null>(null);
    const wizardOutcomeTimeoutRef = useRef<number | null>(null);
    const isMountedRef = useRef(true);
    const panelMeasureRef = useRef<HTMLDivElement | null>(null);
    const [tileDensity, setTileDensity] = useState<"comfortable" | "compact" | "row">(
      "comfortable"
    );
    const [wizardOutcome, setWizardOutcome] = useState<null | { kind: "success"; updatedCount: number }>(null);
    const [panelFailureBanner, setPanelFailureBanner] = useState<string | null>(null);
    const [pendingConfirmation, setPendingConfirmation] = useState<PendingBulkConfirmation | null>(
      null
    );
    const [suggestedStatus, setSuggestedStatus] = useState<BulkTargetStatus | null>(null);
    const [inlineCardEdit, setInlineCardEdit] = useState<InlineCardEditState | null>(null);
    const [scrollFocusA1, setScrollFocusA1] = useState<string | null>(null);
    const [highlightedA1, setHighlightedA1] = useState<string | null>(null);
    const [pendingInlineSaves, setPendingInlineSaves] = useState<
      Record<string, PendingInlineSaveState>
    >({});
    const sheetConfirmButtonRef = useRef<HTMLButtonElement | null>(null);
    const publishConfirmButtonRef = useRef<HTMLButtonElement | null>(null);
    const pingButtonRef = useRef<HTMLButtonElement | null>(null);
    const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
    const appliedHandoffKeyRef = useRef<string | null>(null);
    const stepTwoClickTimeoutRef = useRef<number | null>(null);
    const highlightTimeoutRef = useRef<number | null>(null);
    const inlineSaveRequestRef = useRef(0);
    const preselectedShiftIDs = props.preselectedShiftIDs ?? [];
    const hasMessageHandoff = preselectedShiftIDs.length > 0;
    const preselectedHandoffKey = hasMessageHandoff
      ? `${props.preselectedCaregiverName || ""}::${preselectedShiftIDs.join("|")}::${
          props.preselectedHandoffToken || 0
        }::${props.preselectedTargetStatus || ""}`
      : "";

    useEffect(() => {
      const node = panelMeasureRef.current;
      if (!node || typeof ResizeObserver === "undefined") return;

      const observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        const width = entry?.contentRect.width ?? node.clientWidth;
        if (width <= 480) {
          setTileDensity("row");
        } else if (width <= 620) {
          setTileDensity("compact");
        } else {
          setTileDensity("comfortable");
        }
      });

      observer.observe(node);
      return () => observer.disconnect();
    }, []);

    useEffect(() => {
      const id = "cw_bulk_step_anim";
      if (document.getElementById(id)) return;
      const style = document.createElement("style");
      style.id = id;
      style.textContent = `
        @keyframes cwBulkStepSlideIn {
          from { opacity: 0; transform: translateX(28px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes cwBulkFocusPulse {
          0% { box-shadow: 0 0 0 0 rgba(15,118,110,0.24), 0 0 0 0 rgba(15,118,110,0.10); }
          50% { box-shadow: 0 0 0 2px rgba(15,118,110,0.28), 0 0 0 7px rgba(15,118,110,0.14); }
          100% { box-shadow: 0 0 0 0 rgba(15,118,110,0.24), 0 0 0 0 rgba(15,118,110,0.10); }
        }
        @keyframes cwBulkSavingSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `;
      document.head.appendChild(style);
    }, []);

    useEffect(() => {
      onSelectionChange?.();
    }, [onSelectionChange, selectedBulkCells]);

    useEffect(() => {
      if (!pendingConfirmation) return;
      const preferredRef = pendingConfirmation.publishPreferred
        ? publishConfirmButtonRef
        : sheetConfirmButtonRef;
      preferredRef.current?.focus();

      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          event.preventDefault();
          setPendingConfirmation(null);
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          confirmPendingBulkChoice(pendingConfirmation.publishPreferred);
        }
      };

      window.addEventListener("keydown", onKeyDown);
      return () => window.removeEventListener("keydown", onKeyDown);
    }, [confirmPendingBulkChoice, pendingConfirmation]);

    useEffect(() => {
      isMountedRef.current = true;
      return () => {
        isMountedRef.current = false;
        if (wizardAdvanceTimeoutRef.current != null) {
          window.clearTimeout(wizardAdvanceTimeoutRef.current);
        }
        if (wizardOutcomeTimeoutRef.current != null) {
          window.clearTimeout(wizardOutcomeTimeoutRef.current);
        }
        if (stepTwoClickTimeoutRef.current != null) {
          window.clearTimeout(stepTwoClickTimeoutRef.current);
        }
        if (highlightTimeoutRef.current != null) {
          window.clearTimeout(highlightTimeoutRef.current);
        }
      };
    }, []);

    useEffect(() => {
      if (wizardStep !== 2 || !scrollFocusA1) return;
      const node = rowRefs.current[scrollFocusA1];
      if (!node) return;
      node.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightedA1(scrollFocusA1);
      if (highlightTimeoutRef.current != null) {
        window.clearTimeout(highlightTimeoutRef.current);
      }
      highlightTimeoutRef.current = window.setTimeout(() => {
        setHighlightedA1((prev) => (prev === scrollFocusA1 ? null : prev));
        highlightTimeoutRef.current = null;
      }, 1500);
      setScrollFocusA1(null);
    }, [scrollFocusA1, wizardStep]);

    useEffect(() => {
      setPendingInlineSaves((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const cell of visibleBulkCandidates) {
          const pending = next[cell.a1];
          if (!pending || pending.saving) continue;
          if (norm(cell.originalValue) !== norm(pending.value)) continue;
          delete next[cell.a1];
          changed = true;
        }
        return changed ? next : prev;
      });
    }, [visibleBulkCandidates]);

    const selectedBulkCount = Object.keys(selectedBulkCells).length;

    function getPublishActionsForCells(cells: BulkSelectedCell[]): PublishAction[] {
      const weeks = new Set(cells.map((cell) => cell.week));
      const actions: PublishAction[] = [];
      if (weeks.has("cw")) actions.push("publishCurrentWeek");
      if (weeks.has("nw")) actions.push("publishNextWeek");
      return actions;
    }

    function formatPublishActionLabel(action: PublishAction) {
      return action === "publishCurrentWeek" ? "Current week" : action === "publishNextWeek" ? "Next week" : "Ping";
    }

    function formatPublishElapsed(startedAt: number) {
      const seconds = Math.max(0, (window.performance.now() - startedAt) / 1000);
      return `${seconds.toFixed(1)}s`;
    }

    function updatePublishToast(args: {
      id: number;
      title: string;
      lines: string[];
      actions?: SaveToast["actions"];
      kind?: SaveToast["kind"];
    }) {
      setSaveToast({
        id: args.id,
        kind: args.kind || "loading",
        title: args.title,
        lines: args.lines,
        actions: args.actions,
      });
    }

    function confirmPendingBulkChoice(publish: boolean) {
      if (!pendingConfirmation) return;
      const args = {
        targetBaseStatus: pendingConfirmation.targetBaseStatus,
        targetCancelled: pendingConfirmation.targetCancelled,
        caregiverNameOverride: pendingConfirmation.caregiverNameOverride,
      };
      setPendingConfirmation(null);
      applyBulkStatusChange(args, { publish });
    }

    async function runPublishForCells(cells: BulkSelectedCell[]) {
      const actions = getPublishActionsForCells(cells);
      if (!actions.length) return { ok: true as const, responses: [] as PublishResponse[] };

      const toastId = Date.now();
      const startedAt = window.performance.now();
      let timer: number | null = null;
      let dismissed = false;

      const dismiss = () => {
        dismissed = true;
        if (timer != null) {
          window.clearInterval(timer);
          timer = null;
        }
        setSaveToast((prev) => (prev?.id === toastId ? null : prev));
      };

      const renderLoading = (message = "Publishing to Firestore...") => {
        if (dismissed) return;
        updatePublishToast({
          id: toastId,
          kind: "loading",
          title: "✓ Sheet updated",
          lines: [message, `Elapsed: ${formatPublishElapsed(startedAt)}`],
          actions: [
            {
              label: "Dismiss",
              onClick: dismiss,
              variant: "secondary",
            },
          ],
        });
      };

      renderLoading();
      timer = window.setInterval(() => {
        renderLoading();
      }, 1000);

      const responses: PublishResponse[] = [];

      try {
        for (const action of actions) {
          const result = await publish(action);
          if (!result.ok) {
            if (timer != null) {
              window.clearInterval(timer);
              timer = null;
            }

            const actionLabel = formatPublishActionLabel(action);
            updatePublishToast({
              id: toastId,
              kind: "warning",
              title: `Publish failed: ${result.error}`,
              lines: [
                "Your sheet changes are saved.",
                "To sync Firestore, retry or run publish from the sheet's Schedule Manager menu.",
                actionLabel,
                ...(result.step ? [`Step: ${result.step}`] : []),
              ],
              actions: [
                {
                  label: "Retry Publish",
                  onClick: () => void runPublishForCells(cells),
                  variant: "primary",
                },
                {
                  label: "Dismiss",
                  onClick: dismiss,
                  variant: "secondary",
                },
              ],
            });

            return { ok: false as const, error: result.error, step: result.step };
          }

          responses.push(result.response);
        }

        if (timer != null) {
          window.clearInterval(timer);
          timer = null;
        }

        updatePublishToast({
          id: toastId,
          kind: "success",
          title: `Firestore synced (${formatPublishElapsed(startedAt)})`,
          lines: [
            "✓ Sheet updated",
            ...responses.map((response) => `✓ ${response.action || "Publish"} complete`),
            `Elapsed: ${formatPublishElapsed(startedAt)}`,
          ],
          actions: [
            {
              label: "Dismiss",
              onClick: dismiss,
              variant: "secondary",
            },
          ],
        });

        return { ok: true as const, responses };
      } catch (error: any) {
        if (timer != null) {
          window.clearInterval(timer);
          timer = null;
        }

        updatePublishToast({
          id: toastId,
          kind: "warning",
          title: "Publish failed",
          lines: [
            "Your sheet changes are saved.",
            error?.message ?? "Unable to publish changes.",
          ],
          actions: [
            {
              label: "Retry Publish",
              onClick: () => void runPublishForCells(cells),
              variant: "primary",
            },
            {
              label: "Dismiss",
              onClick: dismiss,
              variant: "secondary",
            },
          ],
        });

        return {
          ok: false as const,
          error: error?.message ?? "Unable to publish changes.",
        };
      }
    }

    function clearPendingWizardAdvance() {
      if (wizardAdvanceTimeoutRef.current != null) {
        window.clearTimeout(wizardAdvanceTimeoutRef.current);
        wizardAdvanceTimeoutRef.current = null;
      }
    }

    function clearWizardOutcomeTimeout() {
      if (wizardOutcomeTimeoutRef.current != null) {
        window.clearTimeout(wizardOutcomeTimeoutRef.current);
        wizardOutcomeTimeoutRef.current = null;
      }
    }

    function clearStepTwoClickTimeout() {
      if (stepTwoClickTimeoutRef.current != null) {
        window.clearTimeout(stepTwoClickTimeoutRef.current);
        stepTwoClickTimeoutRef.current = null;
      }
    }

    function resetBulkWizard() {
      clearPendingWizardAdvance();
      clearWizardOutcomeTimeout();
      setWizardOutcome(null);
      setSelectedBulkCells({});
      setBulkStepTwoArmed(false);
      setBulkSmartCaregiver("");
      setBulkSmartClient("");
      setBulkSmartStatus("Any");
      setBulkStepTwoSearch("");
      setShowCaregiverSuggestions(false);
      setShowClientSuggestions(false);
      setPendingConfirmation(null);
      setSuggestedStatus(null);
      setInlineCardEdit(null);
      setScrollFocusA1(null);
      setHighlightedA1(null);
      setPendingInlineSaves({});
      if (layout === "wizard") {
        setWizardStep(1);
      }
    }

    function queueWizardAutoAdvance() {
      if (layout !== "wizard") return;
      clearPendingWizardAdvance();
      wizardAdvanceTimeoutRef.current = window.setTimeout(() => {
        setWizardStep(2);
        wizardAdvanceTimeoutRef.current = null;
      }, 300);
    }

    function toggleBulkCellSelection(cell: BulkSelectedCell) {
      setSelectedBulkCells((prev) => {
        const next = { ...prev };
        if (next[cell.a1]) delete next[cell.a1];
        else next[cell.a1] = cell;
        return next;
      });
    }

    function clearBulkSelection(options?: { keepStep?: boolean; keepCandidates?: boolean }) {
      clearPendingWizardAdvance();
      clearWizardOutcomeTimeout();
      setWizardOutcome(null);
      setSelectedBulkCells({});
      if (!options?.keepCandidates) {
        setBulkStepTwoArmed(false);
      }
      setPendingConfirmation(null);
      setInlineCardEdit(null);
      setPendingInlineSaves({});
      if (layout === "wizard" && !options?.keepStep) {
        setWizardStep(1);
      }
    }

    function isBulkCellSelected(a1: string) {
      return Boolean(selectedBulkCells[a1]);
    }

    useImperativeHandle(
      ref,
      () => ({
        toggleBulkCellSelection,
        clearBulkSelection,
        isBulkCellSelected,
      }),
      [selectedBulkCells]
    );

    useEffect(() => {
      if (!hasMessageHandoff) return;
      if (!preselectedHandoffKey || appliedHandoffKeyRef.current === preselectedHandoffKey) return;
      if (!visibleBulkCandidates.length) return;

      const selectedCells = resolveBulkCellsFromShiftIDs({
        shiftIDs: preselectedShiftIDs,
        scheduleRows: props.scheduleRows,
        visibleBulkCandidates,
      });

      if (!selectedCells.length) return;

      const nextSelection: Record<string, BulkSelectedCell> = {};
      for (const cell of selectedCells) {
        nextSelection[cell.a1] = cell;
      }

      appliedHandoffKeyRef.current = preselectedHandoffKey;
      setSelectedBulkCells(nextSelection);
      setBulkStepTwoArmed(true);
      setSuggestedStatus(props.preselectedTargetStatus ?? "Offered");
      setWizardStep(3);
      if (props.preselectedPerfStartAt) {
        logBulkEditPerf("landed on step 3", props.preselectedPerfStartAt, {
          selectedCount: selectedCells.length,
        });
      }
      setBulkStepTwoSearch("");
      setBulkSelectionMode("caregiver");
      setBulkSmartCaregiver("");
      setBulkSmartClient("");
      setBulkSmartStatus("Any");
      setShowCaregiverSuggestions(false);
      setShowClientSuggestions(false);
      setPendingConfirmation(null);
      clearWizardOutcomeTimeout();
      setWizardOutcome(null);
    }, [
      hasMessageHandoff,
      preselectedHandoffKey,
      preselectedShiftIDs,
      props.preselectedTargetStatus,
      props.scheduleRows,
      visibleBulkCandidates,
    ]);

    function smartSelectByCaregiver(caregiverName: string) {
      const target = normalizeKey(caregiverName);
      if (!target) return 0;

      const matches = visibleBulkCandidates.filter((cell) => {
        const parsed = parseBulkShiftCell(cell.originalValue);
        return !parsed.isCancelled && normalizeKey(parsed.caregiverName || "") === target;
      });

      const next: Record<string, BulkSelectedCell> = {};
      for (const match of matches) next[match.a1] = match;
      setSelectedBulkCells(next);
      setBulkStepTwoArmed(true);
      return matches.length;
    }

    function smartSelectByClient(clientName: string) {
      const target = normalizeKey(clientName);
      if (!target) return 0;

      const matches = visibleBulkCandidates.filter(
        (cell) =>
          !parseBulkShiftCell(cell.originalValue).isCancelled &&
          normalizeKey(cell.clientName) === target
      );

      const next: Record<string, BulkSelectedCell> = {};
      for (const match of matches) next[match.a1] = match;
      setSelectedBulkCells(next);
      setBulkStepTwoArmed(true);
      return matches.length;
    }

    function smartSelectByStatus(status: Exclude<BulkSmartStatusFilter, "Any">) {
      const matches = visibleBulkCandidates.filter((cell) => {
        const parsed = parseBulkShiftCell(cell.originalValue);
        return !parsed.isCancelled && parsed.baseStatus === status;
      });

      const next: Record<string, BulkSelectedCell> = {};
      for (const match of matches) next[match.a1] = match;
      setSelectedBulkCells(next);
      setBulkStepTwoArmed(true);
      return matches.length;
    }

    function smartSelectByCaregiverAndStatus(
      caregiverName: string,
      status: BulkSmartStatusFilter
    ) {
      const target = normalizeKey(caregiverName);
      if (!target) return 0;

      const matches = visibleBulkCandidates.filter((cell) => {
        const parsed = parseBulkShiftCell(cell.originalValue);
        const caregiverMatch = normalizeKey(parsed.caregiverName || "") === target;
        const statusMatch = status === "Any" ? true : parsed.baseStatus === status;
        return !parsed.isCancelled && caregiverMatch && statusMatch;
      });

      const next: Record<string, BulkSelectedCell> = {};
      for (const match of matches) next[match.a1] = match;
      setSelectedBulkCells(next);
      setBulkStepTwoArmed(true);
      return matches.length;
    }

    function selectAllVisibleShifts() {
      const next: Record<string, BulkSelectedCell> = {};
      for (const cell of visibleBulkCandidates) next[cell.a1] = cell;
      setSelectedBulkCells(next);
      setBulkStepTwoArmed(true);
      return visibleBulkCandidates.length;
    }

    const bulkCaregiverSuggestions = useMemo(() => {
      const names = Array.from(
        new Set(
          visibleBulkCandidates
            .map((cell) => parseBulkShiftCell(cell.originalValue).caregiverName || "")
            .map((name) => norm(name))
            .filter(Boolean)
        )
      ).sort((a, b) => a.localeCompare(b));

      const query = normalizeKey(bulkSmartCaregiver);
      if (!query) return names.slice(0, 8);

      return names.filter((name) => normalizeKey(name).includes(query)).slice(0, 8);
    }, [bulkSmartCaregiver, visibleBulkCandidates]);

    const bulkClientSuggestions = useMemo(() => {
      const names = Array.from(
        new Set(visibleBulkCandidates.map((cell) => norm(cell.clientName)).filter(Boolean))
      ).sort((a, b) => a.localeCompare(b));

      const query = normalizeKey(bulkSmartClient);
      if (!query) return names.slice(0, 8);

      return names.filter((name) => normalizeKey(name).includes(query)).slice(0, 8);
    }, [bulkSmartClient, visibleBulkCandidates]);

    const bulkPreviewCandidates = useMemo(() => {
      if (hasMessageHandoff) {
        return Object.values(selectedBulkCells);
      }
      if (!bulkStepTwoArmed) return [];

      if (bulkSelectionMode === "caregiver") {
        const target = normalizeKey(bulkSmartCaregiver);
        if (!target) return [];
        return visibleBulkCandidates.filter((cell) => {
          const parsed = parseBulkShiftCell(cell.originalValue);
          const caregiverMatch = normalizeKey(parsed.caregiverName || "") === target;
          const statusMatch =
            bulkSmartStatus === "Any" ? true : parsed.baseStatus === bulkSmartStatus;
          return caregiverMatch && statusMatch;
        });
      }

      if (bulkSelectionMode === "client") {
        const target = normalizeKey(bulkSmartClient);
        if (!target) return [];
        return visibleBulkCandidates.filter((cell) => normalizeKey(cell.clientName) === target);
      }

      if (bulkSelectionMode === "status") {
        if (bulkSmartStatus === "Any") return [];
        return visibleBulkCandidates.filter(
          (cell) => parseBulkShiftCell(cell.originalValue).baseStatus === bulkSmartStatus
        );
      }

      return [];
    }, [
      bulkSelectionMode,
      bulkSmartCaregiver,
      bulkSmartClient,
      bulkSmartStatus,
      bulkStepTwoArmed,
      visibleBulkCandidates,
      hasMessageHandoff,
      selectedBulkCells,
    ]);

    const bulkShiftList = useMemo(() => {
      return bulkPreviewCandidates
        .map((cell) => {
          const pendingInlineValue = pendingInlineSaves[cell.a1];
          const effectiveOriginalValue = pendingInlineValue?.value ?? cell.originalValue;
          const parsed = parseBulkShiftCell(effectiveOriginalValue);
          const matchingScheduleRow = (Array.isArray(props.scheduleRows)
            ? props.scheduleRows.find((row: any) => {
                const sameClient = normalizeKey(row?.client ?? "") === normalizeKey(cell.clientName);
                const sameDate = dateKey(row?.date ?? "") === dateKey(cell.dateStr);
                const sameStart =
                  norm(row?.startTime ?? "").replace(/\s+/g, "").toUpperCase() ===
                  norm(parsed.startTime ?? "").replace(/\s+/g, "").toUpperCase();
                const sameEnd =
                  norm(row?.endTime ?? "").replace(/\s+/g, "").toUpperCase() ===
                  norm(parsed.endTime ?? "").replace(/\s+/g, "").toUpperCase();
                return sameClient && sameDate && sameStart && sameEnd;
              })
            : null) as { status?: string } | null;
          const isCancelled = parsed.isCancelled || scheduleRowIsCancelled(matchingScheduleRow?.status);
          const formattedDayDate = formatShortDayDate(cell.dateStr);
          const currentStatusLabel = statusSearchLabel(parsed.baseStatus, isCancelled);
          return {
            ...cell,
            originalValue: effectiveOriginalValue,
            caregiverName: parsed.caregiverName || "Open",
            status: parsed.baseStatus,
            isCancelled,
            currentStatusLabel,
            startTime: parsed.startTime || "",
            endTime: parsed.endTime || "",
            selected: Boolean(selectedBulkCells[cell.a1]),
            isSaving: Boolean(pendingInlineValue?.saving),
            searchableText: normalizeKey(
              [
                cell.clientName,
                parsed.caregiverName || "Open",
                cell.dayLabel,
                formattedDayDate,
                currentStatusLabel,
              ].join(" ")
            ),
          };
        })
        .sort((a, b) => {
          const dateCmp = dateKey(a.dateStr).localeCompare(dateKey(b.dateStr));
          if (dateCmp !== 0) return dateCmp;
          const timeCmp =
            (parseTimeToMinutes(a.startTime) ?? 0) - (parseTimeToMinutes(b.startTime) ?? 0);
          if (timeCmp !== 0) return timeCmp;
          return a.clientName.localeCompare(b.clientName);
        });
    }, [bulkPreviewCandidates, pendingInlineSaves, props.scheduleRows, selectedBulkCells]);
    const bulkSearchTokens = useMemo(
      () => tokenizeSearchQuery(bulkStepTwoSearch),
      [bulkStepTwoSearch]
    );
    const filteredBulkShiftList = useMemo(() => {
      if (!bulkSearchTokens.length) return bulkShiftList;
      return bulkShiftList.filter((cell) =>
        bulkSearchTokens.every((token) => cell.searchableText.includes(token))
      );
    }, [bulkSearchTokens, bulkShiftList]);
    const selectableFilteredBulkShiftList = filteredBulkShiftList.filter((cell) => !cell.isCancelled);
    const allPreviewSelected =
      selectableFilteredBulkShiftList.length > 0 &&
      selectableFilteredBulkShiftList.every((cell) => Boolean(selectedBulkCells[cell.a1]));
    const visibleSelectedCount = filteredBulkShiftList.filter((cell) => cell.selected).length;
    const hiddenSelectedCount = Math.max(0, selectedBulkCount - visibleSelectedCount);

    function selectAllPreviewCandidates() {
      setSelectedBulkCells((prev) => {
        const next = { ...prev };
        for (const cell of filteredBulkShiftList) {
          if (cell.isCancelled) continue;
          next[cell.a1] = cell;
        }
        return next;
      });
      clearWizardOutcomeTimeout();
      setWizardOutcome(null);
      setBulkStepTwoArmed(true);
      return filteredBulkShiftList.length;
    }

    function deselectAllPreviewCandidates() {
      clearPendingWizardAdvance();
      clearWizardOutcomeTimeout();
      setWizardOutcome(null);
      setSelectedBulkCells((prev) => {
        const next = { ...prev };
        for (const cell of filteredBulkShiftList) {
          delete next[cell.a1];
        }
        return next;
      });
    }

    function handleStepTwoCardClick(cell: BulkSelectedCell) {
      if (pendingConfirmation) return;
      clearStepTwoClickTimeout();
      stepTwoClickTimeoutRef.current = window.setTimeout(() => {
        toggleBulkCellSelection(cell);
        stepTwoClickTimeoutRef.current = null;
      }, 180);
    }

    function handleStepTwoCardDoubleClick(cell: BulkSelectedCell) {
      if (pendingConfirmation) return;
      clearStepTwoClickTimeout();
      setInlineCardEdit({
        a1: cell.a1,
        value: cell.originalValue,
      });
    }

    function cancelInlineCardEdit() {
      setInlineCardEdit(null);
    }

    function commitInlineCardEdit(cell: BulkSelectedCell) {
      if (!inlineCardEdit) return;
      const nextValue = inlineCardEdit.value;
      const requestId = ++inlineSaveRequestRef.current;
      setPendingInlineSaves((prev) => ({
        ...prev,
        [cell.a1]: {
          value: nextValue,
          previousValue: cell.originalValue,
          requestId,
          saving: true,
        },
      }));
      setInlineCardEdit(null);
      void saveInlineEdit({
        a1: cell.a1,
        newVal: nextValue,
        clientName: cell.clientName,
        shiftDateForSave: cell.dateStr,
        dayLabel: cell.dayLabel,
        weekOf: weekStartYmd,
        backgroundRefresh: true,
      }).then((saved) => {
        if (!isMountedRef.current) return;
        setPendingInlineSaves((prev) => {
          const pending = prev[cell.a1];
          if (!pending || pending.requestId !== requestId) return prev;
          if (saved) {
            return {
              ...prev,
              [cell.a1]: {
                ...pending,
                saving: false,
              },
            };
          }
          const next = { ...prev };
          delete next[cell.a1];
          return next;
        });
        if (!saved) {
          setPanelFailureBanner(
            "Bulk update failed: The raw cell edit could not be saved. Changes were reverted."
          );
        }
      });
    }

    const bulkStepOneReady = Boolean(bulkSelectionMode);
    const bulkStepTwoVisible = bulkStepOneReady;
    const bulkStepThreeVisible = bulkStepTwoArmed && bulkShiftList.length > 0;

    function resetBulkSearchUi(mode: "caregiver" | "client" | "status") {
      setBulkSelectionMode(mode);
      setBulkStepTwoArmed(false);
      setBulkSmartCaregiver("");
      setBulkSmartClient("");
      setBulkSmartStatus("Any");
      setBulkStepTwoSearch("");
      setShowCaregiverSuggestions(false);
      setShowClientSuggestions(false);
      clearWizardOutcomeTimeout();
      setWizardOutcome(null);
      setPendingConfirmation(null);
      setSuggestedStatus(null);
      setInlineCardEdit(null);
    }

    async function runBulkStatusChange(args: {
      targetBaseStatus?: BulkTargetStatus;
      targetCancelled?: "keep" | boolean;
      caregiverNameOverride?: string | null;
    }, cells: BulkSelectedCell[], opts?: { suppressToast?: boolean }) {
      const successes: string[] = [];
      const failures: string[] = [];

      for (const cell of cells) {
        const parsed = parseBulkShiftCell(cell.originalValue);
        const targetBaseStatus =
          args.targetBaseStatus ?? (parsed.baseStatus === "Unknown" ? null : parsed.baseStatus);

        const targetCancelled =
          args.targetCancelled === "keep"
            ? parsed.isCancelled
            : typeof args.targetCancelled === "boolean"
            ? args.targetCancelled
            : parsed.isCancelled;

        if (!targetBaseStatus) {
          failures.push(`${cell.clientName} • ${cell.dayLabel} • Conversion failed`);
          continue;
        }

        let nextCellText = "";
        try {
          nextCellText = cleanBulkCellValue({
            rawText: cell.originalValue,
            targetBaseStatus,
            caregiverNameOverride: args.caregiverNameOverride ?? undefined,
            targetCancelled,
          });
        } catch (error) {
          failures.push(
            `${cell.clientName} • ${cell.dayLabel} • ${
              error instanceof Error ? error.message : "Conversion failed"
            }`
          );
          continue;
        }

        if (draftMode) {
          setDraftCell({
            a1: cell.a1,
            week: cell.week,
            originalValue: cell.originalValue,
            draftValue: nextCellText,
            clientName: cell.clientName,
            dateStr: cell.dateStr,
            dayLabel: cell.dayLabel,
          });
          successes.push(`${cell.clientName} • ${cell.dayLabel}`);
        } else {
          console.log("[BulkEditConfirm] apply cell payload", {
            a1: cell.a1,
            clientName: cell.clientName,
            dayLabel: cell.dayLabel,
            targetBaseStatus,
            targetCancelled,
            week: cell.week,
          });
          const saved = await saveInlineEdit({
            a1: cell.a1,
            newVal: nextCellText,
            clientName: cell.clientName,
            shiftDateForSave: cell.dateStr,
            dayLabel: cell.dayLabel,
            weekOf: weekStartYmd,
            backgroundRefresh: false,
          });
          if (saved) {
            successes.push(`${cell.clientName} • ${cell.dayLabel}`);
          } else {
            failures.push(`${cell.clientName} • ${cell.dayLabel} • Save failed`);
          }
        }
      }

      if (!draftMode && successes.length) {
        void refreshScheduleStateInBackground({
          includeGrid: false,
          includeEditLog: true,
        });
      }

      if (!opts?.suppressToast) {
        setSaveToast({
          id: Date.now(),
          kind: failures.length ? "warning" : "success",
          title: failures.length
            ? "Bulk update finished with warnings"
            : draftMode
            ? "Bulk draft update complete"
            : "Bulk update complete",
          lines: [
            `${successes.length} shift${successes.length === 1 ? "" : "s"} updated.`,
            ...failures.slice(0, 8),
            ...(failures.length > 8 ? [`+${failures.length - 8} more issue(s)`] : []),
          ],
        });
      }

      return { successes, failures };
    }

    function applyBulkStatusChange(args: {
      targetBaseStatus?: BulkTargetStatus;
      targetCancelled?: "keep" | boolean;
      caregiverNameOverride?: string | null;
    }, opts?: { publish?: boolean }) {
      const cells = Object.values(selectedBulkCells);

      if (!cells.length) {
        setSaveToast({
          id: Date.now(),
          kind: "warning",
          title: "No shifts selected",
          lines: ["Select one or more shifts first."],
        });
        return;
      }

      if (layout === "wizard") {
        clearWizardOutcomeTimeout();
        setPanelFailureBanner(null);
        setWizardOutcome({ kind: "success", updatedCount: cells.length });
        wizardOutcomeTimeoutRef.current = window.setTimeout(() => {
          if (!isMountedRef.current) return;
          resetBulkWizard();
        }, 600);

        void (async () => {
          try {
            const { failures } = await runBulkStatusChange(args, cells, {
              suppressToast: Boolean(opts?.publish),
            });
            if (failures.length) {
              if (!isMountedRef.current) return;
              setPanelFailureBanner(
                `Bulk update failed: ${outcomeSummaryMessage(failures)} Changes were reverted.`
              );
              return;
            }
            if (!opts?.publish || !isMountedRef.current) return;
            await runPublishForCells(cells);
          } catch (err: any) {
            if (!isMountedRef.current) return;
            setSaveToast({
              id: Date.now(),
              kind: "error",
              title: "Bulk update failed",
              lines: [err?.message ?? "Unable to apply bulk changes."],
            });
            setPanelFailureBanner(
              `Bulk update failed: ${
                err?.message ?? "Unable to apply bulk changes."
              } Changes were reverted.`
            );
          }
        })();
        return;
      }

      void (async () => {
        try {
          setBulkApplying(true);
          const { failures } = await runBulkStatusChange(args, cells, {
            suppressToast: Boolean(opts?.publish),
          });
          if (!failures.length && opts?.publish) {
            await runPublishForCells(cells);
          }
        } catch (err: any) {
          setSaveToast({
            id: Date.now(),
            kind: "error",
            title: "Bulk update failed",
            lines: [err?.message ?? "Unable to apply bulk changes."],
          });
        } finally {
          if (isMountedRef.current) {
            setBulkApplying(false);
          }
        }
      })();
    }

    function openBulkStatusConfirmation(args: {
      targetBaseStatus?: BulkTargetStatus;
      targetCancelled?: "keep" | boolean;
      caregiverNameOverride?: string | null;
      publishPreferred?: boolean;
    }) {
      const cells = Object.values(selectedBulkCells);
      if (!cells.length) {
        setSaveToast({
          id: Date.now(),
          kind: "warning",
          title: "No shifts selected",
          lines: ["Select one or more shifts first."],
        });
        return;
      }

      const targetStatus =
        args.targetBaseStatus ?? (args.targetCancelled ? "Cancelled" : "Filled");
      const title = `Change ${cells.length} shift${cells.length === 1 ? "" : "s"} to ${
        targetStatus === "PendingClientApproval" ? "Pending" : targetStatus
      }?`;
      const rows = cells.map((cell) => {
        const parsed = parseBulkShiftCell(cell.originalValue);
        const caregiver = parsed.caregiverName || "Open";
        const when = formatShortDayDate(cell.dateStr);
        const timeLabel =
          parsed.startTime && parsed.endTime
            ? `${parsed.startTime}-${parsed.endTime}`
            : parsed.timeText || "Time unavailable";
        return {
          a1: cell.a1,
          descriptor: `${caregiver} · ${when} · ${timeLabel}`,
          currentStatusLabel: statusSearchLabel(parsed.baseStatus, parsed.isCancelled),
          currentBaseStatus: parsed.baseStatus,
          currentIsCancelled: parsed.isCancelled,
        };
      });

      setPendingConfirmation({
        title,
        tone:
          targetStatus === "Cancelled"
            ? { bg: "#f8fafc", border: "#111827", text: "#111827" }
            : bulkStatusTone(targetStatus as BulkTargetStatus),
        indicator: renderStatusIndicator(targetStatus as BulkTargetStatus | "Cancelled", 12),
        targetBaseStatus: args.targetBaseStatus,
        targetCancelled: args.targetCancelled,
        caregiverNameOverride: args.caregiverNameOverride,
        targetStatusLabel: targetStatus === "PendingClientApproval" ? "Pending" : targetStatus,
        publishPreferred:
          typeof args.publishPreferred === "boolean"
            ? args.publishPreferred
            : hasMessageHandoff &&
              props.preselectedTargetStatus === "Filled" &&
              targetStatus === "Filled",
        rows,
        selectedCount: cells.length,
      });
    }

    function handleWizardModeChange(mode: "caregiver" | "client" | "status") {
      resetBulkSearchUi(mode);
      if (layout === "wizard") {
        clearPendingWizardAdvance();
      }
    }

    function handleWizardCaregiverSelect(name: string) {
      setBulkSmartCaregiver(name);
      setShowCaregiverSuggestions(false);
      const count = smartSelectByCaregiverAndStatus(name, bulkSmartStatus);
      if (count > 0) queueWizardAutoAdvance();
    }

    function handleWizardClientSelect(name: string) {
      setBulkSmartClient(name);
      setShowClientSuggestions(false);
      const count = smartSelectByClient(name);
      if (count > 0) queueWizardAutoAdvance();
    }

    function handleWizardStatusSelect(status: Exclude<BulkSmartStatusFilter, "Any">) {
      const count = smartSelectByStatus(status);
      if (count > 0) queueWizardAutoAdvance();
    }

    const wizardStepLabel =
      wizardStep === 1 ? "Find Shifts" : wizardStep === 2 ? "Review" : "Apply Change";
    const wizardCanAdvance = selectedBulkCount > 0;
    const tileStatusCounts = useMemo(() => {
      const counts: Record<string, number> = {};
      for (const tile of STATUS_TILE_ORDER) {
        counts[tile.status] = 0;
      }
      for (const cell of Object.values(selectedBulkCells)) {
        const parsed = parseBulkShiftCell(cell.originalValue);
        if (parsed.baseStatus !== "Unknown") {
          counts[parsed.baseStatus] = (counts[parsed.baseStatus] ?? 0) + 1;
        }
        if (parsed.isCancelled) {
          counts.Cancelled = (counts.Cancelled ?? 0) + 1;
        }
      }
      return counts;
    }, [selectedBulkCells]);
    const tileGridColumns = tileDensity === "row" ? "1fr" : "repeat(2, minmax(0, 1fr))";
    const tileHeight = tileDensity === "comfortable" ? 80 : tileDensity === "compact" ? 68 : 44;
    const tileLabelFontSize =
      tileDensity === "comfortable" ? 12 : tileDensity === "compact" ? 11 : 11;
    const tileMetaVisible = tileDensity !== "row";
    const tileIndicatorSize = tileDensity === "comfortable" ? 20 : tileDensity === "compact" ? 18 : 16;
    const wizardFooterDisabled = Boolean(wizardOutcome || pendingConfirmation);

    if (layout === "wizard") {
      return (
        <div
          ref={panelMeasureRef}
          style={{
            height: "100%",
            minHeight: 0,
            display: "grid",
            gridTemplateRows: panelFailureBanner ? "auto 1fr auto" : "1fr auto",
            gap: 0,
            border: `1px solid ${UI.border}`,
            borderRadius: 16,
            background: UI.panelBg,
            overflow: "hidden",
          }}
        >
          {panelFailureBanner ? (
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 10,
                padding: "10px 12px",
                background: "#fee2e2",
                borderBottom: `1px solid #fecaca`,
                color: "#991b1b",
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 900, lineHeight: 1.45 }}>
                {panelFailureBanner}
              </div>
              <button
                type="button"
                onClick={() => setPanelFailureBanner(null)}
                style={{
                  border: "none",
                  background: "transparent",
                  color: "#991b1b",
                  fontSize: 14,
                  fontWeight: 1000,
                  lineHeight: 1,
                  cursor: "pointer",
                  padding: 0,
                  flexShrink: 0,
                }}
                aria-label="Dismiss failure message"
              >
                ×
              </button>
            </div>
          ) : null}
          <div
            style={{
              minHeight: 0,
              overflow: "hidden",
              padding: 10,
            }}
          >
            {wizardStep === 1 ? (
              <div
                style={{
                  height: "100%",
                  minHeight: 0,
                  display: "grid",
                  gridTemplateRows: "auto auto 1fr",
                  gap: 6,
                  padding: 8,
                  border: `1px solid ${UI.borderSoft}`,
                  borderRadius: 14,
                  background: UI.headerBg,
                  animation: "cwBulkStepSlideIn 220ms ease both",
                  overflow: "hidden",
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 1000, color: UI.text }}>Find Shifts</div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(112px, 1fr))",
                    gap: 6,
                  }}
                >
                  {(
                    [
                      ["caregiver", "By Caregiver"],
                      ["client", "By Client"],
                      ["status", "By Status"],
                    ] as const
                  ).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => handleWizardModeChange(mode)}
                      style={{
                        border: `1px solid ${
                          bulkSelectionMode === mode ? "#111827" : UI.border
                        }`,
                        background: bulkSelectionMode === mode ? "#111827" : "#fff",
                        color: bulkSelectionMode === mode ? "#fff" : UI.text,
                        borderRadius: 999,
                        minHeight: 32,
                        padding: "6px 8px",
                        fontSize: 10.5,
                        cursor: "pointer",
                        fontWeight: 900,
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div style={{ minHeight: 0, overflow: "auto", paddingRight: 2 }}>
                  {bulkSelectionMode === "caregiver" ? (
                    <div style={{ display: "grid", gap: 6 }}>
                      <div style={{ position: "relative" }}>
                        <input
                          value={bulkSmartCaregiver}
                          onChange={(e) => {
                            clearPendingWizardAdvance();
                            setBulkSmartCaregiver(e.target.value);
                            setBulkStepTwoArmed(false);
                            setShowCaregiverSuggestions(true);
                          }}
                          onFocus={() => setShowCaregiverSuggestions(true)}
                          onKeyDown={(e) => {
                            if (e.key !== "Enter") return;
                            const count = smartSelectByCaregiverAndStatus(
                              bulkSmartCaregiver,
                              bulkSmartStatus
                            );
                            if (count > 0) queueWizardAutoAdvance();
                          }}
                          placeholder="Search caregiver…"
                          style={{
                            width: "100%",
                            border: `1px solid ${UI.border}`,
                            borderRadius: 12,
                            minHeight: 32,
                            padding: "8px 10px",
                            fontSize: 11,
                            outline: "none",
                            background: UI.panelBg,
                            boxSizing: "border-box",
                          }}
                        />

                        {showCaregiverSuggestions && bulkCaregiverSuggestions.length > 0 ? (
                          <div
                            style={{
                              position: "absolute",
                              top: "calc(100% + 4px)",
                              left: 0,
                              right: 0,
                              background: "#fff",
                              border: `1px solid ${UI.border}`,
                              borderRadius: 12,
                              boxShadow: "0 8px 20px rgba(0,0,0,0.12)",
                              zIndex: TOPNAV_Z + 20,
                              overflow: "hidden",
                            }}
                          >
                            {bulkCaregiverSuggestions.map((name) => (
                              <button
                                key={name}
                                type="button"
                                onClick={() => handleWizardCaregiverSelect(name)}
                                style={{
                                  width: "100%",
                                  textAlign: "left",
                                  border: "none",
                                  background: "#fff",
                                  minHeight: 32,
                                  padding: "8px 10px",
                                  fontSize: 11,
                                  cursor: "pointer",
                                  fontWeight: 800,
                                }}
                              >
                                {name}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>

                      <select
                        value={bulkSmartStatus}
                        onChange={(e) => {
                          const nextStatus = e.target.value as BulkSmartStatusFilter;
                          clearPendingWizardAdvance();
                          setBulkSmartStatus(nextStatus);
                          setBulkStepTwoArmed(false);
                          if (norm(bulkSmartCaregiver)) {
                            const count = smartSelectByCaregiverAndStatus(
                              bulkSmartCaregiver,
                              nextStatus
                            );
                            if (count > 0) queueWizardAutoAdvance();
                          }
                        }}
                        style={{
                          border: `1px solid ${UI.border}`,
                          borderRadius: 12,
                          minHeight: 32,
                          padding: "8px 10px",
                          fontSize: 11,
                          outline: "none",
                          background: UI.panelBg,
                          fontWeight: 800,
                          width: "100%",
                        }}
                      >
                        <option value="Any">Any status</option>
                        <option value="Open">Open</option>
                        <option value="Filled">Filled</option>
                        <option value="Offered">Offered</option>
                        <option value="Considering">Considering</option>
                        <option value="PendingClientApproval">Pending Approval</option>
                      </select>
                    </div>
                  ) : null}

                  {bulkSelectionMode === "client" ? (
                    <div style={{ display: "grid", gap: 6 }}>
                      <div style={{ position: "relative" }}>
                        <input
                          value={bulkSmartClient}
                          onChange={(e) => {
                            clearPendingWizardAdvance();
                            setBulkSmartClient(e.target.value);
                            setBulkStepTwoArmed(false);
                            setShowClientSuggestions(true);
                          }}
                          onFocus={() => setShowClientSuggestions(true)}
                          onKeyDown={(e) => {
                            if (e.key !== "Enter") return;
                            const count = smartSelectByClient(bulkSmartClient);
                            if (count > 0) queueWizardAutoAdvance();
                          }}
                          placeholder="Search client…"
                          style={{
                            width: "100%",
                            border: `1px solid ${UI.border}`,
                            borderRadius: 12,
                            minHeight: 32,
                            padding: "8px 10px",
                            fontSize: 11,
                            outline: "none",
                            background: UI.panelBg,
                            boxSizing: "border-box",
                          }}
                        />

                        {showClientSuggestions && bulkClientSuggestions.length > 0 ? (
                          <div
                            style={{
                              position: "absolute",
                              top: "calc(100% + 4px)",
                              left: 0,
                              right: 0,
                              background: "#fff",
                              border: `1px solid ${UI.border}`,
                              borderRadius: 12,
                              boxShadow: "0 8px 20px rgba(0,0,0,0.12)",
                              zIndex: TOPNAV_Z + 20,
                              overflow: "hidden",
                            }}
                          >
                            {bulkClientSuggestions.map((name) => (
                              <button
                                key={name}
                                type="button"
                                onClick={() => handleWizardClientSelect(name)}
                                style={{
                                  width: "100%",
                                  textAlign: "left",
                                  border: "none",
                                  background: "#fff",
                                  minHeight: 32,
                                  padding: "8px 10px",
                                  fontSize: 11,
                                  cursor: "pointer",
                                  fontWeight: 800,
                                }}
                              >
                                {name}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  {bulkSelectionMode === "status" ? (
                    <div style={{ display: "grid", gap: 6 }}>
                      <select
                        value={bulkSmartStatus}
                        onChange={(e) => {
                          const nextStatus = e.target.value as BulkSmartStatusFilter;
                          clearPendingWizardAdvance();
                          setBulkSmartStatus(nextStatus);
                          setBulkStepTwoArmed(false);
                          if (nextStatus !== "Any") {
                            handleWizardStatusSelect(nextStatus);
                          }
                        }}
                        style={{
                          border: `1px solid ${UI.border}`,
                          borderRadius: 12,
                          minHeight: 32,
                          padding: "8px 10px",
                          fontSize: 11,
                          outline: "none",
                          background: UI.panelBg,
                          fontWeight: 800,
                          width: "100%",
                        }}
                      >
                        <option value="Any">Any status</option>
                        <option value="Open">Open</option>
                        <option value="Filled">Filled</option>
                        <option value="Offered">Offered</option>
                        <option value="Considering">Considering</option>
                        <option value="PendingClientApproval">Pending Approval</option>
                      </select>
                    </div>
                  ) : null}

                </div>
              </div>
            ) : null}

            {wizardStep === 2 ? (
              <div
                style={{
                  height: "100%",
                  minHeight: 0,
                  display: "grid",
                  gridTemplateRows: "auto 1fr auto",
                  gap: 8,
                  padding: 10,
                  border: `1px solid ${UI.borderSoft}`,
                  borderRadius: 14,
                  background: UI.headerBg,
                  animation: "cwBulkStepSlideIn 240ms ease both",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 1000, color: UI.text }}>
                    {selectedBulkCount} shifts selected
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      disabled={!selectableFilteredBulkShiftList.length}
                      onClick={() => {
                        if (allPreviewSelected) {
                          deselectAllPreviewCandidates();
                          return;
                        }
                        selectAllPreviewCandidates();
                      }}
                      style={{
                        border: "none",
                        background: "transparent",
                        color: selectableFilteredBulkShiftList.length ? UI.textDim : "#9ca3af",
                        fontSize: 10.5,
                        fontWeight: 900,
                        cursor: selectableFilteredBulkShiftList.length ? "pointer" : "default",
                        padding: 0,
                      }}
                    >
                      {allPreviewSelected ? "Deselect All" : "Select All"}
                    </button>
                  </div>
                </div>

                <div
                  style={{
                    minHeight: 0,
                    overflow: "hidden",
                    display: "grid",
                    gap: 6,
                  }}
                >
                  <div style={{ position: "relative" }}>
                    <input
                      value={bulkStepTwoSearch}
                      onChange={(e) => setBulkStepTwoSearch(e.target.value)}
                      placeholder="Search client, caregiver, day, or status"
                      style={{
                        width: "100%",
                        border: `1px solid ${UI.border}`,
                        borderRadius: 12,
                        minHeight: 32,
                        padding: bulkStepTwoSearch ? "8px 32px 8px 10px" : "8px 10px",
                        fontSize: 11,
                        outline: "none",
                        background: UI.panelBg,
                        boxSizing: "border-box",
                      }}
                    />
                    {bulkStepTwoSearch.trim() ? (
                      <button
                        type="button"
                        onClick={() => setBulkStepTwoSearch("")}
                        aria-label="Clear search"
                        style={{
                          position: "absolute",
                          top: "50%",
                          right: 10,
                          transform: "translateY(-50%)",
                          border: "none",
                          background: "transparent",
                          color: UI.textDim,
                          fontSize: 14,
                          fontWeight: 1000,
                          lineHeight: 1,
                          cursor: "pointer",
                          padding: 0,
                        }}
                      >
                        ×
                      </button>
                    ) : null}
                  </div>

                  <div
                    style={{
                      minHeight: 0,
                      overflow: "auto",
                      paddingRight: 4,
                      display: "grid",
                      gap: 6,
                    }}
                  >
                  {filteredBulkShiftList.length ? (
                    filteredBulkShiftList.map((cell) => {
                      const tone = currentStatusTone(cell.status, cell.isCancelled);
                      const selectionCell = {
                        a1: cell.a1,
                        week: cell.week,
                        clientName: cell.clientName,
                        dateStr: cell.dateStr,
                        dayLabel: cell.dayLabel,
                        originalValue: cell.originalValue,
                      };
                      const isEditing = inlineCardEdit?.a1 === cell.a1;
                      return (
                        <div
                          key={cell.a1}
                          ref={(node) => {
                            rowRefs.current[cell.a1] = node;
                          }}
                          style={{
                            position: "relative",
                            border: `2px solid ${cell.selected ? "#0f766e" : tone.border}`,
                            background: tone.bg,
                            borderRadius: 12,
                            padding: "8px",
                            opacity: cell.isCancelled ? 0.56 : 1,
                            boxShadow:
                              highlightedA1 === cell.a1
                                ? "0 0 0 2px rgba(15,118,110,0.28), 0 0 0 6px rgba(15,118,110,0.12)"
                                : cell.selected
                                ? "inset 0 0 0 1px rgba(15,118,110,0.22), 0 0 0 1px rgba(15,118,110,0.10)"
                                : "none",
                            transition: "box-shadow 140ms ease",
                            animation:
                              highlightedA1 === cell.a1
                                ? "cwBulkFocusPulse 700ms ease-in-out 2"
                                : "none",
                          }}
                        >
                          {cell.isSaving ? (
                            <span
                              aria-hidden="true"
                              style={{
                                position: "absolute",
                                top: 7,
                                left: 7,
                                width: 15,
                                height: 15,
                                borderRadius: 999,
                                border: "2px solid rgba(107,114,128,0.75)",
                                borderTopColor: "transparent",
                                display: "inline-block",
                                animation: "cwBulkSavingSpin 700ms linear infinite",
                                boxSizing: "border-box",
                              }}
                            />
                          ) : null}
                          {cell.selected ? (
                            <span
                              aria-hidden="true"
                              style={{
                                position: "absolute",
                                top: 6,
                                right: 6,
                                width: 19,
                                height: 19,
                                borderRadius: 999,
                                background: "#0f766e",
                                color: "#fff",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: 11,
                                fontWeight: 1000,
                                lineHeight: 1,
                              }}
                            >
                              ✓
                            </span>
                          ) : null}
                          {isEditing ? (
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <input
                                type="text"
                                value={inlineCardEdit.value}
                                onChange={(event) =>
                                  setInlineCardEdit({
                                    a1: cell.a1,
                                    value: event.target.value,
                                  })
                                }
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    commitInlineCardEdit(selectionCell);
                                  } else if (event.key === "Escape") {
                                    event.preventDefault();
                                    cancelInlineCardEdit();
                                  }
                                }}
                                autoFocus
                                style={{
                                  flex: 1,
                                  minWidth: 0,
                                  border: `1px solid ${UI.border}`,
                                  borderRadius: 10,
                                  minHeight: 32,
                                  padding: "6px 10px",
                                  fontSize: 11,
                                  outline: "none",
                                  background: "#fff",
                                }}
                              />
                              <button
                                type="button"
                                onClick={() => commitInlineCardEdit(selectionCell)}
                                style={{
                                  border: `1px solid ${UI.border}`,
                                  background: "#fff",
                                  color: UI.text,
                                  borderRadius: 10,
                                  minHeight: 32,
                                  padding: "6px 10px",
                                  fontSize: 10.5,
                                  cursor: "pointer",
                                  fontWeight: 900,
                                }}
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={cancelInlineCardEdit}
                                style={{
                                  border: `1px solid ${UI.border}`,
                                  background: UI.headerBg,
                                  color: UI.text,
                                  borderRadius: 10,
                                  minHeight: 32,
                                  padding: "6px 10px",
                                  fontSize: 10.5,
                                  cursor: "pointer",
                                  fontWeight: 900,
                                }}
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleStepTwoCardClick(selectionCell)}
                              onDoubleClick={() => handleStepTwoCardDoubleClick(selectionCell)}
                              style={{
                                width: "100%",
                                border: "none",
                                background: "transparent",
                                padding: 0,
                                display: "grid",
                                gap: 6,
                                textAlign: "left",
                                cursor: "pointer",
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  gap: 8,
                                  alignItems: "flex-start",
                                  flexWrap: "wrap",
                                }}
                              >
                                <div
                                  style={{
                                    fontSize: 11,
                                    fontWeight: 1000,
                                    color: UI.text,
                                    minWidth: 0,
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {cell.clientName}
                                </div>
                                <span
                                  style={{
                                    fontSize: 10.5,
                                    color: cell.selected ? "#0f766e" : UI.textDim,
                                    fontWeight: 900,
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {formatShortDayDate(cell.dateStr)}
                                </span>
                              </div>
                              <div
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  gap: 8,
                                  alignItems: "center",
                                  flexWrap: "wrap",
                                }}
                              >
                                <div
                                  style={{
                                    fontSize: 10.5,
                                    color: tone.text,
                                    fontWeight: 900,
                                    lineHeight: 1.35,
                                    minWidth: 0,
                                  }}
                                >
                                  {cell.caregiverName}
                                  {cell.startTime && cell.endTime
                                    ? ` • ${cell.startTime}-${cell.endTime}`
                                    : ""}
                                </div>
                                {renderStatusChip({
                                  label:
                                    cell.currentStatusLabel === "Pending Pending Approval"
                                      ? "Pending"
                                      : cell.currentStatusLabel,
                                  tone,
                                })}
                              </div>
                            </button>
                          )}
                        </div>
                      );
                    })
                  ) : bulkShiftList.length && bulkSearchTokens.length ? (
                    <div
                      style={{
                        padding: 12,
                        borderRadius: 12,
                        border: `1px dashed ${UI.border}`,
                        background: "#fff",
                        fontSize: 10.5,
                        color: UI.textDim,
                        fontWeight: 800,
                      }}
                    >
                      No matches
                    </div>
                  ) : (
                    <div
                      style={{
                        padding: 12,
                        borderRadius: 12,
                        border: `1px dashed ${UI.border}`,
                        background: "#fff",
                        fontSize: 10.5,
                        color: UI.textDim,
                        fontWeight: 800,
                      }}
                    >
                      No shifts selected. The matched shifts are still shown here; click any shift
                      to re-select it or go Back to change filters.
                    </div>
                  )}
                  </div>
                </div>

                <div style={{ minHeight: 14 }}>
                  {hiddenSelectedCount > 0 ? (
                    <div style={{ fontSize: 10.5, color: UI.textDim, fontWeight: 800 }}>
                      {hiddenSelectedCount} selected shift
                      {hiddenSelectedCount === 1 ? "" : "s"} hidden by search
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {wizardStep === 3 ? (
              <div
                style={{
                  position: "relative",
                  height: "100%",
                  minHeight: 0,
                  display: "grid",
                  gridTemplateRows: "auto 1fr",
                  gap: 8,
                  padding: 8,
                  border: `1px solid ${UI.borderSoft}`,
                  borderRadius: 14,
                  background: UI.headerBg,
                  animation: "cwBulkStepSlideIn 260ms ease both",
                  overflow: "hidden",
                }}
              >
                {wizardOutcome ? (
                  <div
                    style={{
                      minHeight: 0,
                      display: "grid",
                      placeItems: "center",
                      padding: 16,
                    }}
                  >
                    <div
                      style={{
                        display: "grid",
                        gap: 10,
                        justifyItems: "center",
                        textAlign: "center",
                      }}
                    >
                      <div
                        aria-hidden="true"
                        style={{
                          width: 48,
                          height: 48,
                          borderRadius: 999,
                          background: "#dbeafe",
                          color: "#1d4ed8",
                          display: "grid",
                          placeItems: "center",
                          padding: 10,
                        }}
                      >
                        <svg
                          width="22"
                          height="22"
                          viewBox="0 0 24 24"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <path
                            d="M21 3L10 14"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                          />
                          <path
                            d="M21 3L14 21L10 14L3 10L21 3Z"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinejoin="round"
                            fill="none"
                          />
                        </svg>
                      </div>
                      <div style={{ fontSize: 15, fontWeight: 1000, color: UI.text }}>
                        Update sent · {wizardOutcome.updatedCount} shift
                        {wizardOutcome.updatedCount === 1 ? "" : "s"}
                      </div>
                      <div style={{ fontSize: 11, fontWeight: 800, color: UI.textDim }}>
                        We&apos;ll let you know here if it fails.
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    {hasMessageHandoff ? (
                      <div
                        style={{
                          border:
                            props.preselectedTargetStatus === "Filled"
                              ? "1px solid rgba(33, 136, 56, 0.3)"
                              : "1px solid #fcd34d",
                          background:
                            props.preselectedTargetStatus === "Filled"
                              ? "rgba(33, 136, 56, 0.12)"
                              : "#fffbeb",
                          color: props.preselectedTargetStatus === "Filled" ? "#14532d" : "#92400e",
                          borderRadius: 12,
                          padding: "8px 10px",
                          fontSize: 11,
                          fontWeight: 900,
                        }}
                      >
                        {props.preselectedTargetStatus === "Filled"
                          ? `Confirming schedule for ${
                              props.preselectedCaregiverName || "this caregiver"
                            }`
                          : `Loaded from message to ${
                              props.preselectedCaregiverName || "this caregiver"
                            }`}
                      </div>
                    ) : null}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 10,
                        flexWrap: "wrap",
                      }}
                    >
                      <div style={{ fontSize: 11, fontWeight: 1000, color: UI.text }}>
                        {selectedBulkCount} shifts will be updated
                      </div>
                      {hasMessageHandoff ? (
                        <button
                          type="button"
                          onClick={() => setWizardStep(2)}
                          style={{
                            border: "1px solid #fcd34d",
                            background: "#fff7d6",
                            color: "#92400e",
                            borderRadius: 999,
                            minHeight: 28,
                            padding: "0 10px",
                            fontSize: 10.5,
                            cursor: "pointer",
                            fontWeight: 900,
                          }}
                        >
                          Back to selection
                        </button>
                      ) : null}
                    </div>

                    <div
                      style={{
                        minHeight: 0,
                        overflowY: "auto",
                        overflowX: "hidden",
                        display: "grid",
                        gap: 8,
                        paddingRight: 2,
                        alignContent: "start",
                      }}
                    >
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: tileGridColumns,
                          gap: 8,
                        }}
                      >
                        {STATUS_TILE_ORDER.map((tile) => {
                          const tone =
                            tile.status === "Cancelled"
                              ? { bg: "#f8fafc", border: "#111827", text: "#111827" }
                              : bulkStatusTone(tile.status);
                          const suggested = hasMessageHandoff && tile.status === suggestedStatus;
                          const disabled =
                            bulkApplying ||
                            (tile.status === "Cancelled"
                              ? tileStatusCounts.Cancelled === selectedBulkCount
                              : tileStatusCounts[tile.status] === selectedBulkCount);
                          return (
                            <button
                              key={tile.status}
                              type="button"
                              disabled={disabled}
                              onClick={() =>
                                openBulkStatusConfirmation({
                                  targetBaseStatus:
                                    tile.status === "Cancelled" ? undefined : tile.status,
                                  targetCancelled:
                                    tile.status === "Cancelled" ? true : false,
                                })
                              }
                              style={{
                                height: tileHeight,
                                width: "100%",
                                border: `1px solid ${
                                  suggested ? "#f59e0b" : disabled ? UI.borderSoft : tone.border
                                }`,
                                background: disabled
                                  ? "#f8fafc"
                                  : suggested
                                  ? "#fff7d6"
                                  : "#fff",
                                color: disabled ? "#9ca3af" : tone.text,
                                borderRadius: 14,
                                padding: tileDensity === "row" ? "0 10px" : 10,
                                display: "flex",
                                flexDirection: tileDensity === "row" ? "row" : "column",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: 6,
                                textAlign: "center",
                                cursor: disabled ? "default" : "pointer",
                                opacity: disabled ? 0.58 : 1,
                                transition:
                                  "background-color 100ms ease, border-color 100ms ease",
                                boxShadow: suggested ? "0 0 0 2px rgba(245,158,11,0.18)" : "none",
                              }}
                            >
                              {tile.status === "Filled" || tile.status === "Open" ? (
                                <span
                                  aria-hidden="true"
                                  style={{
                                    width: tileDensity === "comfortable" ? 12 : 10,
                                    height: tileDensity === "comfortable" ? 12 : 10,
                                    borderRadius: 999,
                                    background: tone.border,
                                    display: "inline-block",
                                    flexShrink: 0,
                                  }}
                                />
                              ) : (
                                <span
                                  aria-hidden="true"
                                  style={{
                                    color: tone.border,
                                    fontSize: tileIndicatorSize,
                                    fontWeight: 1000,
                                    lineHeight: 1,
                                    flexShrink: 0,
                                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                                  }}
                                >
                                  {tile.status === "Considering"
                                    ? "("
                                    : tile.status === "Offered"
                                    ? '"'
                                    : tile.status === "PendingClientApproval"
                                    ? "$"
                                    : "*"}
                                </span>
                              )}
                              <span style={{ fontSize: tileLabelFontSize, fontWeight: 1000 }}>
                                {tile.label}
                              </span>
                              {tileMetaVisible ? (
                                <span
                                  style={{ fontSize: 10.5, fontWeight: 800, color: UI.textDim }}
                                >
                                  {tileStatusCounts[tile.status] ?? 0} selected
                                </span>
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}
                {pendingConfirmation ? (
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      background: "rgba(17,24,39,0.40)",
                      display: "grid",
                      placeItems: "center",
                      padding: 16,
                      zIndex: 5,
                    }}
                    onClick={() => setPendingConfirmation(null)}
                  >
                    <div
                      role="dialog"
                      aria-modal="true"
                      aria-label={pendingConfirmation.title}
                      onClick={(event) => event.stopPropagation()}
                      style={{
                        width: "min(80%, 420px)",
                        maxWidth: "100%",
                        background: UI.panelBg,
                        border: `1px solid ${UI.borderSoft}`,
                        borderRadius: 16,
                        boxShadow: "0 16px 40px rgba(15,23,42,0.22)",
                        padding: 16,
                        display: "grid",
                        gap: 12,
                      }}
                    >
                      <div style={{ fontSize: 14, fontWeight: 1000, color: UI.text }}>
                        {pendingConfirmation.title}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          color: pendingConfirmation.tone.text,
                          fontSize: 12,
                          fontWeight: 900,
                        }}
                      >
                        {pendingConfirmation.indicator}
                        <span>Target status ready to send</span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gap: 8,
                          padding: 10,
                          borderRadius: 12,
                          background: UI.headerBg,
                          border: `1px solid ${UI.borderSoft}`,
                          maxHeight: "clamp(200px, 50vh, 320px)",
                          overflowY: "auto",
                        }}
                      >
                        {pendingConfirmation.rows.map((row) => (
                          <button
                            key={row.a1}
                            type="button"
                            onClick={() => {
                              setPendingConfirmation(null);
                              setWizardStep(2);
                              setScrollFocusA1(row.a1);
                            }}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 8,
                              minHeight: 30,
                              border: "none",
                              background: "#fff",
                              borderRadius: 10,
                              padding: "6px 8px",
                              cursor: "pointer",
                              textAlign: "left",
                            }}
                          >
                            <span
                              style={{
                                fontSize: 11,
                                color: UI.text,
                                fontWeight: 800,
                                minWidth: 0,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {row.descriptor}
                            </span>
                            <span
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                                flexShrink: 0,
                              }}
                            >
                              {renderStatusChip({
                                label:
                                  row.currentStatusLabel === "Pending Pending Approval"
                                    ? "Pending"
                                    : row.currentStatusLabel,
                                tone: currentStatusTone(
                                  row.currentBaseStatus,
                                  row.currentIsCancelled
                                ),
                                compact: true,
                              })}
                              <span
                                aria-hidden="true"
                                style={{ fontSize: 11, color: UI.textDim, fontWeight: 900 }}
                              >
                                →
                              </span>
                              {renderStatusChip({
                                label: pendingConfirmation.targetStatusLabel,
                                tone: pendingConfirmation.tone,
                                compact: true,
                              })}
                            </span>
                          </button>
                        ))}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 8,
                          flexWrap: "wrap",
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => setPendingConfirmation(null)}
                          style={{
                            border: `1px solid ${UI.border}`,
                            background: "#fff",
                            color: UI.text,
                            borderRadius: 10,
                            minHeight: 32,
                            padding: "6px 10px",
                            fontSize: 10.5,
                            cursor: "pointer",
                            fontWeight: 900,
                          }}
                          >
                          Cancel
                        </button>
                        <button
                          type="button"
                          ref={sheetConfirmButtonRef}
                          onClick={() => confirmPendingBulkChoice(false)}
                          style={{
                            flex: "1 1 180px",
                            border: `1px solid ${
                              pendingConfirmation.publishPreferred
                                ? UI.border
                                : pendingConfirmation.tone.border
                            }`,
                            background: pendingConfirmation.publishPreferred ? "#fff" : pendingConfirmation.tone.border,
                            color: pendingConfirmation.publishPreferred ? UI.text : "#fff",
                            borderRadius: 10,
                            minHeight: 32,
                            padding: "6px 10px",
                            fontSize: 10.5,
                            cursor: "pointer",
                            fontWeight: 1000,
                          }}
                        >
                          {`Change to ${pendingConfirmation.targetStatusLabel}`}
                        </button>
                        <button
                          ref={publishConfirmButtonRef}
                          type="button"
                          onClick={() => confirmPendingBulkChoice(true)}
                          style={{
                            flex: "1 1 210px",
                            border: `1px solid ${
                              pendingConfirmation.publishPreferred
                                ? pendingConfirmation.tone.border
                                : UI.border
                            }`,
                            background: pendingConfirmation.publishPreferred
                              ? pendingConfirmation.tone.border
                              : "#fff",
                            color: pendingConfirmation.publishPreferred ? "#fff" : UI.text,
                            borderRadius: 10,
                            minHeight: 32,
                            padding: "6px 10px",
                            fontSize: 10.5,
                            cursor: "pointer",
                            fontWeight: 1000,
                            boxShadow: pendingConfirmation.publishPreferred
                              ? "0 0 0 2px rgba(17,24,39,0.06)"
                              : "none",
                          }}
                        >
                          {`Change to ${pendingConfirmation.targetStatusLabel} + Publish`}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div
            style={{
              borderTop: `1px solid ${UI.borderSoft}`,
              background: UI.panelBg,
              padding: "8px 10px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <div style={{ fontSize: 10.5, color: UI.textDim, fontWeight: 900 }}>
              Step {wizardStep} of 3{" "}
              <span style={{ color: UI.text }}>{"\u2014"} {wizardStepLabel}</span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                type="button"
              onClick={() => {
                clearPendingWizardAdvance();
                setWizardStep((prev) => (prev === 1 ? prev : ((prev - 1) as 1 | 2 | 3)));
                }}
                disabled={wizardStep === 1 || wizardFooterDisabled}
                style={{
                  border: `1px solid ${UI.border}`,
                  background: wizardStep === 1 || wizardFooterDisabled ? "#f3f4f6" : "#fff",
                  color: wizardStep === 1 || wizardFooterDisabled ? "#9ca3af" : UI.text,
                  borderRadius: 10,
                  minHeight: 32,
                  padding: "6px 10px",
                  fontSize: 10.5,
                  cursor: wizardStep === 1 || wizardFooterDisabled ? "default" : "pointer",
                  fontWeight: 900,
                }}
              >
                Back
              </button>

              {wizardStep < 3 ? (
                <button
                  type="button"
                  onClick={() => {
                    clearPendingWizardAdvance();
                    setWizardStep((prev) => (prev === 3 ? prev : ((prev + 1) as 1 | 2 | 3)));
                  }}
                  disabled={!wizardCanAdvance || wizardFooterDisabled}
                  style={{
                    border: `1px solid ${
                      wizardCanAdvance && !wizardFooterDisabled ? "#111827" : UI.border
                    }`,
                    background:
                      wizardCanAdvance && !wizardFooterDisabled ? "#111827" : "#f3f4f6",
                    color: wizardCanAdvance && !wizardFooterDisabled ? "#fff" : "#9ca3af",
                    borderRadius: 10,
                    minHeight: 32,
                    padding: "6px 10px",
                    fontSize: 10.5,
                    cursor: wizardCanAdvance && !wizardFooterDisabled ? "pointer" : "default",
                    fontWeight: 900,
                  }}
                >
                  Next
                </button>
              ) : null}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div
        style={{
          marginTop: 12,
          display: "grid",
          gap: 10,
          padding: "10px",
          borderRadius: 16,
          border: `1px solid ${UI.border}`,
          background: UI.panelBg,
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            flexWrap: "wrap",
            justifyContent: "space-between",
          }}
        >
            <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
            <div style={{ fontSize: 13, fontWeight: 1000, color: UI.text }}>Bulk Edit Mode</div>
            <div style={{ fontSize: 11, fontWeight: 900, color: UI.textDim }}>
              {selectedBulkCount} selected
            </div>
            <div style={{ fontSize: 11, color: UI.textDim, fontWeight: 800 }}>
              Highlighted shifts stay marked directly on the schedule.
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={selectAllVisibleShifts}
              style={{
                border: `1px solid ${UI.border}`,
                background: UI.headerBg,
                color: UI.text,
                borderRadius: 10,
                minHeight: 32,
                padding: "6px 10px",
                fontSize: 11,
                cursor: "pointer",
                fontWeight: 900,
              }}
            >
              Select All Visible
            </button>

              <button
                type="button"
                onClick={() => clearBulkSelection()}
                disabled={!selectedBulkCount}
                style={{
                border: `1px solid ${UI.border}`,
                background: selectedBulkCount ? UI.headerBg : "#f3f4f6",
                color: selectedBulkCount ? UI.text : "#9ca3af",
                borderRadius: 10,
                minHeight: 32,
                padding: "6px 10px",
                fontSize: 11,
                cursor: selectedBulkCount ? "pointer" : "default",
                fontWeight: 900,
              }}
            >
              Clear Selection
            </button>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gap: 12,
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            alignItems: "start",
          }}
        >
          <div
            style={{
              display: "grid",
              gap: 10,
                  padding: 10,
              border: `1px solid ${UI.borderSoft}`,
              borderRadius: 14,
              background: UI.headerBg,
              minHeight: 220,
            }}
          >
              <div style={{ fontSize: 11, fontWeight: 1000, color: UI.text }}>Step 1</div>
              <div style={{ fontSize: 11, color: UI.textDim, fontWeight: 900 }}>
                Choose how you want to find shifts.
              </div>

            <div style={{ display: "grid", gap: 8 }}>
              <button
                type="button"
                onClick={() => resetBulkSearchUi("caregiver")}
                style={{
                  border: `1px solid ${bulkSelectionMode === "caregiver" ? "#111827" : UI.border}`,
                  background: bulkSelectionMode === "caregiver" ? "#111827" : "#fff",
                  color: bulkSelectionMode === "caregiver" ? "#fff" : UI.text,
                  borderRadius: 12,
                  minHeight: 32,
                  padding: "8px 10px",
                  fontSize: 11,
                  cursor: "pointer",
                  fontWeight: 900,
                  textAlign: "left",
                }}
              >
                By Caregiver
              </button>

              <button
                type="button"
                onClick={() => resetBulkSearchUi("client")}
                style={{
                  border: `1px solid ${bulkSelectionMode === "client" ? "#111827" : UI.border}`,
                  background: bulkSelectionMode === "client" ? "#111827" : "#fff",
                  color: bulkSelectionMode === "client" ? "#fff" : UI.text,
                  borderRadius: 12,
                  minHeight: 32,
                  padding: "8px 10px",
                  fontSize: 11,
                  cursor: "pointer",
                  fontWeight: 900,
                  textAlign: "left",
                }}
              >
                By Client
              </button>

              <button
                type="button"
                onClick={() => resetBulkSearchUi("status")}
                style={{
                  border: `1px solid ${bulkSelectionMode === "status" ? "#111827" : UI.border}`,
                  background: bulkSelectionMode === "status" ? "#111827" : "#fff",
                  color: bulkSelectionMode === "status" ? "#fff" : UI.text,
                  borderRadius: 12,
                  minHeight: 32,
                  padding: "8px 10px",
                  fontSize: 11,
                  cursor: "pointer",
                  fontWeight: 900,
                  textAlign: "left",
                }}
              >
                By Status
              </button>

            </div>
          </div>

          {bulkStepTwoVisible ? (
            <div
              style={{
                display: "grid",
                gap: 10,
                padding: 14,
                border: `1px solid ${UI.borderSoft}`,
                borderRadius: 14,
                background: UI.headerBg,
                minHeight: 220,
                animation: "cwBulkStepSlideIn 220ms ease both",
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 1000, color: UI.text }}>Step 2</div>
              <div style={{ fontSize: 11, color: UI.textDim, fontWeight: 900 }}>
                {bulkSelectionMode === "caregiver"
                  ? "Choose a caregiver and optional status filter."
                  : bulkSelectionMode === "client"
                  ? "Choose a client to pull matching shifts."
                  : "Choose which status to target."}
              </div>

              {bulkSelectionMode === "caregiver" ? (
                <>
                  <div style={{ position: "relative" }}>
                    <input
                      value={bulkSmartCaregiver}
                      onChange={(e) => {
                        setBulkSmartCaregiver(e.target.value);
                        setBulkStepTwoArmed(false);
                        setShowCaregiverSuggestions(true);
                      }}
                      onFocus={() => setShowCaregiverSuggestions(true)}
                      placeholder="Search caregiver…"
                      style={{
                        width: "100%",
                        border: `1px solid ${UI.border}`,
                        borderRadius: 12,
                        minHeight: 32,
                        padding: "8px 10px",
                        fontSize: 11,
                        outline: "none",
                        background: UI.panelBg,
                        boxSizing: "border-box",
                      }}
                    />

                    {showCaregiverSuggestions && bulkCaregiverSuggestions.length > 0 ? (
                      <div
                        style={{
                          position: "absolute",
                          top: "calc(100% + 4px)",
                          left: 0,
                          right: 0,
                          background: "#fff",
                          border: `1px solid ${UI.border}`,
                          borderRadius: 12,
                          boxShadow: "0 8px 20px rgba(0,0,0,0.12)",
                          zIndex: TOPNAV_Z + 20,
                          overflow: "hidden",
                        }}
                      >
                        {bulkCaregiverSuggestions.map((name) => (
                          <button
                            key={name}
                            type="button"
                            onClick={() => {
                              setBulkSmartCaregiver(name);
                              setShowCaregiverSuggestions(false);
                              smartSelectByCaregiverAndStatus(name, bulkSmartStatus);
                            }}
                            style={{
                              width: "100%",
                              textAlign: "left",
                              border: "none",
                              background: "#fff",
                              minHeight: 32,
                              padding: "8px 10px",
                              fontSize: 11,
                              cursor: "pointer",
                              fontWeight: 800,
                            }}
                          >
                            {name}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <div style={{ display: "grid", gap: 8 }}>
                    <select
                      value={bulkSmartStatus}
                      onChange={(e) => {
                        setBulkSmartStatus(e.target.value as BulkSmartStatusFilter);
                        setBulkStepTwoArmed(false);
                      }}
                      style={{
                        border: `1px solid ${UI.border}`,
                        borderRadius: 12,
                        minHeight: 32,
                        padding: "8px 10px",
                        fontSize: 11,
                        outline: "none",
                        background: UI.panelBg,
                        fontWeight: 800,
                      }}
                    >
                      <option value="Any">Any status</option>
                      <option value="Open">Open</option>
                      <option value="Filled">Filled</option>
                      <option value="Offered">Offered</option>
                      <option value="Considering">Considering</option>
                      <option value="PendingClientApproval">Pending Approval</option>
                    </select>

                    <button
                      type="button"
                      onClick={() =>
                        smartSelectByCaregiverAndStatus(bulkSmartCaregiver, bulkSmartStatus)
                      }
                      style={{
                        border: `1px solid ${UI.border}`,
                        background: "#fff",
                        color: UI.text,
                        borderRadius: 12,
                        minHeight: 32,
                        padding: "8px 10px",
                        fontSize: 11,
                        cursor: "pointer",
                        fontWeight: 900,
                      }}
                    >
                      Select Matching Shifts
                    </button>
                  </div>
                </>
              ) : null}

              {bulkSelectionMode === "client" ? (
                <>
                  <div style={{ position: "relative" }}>
                    <input
                      value={bulkSmartClient}
                      onChange={(e) => {
                        setBulkSmartClient(e.target.value);
                        setBulkStepTwoArmed(false);
                        setShowClientSuggestions(true);
                      }}
                      onFocus={() => setShowClientSuggestions(true)}
                      placeholder="Search client…"
                      style={{
                        width: "100%",
                        border: `1px solid ${UI.border}`,
                        borderRadius: 12,
                        minHeight: 32,
                        padding: "8px 10px",
                        fontSize: 11,
                        outline: "none",
                        background: UI.panelBg,
                        boxSizing: "border-box",
                      }}
                    />

                    {showClientSuggestions && bulkClientSuggestions.length > 0 ? (
                      <div
                        style={{
                          position: "absolute",
                          top: "calc(100% + 4px)",
                          left: 0,
                          right: 0,
                          background: "#fff",
                          border: `1px solid ${UI.border}`,
                          borderRadius: 12,
                          boxShadow: "0 8px 20px rgba(0,0,0,0.12)",
                          zIndex: TOPNAV_Z + 20,
                          overflow: "hidden",
                        }}
                      >
                        {bulkClientSuggestions.map((name) => (
                          <button
                            key={name}
                            type="button"
                            onClick={() => {
                              setBulkSmartClient(name);
                              setShowClientSuggestions(false);
                              smartSelectByClient(name);
                            }}
                            style={{
                              width: "100%",
                              textAlign: "left",
                              border: "none",
                              background: "#fff",
                              minHeight: 32,
                              padding: "8px 10px",
                              fontSize: 11,
                              cursor: "pointer",
                              fontWeight: 800,
                            }}
                          >
                            {name}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <button
                    type="button"
                    onClick={() => smartSelectByClient(bulkSmartClient)}
                    style={{
                      border: `1px solid ${UI.border}`,
                      background: "#fff",
                      color: UI.text,
                      borderRadius: 12,
                      minHeight: 32,
                      padding: "8px 10px",
                      fontSize: 11,
                      cursor: "pointer",
                      fontWeight: 900,
                      justifySelf: "start",
                    }}
                  >
                    Select Matching Shifts
                  </button>
                </>
              ) : null}

              {bulkSelectionMode === "status" ? (
                <div style={{ display: "grid", gap: 8 }}>
                  <select
                    value={bulkSmartStatus}
                    onChange={(e) => {
                      setBulkSmartStatus(e.target.value as BulkSmartStatusFilter);
                      setBulkStepTwoArmed(false);
                    }}
                    style={{
                      border: `1px solid ${UI.border}`,
                      borderRadius: 12,
                      minHeight: 32,
                      padding: "8px 10px",
                      fontSize: 11,
                      outline: "none",
                      background: UI.panelBg,
                      fontWeight: 800,
                    }}
                  >
                    <option value="Any">Any status</option>
                    <option value="Open">Open</option>
                    <option value="Filled">Filled</option>
                    <option value="Offered">Offered</option>
                    <option value="Considering">Considering</option>
                    <option value="PendingClientApproval">Pending Approval</option>
                  </select>

                  <button
                    type="button"
                    disabled={bulkSmartStatus === "Any"}
                    onClick={() => {
                      if (bulkSmartStatus !== "Any") smartSelectByStatus(bulkSmartStatus);
                    }}
                    style={{
                      border: `1px solid ${UI.border}`,
                      background: "#fff",
                      color: bulkSmartStatus === "Any" ? "#9ca3af" : UI.text,
                      borderRadius: 12,
                      padding: "10px 12px",
                      fontSize: 12,
                      cursor: bulkSmartStatus === "Any" ? "default" : "pointer",
                      fontWeight: 900,
                      justifySelf: "start",
                    }}
                  >
                    Select Matching Shifts
                  </button>
                </div>
              ) : null}

            </div>
          ) : null}

          {bulkStepThreeVisible ? (
            <div
              style={{
                display: "grid",
                gap: 10,
                padding: 14,
                border: `1px solid ${UI.borderSoft}`,
                borderRadius: 14,
                background: UI.headerBg,
                minHeight: 220,
                animation: "cwBulkStepSlideIn 240ms ease both",
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 1000, color: UI.text }}>Step 3</div>
              <div style={{ fontSize: 11, color: UI.textDim, fontWeight: 900 }}>
                Review all visible shifts here. Click any item to include or exclude it from the
                bulk update.
              </div>

              <div
                style={{
                  display: "grid",
                  gap: 8,
                  maxHeight: 310,
                  overflow: "auto",
                  paddingRight: 4,
                }}
              >
                {bulkShiftList.length ? (
                  bulkShiftList.map((cell) => {
                    const tone = bulkStatusTone(cell.status);
                    return (
                      <button
                        key={cell.a1}
                        type="button"
                        onClick={() =>
                          toggleBulkCellSelection({
                            a1: cell.a1,
                            week: cell.week,
                            clientName: cell.clientName,
                            dateStr: cell.dateStr,
                            dayLabel: cell.dayLabel,
                            originalValue: cell.originalValue,
                          })
                        }
                        style={{
                          display: "grid",
                          gap: 5,
                          textAlign: "left",
                          border: `2px solid ${cell.selected ? "#0f766e" : tone.border}`,
                          background: tone.bg,
                          borderRadius: 12,
                          padding: "8px 10px",
                          cursor: "pointer",
                          boxShadow: cell.selected
                            ? "inset 0 0 0 1px rgba(15,118,110,0.22), 0 0 0 1px rgba(15,118,110,0.10)"
                            : "none",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 10,
                            alignItems: "baseline",
                          }}
                        >
                          <div style={{ fontSize: 11, fontWeight: 1000, color: UI.text }}>
                            {cell.clientName}
                          </div>
                          <div
                            style={{
                              fontSize: 10.5,
                              color: cell.selected ? "#0f766e" : UI.textDim,
                              fontWeight: 900,
                            }}
                          >
                            {formatShortDayDate(cell.dateStr)}
                          </div>
                        </div>
                        <div style={{ fontSize: 11, color: tone.text, fontWeight: 900 }}>
                          {cell.status}
                        </div>
                        <div style={{ fontSize: 11, color: UI.textDim, fontWeight: 800 }}>
                          {cell.caregiverName}
                          {cell.startTime && cell.endTime
                            ? ` • ${cell.startTime}-${cell.endTime}`
                            : ""}
                        </div>
                        <div
                          style={{
                            fontSize: 10.5,
                            color: cell.selected ? "#0f766e" : UI.textDim,
                            fontWeight: 900,
                          }}
                        >
                          {cell.selected ? "Selected for bulk update" : "Click to include"}
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <div
                    style={{
                      padding: 12,
                      borderRadius: 12,
                      border: `1px dashed ${UI.border}`,
                      background: "#fff",
                      fontSize: 11,
                      color: UI.textDim,
                      fontWeight: 800,
                    }}
                  >
                    No visible shifts match the current schedule view.
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {bulkStepThreeVisible ? (
            <div
              style={{
                display: "grid",
                gap: 10,
                padding: 14,
                border: `1px solid ${UI.borderSoft}`,
                borderRadius: 14,
                background: UI.headerBg,
                minHeight: 220,
                animation: "cwBulkStepSlideIn 260ms ease both",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <div style={{ fontSize: 11, fontWeight: 1000, color: UI.text }}>Step 4</div>
                  <div style={{ fontSize: 11, color: UI.textDim, fontWeight: 900 }}>
                    Choose the new status for every selected shift.
                  </div>
                </div>
                <button
                  ref={pingButtonRef}
                  type="button"
                  onClick={() => {
                    const toastId = Date.now();
                    setSaveToast({
                      id: toastId,
                      kind: "loading",
                      title: "Testing publish connection",
                      lines: ["Pinging Apps Script publish webhook..."],
                      actions: [
                        {
                          label: "Dismiss",
                          onClick: () =>
                            setSaveToast((prev) => (prev?.id === toastId ? null : prev)),
                          variant: "secondary",
                        },
                      ],
                    });

                    void (async () => {
                      const result = await ping();
                      if (result.ok) {
                        setSaveToast({
                          id: toastId,
                          kind: "success",
                          title: "Publish connection ok",
                          lines: [
                            `Action: ${result.response.action || "ping"}`,
                            ...(result.response.message ? [result.response.message] : []),
                            result.response.elapsedMs != null
                              ? `Elapsed: ${result.response.elapsedMs}ms`
                              : "",
                          ].filter(Boolean),
                          actions: [
                            {
                              label: "Dismiss",
                              onClick: () =>
                                setSaveToast((prev) => (prev?.id === toastId ? null : prev)),
                              variant: "secondary",
                            },
                          ],
                        });
                        return;
                      }

                      setSaveToast({
                        id: toastId,
                        kind: "warning",
                        title: "Publish connection failed",
                        lines: [result.error],
                        actions: [
                          {
                            label: "Dismiss",
                            onClick: () =>
                              setSaveToast((prev) => (prev?.id === toastId ? null : prev)),
                            variant: "secondary",
                          },
                        ],
                      });
                    })();
                  }}
                  style={{
                    border: `1px solid ${UI.border}`,
                    background: "#fff",
                    color: UI.text,
                    borderRadius: 10,
                    minHeight: 28,
                    padding: "0 10px",
                    fontSize: 10.5,
                    cursor: "pointer",
                    fontWeight: 900,
                  }}
                >
                  Test connection
                </button>
              </div>

              <div
                style={{
                  minHeight: 0,
                  overflowY: "auto",
                  overflowX: "hidden",
                  display: "grid",
                  gap: 8,
                }}
              >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: tileGridColumns,
                  gap: 8,
                }}
              >
                {STATUS_TILE_ORDER.map((tile) => {
                  const tone =
                    tile.status === "Cancelled"
                      ? { bg: "#f8fafc", border: "#111827", text: "#111827" }
                      : bulkStatusTone(tile.status);
                  const disabled =
                    bulkApplying ||
                    (tile.status === "Cancelled"
                      ? tileStatusCounts.Cancelled === selectedBulkCount
                      : tileStatusCounts[tile.status] === selectedBulkCount);
                  return (
                    <button
                      key={tile.status}
                      type="button"
                      disabled={disabled}
                      onClick={() =>
                        applyBulkStatusChange({
                          targetBaseStatus: tile.status === "Cancelled" ? undefined : tile.status,
                          targetCancelled: tile.status === "Cancelled" ? true : false,
                        })
                      }
                      style={{
                        height: tileHeight,
                        border: `1px solid ${disabled ? UI.borderSoft : tone.border}`,
                        background: disabled ? "#f8fafc" : "#fff",
                        color: disabled ? "#9ca3af" : tone.text,
                        borderRadius: 14,
                        padding: tileDensity === "row" ? "0 10px" : 10,
                        display: "flex",
                        flexDirection: tileDensity === "row" ? "row" : "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 6,
                        textAlign: "center",
                        cursor: disabled ? "default" : "pointer",
                        opacity: disabled ? 0.58 : 1,
                      }}
                    >
                      {tile.status === "Filled" || tile.status === "Open" ? (
                        <span
                          aria-hidden="true"
                          style={{
                            width: tileDensity === "comfortable" ? 12 : 10,
                            height: tileDensity === "comfortable" ? 12 : 10,
                            borderRadius: 999,
                            background: tone.border,
                            display: "inline-block",
                            flexShrink: 0,
                          }}
                        />
                      ) : (
                        <span
                          aria-hidden="true"
                          style={{
                            color: tone.border,
                            fontSize: tileIndicatorSize,
                            fontWeight: 1000,
                            lineHeight: 1,
                            flexShrink: 0,
                            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                          }}
                        >
                          {tile.status === "Considering"
                            ? "("
                            : tile.status === "Offered"
                            ? '"'
                            : tile.status === "PendingClientApproval"
                            ? "$"
                            : "*"}
                        </span>
                      )}
                      <span style={{ fontSize: tileLabelFontSize, fontWeight: 1000 }}>
                        {tile.label}
                      </span>
                      {tileMetaVisible ? (
                        <span style={{ fontSize: 10.5, fontWeight: 800, color: UI.textDim }}>
                          {tileStatusCounts[tile.status] ?? 0} selected
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              </div>
            </div>
          ) : null}
        </div>

        <div style={{ fontSize: 10.5, color: UI.textDim, fontWeight: 800, lineHeight: 1.4 }}>
          Bulk mode now reveals each next step after the previous choice is made: pick a selection
          method, build the selection, review the shifts, then apply the change.
        </div>
      </div>
    );
  }
);

export default BulkEditPanel;

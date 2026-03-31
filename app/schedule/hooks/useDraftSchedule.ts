"use client";

import { useCallback, useMemo, useState } from "react";

export type DraftWeekKind = "cw" | "nw";

export type DraftCellChange = {
  a1: string;
  week: DraftWeekKind;
  originalValue: string;
  draftValue: string;
  clientName?: string;
  dateStr?: string;
  dayLabel?: string;
  updatedAt: number;
};

type DraftChangeMap = Record<string, DraftCellChange>;

type DraftAction =
  | {
      type: "set";
      key: string;
      before: DraftCellChange | null;
      after: DraftCellChange | null;
    }
  | {
      type: "setMany";
      changes: Array<{
        key: string;
        before: DraftCellChange | null;
        after: DraftCellChange | null;
      }>;
    }
  | {
      type: "reset";
      before: DraftChangeMap;
      after: DraftChangeMap;
    }
  | {
      type: "disable";
      beforeEnabled: boolean;
      afterEnabled: boolean;
    };

export type DraftSaveItem = {
  a1: string;
  week: DraftWeekKind;
  originalValue: string;
  draftValue: string;
  clientName?: string;
  dateStr?: string;
  dayLabel?: string;
};

export type UseDraftScheduleResult = {
  draftMode: boolean;
  draftChanges: DraftChangeMap;
  changedCells: DraftCellChange[];
  changedCellCount: number;
  hasDraftChanges: boolean;
  canUndo: boolean;
  canRedo: boolean;

  enableDraftMode: () => void;
  disableDraftMode: (options?: { clearChanges?: boolean }) => void;
  toggleDraftMode: () => void;

  setDraftCell: (args: {
    a1: string;
    week: DraftWeekKind;
    originalValue: string;
    draftValue: string;
    clientName?: string;
    dateStr?: string;
    dayLabel?: string;
  }) => void;

  setDraftCells: (
    args: Array<{
      a1: string;
      week: DraftWeekKind;
      originalValue: string;
      draftValue: string;
      clientName?: string;
      dateStr?: string;
      dayLabel?: string;
    }>
  ) => void;

  clearDraftCell: (args: {
    a1: string;
    week: DraftWeekKind;
  }) => void;

  resetDraft: () => void;
  undo: () => void;
  redo: () => void;

  getDraftValue: (args: {
    a1: string;
    week: DraftWeekKind;
    originalValue: string;
  }) => string;

  getDraftChange: (args: {
    a1: string;
    week: DraftWeekKind;
  }) => DraftCellChange | null;

  isCellChanged: (args: {
    a1: string;
    week: DraftWeekKind;
  }) => boolean;

  buildSavePayload: () => DraftSaveItem[];
};

function norm(value: unknown): string {
  return String(value ?? "").trim();
}

function makeDraftKey(a1: string, week: DraftWeekKind): string {
  return `${week}::${norm(a1).toUpperCase()}`;
}

function shallowCloneMap(map: DraftChangeMap): DraftChangeMap {
  return { ...map };
}

export function useDraftSchedule(): UseDraftScheduleResult {
  const [draftMode, setDraftMode] = useState(false);
  const [draftChanges, setDraftChanges] = useState<DraftChangeMap>({});
  const [undoStack, setUndoStack] = useState<DraftAction[]>([]);
  const [redoStack, setRedoStack] = useState<DraftAction[]>([]);

  const pushUndo = useCallback((action: DraftAction) => {
    setUndoStack((prev) => [...prev, action]);
    setRedoStack([]);
  }, []);

  const changedCells = useMemo(() => {
    return Object.values(draftChanges).sort((a, b) => {
      if (a.week !== b.week) return a.week.localeCompare(b.week);
      return a.updatedAt - b.updatedAt;
    });
  }, [draftChanges]);

  const changedCellCount = changedCells.length;
  const hasDraftChanges = changedCellCount > 0;
  const canUndo = undoStack.length > 0;
  const canRedo = redoStack.length > 0;

  const enableDraftMode = useCallback(() => {
    setDraftMode((prev) => {
      if (prev) return prev;
      pushUndo({
        type: "disable",
        beforeEnabled: false,
        afterEnabled: true,
      });
      return true;
    });
  }, [pushUndo]);

  const disableDraftMode = useCallback(
    (options?: { clearChanges?: boolean }) => {
      const clearChanges = Boolean(options?.clearChanges);

      setDraftMode((prev) => {
        if (!prev) return prev;
        pushUndo({
          type: "disable",
          beforeEnabled: true,
          afterEnabled: false,
        });
        return false;
      });

      if (clearChanges) {
        setDraftChanges((prev) => {
          if (Object.keys(prev).length === 0) return prev;

          const before = shallowCloneMap(prev);
          const after: DraftChangeMap = {};

          pushUndo({
            type: "reset",
            before,
            after,
          });

          return after;
        });
      }
    },
    [pushUndo]
  );

  const toggleDraftMode = useCallback(() => {
    setDraftMode((prev) => {
      pushUndo({
        type: "disable",
        beforeEnabled: prev,
        afterEnabled: !prev,
      });
      return !prev;
    });
  }, [pushUndo]);

  const setDraftCell = useCallback(
    (args: {
      a1: string;
      week: DraftWeekKind;
      originalValue: string;
      draftValue: string;
      clientName?: string;
      dateStr?: string;
      dayLabel?: string;
    }) => {
      const key = makeDraftKey(args.a1, args.week);
      const originalValue = args.originalValue ?? "";
      const draftValue = args.draftValue ?? "";

      setDraftChanges((prev) => {
        const before = prev[key] ?? null;

        if (draftValue === originalValue) {
          if (!before) return prev;

          const next = shallowCloneMap(prev);
          delete next[key];

          pushUndo({
            type: "set",
            key,
            before,
            after: null,
          });

          return next;
        }

        const after: DraftCellChange = {
          a1: norm(args.a1).toUpperCase(),
          week: args.week,
          originalValue,
          draftValue,
          clientName: args.clientName,
          dateStr: args.dateStr,
          dayLabel: args.dayLabel,
          updatedAt: Date.now(),
        };

        const next = shallowCloneMap(prev);
        next[key] = after;

        pushUndo({
          type: "set",
          key,
          before,
          after,
        });

        return next;
      });
    },
    [pushUndo]
  );

  const setDraftCells = useCallback(
    (
      argsList: Array<{
        a1: string;
        week: DraftWeekKind;
        originalValue: string;
        draftValue: string;
        clientName?: string;
        dateStr?: string;
        dayLabel?: string;
      }>
    ) => {
      if (!argsList.length) return;

      setDraftChanges((prev) => {
        const next = shallowCloneMap(prev);
        const batchChanges: Array<{
          key: string;
          before: DraftCellChange | null;
          after: DraftCellChange | null;
        }> = [];

        const now = Date.now();

        for (let i = 0; i < argsList.length; i++) {
          const args = argsList[i];
          const key = makeDraftKey(args.a1, args.week);
          const originalValue = args.originalValue ?? "";
          const draftValue = args.draftValue ?? "";
          const before = next[key] ?? null;

          if (draftValue === originalValue) {
            if (before) {
              delete next[key];
              batchChanges.push({
                key,
                before,
                after: null,
              });
            }
            continue;
          }

          const after: DraftCellChange = {
            a1: norm(args.a1).toUpperCase(),
            week: args.week,
            originalValue,
            draftValue,
            clientName: args.clientName,
            dateStr: args.dateStr,
            dayLabel: args.dayLabel,
            updatedAt: now + i,
          };

          next[key] = after;

          batchChanges.push({
            key,
            before,
            after,
          });
        }

        if (!batchChanges.length) return prev;

        pushUndo({
          type: "setMany",
          changes: batchChanges,
        });

        return next;
      });
    },
    [pushUndo]
  );

  const clearDraftCell = useCallback(
    (args: { a1: string; week: DraftWeekKind }) => {
      const key = makeDraftKey(args.a1, args.week);

      setDraftChanges((prev) => {
        const before = prev[key] ?? null;
        if (!before) return prev;

        const next = shallowCloneMap(prev);
        delete next[key];

        pushUndo({
          type: "set",
          key,
          before,
          after: null,
        });

        return next;
      });
    },
    [pushUndo]
  );

  const resetDraft = useCallback(() => {
    setDraftChanges((prev) => {
      if (Object.keys(prev).length === 0) return prev;

      const before = shallowCloneMap(prev);
      const after: DraftChangeMap = {};

      pushUndo({
        type: "reset",
        before,
        after,
      });

      return after;
    });
  }, [pushUndo]);

  const undo = useCallback(() => {
    setUndoStack((prevUndo) => {
      if (prevUndo.length === 0) return prevUndo;

      const action = prevUndo[prevUndo.length - 1];

      if (action.type === "set") {
        setDraftChanges((prevChanges) => {
          const next = shallowCloneMap(prevChanges);

          if (action.before) next[action.key] = action.before;
          else delete next[action.key];

          return next;
        });
      } else if (action.type === "setMany") {
        setDraftChanges((prevChanges) => {
          const next = shallowCloneMap(prevChanges);

          for (const change of action.changes) {
            if (change.before) next[change.key] = change.before;
            else delete next[change.key];
          }

          return next;
        });
      } else if (action.type === "reset") {
        setDraftChanges(shallowCloneMap(action.before));
      } else if (action.type === "disable") {
        setDraftMode(action.beforeEnabled);
      }

      setRedoStack((prevRedo) => [...prevRedo, action]);
      return prevUndo.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setRedoStack((prevRedo) => {
      if (prevRedo.length === 0) return prevRedo;

      const action = prevRedo[prevRedo.length - 1];

      if (action.type === "set") {
        setDraftChanges((prevChanges) => {
          const next = shallowCloneMap(prevChanges);

          if (action.after) next[action.key] = action.after;
          else delete next[action.key];

          return next;
        });
      } else if (action.type === "setMany") {
        setDraftChanges((prevChanges) => {
          const next = shallowCloneMap(prevChanges);

          for (const change of action.changes) {
            if (change.after) next[change.key] = change.after;
            else delete next[change.key];
          }

          return next;
        });
      } else if (action.type === "reset") {
        setDraftChanges(shallowCloneMap(action.after));
      } else if (action.type === "disable") {
        setDraftMode(action.afterEnabled);
      }

      setUndoStack((prevUndo) => [...prevUndo, action]);
      return prevRedo.slice(0, -1);
    });
  }, []);

  const getDraftChange = useCallback(
    (args: { a1: string; week: DraftWeekKind }) => {
      const key = makeDraftKey(args.a1, args.week);
      return draftChanges[key] ?? null;
    },
    [draftChanges]
  );

  const getDraftValue = useCallback(
    (args: { a1: string; week: DraftWeekKind; originalValue: string }) => {
      const key = makeDraftKey(args.a1, args.week);
      return draftChanges[key]?.draftValue ?? args.originalValue;
    },
    [draftChanges]
  );

  const isCellChanged = useCallback(
    (args: { a1: string; week: DraftWeekKind }) => {
      const key = makeDraftKey(args.a1, args.week);
      return Boolean(draftChanges[key]);
    },
    [draftChanges]
  );

  const buildSavePayload = useCallback((): DraftSaveItem[] => {
    return Object.values(draftChanges).map((change) => ({
      a1: change.a1,
      week: change.week,
      originalValue: change.originalValue,
      draftValue: change.draftValue,
      clientName: change.clientName,
      dateStr: change.dateStr,
      dayLabel: change.dayLabel,
    }));
  }, [draftChanges]);

  return {
    draftMode,
    draftChanges,
    changedCells,
    changedCellCount,
    hasDraftChanges,
    canUndo,
    canRedo,

    enableDraftMode,
    disableDraftMode,
    toggleDraftMode,

    setDraftCell,
    setDraftCells,
    clearDraftCell,
    resetDraft,
    undo,
    redo,

    getDraftValue,
    getDraftChange,
    isCellChanged,
    buildSavePayload,
  };
}

export default useDraftSchedule;
import type { BaseShiftStatus } from "@/app/schedule/utils/scheduleShiftStatus";

export type BulkSelectedCell = {
  a1: string;
  week: "cw" | "nw";
  clientName: string;
  dateStr: string;
  dayLabel: string;
  originalValue: string;
};

export type BulkTargetStatus = Exclude<BaseShiftStatus, "Unknown">;

export type BulkSmartStatusFilter =
  | "Any"
  | "Open"
  | "Filled"
  | "Offered"
  | "Considering"
  | "PendingClientApproval";

export type BulkEditPanelHandle = {
  toggleBulkCellSelection: (cell: BulkSelectedCell) => void;
  clearBulkSelection: () => void;
  isBulkCellSelected: (a1: string) => boolean;
};

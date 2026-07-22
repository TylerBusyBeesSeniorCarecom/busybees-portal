"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import type { CSSProperties, KeyboardEvent } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";

import { UI, getWeekStartYmd, type WeekKind } from "@/app/sheets-tools/shared";
import { useMaybeSheetsToolsShared } from "@/app/sheets-tools/SheetsToolsSharedProvider";
import type { ClientProfile } from "@/app/components/clientProfileModel";
import { normalizeKey } from "@/app/components/clientProfileModel";
import { logBulkEditPerf, queueBulkEditMessageHandoff } from "@/app/sheets-tools/bulkEditHandoff";
import { useFirebaseAuth } from "@/lib/firebase/useFirebaseAuth";
import {
  fetchShiftsByIDs,
  markScheduleOfferAccepted,
  sendMessage,
  updateShiftStatusesByShiftIDs,
} from "@/lib/messages/firestoreClient";
import { firebaseDb } from "@/lib/firebase/client";
import {
  SCHEDULE_HEADER,
  SCHEDULE_TRAILER,
  type ScheduleOfferCandidate,
} from "./scheduleOffer";

type MessageComposerProps = {
  conversationID: string;
  recipientName?: string;
  scheduleOfferCandidate?: ScheduleOfferCandidate | null;
};

type ClientPickerEntry = ClientProfile & {
  clientID: string;
  hasDescription: boolean;
  activeThisWeek: boolean;
};

type ScheduleInsertShift = {
  shiftID: string;
  caregiverID: string;
  weekStart: string;
  date: string;
  client: string;
  startTime: string;
  endTime: string;
};

type AcceptScheduleDialogState = {
  caregiverName: string;
  shiftIDs: string[];
  shifts: ScheduleInsertShift[];
  shiftCount: number;
  messageID: string;
  mode: "offer" | "week";
  week: WeekKind;
  loading: boolean;
  noShifts: boolean;
};

const CATEGORY_OPTIONS = ["General Question", "Case Specific", "Scheduling", "Payroll", "Other"];
const INSERT_MENU_WIDTH = 236;
const TEXTAREA_MIN_VISIBLE_HEIGHT = 36;
const TEXTAREA_MAX_HEIGHT = 180;
let skipAcceptConfirmationPreference = false;

function parseLocalDate(dateStr: string) {
  const raw = String(dateStr || "").trim();
  if (!raw) return null;

  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const [yyyy, mm, dd] = raw.split("-").map((part) => Number(part));
    if (yyyy && mm && dd) {
      return new Date(yyyy, mm - 1, dd);
    }
  }

  const parts = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (parts) {
    return new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
  }

  const fallback = new Date(raw);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function formatWeekday(dateStr: string) {
  const date = parseLocalDate(dateStr);
  if (!date) return dateStr;
  return date.toLocaleDateString("en-US", {
    weekday: "long",
  });
}

function formatIOSShiftTime(raw: string) {
  const normalized = String(raw || "").trim().replace(/\s+/g, "").toUpperCase();
  const match = normalized.match(/^(\d{1,2})(?::(\d{2}))?(AM|PM)$/);
  if (!match) return normalized.toLowerCase();

  let hours = Number(match[1]) % 12;
  const minutes = match[2] || "00";
  const suffix = match[3].toLowerCase();
  if (hours === 0) hours = 12;
  return minutes === "00" ? `${hours}${suffix}` : `${hours}:${minutes}${suffix}`;
}

function timeToMinutes(raw: string) {
  const normalized = String(raw || "").trim().replace(/\s+/g, "").toUpperCase();
  const match = normalized.match(/^(\d{1,2})(?::(\d{2}))?(AM|PM)$/);
  if (!match) return Number.POSITIVE_INFINITY;

  let hours = Number(match[1]) % 12;
  const minutes = Number(match[2] || "0");
  if (match[3] === "PM") hours += 12;
  return hours * 60 + minutes;
}

async function buildScheduleInsert(args: {
  week: WeekKind;
  caregiverID: string;
}) {
  const weekStartYmd = getWeekStartYmd(args.week);

  let snapshot;
  try {
    snapshot = await getDocs(
      query(
        collection(firebaseDb, "shifts"),
        where("caregiverID", "==", args.caregiverID),
        where("weekStart", "==", weekStartYmd)
      )
    );
  } catch {
    return {
      text: "(couldn't find schedule for this caregiver)",
      shiftIDs: [] as string[],
      shifts: [] as ScheduleInsertShift[],
    };
  }

  const shifts = snapshot.docs
    .map((docSnapshot) => {
      const data = docSnapshot.data() as Record<string, unknown>;
      const date = String(data.date || "").trim();
      const client = String(data.client || "").trim();
      const startTime = String(data.startTime || "").trim();
      const endTime = String(data.endTime || "").trim();
      const shiftID = String(data.shiftID || docSnapshot.id || "").trim();
      const caregiverID = String(data.caregiverID || args.caregiverID || "").trim();
      const weekStart = String(data.weekStart || weekStartYmd || "").trim();

      if (!date || !client || !startTime || !endTime || !shiftID) return null;

      return {
        shiftID,
        caregiverID,
        weekStart,
        date,
        client,
        startTime,
        endTime,
      };
    })
    .filter((shift): shift is {
      shiftID: string;
      caregiverID: string;
      weekStart: string;
      date: string;
      client: string;
      startTime: string;
      endTime: string;
    } =>
      Boolean(shift)
    )
    .sort((a, b) => {
      const aDate = parseLocalDate(a.date)?.getTime() ?? Number.POSITIVE_INFINITY;
      const bDate = parseLocalDate(b.date)?.getTime() ?? Number.POSITIVE_INFINITY;
      if (aDate !== bDate) return aDate - bDate;

      const aStart = timeToMinutes(a.startTime);
      const bStart = timeToMinutes(b.startTime);
      if (aStart !== bStart) return aStart - bStart;

      return timeToMinutes(a.endTime) - timeToMinutes(b.endTime);
    });

  if (shifts.length === 0) {
    return {
      text: `${SCHEDULE_HEADER}\n${SCHEDULE_TRAILER}`,
      shiftIDs: [],
      shifts: [] as ScheduleInsertShift[],
    };
  }

  const lines = shifts.map(
    (row) => `${formatWeekday(row.date)} ${formatIOSShiftTime(row.startTime)}-${formatIOSShiftTime(row.endTime)} w/ ${row.client}`
  );
  return {
    text: `${SCHEDULE_HEADER}\n${lines.join("\n")}\n${SCHEDULE_TRAILER}`,
    shiftIDs: shifts.map((shift) => shift.shiftID),
    shifts,
  };
}

function categoryTone(category: string) {
  switch (category) {
    case "Scheduling":
      return { dot: "#a855f7", text: "#312e81" };
    case "Case Specific":
      return { dot: "#f59e0b", text: "#9a3412" };
    case "Payroll":
      return { dot: "#2e7d32", text: "#2e7d32" };
    case "Other":
      return { dot: "#9ca3af", text: "#374151" };
    default:
      return { dot: "#6b7280", text: "#374151" };
  }
}

function CalendarPlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" style={iconSvgStyle}>
      <rect x="3.5" y="5.5" width="17" height="15" rx="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 3.5v4M16 3.5v4M3.5 9.5h17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12 11.5v6M9 14.5h6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function UserCircleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" style={iconSvgStyle}>
      <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="10" r="2.3" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M7.8 18.2c.9-2.1 2.5-3.2 4.2-3.2s3.3 1.1 4.2 3.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false" style={chevronSvgStyle}>
      <path d="M5 7.5 10 12.5 15 7.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" style={iconSvgStyle}>
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 12.4 10.7 15 16 8.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function buildClientDescriptionInsert(client: ClientProfile) {
  const header = `Client Profile: ${client.name}`;
  const address = client.address.trim();
  const description = client.description.trim();
  if (address) {
    return `${header}\n${address}\n\n${description}`;
  }
  return `${header}\n\n${description}`;
}

function getClientProfileAddress(data: Record<string, unknown>) {
  return String(data.address || data.fullAddress || data.streetAddress || "").trim();
}

function makeClientProfile(args: {
  clientID: string;
  name: string;
  address: string;
  description: string;
  rate?: string;
  raw: Record<string, string>;
  activeThisWeek: boolean;
}): ClientPickerEntry {
  return {
    clientID: args.clientID,
    name: args.name,
    address: args.address,
    description: args.description,
    rate: args.rate || "",
    raw: args.raw,
    hasDescription: Boolean(args.description.trim()),
    activeThisWeek: args.activeThisWeek,
  };
}

function menuPlacementStyle(args: { above: boolean; width?: number }) {
  return args.above
    ? ({
        bottom: "calc(100% + 6px)",
        top: "auto",
        width: args.width ?? INSERT_MENU_WIDTH,
      } satisfies CSSProperties)
    : ({
        top: "calc(100% + 6px)",
        bottom: "auto",
        width: args.width ?? INSERT_MENU_WIDTH,
      } satisfies CSSProperties);
}

export default function MessageComposer({
  conversationID,
  recipientName,
  scheduleOfferCandidate,
}: MessageComposerProps) {
  const { data: session } = useSession();
  const { user: firebaseUser, loading: firebaseAuthLoading, error: firebaseAuthError } = useFirebaseAuth();
  const sheetsShared = useMaybeSheetsToolsShared();
  const [category, setCategory] = useState(CATEGORY_OPTIONS[0]);
  const [draft, setDraft] = useState("");
  const [sendPending, setSendPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeMenu, setActiveMenu] = useState<"schedule" | "client" | "category" | null>(null);
  const [scheduleMenuAbove, setScheduleMenuAbove] = useState(false);
  const [clientMenuAbove, setClientMenuAbove] = useState(false);
  const [categoryMenuAbove, setCategoryMenuAbove] = useState(false);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [clientsLoaded, setClientsLoaded] = useState(false);
  const [clientsError, setClientsError] = useState<string | null>(null);
  const [clients, setClients] = useState<ClientPickerEntry[]>([]);
  const [clientScope, setClientScope] = useState<"Active" | "All">("Active");
  const [clientSearch, setClientSearch] = useState("");
  const [clientPopoverFrame, setClientPopoverFrame] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const [pendingScheduleShiftIDs, setPendingScheduleShiftIDs] = useState<string[]>([]);
  const [pendingScheduleShifts, setPendingScheduleShifts] = useState<ScheduleInsertShift[]>([]);
  const [pendingScheduleWeek, setPendingScheduleWeek] = useState<WeekKind | null>(null);
  const [pendingScheduleRecipientName, setPendingScheduleRecipientName] = useState("");
  const [pendingScheduleInsertedAt, setPendingScheduleInsertedAt] = useState<number>(0);
  const [scheduleOfferPrompt, setScheduleOfferPrompt] = useState<{
    shiftIDs: string[];
    shiftCount: number;
    caregiverName: string;
    week: WeekKind;
  } | null>(null);
  const [acceptScheduleDialog, setAcceptScheduleDialog] =
    useState<AcceptScheduleDialogState | null>(null);
  const [acceptSkipConfirm, setAcceptSkipConfirm] = useState(skipAcceptConfirmationPreference);
  const [acceptingSchedule, setAcceptingSchedule] = useState(false);
  const [acceptToast, setAcceptToast] = useState<{
    id: number;
    caregiverName: string;
    shiftCount: number;
  } | null>(null);
  const isCaregiverThread = conversationID.startsWith("CG-");
  const [hasUserResized, setHasUserResized] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const draftRef = useRef("");
  const selectionRef = useRef<{ start: number; end: number } | null>(null);
  const priorManualResizeRef = useRef(false);
  const autoHeightRef = useRef(TEXTAREA_MIN_VISIBLE_HEIGHT);
  const applyingAutoHeightRef = useRef(false);
  const composerRef = useRef<HTMLDivElement | null>(null);
  const scheduleButtonRef = useRef<HTMLButtonElement | null>(null);
  const clientButtonRef = useRef<HTMLButtonElement | null>(null);
  const categoryButtonRef = useRef<HTMLButtonElement | null>(null);
  const scheduleMenuRef = useRef<HTMLDivElement | null>(null);
  const clientMenuRef = useRef<HTMLDivElement | null>(null);
  const categoryMenuRef = useRef<HTMLDivElement | null>(null);
  const clientPopoverCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    if (!draft && hasUserResized) {
      setHasUserResized(false);
    }
  }, [draft, hasUserResized]);

  useEffect(() => {
    if (!draft.trim()) {
      setPendingScheduleShiftIDs([]);
      setPendingScheduleShifts([]);
      setPendingScheduleWeek(null);
      setPendingScheduleRecipientName("");
      setPendingScheduleInsertedAt(0);
      return;
    }

    if (pendingScheduleShiftIDs.length > 0 && !draft.includes(SCHEDULE_HEADER)) {
      setPendingScheduleShiftIDs([]);
      setPendingScheduleShifts([]);
      setPendingScheduleWeek(null);
      setPendingScheduleRecipientName("");
      setPendingScheduleInsertedAt(0);
    }
  }, [draft, pendingScheduleShiftIDs.length]);

  useEffect(() => {
    if (!scheduleOfferPrompt) return;
    const timeout = window.setTimeout(() => {
      setScheduleOfferPrompt(null);
    }, 30000);
    return () => window.clearTimeout(timeout);
  }, [scheduleOfferPrompt]);

  useEffect(() => {
    skipAcceptConfirmationPreference = acceptSkipConfirm;
  }, [acceptSkipConfirm]);

  useEffect(() => {
    if (!acceptToast) return;
    const timeout = window.setTimeout(() => {
      setAcceptToast((prev) => (prev?.id === acceptToast.id ? null : prev));
    }, 12000);
    return () => window.clearTimeout(timeout);
  }, [acceptToast]);

  useEffect(() => {
    if (!acceptScheduleDialog || acceptScheduleDialog.mode !== "week") return;

    let cancelled = false;
    const week = acceptScheduleDialog.week;

    setAcceptScheduleDialog((prev) => {
      if (!prev || prev.mode !== "week" || prev.week !== week) return prev;
      return { ...prev, loading: true };
    });

    void (async () => {
      try {
        const block = await buildScheduleInsert({
          week,
          caregiverID: conversationID,
        });
        if (cancelled) return;

        setAcceptScheduleDialog((prev) => {
          if (!prev || prev.mode !== "week" || prev.week !== week) return prev;
          return {
            ...prev,
            shiftIDs: block.shiftIDs,
            shifts: block.shifts,
            shiftCount: block.shiftIDs.length,
            loading: false,
            noShifts: block.shiftIDs.length === 0,
          };
        });
      } catch (dialogError) {
        if (cancelled) return;
        console.error("[messages] accept schedule load failed", dialogError);
        setAcceptScheduleDialog((prev) => {
          if (!prev || prev.mode !== "week" || prev.week !== week) return prev;
          return {
            ...prev,
            shiftIDs: [],
            shifts: [],
            shiftCount: 0,
            loading: false,
            noShifts: true,
          };
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [acceptScheduleDialog?.mode, acceptScheduleDialog?.week, conversationID]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el || hasUserResized) return;

    applyingAutoHeightRef.current = true;
    if (!draft.trim()) {
      el.style.height = `${TEXTAREA_MIN_VISIBLE_HEIGHT}px`;
      autoHeightRef.current = TEXTAREA_MIN_VISIBLE_HEIGHT;
      const raf = window.requestAnimationFrame(() => {
        applyingAutoHeightRef.current = false;
      });
      return () => window.cancelAnimationFrame(raf);
    }
    const nextHeight = Math.max(
      TEXTAREA_MIN_VISIBLE_HEIGHT,
      Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT)
    );
    el.style.height = `${nextHeight}px`;
    autoHeightRef.current = nextHeight;
    const raf = window.requestAnimationFrame(() => {
      applyingAutoHeightRef.current = false;
    });
    return () => window.cancelAnimationFrame(raf);
  }, [draft, hasUserResized]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      if (applyingAutoHeightRef.current || hasUserResized) return;
      const currentHeight = Math.round(el.getBoundingClientRect().height);
      if (Math.abs(currentHeight - autoHeightRef.current) > 4) {
        autoHeightRef.current = currentHeight;
        setHasUserResized(true);
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, [hasUserResized]);

  useEffect(() => {
    if (activeMenu !== "schedule") return;
    const button = scheduleButtonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const estimatedHeight = 162;
    setScheduleMenuAbove(rect.bottom + estimatedHeight > window.innerHeight - 12);
  }, [activeMenu, draft]);

  useEffect(() => {
    if (activeMenu !== "client") {
      setClientPopoverFrame(null);
      clientPopoverCleanupRef.current?.();
      clientPopoverCleanupRef.current = null;
      return;
    }

    function updateFrame() {
      const shell = composerRef.current?.parentElement;
      if (!shell) return;
      const rect = shell.getBoundingClientRect();
      setClientPopoverFrame({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      });
    }

    updateFrame();

    const shell = composerRef.current?.parentElement;
    if (shell && typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(updateFrame);
      observer.observe(shell);
      clientPopoverCleanupRef.current = () => observer.disconnect();
    }

    window.addEventListener("resize", updateFrame);
    return () => {
      window.removeEventListener("resize", updateFrame);
      clientPopoverCleanupRef.current?.();
      clientPopoverCleanupRef.current = null;
    };
  }, [activeMenu]);

  useEffect(() => {
    if (activeMenu !== "category") return;
    const button = categoryButtonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const estimatedHeight = 220;
    setCategoryMenuAbove(rect.bottom + estimatedHeight > window.innerHeight - 12);
  }, [activeMenu]);

  useEffect(() => {
    function handlePointerDown(event: globalThis.MouseEvent) {
      const target = event.target as Node | null;
      if (!target || !composerRef.current?.contains(target)) {
        setActiveMenu(null);
        return;
      }

      const scheduleMenu = scheduleMenuRef.current;
      const clientMenu = clientMenuRef.current;
      const categoryMenu = categoryMenuRef.current;
      const scheduleButton = scheduleButtonRef.current;
      const clientButton = clientButtonRef.current;
      const categoryButton = categoryButtonRef.current;

      if (
        activeMenu === "schedule" &&
        scheduleMenu &&
        scheduleButton &&
        !scheduleMenu.contains(target) &&
        !scheduleButton.contains(target)
      ) {
        setActiveMenu(null);
      }

      if (
        activeMenu === "client" &&
        clientMenu &&
        clientButton &&
        !clientMenu.contains(target) &&
        !clientButton.contains(target)
      ) {
        setActiveMenu(null);
      }

      if (
        activeMenu === "category" &&
        categoryMenu &&
        categoryButton &&
        !categoryMenu.contains(target) &&
        !categoryButton.contains(target)
      ) {
        setActiveMenu(null);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [activeMenu]);

  useEffect(() => {
    if (activeMenu !== "client") return;

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setActiveMenu(null);
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [activeMenu]);

  useEffect(() => {
    if (activeMenu !== "client" || clientsLoaded || clientsLoading) return;

    let cancelled = false;
    console.log("CaseInsert: mount");
    setClientsLoading(true);
    setClientsError(null);

    void (async () => {
      if (firebaseAuthLoading) {
        console.log("CaseInsert: waiting for auth");
        return;
      }

      if (firebaseAuthError) {
        console.error("CaseInsert error:", firebaseAuthError);
        setClientsError(firebaseAuthError);
        return;
      }

      if (!firebaseUser) {
        console.log("CaseInsert: waiting for Firebase user");
        setClientsError("Waiting for Firebase auth");
        return;
      }

      const currentWeekStart = getWeekStartYmd("cw");

      const loadClientsAdmin = async () => {
        console.log("CaseInsert: fetching clientsAdmin");
        try {
          const snapshot = await getDocs(collection(firebaseDb, "clientsAdmin"));
          console.log(`CaseInsert: clientsAdmin got ${snapshot.docs.length} docs`);
          return snapshot.docs
            .map((docSnapshot) => {
              const data = docSnapshot.data() as Record<string, unknown>;
              const name = String(data.name || data.clientName || data.client || "").trim();
              if (!name) return null;
              const description = String(data.description || data.clientDescription || "").trim();
              const address = getClientProfileAddress(data);
              const clientID = String(data.clientID || docSnapshot.id || name).trim();
              const raw = Object.fromEntries(
                Object.entries(data).map(([key, value]) => [key, String(value ?? "")])
              );
              return makeClientProfile({
                clientID,
                name,
                address,
                description,
                rate: String(data.rate || "").trim(),
                raw,
                activeThisWeek: false,
              });
            })
            .filter((client): client is ClientPickerEntry => Boolean(client));
        } catch (loadError) {
          console.error("CaseInsert error:", loadError);
          return [] as ClientPickerEntry[];
        }
      };

      const loadLegacyClients = async () => {
        console.log("CaseInsert: fetching clients");
        try {
          const snapshot = await getDocs(collection(firebaseDb, "clients"));
          console.log(`CaseInsert: clients got ${snapshot.docs.length} docs`);
          return snapshot.docs.reduce<Record<string, { description: string; address: string }>>((acc, docSnapshot) => {
            const data = docSnapshot.data() as Record<string, unknown>;
            const name = String(data.name || data.clientName || data.client || "").trim();
            if (!name) return acc;
            const key = normalizeKey(name);
            acc[key] = {
              description: String(data.description || data.clientDescription || "").trim(),
              address: getClientProfileAddress(data),
            };
            return acc;
          }, {});
        } catch (loadError) {
          console.error("CaseInsert error:", loadError);
          return {} as Record<string, { description: string; address: string }>;
        }
      };

      const loadActiveClientNames = async () => {
        console.log("CaseInsert: fetching shifts");
        try {
          const snapshot = await getDocs(
            query(collection(firebaseDb, "shifts"), where("weekStart", "==", currentWeekStart))
          );
          console.log(`CaseInsert: shifts got ${snapshot.docs.length} docs`);
          return new Set(
            snapshot.docs
              .map((docSnapshot) => String((docSnapshot.data() as Record<string, unknown>).client || "").trim())
              .filter(Boolean)
              .map((name) => normalizeKey(name))
          );
        } catch (loadError) {
          console.error("CaseInsert error:", loadError);
          return new Set<string>();
        }
      };

      const [adminResult, legacyResult, activeResult] = await Promise.allSettled([
        loadClientsAdmin(),
        loadLegacyClients(),
        loadActiveClientNames(),
      ]);

      if (cancelled) return;

      const adminClients = adminResult.status === "fulfilled" ? adminResult.value : [];
      const legacyClients = legacyResult.status === "fulfilled" ? legacyResult.value : {};
      const activeNames = activeResult.status === "fulfilled" ? activeResult.value : new Set<string>();

      const mergedMap = new Map<string, ClientPickerEntry>();
      for (const client of adminClients) {
        const key = normalizeKey(client.name);
        const legacy = legacyClients[key];
        const description = client.description.trim() || legacy?.description || "";
        const address = client.address.trim() || legacy?.address || "";
        mergedMap.set(key, {
          ...client,
          description,
          address,
          hasDescription: Boolean(description.trim()),
          activeThisWeek: activeNames.has(key),
        });
      }

      const sorted = Array.from(mergedMap.values()).sort((a, b) => {
        if (a.hasDescription !== b.hasDescription) return a.hasDescription ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      console.log(`CaseInsert: merge complete (${sorted.length} clients)`);
      setClients(sorted);
      setClientsLoaded(true);
    })().finally(() => {
      if (!cancelled) setClientsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [activeMenu, clientsLoaded, firebaseAuthError, firebaseAuthLoading, firebaseUser]);

  const currentSendDisabled = sendPending || !draft.trim() || !category;

  async function handleSend() {
    const body = draft.trim();
    if (!body || sendPending || !category) return;

    const scheduleOfferCandidate =
      conversationID.startsWith("CG-") &&
      pendingScheduleShiftIDs.length > 0 &&
      Boolean(pendingScheduleWeek) &&
      body.includes(SCHEDULE_HEADER) &&
      Date.now() - pendingScheduleInsertedAt <= 5 * 60 * 1000;

    const senderID =
      String(session?.user?.caregiverId || "").trim() ||
      String(session?.user?.email || "").trim() ||
      "Admin";
    const senderName =
      String(session?.user?.name || "").trim() ||
      String(session?.user?.email || "").trim() ||
      "Admin";

    const bodyBeforeSend = draft;
    draftRef.current = bodyBeforeSend;
    priorManualResizeRef.current = hasUserResized;
    setHasUserResized(false);
    setDraft("");
    setError(null);
    setSendPending(true);

    try {
      await sendMessage({
        conversationID,
        body,
        senderID,
        senderName,
        category,
        queryTargets: [conversationID],
        scheduleOfferShiftIDs: scheduleOfferCandidate ? pendingScheduleShiftIDs : undefined,
      });

      if (scheduleOfferCandidate && pendingScheduleWeek) {
        setScheduleOfferPrompt({
          shiftIDs: pendingScheduleShiftIDs,
          shiftCount: pendingScheduleShiftIDs.length,
          caregiverName: pendingScheduleRecipientName || recipientName || conversationID,
          week: pendingScheduleWeek,
        });
        setPendingScheduleShiftIDs([]);
        setPendingScheduleWeek(null);
        setPendingScheduleRecipientName("");
        setPendingScheduleInsertedAt(0);
      }
    } catch (sendError) {
      setDraft(draftRef.current);
      setHasUserResized(priorManualResizeRef.current);
      setError(sendError instanceof Error ? sendError.message : "Failed to send message");
    } finally {
      setSendPending(false);
    }
  }

  function updateSelectionFromTextarea() {
    const el = textareaRef.current;
    if (!el) return;
    selectionRef.current = {
      start: el.selectionStart ?? draft.length,
      end: el.selectionEnd ?? draft.length,
    };
  }

  function insertTextAtCursor(text: string) {
    const el = textareaRef.current;
    const currentDraft = draftRef.current || draft;
    const start = selectionRef.current?.start ?? el?.selectionStart ?? currentDraft.length;
    const end = selectionRef.current?.end ?? el?.selectionEnd ?? currentDraft.length;
    const nextValue = `${currentDraft.slice(0, start)}${text}${currentDraft.slice(end)}`;

    setDraft(nextValue);
    window.requestAnimationFrame(() => {
      const nextEl = textareaRef.current;
      if (!nextEl) return;
      const nextCursor = start + text.length;
      nextEl.focus();
      nextEl.setSelectionRange(nextCursor, nextCursor);
      selectionRef.current = { start: nextCursor, end: nextCursor };
    });
  }

  function openMenu(menu: "schedule" | "client" | "category") {
    setActiveMenu((current) => (current === menu ? null : menu));
  }

  function handleTextAreaKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    void handleSend();
  }

  async function handleInsertSchedule(week: WeekKind) {
    const block = await buildScheduleInsert({
      week,
      caregiverID: conversationID,
    });
    insertTextAtCursor(block.text);
    setPendingScheduleShiftIDs(block.shiftIDs);
    setPendingScheduleShifts(block.shifts);
    setPendingScheduleWeek(week);
    setPendingScheduleRecipientName(recipientName || "");
    setPendingScheduleInsertedAt(block.shiftIDs.length ? Date.now() : 0);
    sheetsShared?.loadWeekBundle(week, { syncActive: true }).catch(() => {
      // Warm cache only; the panel can still fall back to its own load path.
    });
    setActiveMenu(null);
  }

  function handleInsertClient(client: ClientProfile) {
    insertTextAtCursor(buildClientDescriptionInsert(client));
    setActiveMenu(null);
  }

  function handleSelectCategory(nextCategory: string) {
    setCategory(nextCategory);
    setActiveMenu(null);
  }

  function openBulkEditFromScheduleOffer() {
    if (!scheduleOfferPrompt?.shiftIDs.length) {
      setScheduleOfferPrompt(null);
      return;
    }

    const perfStartAt = window.performance.now();
    logBulkEditPerf("click Open Bulk Edit", perfStartAt, {
      week: scheduleOfferPrompt.week,
      shiftCount: scheduleOfferPrompt.shiftCount,
      caregiverName: scheduleOfferPrompt.caregiverName,
    });

    queueBulkEditMessageHandoff({
      week: scheduleOfferPrompt.week,
      shiftIDs: scheduleOfferPrompt.shiftIDs,
      shifts: pendingScheduleShifts,
      caregiverName: scheduleOfferPrompt.caregiverName,
      source: "message",
      createdAt: Date.now(),
      perfStartAt,
      targetStatus: "Offered",
    });
    setScheduleOfferPrompt(null);
  }

  function openAcceptScheduleDialog() {
    if (!isCaregiverThread || acceptingSchedule) return;

    if (scheduleOfferCandidate?.shiftIDs.length) {
      if (acceptSkipConfirm) {
        void handleAcceptScheduleOffer({ skipBulkEdit: true });
        return;
      }

      setAcceptScheduleDialog({
        mode: "offer",
        caregiverName: scheduleOfferCandidate.caregiverName,
        shiftIDs: scheduleOfferCandidate.shiftIDs,
        shifts: [],
        shiftCount: scheduleOfferCandidate.shiftIDs.length,
        messageID: scheduleOfferCandidate.messageID,
        week: pendingScheduleWeek || "cw",
        loading: false,
        noShifts: false,
      });
      return;
    }

    setAcceptScheduleDialog({
      mode: "week",
      caregiverName: recipientName || conversationID,
      shiftIDs: [],
      shifts: [],
      shiftCount: 0,
      messageID: "",
      week: pendingScheduleWeek || "cw",
      loading: true,
      noShifts: false,
    });
  }

  async function handleAcceptScheduleOffer(args: { skipBulkEdit: boolean }) {
    const dialog = acceptScheduleDialog;
    if (!dialog || acceptingSchedule) return;

    const isOfferMode = dialog.mode === "offer" && scheduleOfferCandidate?.shiftIDs.length;
    const shiftIDs = dialog.shiftIDs.length
      ? dialog.shiftIDs
      : scheduleOfferCandidate?.shiftIDs || [];
    if (!shiftIDs.length) return;

    setAcceptingSchedule(true);
    setError(null);

    const senderID =
      String(session?.user?.caregiverId || "").trim() ||
      String(session?.user?.email || "").trim() ||
      "Admin";
    const senderName =
      String(session?.user?.name || "").trim() ||
      String(session?.user?.email || "").trim() ||
      "Admin";
    const thankYouBody = "Thank you!";

    try {
      await sendMessage({
        conversationID,
        body: thankYouBody,
        senderID,
        senderName,
        category: "Scheduling",
        queryTargets: [conversationID],
      });

      if (isOfferMode && scheduleOfferCandidate) {
        await markScheduleOfferAccepted(scheduleOfferCandidate.messageID);
      }

      if (args.skipBulkEdit) {
        const updated = await updateShiftStatusesByShiftIDs(shiftIDs, "Filled");
        setAcceptToast({
          id: Date.now(),
          caregiverName: dialog.caregiverName,
          shiftCount: updated || shiftIDs.length,
        });
        setScheduleOfferPrompt(null);
        setAcceptScheduleDialog(null);
        return;
      }

      const shifts = dialog.shifts.length ? dialog.shifts : await fetchShiftsByIDs(shiftIDs);
      const weekStart = dialog.week === "cw" ? getWeekStartYmd("cw") : getWeekStartYmd("nw");
      const resolvedWeekStart = shifts[0]?.weekStart || weekStart;
      const cwWeekStart = getWeekStartYmd("cw");
      const nwWeekStart = getWeekStartYmd("nw");
      const week =
        resolvedWeekStart === cwWeekStart
          ? "cw"
          : resolvedWeekStart === nwWeekStart
          ? "nw"
          : dialog.week || "cw";

      logBulkEditPerf("click Open Bulk Edit", window.performance.now(), {
        week,
        shiftCount: shiftIDs.length,
        caregiverName: dialog.caregiverName,
        mode: "accept",
      });

      queueBulkEditMessageHandoff({
        week,
        shiftIDs,
        shifts: shifts.length
          ? shifts.map((shift) => ({
              shiftID: shift.shiftID,
              caregiverID: shift.caregiverID,
              weekStart: shift.weekStart,
              date: shift.date,
              client: shift.client,
              startTime: shift.startTime,
              endTime: shift.endTime,
            }))
          : dialog.shifts,
        caregiverName: dialog.caregiverName,
        source: "message",
        createdAt: Date.now(),
        perfStartAt: window.performance.now(),
        targetStatus: "Filled",
      });
      setAcceptToast({
        id: Date.now(),
        caregiverName: dialog.caregiverName,
        shiftCount: shiftIDs.length,
      });
      setAcceptScheduleDialog(null);
    } catch (acceptError) {
      setError(acceptError instanceof Error ? acceptError.message : "Failed to confirm schedule");
    } finally {
      setAcceptingSchedule(false);
    }
  }

  const scheduleMenuItems = [
    { key: "cw" as WeekKind, label: "Current Week" },
    { key: "nw" as WeekKind, label: "Next Week" },
  ];

  const categoryToneValue = categoryTone(category);

  const activeClientCount = useMemo(
    () => clients.filter((client) => client.activeThisWeek).length,
    [clients]
  );

  const clientEntries = useMemo(() => {
    const normalizedSearch = clientSearch.trim().toLowerCase();
    return clients
      .filter((client) => (clientScope === "All" ? true : client.activeThisWeek))
      .filter((client) => client.name.toLowerCase().includes(normalizedSearch));
  }, [clientSearch, clientScope, clients]);

  return (
    <div
      ref={composerRef}
      style={{
        borderTop: `1px solid ${UI.borderSoft}`,
        background: UI.panelBg,
        padding: 12,
      }}
    >
      <div style={controlsRowStyle}>
        <div style={menuButtonWrapperStyle}>
          <button
            ref={scheduleButtonRef}
            type="button"
            disabled={sendPending}
            onClick={() => openMenu("schedule")}
            title="Insert schedule"
            aria-label="Insert schedule"
            style={iconButtonYellowStyle}
          >
            <CalendarPlusIcon />
          </button>

          {activeMenu === "schedule" ? (
            <div
              ref={scheduleMenuRef}
              style={{ ...dropdownMenuStyle, ...menuPlacementStyle({ above: scheduleMenuAbove }) }}
            >
              {scheduleMenuItems.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => void handleInsertSchedule(item.key)}
                  style={dropdownItemStyle}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div style={menuButtonWrapperStyle}>
          <button
            ref={clientButtonRef}
            type="button"
            disabled={sendPending}
            onClick={() => openMenu("client")}
            title="Insert client description"
            aria-label="Insert client description"
            style={iconButtonOrangeStyle}
          >
            <UserCircleIcon />
          </button>

          {activeMenu === "client" ? (
            <div
              style={{
                position: "fixed",
                left: clientPopoverFrame?.left ?? 0,
                top: clientPopoverFrame?.top ?? 0,
                width: clientPopoverFrame?.width ?? "100vw",
                height: clientPopoverFrame?.height ?? "100vh",
                zIndex: 40,
                background: "rgba(0, 0, 0, 0.15)",
                display: "grid",
                placeItems: "center",
                padding: 16,
              }}
              onMouseDown={() => setActiveMenu(null)}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-label="Insert client description"
                ref={clientMenuRef}
                onMouseDown={(event) => event.stopPropagation()}
                data-popover="client-description"
                style={{
                  width:
                    clientPopoverFrame && clientPopoverFrame.width < 500
                      ? `${Math.round(clientPopoverFrame.width * 0.95)}px`
                      : "360px",
                  maxWidth: "95vw",
                  height: "min(500px, 70vh)",
                  minHeight: 320,
                  maxHeight: "70vh",
                  borderRadius: 18,
                  background: "#ffffff",
                  border: `1px solid ${UI.borderSoft}`,
                  boxShadow: "0 20px 50px rgba(15, 23, 42, 0.22)",
                  display: "flex",
                  flexDirection: "column",
                  overflow: "hidden",
                  position: "relative",
                }}
              >
                <button
                  type="button"
                  aria-label="Close client picker"
                  onClick={() => setActiveMenu(null)}
                  style={{
                    position: "absolute",
                    top: 8,
                    right: 8,
                    border: "none",
                    background: "transparent",
                    color: UI.textDim,
                    fontSize: 18,
                    fontWeight: 1000,
                    cursor: "pointer",
                    lineHeight: 1,
                    padding: 0,
                    zIndex: 1,
                  }}
                >
                  ×
                </button>
                <div
                  style={{
                    flex: 1,
                    minHeight: 0,
                    display: "flex",
                    flexDirection: "column",
                    padding: 14,
                    paddingRight: 36,
                    gap: 10,
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 1000, color: UI.text }}>
                    Insert client description
                  </div>
                  <div style={clientScopeRowStyle}>
                    <button
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => setClientScope("Active")}
                      style={{
                        ...clientScopeButtonStyle,
                        ...(clientScope === "Active" ? clientScopeButtonActiveStyle : null),
                      }}
                    >
                      Active ({activeClientCount})
                    </button>
                    <button
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => setClientScope("All")}
                      style={{
                        ...clientScopeButtonStyle,
                        ...(clientScope === "All" ? clientScopeButtonActiveStyle : null),
                      }}
                    >
                      All ({clients.length})
                    </button>
                  </div>
                  <input
                    value={clientSearch}
                    onChange={(event) => setClientSearch(event.target.value)}
                    placeholder="Search clients…"
                    style={clientSearchInputStyle}
                  />
                  <div
                    style={{
                      flex: 1,
                      minHeight: 0,
                      overflowY: "auto",
                      display: "grid",
                      gap: 4,
                      paddingRight: 2,
                    }}
                  >
                    {clientsError ? (
                      <div style={dropdownLoadingStyle}>{clientsError}</div>
                    ) : !clientsLoaded || clientsLoading ? (
                      <div style={dropdownLoadingStyle}>Loading…</div>
                    ) : clientEntries.length === 0 ? (
                      <div style={dropdownLoadingStyle}>No clients found</div>
                    ) : (
                      clientEntries.map((client) => (
                        <button
                          key={client.clientID || client.name}
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => handleInsertClient(client)}
                          style={clientPopoverItemStyle}
                        >
                          <div
                            style={{
                              fontSize: 12,
                              fontWeight: 900,
                              color: UI.text,
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {client.name}
                          </div>
                          <div
                            style={{
                              fontSize: 10.5,
                              color: UI.textDim,
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {client.hasDescription ? "Has description" : "No description"}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {isCaregiverThread ? (
          <div style={menuButtonWrapperStyle}>
            <button
              type="button"
              disabled={acceptingSchedule}
              onClick={() => openAcceptScheduleDialog()}
              title="Confirm this week's shifts (mark as filled + send thank-you)"
              aria-label="Confirm schedule"
              style={acceptingSchedule ? iconButtonDisabledStyle : iconButtonGreenStyle}
            >
              <CheckCircleIcon />
            </button>
          </div>
        ) : null}

        <div style={spacerStyle} />

        <div style={menuButtonWrapperStyle}>
          <button
            ref={categoryButtonRef}
            type="button"
            disabled={sendPending}
            onClick={() => openMenu("category")}
            aria-label={`Category: ${category}`}
            style={categoryButtonStyle}
          >
            <span style={categoryStaticLabelStyle}>Category:</span>
            <span style={{ ...categoryDotStyle, background: categoryToneValue.dot }} />
            <span style={categoryLabelStyle}>{category}</span>
            <ChevronDownIcon />
          </button>

          {activeMenu === "category" ? (
            <div
              ref={categoryMenuRef}
              style={{
                ...dropdownMenuStyle,
                ...menuPlacementStyle({ above: categoryMenuAbove, width: 224 }),
                right: 0,
                left: "auto",
              }}
            >
              {CATEGORY_OPTIONS.map((option) => {
                const tone = categoryTone(option);
                return (
                  <button
                    key={option}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => handleSelectCategory(option)}
                    style={categoryMenuItemStyle}
                  >
                    <span style={{ ...categoryDotStyle, background: tone.dot }} />
                    <span>{option}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>

      <textarea
        ref={textareaRef}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onSelect={updateSelectionFromTextarea}
        onKeyUp={updateSelectionFromTextarea}
        onClick={updateSelectionFromTextarea}
        onFocus={updateSelectionFromTextarea}
        onKeyDown={handleTextAreaKeyDown}
        placeholder="Type a message…"
        disabled={sendPending}
        rows={1}
        style={{
          ...textareaStyle,
          opacity: sendPending ? 0.7 : 1,
        }}
      />

      {scheduleOfferPrompt ? (
        <div style={scheduleOfferPromptStyle}>
          <div style={{ display: "grid", gap: 4 }}>
            <div style={scheduleOfferPromptTitleStyle}>
              ✓ Schedule sent to {scheduleOfferPrompt.caregiverName}
            </div>
            <div style={scheduleOfferPromptBodyStyle}>
              Update these {scheduleOfferPrompt.shiftCount} shifts?
            </div>
          </div>
          <div style={scheduleOfferPromptActionsStyle}>
            <button
              type="button"
              onClick={openBulkEditFromScheduleOffer}
              style={scheduleOfferPromptOpenButtonStyle}
            >
              Open Bulk Edit
            </button>
            <button
              type="button"
              onClick={() => setScheduleOfferPrompt(null)}
              style={scheduleOfferPromptDismissButtonStyle}
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      {acceptToast ? (
        <div style={acceptToastStyle}>
          ✓ Schedule confirmed for {acceptToast.caregiverName}
        </div>
      ) : null}

      {acceptScheduleDialog ? (
        <div style={acceptDialogBackdropStyle} onMouseDown={() => setAcceptScheduleDialog(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Confirm schedule for ${acceptScheduleDialog.caregiverName}`}
            onMouseDown={(event) => event.stopPropagation()}
            style={acceptDialogCardStyle}
          >
            <div style={acceptDialogTitleStyle}>
              {acceptScheduleDialog.mode === "offer"
                ? `Mark ${acceptScheduleDialog.shiftIDs.length} shifts as filled and send thank-you?`
                : "Mark this week's shifts as filled and send thank-you?"}
            </div>

            {acceptScheduleDialog.mode === "week" ? (
              <div style={{ display: "grid", gap: 10 }}>
                <div style={weekToggleRowStyle}>
                  <button
                    type="button"
                    onClick={() =>
                      setAcceptScheduleDialog((prev) =>
                        prev && prev.mode === "week"
                          ? { ...prev, week: "cw", loading: true, noShifts: false }
                          : prev
                      )
                    }
                    style={{
                      ...weekToggleButtonStyle,
                      ...(acceptScheduleDialog.week === "cw" ? weekToggleButtonActiveStyle : null),
                    }}
                  >
                    This Week
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setAcceptScheduleDialog((prev) =>
                        prev && prev.mode === "week"
                          ? { ...prev, week: "nw", loading: true, noShifts: false }
                          : prev
                      )
                    }
                    style={{
                      ...weekToggleButtonStyle,
                      ...(acceptScheduleDialog.week === "nw" ? weekToggleButtonActiveStyle : null),
                    }}
                  >
                    Next Week
                  </button>
                </div>
                <div style={acceptDialogCountStyle}>
                  {acceptScheduleDialog.loading
                    ? "Loading shifts…"
                    : acceptScheduleDialog.noShifts
                    ? `No shifts scheduled for ${
                        acceptScheduleDialog.week === "cw" ? "this week" : "next week"
                      } — nothing to confirm.`
                    : `${acceptScheduleDialog.shiftCount} shift${
                        acceptScheduleDialog.shiftCount === 1 ? "" : "s"
                      } selected`}
                </div>
              </div>
            ) : (
              <div style={acceptDialogBodyStyle}>
                This will send “Thank you!” now. You can skip Bulk Edit and fill the shifts
                directly, or continue into Bulk Edit to review them first.
              </div>
            )}

            {!acceptScheduleDialog.noShifts ? (
              <label style={acceptCheckboxRowStyle}>
                <input
                  type="checkbox"
                  checked={acceptSkipConfirm}
                  onChange={(event) => setAcceptSkipConfirm(event.target.checked)}
                />
                <span>Skip confirmation, apply Filled directly</span>
              </label>
            ) : null}

            <div style={acceptDialogActionsStyle}>
              <button
                type="button"
                onClick={() => setAcceptScheduleDialog(null)}
                disabled={acceptingSchedule}
                style={acceptDialogSecondaryButtonStyle}
              >
                Cancel
              </button>
              {!acceptScheduleDialog.noShifts ? (
                <button
                  type="button"
                  onClick={() => void handleAcceptScheduleOffer({ skipBulkEdit: acceptSkipConfirm })}
                  disabled={acceptingSchedule || acceptScheduleDialog.loading}
                  style={acceptDialogPrimaryButtonStyle}
                >
                  {acceptingSchedule ? "Working…" : "Yes, confirm"}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12 }}>
        {error ? <div style={errorStyle}>{error}</div> : <div style={{ minHeight: 16 }} />}
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={currentSendDisabled}
          style={sendButtonStyle}
        >
          {sendPending ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}

const controlsRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "nowrap",
};

const menuButtonWrapperStyle: CSSProperties = {
  position: "relative",
  flex: "0 0 auto",
};

const spacerStyle: CSSProperties = {
  flex: "1 1 auto",
  minWidth: 12,
};

const iconButtonBaseStyle: CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: "50%",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  padding: 0,
  transition: "transform 120ms ease, box-shadow 120ms ease, opacity 120ms ease",
};

const iconButtonYellowStyle: CSSProperties = {
  ...iconButtonBaseStyle,
  background: "#fef3c7",
  border: "1px solid #fcd34d",
  color: "#111827",
};

const iconButtonOrangeStyle: CSSProperties = {
  ...iconButtonBaseStyle,
  background: "#ffedd5",
  border: "1px solid #fdba74",
  color: "#c2410c",
};

const iconButtonGreenStyle: CSSProperties = {
  ...iconButtonBaseStyle,
  background: "rgba(33, 136, 56, 0.15)",
  border: "1px solid rgba(33, 136, 56, 0.3)",
  color: "#218838",
};

const iconButtonDisabledStyle: CSSProperties = {
  ...iconButtonBaseStyle,
  background: "#f3f4f6",
  border: "1px solid #d1d5db",
  color: "#9ca3af",
  opacity: 0.4,
  cursor: "default",
};

const categoryButtonStyle: CSSProperties = {
  minHeight: 32,
  border: `1px solid ${UI.borderSoft}`,
  borderRadius: 999,
  padding: "0 10px 0 8px",
  background: "#ffffff",
  color: "#1a1a1a",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  whiteSpace: "nowrap",
};

const categoryDotStyle: CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: "50%",
  flex: "0 0 auto",
};

const categoryLabelStyle: CSSProperties = {
  maxWidth: 170,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const categoryStaticLabelStyle: CSSProperties = {
  color: UI.textDim,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 0.4,
};

const dropdownMenuStyle: CSSProperties = {
  position: "absolute",
  left: 0,
  zIndex: 20,
  background: "#ffffff",
  border: `1px solid ${UI.borderSoft}`,
  borderRadius: 12,
  boxShadow: "0 14px 30px rgba(15, 23, 42, 0.12)",
  padding: 6,
  display: "grid",
  gap: 4,
  maxHeight: 240,
  overflowY: "auto",
};

const clientSearchInputStyle: CSSProperties = {
  width: "100%",
  height: 30,
  borderRadius: 10,
  border: `1px solid ${UI.borderSoft}`,
  background: "#ffffff",
  padding: "0 10px",
  fontSize: 12,
  color: "#1a1a1a",
  outline: "none",
  marginBottom: 4,
};

const clientScopeRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  marginBottom: 6,
};

const clientScopeButtonStyle: CSSProperties = {
  flex: "1 1 0",
  minWidth: 0,
  height: 28,
  borderRadius: 10,
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: UI.borderSoft,
  background: "#ffffff",
  color: UI.textDim,
  fontSize: 11,
  fontWeight: 700,
  cursor: "pointer",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const clientScopeButtonActiveStyle: CSSProperties = {
  background: "#fef7dc",
  color: "#1a1a1a",
  borderColor: "#f8ba00",
};

const dropdownItemStyle: CSSProperties = {
  width: "100%",
  border: "none",
  borderRadius: 10,
  padding: "8px 10px",
  background: "#ffffff",
  color: "#1a1a1a",
  textAlign: "left",
  cursor: "pointer",
  fontSize: 12,
};

const clientPopoverItemStyle: CSSProperties = {
  width: "100%",
  border: `1px solid ${UI.borderSoft}`,
  borderRadius: 12,
  padding: "10px 12px",
  background: "#ffffff",
  color: "#1a1a1a",
  textAlign: "left",
  cursor: "pointer",
  display: "grid",
  gap: 3,
};

const categoryMenuItemStyle: CSSProperties = {
  ...dropdownItemStyle,
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
};

const dropdownLoadingStyle: CSSProperties = {
  padding: "8px 10px",
  color: UI.textDim,
  fontSize: 12,
};

const textareaStyle: CSSProperties = {
  width: "100%",
  height: TEXTAREA_MIN_VISIBLE_HEIGHT,
  minHeight: TEXTAREA_MIN_VISIBLE_HEIGHT,
  maxHeight: "none",
  resize: "vertical",
  marginTop: 10,
  border: `1px solid ${UI.borderSoft}`,
  borderRadius: 12,
  padding: "10px 12px",
  fontSize: 14,
  lineHeight: 1.4,
  color: "#1a1a1a",
  background: "#ffffff",
  outline: "none",
  overflowY: "auto",
};

const iconSvgStyle: CSSProperties = {
  width: 16,
  height: 16,
  display: "block",
};

const chevronSvgStyle: CSSProperties = {
  width: 14,
  height: 14,
  display: "block",
  color: UI.textDim,
};

const sendButtonStyle: CSSProperties = {
  minWidth: 82,
  height: 32,
  border: "none",
  borderRadius: 10,
  padding: "0 14px",
  background: "#f8ba00",
  color: "#1a1a1a",
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
};

const errorStyle: CSSProperties = {
  fontSize: 11,
  color: "#b91c1c",
  marginRight: "auto",
};

const scheduleOfferPromptStyle: CSSProperties = {
  marginTop: 10,
  border: "1px solid #fcd34d",
  background: "#fffbeb",
  color: "#92400e",
  borderRadius: 14,
  padding: "10px 12px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
};

const scheduleOfferPromptTitleStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 1000,
  color: "#92400e",
};

const scheduleOfferPromptBodyStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 800,
  color: "#b45309",
};

const scheduleOfferPromptActionsStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
};

const scheduleOfferPromptOpenButtonStyle: CSSProperties = {
  border: "1px solid #f59e0b",
  background: "#f8ba00",
  color: "#1a1a1a",
  borderRadius: 10,
  minHeight: 32,
  padding: "6px 10px",
  fontSize: 11,
  fontWeight: 900,
  cursor: "pointer",
};

const scheduleOfferPromptDismissButtonStyle: CSSProperties = {
  border: "1px solid #fcd34d",
  background: "#fff",
  color: "#92400e",
  borderRadius: 10,
  minHeight: 32,
  padding: "6px 10px",
  fontSize: 11,
  fontWeight: 900,
  cursor: "pointer",
};

const acceptToastStyle: CSSProperties = {
  marginTop: 10,
  border: "1px solid rgba(33, 136, 56, 0.28)",
  background: "rgba(33, 136, 56, 0.12)",
  color: "#14532d",
  borderRadius: 14,
  padding: "10px 12px",
  fontSize: 11,
  fontWeight: 900,
};

const acceptDialogBackdropStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(17, 24, 39, 0.34)",
  display: "grid",
  placeItems: "center",
  padding: 16,
  zIndex: 80,
};

const acceptDialogCardStyle: CSSProperties = {
  width: "min(92vw, 420px)",
  borderRadius: 18,
  background: "#ffffff",
  border: `1px solid ${UI.borderSoft}`,
  boxShadow: "0 20px 50px rgba(15, 23, 42, 0.22)",
  padding: 16,
  display: "grid",
  gap: 12,
};

const acceptDialogTitleStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 1000,
  color: UI.text,
};

const acceptDialogBodyStyle: CSSProperties = {
  fontSize: 12,
  lineHeight: 1.5,
  color: UI.textDim,
};

const weekToggleRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
};

const weekToggleButtonStyle: CSSProperties = {
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: UI.borderSoft,
  background: "#ffffff",
  color: UI.textDim,
  borderRadius: 999,
  minHeight: 30,
  padding: "0 10px",
  fontSize: 11,
  fontWeight: 900,
  cursor: "pointer",
};

const weekToggleButtonActiveStyle: CSSProperties = {
  background: "#fef7dc",
  borderColor: "#f8ba00",
  color: UI.text,
};

const acceptDialogCountStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 900,
  color: "#92400e",
};

const acceptCheckboxRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 11.5,
  fontWeight: 800,
  color: UI.text,
};

const acceptDialogActionsStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
  gap: 8,
  flexWrap: "wrap",
};

const acceptDialogSecondaryButtonStyle: CSSProperties = {
  border: `1px solid ${UI.borderSoft}`,
  background: "#ffffff",
  color: UI.text,
  borderRadius: 10,
  minHeight: 32,
  padding: "6px 10px",
  fontSize: 11,
  fontWeight: 900,
  cursor: "pointer",
};

const acceptDialogPrimaryButtonStyle: CSSProperties = {
  border: "1px solid #218838",
  background: "#218838",
  color: "#ffffff",
  borderRadius: 10,
  minHeight: 32,
  padding: "6px 10px",
  fontSize: 11,
  fontWeight: 1000,
  cursor: "pointer",
};

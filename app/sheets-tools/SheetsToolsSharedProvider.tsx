"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  buildShiftLookupFromRows,
  getWeekStartYmd,
  fetchGrid,
  fetchScheduleMaps,
  normalizeKey,
  normalizeScheduleValues,
  parseWeek,
  type CaregiverProfile,
  type CaregiversApiResponse,
  type ClockMap,
  type GridResponse,
  type LocationMap,
  type ShiftRow,
  type WeekKind,
} from "./shared";
import { collection, onSnapshot, query, where, type Unsubscribe } from "firebase/firestore";
import { firebaseDb } from "@/lib/firebase/client";

type ReplaceUrlStateArgs = {
  week?: WeekKind;
  shift?: string | null;
};

type SheetsToolsSharedContextValue = {
  session: ReturnType<typeof useSession>["data"];
  currentUserName: string;
  currentUserEmail: string;
  sheetId: string;
  userEmail: string;
  caregiversById: Record<string, CaregiverProfile>;
  idByNameOnSchedule: Record<string, string>;
  refreshCaregivers: () => Promise<void>;
  cwGrid: GridResponse | null;
  nwGrid: GridResponse | null;
  cwScheduleRows: ShiftRow[];
  nwScheduleRows: ShiftRow[];
  cwShiftIdLookup: Record<string, string>;
  nwShiftIdLookup: Record<string, string>;
  cwClockMap: ClockMap;
  nwClockMap: ClockMap;
  cwLocationMap: LocationMap;
  nwLocationMap: LocationMap;
  cwLoaded: boolean;
  nwLoaded: boolean;
  cwAvailabilitySubmitters: Set<string>;
  nwAvailabilitySubmitters: Set<string>;
  availabilityLoaded: boolean;
  loadingWeeksRef: MutableRefObject<Set<WeekKind>>;
  loadWeekBundle: (week: WeekKind, opts?: { syncActive?: boolean }) => Promise<void>;
  refreshScheduleStateInBackground: (args?: {
    includeGrid?: boolean;
    includeEditLog?: boolean;
  }) => Promise<void>;
  refreshRecommendationsStateInBackground: () => Promise<void>;
  replaceUrlState: (next: ReplaceUrlStateArgs) => void;
};

const SheetsToolsSharedContext = createContext<SheetsToolsSharedContextValue | null>(null);

export function SheetsToolsSharedProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() || "/sheets-tools";
  const searchParams = useSearchParams();
  const { data: session } = useSession();

  const weekParam = searchParams.get("week");
  const currentWeek = useMemo(() => parseWeek(weekParam), [weekParam]);

  const bootRef = useRef({
    sheetId: searchParams.get("sheetId") ?? "",
    userEmail: searchParams.get("userEmail") ?? "",
  });

  const [caregiversById, setCaregiversById] = useState<Record<string, CaregiverProfile>>({});
  const [idByNameOnSchedule, setIdByNameOnSchedule] = useState<Record<string, string>>({});
  const [cwGrid, setCwGrid] = useState<GridResponse | null>(null);
  const [nwGrid, setNwGrid] = useState<GridResponse | null>(null);
  const [cwScheduleRows, setCwScheduleRows] = useState<ShiftRow[]>([]);
  const [nwScheduleRows, setNwScheduleRows] = useState<ShiftRow[]>([]);
  const [cwShiftIdLookup, setCwShiftIdLookup] = useState<Record<string, string>>({});
  const [nwShiftIdLookup, setNwShiftIdLookup] = useState<Record<string, string>>({});
  const [cwClockMap, setCwClockMap] = useState<ClockMap>({});
  const [nwClockMap, setNwClockMap] = useState<ClockMap>({});
  const [cwLocationMap, setCwLocationMap] = useState<LocationMap>({});
  const [nwLocationMap, setNwLocationMap] = useState<LocationMap>({});
  const [cwLoaded, setCwLoaded] = useState(false);
  const [nwLoaded, setNwLoaded] = useState(false);
  const [cwAvailabilitySubmitters, setCwAvailabilitySubmitters] = useState<Set<string>>(
    () => new Set()
  );
  const [nwAvailabilitySubmitters, setNwAvailabilitySubmitters] = useState<Set<string>>(
    () => new Set()
  );
  const [availabilityLoaded, setAvailabilityLoaded] = useState(false);
  const loadingWeeksRef = useRef<Set<WeekKind>>(new Set());
  const loadingWeekPromisesRef = useRef<Partial<Record<WeekKind, Promise<void>>>>({});

  const cwWeekStartYmd = useMemo(() => getWeekStartYmd("cw"), []);
  const nwWeekStartYmd = useMemo(() => getWeekStartYmd("nw"), []);

  const replaceUrlState = useCallback(
    (next: ReplaceUrlStateArgs) => {
      const sp = new URLSearchParams(searchParams?.toString() || "");
      sp.delete("tab");
      sp.set("week", next.week ?? currentWeek);
      if (next.shift === null) {
        sp.delete("shift");
      } else if (typeof next.shift === "string" && next.shift) {
        sp.set("shift", next.shift);
      }

      const qs = sp.toString();
      if (qs !== (searchParams?.toString() || "")) {
        router.replace(qs ? `${pathname}?${qs}` : pathname);
      }
    },
    [currentWeek, pathname, router, searchParams]
  );

  const loadWeekBundle = useCallback(async (week: WeekKind, _opts?: { syncActive?: boolean }) => {
    const existing = loadingWeekPromisesRef.current[week];
    if (existing) return existing;
    if (loadingWeeksRef.current.has(week)) {
      return loadingWeekPromisesRef.current[week] ?? Promise.resolve();
    }
    loadingWeeksRef.current.add(week);

    const promise = (async () => {
      try {
        const [grid, sched] = await Promise.all([fetchGrid(week), fetchScheduleMaps(week)]);
        const rows = normalizeScheduleValues(sched.values ?? []);
        const nextLookup = buildShiftLookupFromRows(rows);

        if (week === "cw") {
          setCwGrid(grid);
          setCwScheduleRows(rows);
          setCwShiftIdLookup(nextLookup);
          setCwClockMap(sched.clockMap ?? {});
          setCwLocationMap(sched.locationMap ?? {});
          setCwLoaded(true);
        } else {
          setNwGrid(grid);
          setNwScheduleRows(rows);
          setNwShiftIdLookup(nextLookup);
          setNwClockMap(sched.clockMap ?? {});
          setNwLocationMap(sched.locationMap ?? {});
          setNwLoaded(true);
        }
      } finally {
        loadingWeeksRef.current.delete(week);
        delete loadingWeekPromisesRef.current[week];
      }
    })();

    loadingWeekPromisesRef.current[week] = promise;
    return promise;
  }, []);

  const refreshCaregivers = useCallback(async () => {
    const res = await fetch("/api/caregivers", { cache: "no-store" });
    const text = await res.text();
    const payload = text ? (JSON.parse(text) as CaregiversApiResponse) : null;

    if (!res.ok) throw new Error(payload?.error || `Caregivers request failed (${res.status})`);
    if (!payload?.ok) throw new Error(payload?.error || "Failed to load caregivers");

    setCaregiversById(payload.byId ?? {});
    const rawMap = payload.idByNameOnSchedule ?? {};
    const normMap: Record<string, string> = {};
    for (const key of Object.keys(rawMap)) {
      normMap[normalizeKey(key)] = rawMap[key];
    }
    setIdByNameOnSchedule(normMap);
  }, []);

  const refreshScheduleStateInBackground = useCallback(
    async (_args?: { includeGrid?: boolean; includeEditLog?: boolean }) => {
      await Promise.all([loadWeekBundle(currentWeek), refreshCaregivers()]);
    },
    [currentWeek, loadWeekBundle, refreshCaregivers]
  );

  const refreshRecommendationsStateInBackground = useCallback(async () => {
    await Promise.all([loadWeekBundle("cw"), loadWeekBundle("nw"), refreshCaregivers()]);
  }, [loadWeekBundle, refreshCaregivers]);

  useEffect(() => {
    if (!cwWeekStartYmd || !nwWeekStartYmd) return;

    let cancelled = false;
    const availabilityQuery = query(
      collection(firebaseDb, "availability"),
      where("weekStart", "in", [cwWeekStartYmd, nwWeekStartYmd])
    );

    const unsubscribe: Unsubscribe = onSnapshot(
      availabilityQuery,
      (snapshot) => {
        if (cancelled) return;

        const nextCW = new Set<string>();
        const nextNW = new Set<string>();

        snapshot.docs.forEach((docSnapshot) => {
          const data = docSnapshot.data() as Record<string, unknown>;
          const caregiverID = String(data.caregiverID || "").trim() || docSnapshot.id.split("_")[0];
          const weekStart = String(data.weekStart || "").trim() || "";

          if (!caregiverID) return;
          if (weekStart === cwWeekStartYmd) nextCW.add(caregiverID);
          if (weekStart === nwWeekStartYmd) nextNW.add(caregiverID);
        });

        setCwAvailabilitySubmitters(nextCW);
        setNwAvailabilitySubmitters(nextNW);
        setAvailabilityLoaded(true);
      },
      () => {
        if (!cancelled) setAvailabilityLoaded(true);
      }
    );

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [cwWeekStartYmd, nwWeekStartYmd]);

  const currentUserName =
    session?.user?.name?.trim() || session?.user?.email?.trim() || "Signed-in user";
  const currentUserEmail =
    session?.user?.email?.trim() || bootRef.current.userEmail || "";

  const value = useMemo<SheetsToolsSharedContextValue>(
    () => ({
      session,
      currentUserName,
      currentUserEmail,
      sheetId: bootRef.current.sheetId,
      userEmail: bootRef.current.userEmail,
      caregiversById,
      idByNameOnSchedule,
      refreshCaregivers,
      cwGrid,
      nwGrid,
      cwScheduleRows,
      nwScheduleRows,
      cwShiftIdLookup,
      nwShiftIdLookup,
      cwClockMap,
      nwClockMap,
      cwLocationMap,
      nwLocationMap,
      cwLoaded,
      nwLoaded,
      cwAvailabilitySubmitters,
      nwAvailabilitySubmitters,
      availabilityLoaded,
      loadingWeeksRef,
      loadWeekBundle,
      refreshScheduleStateInBackground,
      refreshRecommendationsStateInBackground,
      replaceUrlState,
    }),
    [
      caregiversById,
      currentUserEmail,
      currentUserName,
      cwClockMap,
      cwGrid,
      cwLoaded,
      cwAvailabilitySubmitters,
      cwLocationMap,
      cwScheduleRows,
      cwShiftIdLookup,
      availabilityLoaded,
      idByNameOnSchedule,
      loadWeekBundle,
      nwClockMap,
      nwGrid,
      nwLoaded,
      nwAvailabilitySubmitters,
      nwLocationMap,
      nwScheduleRows,
      nwShiftIdLookup,
      refreshCaregivers,
      refreshRecommendationsStateInBackground,
      refreshScheduleStateInBackground,
      replaceUrlState,
      session,
    ]
  );

  return (
    <SheetsToolsSharedContext.Provider value={value}>
      {children}
    </SheetsToolsSharedContext.Provider>
  );
}

export function useSheetsToolsShared() {
  const value = useContext(SheetsToolsSharedContext);
  if (!value) {
    throw new Error("useSheetsToolsShared must be used inside <SheetsToolsSharedProvider>");
  }
  return value;
}

export function useMaybeSheetsToolsShared() {
  return useContext(SheetsToolsSharedContext);
}

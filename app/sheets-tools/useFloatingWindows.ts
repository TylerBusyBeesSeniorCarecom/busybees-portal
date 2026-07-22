"use client";

import {
  createElement,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type PanelId = "bulk-edit" | "recommendations" | "messages";

export type PanelState = {
  open: boolean;
  minimized: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
};

export type FloatingWindowsValue = {
  panels: Record<PanelId, PanelState>;
  openPanel: (id: PanelId) => void;
  closePanel: (id: PanelId) => void;
  minimizePanel: (id: PanelId) => void;
  focusPanel: (id: PanelId) => void;
  setPanelBounds: (
    id: PanelId,
    bounds: Partial<Pick<PanelState, "x" | "y" | "w" | "h">>
  ) => void;
  toolbarBounds: { x: number; y: number };
  setToolbarBounds: (bounds: { x: number; y: number }) => void;
  toolbarMinimized: boolean;
  setToolbarMinimized: (minimized: boolean) => void;
};

const STORAGE_KEY = "sheets-tools:layout:v1";
const TOOLBAR_W = 292;
const TOOLBAR_H = 52;
const TOOLBAR_MIN_W = 44;
const TOOLBAR_MIN_H = 36;
const MIN_W = 320;
const MIN_H = 200;

const DEFAULT_PANEL_BOUNDS: Record<PanelId, Omit<PanelState, "open" | "minimized" | "z">> = {
  "bulk-edit": { x: 100, y: 100, w: 720, h: 640 },
  recommendations: { x: 140, y: 140, w: 560, h: 720 },
  messages: { x: 100, y: 160, w: 900, h: 640 },
};

function panelMinSize(id: PanelId) {
  if (id === "messages") return { w: 240, h: 120 };
  return { w: MIN_W, h: MIN_H };
}

type StoredLayout = {
  toolbarBounds?: { x: number; y: number };
  toolbarMinimized?: boolean;
  panels?: Partial<Record<PanelId, Partial<Pick<PanelState, "x" | "y" | "w" | "h">>>>;
};

function clampToolbar(bounds: { x: number; y: number }, minimized = false) {
  if (typeof window === "undefined") return bounds;
  const pad = 8;
  const width = minimized ? TOOLBAR_MIN_W : TOOLBAR_W;
  const height = minimized ? TOOLBAR_MIN_H : TOOLBAR_H;
  return {
    x: Math.max(pad, Math.min(bounds.x, window.innerWidth - width - pad)),
    y: Math.max(pad, Math.min(bounds.y, window.innerHeight - height - pad)),
  };
}

function clampPanelForId(
  id: PanelId,
  bounds: Pick<PanelState, "x" | "y" | "w" | "h">
) {
  if (typeof window === "undefined") return bounds;
  const pad = 8;
  const mins = panelMinSize(id);
  const maxW = Math.max(mins.w, window.innerWidth - pad * 2);
  const maxH = Math.max(mins.h, window.innerHeight - pad * 2);
  const w = Math.min(Math.max(bounds.w, mins.w), maxW);
  const h = Math.min(Math.max(bounds.h, mins.h), maxH);
  const x = Math.max(pad, Math.min(bounds.x, window.innerWidth - w - pad));
  const y = Math.max(pad, Math.min(bounds.y, window.innerHeight - 40 - pad));
  return { x, y, w, h };
}

function parseOpenPanels(raw: string | null): Set<PanelId> {
  const out = new Set<PanelId>();
  for (const item of String(raw || "").split(",")) {
    if (item === "bulk-edit" || item === "recommendations" || item === "messages") {
      out.add(item);
    }
  }
  return out;
}

const FloatingWindowsContext = createContext<FloatingWindowsValue | null>(null);

export function FloatingWindowsProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() || "/sheets-tools";
  const searchParams = useSearchParams();
  const initialOpenParamRef = useRef(searchParams.get("open"));
  const zCounterRef = useRef(3);
  const hasMountedRef = useRef(false);

  const [toolbarBounds, setToolbarBoundsState] = useState(() => ({ x: 24, y: 24 }));
  const [toolbarMinimized, setToolbarMinimizedState] = useState(false);
  const [panels, setPanels] = useState<Record<PanelId, PanelState>>(() => ({
    "bulk-edit": { open: false, minimized: false, z: 1, ...DEFAULT_PANEL_BOUNDS["bulk-edit"] },
    recommendations: { open: false, minimized: false, z: 2, ...DEFAULT_PANEL_BOUNDS.recommendations },
    messages: { open: false, minimized: false, z: 3, ...DEFAULT_PANEL_BOUNDS.messages },
  }));

  useEffect(() => {
    const openFromUrl = parseOpenPanels(initialOpenParamRef.current);
    let stored: StoredLayout = {};
    try {
      stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as StoredLayout;
    } catch {}

    const nextToolbarMinimized = Boolean(stored.toolbarMinimized);
    const nextToolbar = clampToolbar(
      stored.toolbarBounds ?? { x: 24, y: 24 },
      nextToolbarMinimized
    );
    const nextPanels = (["bulk-edit", "recommendations", "messages"] as PanelId[]).reduce<
      Record<PanelId, PanelState>
    >((acc, id, idx) => {
      const merged = clampPanelForId(id, {
        ...DEFAULT_PANEL_BOUNDS[id],
        ...(stored.panels?.[id] ?? {}),
      });
      acc[id] = {
        open: openFromUrl.has(id),
        minimized: false,
        z: idx + 1,
        ...merged,
      };
      return acc;
    }, {} as Record<PanelId, PanelState>);

    zCounterRef.current = 3;
    setToolbarBoundsState(nextToolbar);
    setToolbarMinimizedState(nextToolbarMinimized);
    setPanels(nextPanels);
    hasMountedRef.current = true;
  }, []);

  useEffect(() => {
    if (!hasMountedRef.current) return;
    const onResize = () => {
      setToolbarBoundsState((prev) => clampToolbar(prev, toolbarMinimized));
      setPanels((prev) => {
        const next = { ...prev };
        for (const id of Object.keys(next) as PanelId[]) {
          next[id] = { ...next[id], ...clampPanelForId(id, next[id]) };
        }
        return next;
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [toolbarMinimized]);

  useEffect(() => {
    if (!hasMountedRef.current) return;
    const stored: StoredLayout = {
      toolbarBounds,
      toolbarMinimized,
      panels: {
        "bulk-edit": panels["bulk-edit"],
        recommendations: panels.recommendations,
        messages: panels.messages,
      },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  }, [panels, toolbarBounds, toolbarMinimized]);

  useEffect(() => {
    if (!hasMountedRef.current) return;
    const sp = new URLSearchParams(searchParams?.toString() || "");
    sp.delete("tab");
    const openIds = (Object.keys(panels) as PanelId[]).filter((id) => panels[id].open);
    if (openIds.length) sp.set("open", openIds.join(","));
    else sp.delete("open");
    const qs = sp.toString();
    if (qs !== (searchParams?.toString() || "")) {
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    }
  }, [panels, pathname, router, searchParams]);

  const focusPanel = useCallback((id: PanelId) => {
    setPanels((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        z: ++zCounterRef.current,
      },
    }));
  }, []);

  const openPanel = useCallback((id: PanelId) => {
    setPanels((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        open: true,
        minimized: false,
        z: ++zCounterRef.current,
      },
    }));
  }, []);

  const closePanel = useCallback((id: PanelId) => {
    setPanels((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        open: false,
        minimized: false,
      },
    }));
  }, []);

  const minimizePanel = useCallback((id: PanelId) => {
    setPanels((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        minimized: true,
        z: ++zCounterRef.current,
      },
    }));
  }, []);

  const setPanelBounds = useCallback(
    (id: PanelId, bounds: Partial<Pick<PanelState, "x" | "y" | "w" | "h">>) => {
      setPanels((prev) => {
        const nextBounds = clampPanelForId(id, { ...prev[id], ...bounds });
        return {
          ...prev,
          [id]: {
            ...prev[id],
            ...nextBounds,
          },
        };
      });
    },
    []
  );

  const setToolbarBounds = useCallback((bounds: { x: number; y: number }) => {
    setToolbarBoundsState(clampToolbar(bounds, toolbarMinimized));
  }, [toolbarMinimized]);

  const setToolbarMinimized = useCallback((minimized: boolean) => {
    setToolbarMinimizedState(minimized);
    setToolbarBoundsState((prev) => clampToolbar(prev, minimized));
  }, []);

  const value = useMemo<FloatingWindowsValue>(
    () => ({
      panels,
      openPanel,
      closePanel,
      minimizePanel,
      focusPanel,
      setPanelBounds,
      toolbarBounds,
      setToolbarBounds,
      toolbarMinimized,
      setToolbarMinimized,
    }),
    [
      closePanel,
      focusPanel,
      minimizePanel,
      openPanel,
      panels,
      setPanelBounds,
      setToolbarBounds,
      setToolbarMinimized,
      toolbarBounds,
      toolbarMinimized,
    ]
  );

  return createElement(FloatingWindowsContext.Provider, { value }, children);
}

export function useFloatingWindows() {
  const value = useContext(FloatingWindowsContext);
  if (!value) {
    throw new Error("useFloatingWindows must be used inside <FloatingWindowsProvider>");
  }
  return value;
}

"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useMessagesUI } from "./MessagesContext";

/** ---------------- Types ---------------- */

type AdminOpt = { id: string; name: string };

type Conversation = {
  caregiverId: string;
  caregiverName: string;
  caregiverRole?: string;
  lastTimestamp?: string;
  lastSnippet?: string;
  unreadCount?: number;
  totalMessages?: number;
  hasLogin?: boolean;
  lastLoginLocal?: string;
};

type ThreadMessage = {
  messageId: string;
  timestamp: string;
  category: string;
  status: string;
  text: string;
  sender: { id: string; name: string; role: string };
  recipient: { id: string; name: string; role: string };
  readReceipts: { id: string; name: string; time: string }[];
  side: "caregiver" | "staff";
};

type ThreadResponse = {
  caregiverId: string;
  caregiverName: string;
  messages: ThreadMessage[];
};

type IncomingAlert = {
  id: string;
  caregiverId: string;
  caregiverName: string;
  snippet: string;
  addedUnread: number;
};

type WeekKind = "cw" | "nw";

type ClientItem = {
  name: string;
  location: string;
  address: string;
  description: string;
  status: string;
};

/** ---------------- UI ---------------- */

const UI = {
  border: "#e5e7eb",
  borderSoft: "#f1f5f9",
  text: "#111827",
  textDim: "#6b7280",
  bg: "rgba(255,255,255,0.98)",
  bgSoft: "linear-gradient(180deg, rgba(255,255,255,0.99) 0%, rgba(248,250,252,0.98) 100%)",
  panel: "#f8fafc",
  shadow: "0 24px 70px rgba(15,23,42,0.18)",
  blue: "#2563eb",
  red: "#ef4444",
  green: "#10b981",
  purple: "#8b5cf6",
  grayBubble: "#e5e7eb",
  orange: "#f97316",
  yellow: "#f59e0b",
  bubbleMine: "#1d4ed8",
  bubbleTheirs: "#ffffff",
};

const AVAIL_API_PATH = "/api/availability"; // adjust if needed
const CAREGIVERS_API_PATH = "/api/caregivers";

/** ---------------- Helpers ---------------- */

function fmtDateTime(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function toShortTime(raw: string) {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (/[ap]m/i.test(s) && s.length <= 10) return s.replace(/\s+/g, "");
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    let hh = Number(m[1]);
    const mm = m[2];
    const ap = hh >= 12 ? "PM" : "AM";
    hh = hh % 12;
    if (hh === 0) hh = 12;
    return `${hh}:${mm}${ap}`;
  }
  return s.replace(/\s+/g, "");
}

function fullWeekday(dateStr: string) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, { weekday: "long" });
}

function parseDateKey(dateStr: string) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function minutesFromTime(raw: string) {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return 0;
  const ampm = s.includes("am") ? "am" : s.includes("pm") ? "pm" : null;
  const nums = s.match(/(\d{1,2})(?::(\d{2}))?/);
  if (!nums) return 0;
  let h = Number(nums[1] || 0);
  const m = Number(nums[2] || 0);
  if (ampm) {
    if (ampm === "pm" && h < 12) h += 12;
    if (ampm === "am" && h === 12) h = 0;
  }
  return h * 60 + m;
}

function shiftMinutes(startRaw: string, endRaw: string) {
  const s = minutesFromTime(startRaw);
  const e = minutesFromTime(endRaw);
  if (!startRaw || !endRaw) return 0;
  if (e === s) return 0;
  // overnight support
  return e > s ? e - s : e + 24 * 60 - s;
}

function normHeader(h: any) {
  return String(h ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function findHeaderIndex(headers: any[], target: string) {
  const t = normHeader(target);
  return headers.findIndex((h) => normHeader(h) === t);
}

function findAnyHeaderIndex(headers: any[], targets: string[]) {
  for (const t of targets) {
    const idx = findHeaderIndex(headers, t);
    if (idx >= 0) return idx;
  }
  return -1;
}

function catKey(cat: string) {
  const c = String(cat || "").toLowerCase();
  if (c.includes("pay")) return "payroll";
  if (c.includes("sched")) return "scheduling";
  return "general";
}

function isUnreadMsg(m: ThreadMessage, viewerId: string) {
  const mine = String(m.sender?.id || "") === String(viewerId || "");
  if (mine) return false;
  const s = String(m.status || "").toLowerCase();
  return s.includes("unread") || s === "new";
}

type WinState = { x: number; y: number; w: number; h: number };
const DEFAULT_WIN: WinState = { x: 24, y: 90, w: 520, h: 720 };
const WIN_STORAGE_KEY = "messages_window_v1";
const DOCKED_STORAGE_KEY = "messages_window_docked_v1";
const CLEAR_STORAGE_KEY = "messages_window_clear_v1";
const THREAD_CACHE_LIMIT = 24;

function receiptSummary(receipts: { id: string; name: string; time: string }[]) {
  const arr = Array.isArray(receipts) ? receipts : [];
  if (!arr.length) return "";
  const names = arr.map((r) => r.name || r.id).filter(Boolean);
  const head = names.slice(0, 2).join(", ");
  const more = names.length > 2 ? ` +${names.length - 2}` : "";
  return `Read by ${head}${more}`;
}

function Spinner({ size = 14 }: { size?: number }) {
  return (
    <span
      aria-label="Loading"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        border: "2px solid rgba(17,24,39,0.18)",
        borderTopColor: "rgba(17,24,39,0.70)",
        display: "inline-block",
        animation: "spin 0.8s linear infinite",
      }}
    />
  );
}

function Chip({
  label,
  color,
  bg,
  border,
  title,
}: {
  label: string;
  color: string;
  bg: string;
  border: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      style={{
        fontSize: 11,
        padding: "2px 8px",
        borderRadius: 999,
        border: `1px solid ${border}`,
        color,
        background: bg,
        fontWeight: 900,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

function PersonIcon({ color = UI.orange }: { color?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" style={{ display: "block" }}>
      <path
        fill={color}
        d="M12 12a4.5 4.5 0 1 0-4.5-4.5A4.51 4.51 0 0 0 12 12Zm0 2.25c-4.42 0-8 2.24-8 5v.75A2 2 0 0 0 6 22h12a2 2 0 0 0 2-2v-.75c0-2.76-3.58-5-8-5Z"
      />
    </svg>
  );
}

function InitialsAvatar({
  name,
  size = 40,
  active = false,
}: {
  name: string;
  size?: number;
  active?: boolean;
}) {
  const initials = String(name || "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "?";

  return (
    <div
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: active
          ? "linear-gradient(180deg, rgba(59,130,246,0.22) 0%, rgba(37,99,235,0.14) 100%)"
          : "linear-gradient(180deg, rgba(226,232,240,0.95) 0%, rgba(241,245,249,0.98) 100%)",
        border: `1px solid ${active ? "rgba(37,99,235,0.28)" : "rgba(148,163,184,0.18)"}`,
        color: active ? UI.blue : UI.textDim,
        display: "grid",
        placeItems: "center",
        fontSize: Math.max(12, Math.floor(size / 2.6)),
        fontWeight: 900,
        letterSpacing: 0.3,
        flex: "0 0 auto",
      }}
    >
      {initials}
    </div>
  );
}

function UnreadBadge({ count, size = 44 }: { count: number; size?: number }) {
  const label = count > 99 ? "99+" : String(Math.max(0, count));
  return (
    <div
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: "linear-gradient(180deg, #ef4444 0%, #dc2626 100%)",
        color: "#fff",
        display: "grid",
        placeItems: "center",
        fontSize: count > 99 ? 12 : 15,
        fontWeight: 900,
        letterSpacing: 0.2,
        boxShadow: "0 12px 24px rgba(220,38,38,0.20)",
        flex: "0 0 auto",
      }}
    >
      {label}
    </div>
  );
}

/** ---------------- Component ---------------- */

export default function MessagesPopup() {
  const { open, toggle, closePanel, openPanel, composeRequest, clearComposeRequest } = useMessagesUI();

  // data state
  const [admins, setAdmins] = useState<AdminOpt[]>([]);
  const [viewerId, setViewerId] = useState<string>("");
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [query, setQuery] = useState("");
  const [activeCaregiverId, setActiveCaregiverId] = useState<string>("");
  const [activeCaregiverName, setActiveCaregiverName] = useState<string>("");
  const [thread, setThread] = useState<ThreadMessage[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);

  // prevent flash on polling
  const [listReady, setListReady] = useState(false);
  const [threadReady, setThreadReady] = useState(false);

  // prevent overlap + stale responses
  const listReqId = useRef(0);
  const threadReqId = useRef(0);
  const listInFlight = useRef(false);
  const threadInFlight = useRef(false);
  const threadCacheRef = useRef<Map<string, ThreadResponse>>(new Map());
  const threadPrefetchingRef = useRef<Set<string>>(new Set());

  // composer
  const [category, setCategory] = useState<"General" | "Scheduling" | "Payroll">("General");
  const [text, setText] = useState("");
  const [sendStatus, setSendStatus] = useState<string>("");
  const [insertingWeek, setInsertingWeek] = useState<WeekKind | null>(null);

  const POLL_MS = 5000;
  const threadWrapRef = useRef<HTMLDivElement | null>(null);

  // floating window state
  const [win, setWin] = useState<WinState>(DEFAULT_WIN);
  const [docked, setDocked] = useState(false);
  const [clearMode, setClearMode] = useState(false);
  const [expandedReceipts, setExpandedReceipts] = useState<Record<string, boolean>>({});
  const [incomingAlerts, setIncomingAlerts] = useState<IncomingAlert[]>([]);
  const msgInputRef = useRef<HTMLTextAreaElement | null>(null);
  const unreadSnapshotRef = useRef<Record<string, number>>({});
  const unreadSnapshotReadyRef = useRef(false);

  const dragRef = useRef({
    active: false,
    startX: 0,
    startY: 0,
    startWin: DEFAULT_WIN as WinState,
  });

  const resizeRef = useRef({
    active: false,
    startX: 0,
    startY: 0,
    startWin: DEFAULT_WIN as WinState,
  });

  // ✅ edit modal state (sent messages)
  const [editOpen, setEditOpen] = useState(false);
  const [editMid, setEditMid] = useState<string>("");
  const [editText, setEditText] = useState<string>("");
  const [editCategory, setEditCategory] = useState<"General" | "Scheduling" | "Payroll">("General");
  const [editStatus, setEditStatus] = useState<string>("");

  // ✅ client picker state
  const [clientModalOpen, setClientModalOpen] = useState(false);
  const [clients, setClients] = useState<ClientItem[]>([]);
  const [clientLoading, setClientLoading] = useState(false);
  const [clientErr, setClientErr] = useState<string>("");
  const [clientSearch, setClientSearch] = useState("");
  const [clientSelectedIdx, setClientSelectedIdx] = useState<number>(-1);

  // ✅ Conversation enrichment: availability + hours + certification
  const [availSubmitted, setAvailSubmitted] = useState<{ cw: Set<string>; nw: Set<string> }>({
    cw: new Set(),
    nw: new Set(),
  });
  const [hoursByCaregiver, setHoursByCaregiver] = useState<{ cw: Record<string, number>; nw: Record<string, number> }>({
    cw: {},
    nw: {},
  });
  const [certByCaregiverId, setCertByCaregiverId] = useState<Record<string, string>>({});

  function clampToViewport(next: WinState): WinState {
    const pad = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const minW = Math.min(360, Math.max(320, vw - pad * 2));
    const minH = Math.min(420, Math.max(400, vh - pad * 2));

    const w = Math.max(minW, Math.min(next.w, vw - pad * 2));
    const h = Math.max(minH, Math.min(next.h, vh - pad * 2));

    const x = Math.max(pad, Math.min(next.x, vw - w - pad));
    const y = Math.max(pad, Math.min(next.y, vh - h - pad));

    return { x, y, w, h };
  }

  function goToInbox() {
    threadReqId.current += 1;
    threadInFlight.current = false;
    setActiveCaregiverId("");
    setActiveCaregiverName("");
    setThread([]);
    setThreadReady(false);
    setLoadingThread(false);
  }

  function syncComposerHeight() {
    const el = msgInputRef.current;
    if (!el) return;
    el.style.height = "0px";
    const next = Math.min(Math.max(el.scrollHeight, 48), 180);
    el.style.height = `${next}px`;
  }

  function reorderConversations(next: Conversation[], caregiverId: string) {
    const cid = String(caregiverId || "").trim();
    if (!cid) return next;
    const idx = next.findIndex((c) => String(c.caregiverId || "") === cid);
    if (idx <= 0) return next;
    const copy = next.slice();
    const [hit] = copy.splice(idx, 1);
    copy.unshift(hit);
    return copy;
  }

  function dismissIncomingAlert(id: string) {
    setIncomingAlerts((prev) => prev.filter((item) => item.id !== id));
  }

  function queueIncomingAlert(conv: Conversation, addedUnread: number) {
    const cid = String(conv.caregiverId || "").trim();
    if (!cid || addedUnread <= 0) return;
    const id = `${cid}-${Date.now()}`;
    const caregiverName = String(conv.caregiverName || cid);
    const snippet = String(conv.lastSnippet || "").trim() || "New message";

    setIncomingAlerts((prev) => {
      const next = prev.filter((item) => item.caregiverId !== cid);
      next.unshift({
        id,
        caregiverId: cid,
        caregiverName,
        snippet,
        addedUnread,
      });
      return next.slice(0, 4);
    });

    window.setTimeout(() => {
      setIncomingAlerts((prev) => prev.filter((item) => item.id !== id));
    }, 7000);
  }

  function syncUnreadSnapshot(next: Conversation[], opts?: { notify?: boolean }) {
    const map: Record<string, number> = {};
    const notify = opts?.notify !== false;

    for (const conv of next) {
      const cid = String(conv.caregiverId || "").trim();
      if (!cid) continue;

      const unread = Math.max(0, Number(conv.unreadCount || 0));
      map[cid] = unread;

      if (!notify || !unreadSnapshotReadyRef.current) continue;

      const prevUnread = Math.max(0, Number(unreadSnapshotRef.current[cid] || 0));
      const addedUnread = unread - prevUnread;
      const isActiveThread = open && String(activeCaregiverId || "") === cid;
      if (addedUnread > 0 && !isActiveThread) {
        queueIncomingAlert(conv, addedUnread);
      }
    }

    unreadSnapshotRef.current = map;
    unreadSnapshotReadyRef.current = true;
  }

  function storeThreadCache(caregiverId: string, value: ThreadResponse) {
    const key = String(caregiverId || "").trim();
    if (!key) return;
    const next = new Map(threadCacheRef.current);
    next.delete(key);
    next.set(key, value);
    while (next.size > THREAD_CACHE_LIMIT) {
      const oldest = next.keys().next().value;
      if (!oldest) break;
      next.delete(oldest);
    }
    threadCacheRef.current = next;
  }

  function primeThreadFromCache(caregiverId: string) {
    const cached = threadCacheRef.current.get(String(caregiverId || "").trim());
    if (!cached) return false;
    setThread(cached.messages || []);
    setActiveCaregiverId(cached.caregiverId || caregiverId);
    setActiveCaregiverName(cached.caregiverName || caregiverId);
    setThreadReady(true);
    setLoadingThread(false);
    return true;
  }

  async function prefetchThread(caregiverId: string) {
    const cid = String(caregiverId || "").trim();
    if (!cid) return;
    if (threadCacheRef.current.has(cid)) return;
    if (threadPrefetchingRef.current.has(cid)) return;

    threadPrefetchingRef.current.add(cid);
    try {
      const res: ThreadResponse = await apiGet({ action: "getThread", caregiverId: cid });
      if (!res) return;
      storeThreadCache(cid, {
        caregiverId: res.caregiverId || cid,
        caregiverName: res.caregiverName || cid,
        messages: Array.isArray(res.messages) ? res.messages : [],
      });
    } catch {
      // ignore
    } finally {
      threadPrefetchingRef.current.delete(cid);
    }
  }

  function openConversation(caregiverId: string, caregiverName?: string) {
    const cid = String(caregiverId || "").trim();
    if (!cid) return;
    setConvs((prev) => reorderConversations(prev, cid));
    setActiveCaregiverId(cid);
    setActiveCaregiverName(String(caregiverName || cid));
    setExpandedReceipts({});
    markThreadReadNow(cid);

    const hadCached = primeThreadFromCache(cid);
    if (!hadCached) {
      setThread([]);
      setThreadReady(false);
      setLoadingThread(true);
      loadThread(cid, { markRead: false });
      return;
    }

    loadThread(cid, { silent: true, markRead: false });
  }

  // load saved window state once
  useEffect(() => {
    try {
      const raw = localStorage.getItem(WIN_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const merged = { ...DEFAULT_WIN, ...parsed } as WinState;
        setWin(clampToViewport(merged));
      }
      setDocked(localStorage.getItem(DOCKED_STORAGE_KEY) === "1");
      setClearMode(localStorage.getItem(CLEAR_STORAGE_KEY) === "1");
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // persist window
  useEffect(() => {
    try {
      localStorage.setItem(WIN_STORAGE_KEY, JSON.stringify(win));
      localStorage.setItem(DOCKED_STORAGE_KEY, docked ? "1" : "0");
      localStorage.setItem(CLEAR_STORAGE_KEY, clearMode ? "1" : "0");
    } catch {}
  }, [clearMode, docked, win]);

  // keep on-screen when viewport resizes
  useEffect(() => {
    function onResize() {
      setWin((prev) => clampToViewport(prev));
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // tiny CSS for spinner animation
  useEffect(() => {
    const id = "messagespopup_spin_style";
    if (document.getElementById(id)) return;
    const style = document.createElement("style");
    style.id = id;
    style.textContent = `@keyframes spin { from { transform: rotate(0deg);} to { transform: rotate(360deg);} }`;
    document.head.appendChild(style);
  }, []);

  function onDragStart(e: React.MouseEvent) {
    if (docked) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, select, input, textarea, a")) return;

    dragRef.current.active = true;
    dragRef.current.startX = e.clientX;
    dragRef.current.startY = e.clientY;
    dragRef.current.startWin = win;
    e.preventDefault();
  }

  function onResizeStart(e: React.MouseEvent) {
    if (docked) return;
    resizeRef.current.active = true;
    resizeRef.current.startX = e.clientX;
    resizeRef.current.startY = e.clientY;
    resizeRef.current.startWin = win;
    e.preventDefault();
    e.stopPropagation();
  }

  // global mouse move/up
  useEffect(() => {
    function onMove(ev: MouseEvent) {
      if (dragRef.current.active) {
        const R = dragRef.current;
        const dx = ev.clientX - R.startX;
        const dy = ev.clientY - R.startY;
        const next: WinState = { ...R.startWin, x: R.startWin.x + dx, y: R.startWin.y + dy };
        setWin(clampToViewport(next));
        return;
      }

      if (resizeRef.current.active) {
        const R = resizeRef.current;
        const dx = ev.clientX - R.startX;
        const dy = ev.clientY - R.startY;
        const next: WinState = { ...R.startWin, w: R.startWin.w + dx, h: R.startWin.h + dy };
        setWin(clampToViewport(next));
      }
    }

    function onUp() {
      dragRef.current.active = false;
      resizeRef.current.active = false;
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win]);

  /** ---------------- API helpers ---------------- */

  async function apiGet(params: Record<string, string>) {
    const sp = new URLSearchParams(params);
    const r = await fetch(`/api/messages?${sp.toString()}`, { cache: "no-store" });
    return r.json();
  }

  async function apiPost(body: any) {
    const r = await fetch(`/api/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    return r.json();
  }

  async function apiGetSchedule(week: WeekKind) {
    const r = await fetch(`/api/schedule?week=${week}`, { cache: "no-store" });
    return r.json();
  }

  async function apiGetClients() {
    const r = await fetch(`/api/clients`, { cache: "no-store" });
    return r.json();
  }

  async function apiGetAvailability(week: WeekKind) {
    const r = await fetch(`${AVAIL_API_PATH}?week=${week}`, { cache: "no-store" });
    return r.json();
  }

  async function apiGetCaregivers() {
    const r = await fetch(CAREGIVERS_API_PATH, { cache: "no-store" });
    return r.json();
  }

  /** ---------------- Data loading ---------------- */

  // load admins + default viewer
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await apiGet({ action: "listAdminOptions" });
        if (!mounted) return;

        const opts: AdminOpt[] = res?.admins || [];
        setAdmins(opts);

        const saved = typeof window !== "undefined" ? localStorage.getItem("messages_viewer_id") : "";
        const def = saved || res?.defaultViewerId || opts?.[0]?.id || "";
        setViewerId(def);
      } catch {
        // ignore
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  async function loadConversations(vId: string, opts?: { silent?: boolean }) {
    if (!vId) return;
    if (listInFlight.current) return;

    const silent = !!opts?.silent;

    listInFlight.current = true;
    const req = ++listReqId.current;

    if (!silent && !listReady) setLoadingList(true);

    try {
      const res = await apiGet({ action: "getConversations", viewerId: vId });
      if (req !== listReqId.current) return;

      const next = (res?.conversations || []) as Conversation[];
      setConvs(next);
      syncUnreadSnapshot(next, { notify: !!opts?.silent });
      setListReady(true);
    } finally {
      listInFlight.current = false;
      if (!silent && !listReady) setLoadingList(false);
    }
  }

  async function loadThread(caregiverId: string, opts?: { silent?: boolean; markRead?: boolean }) {
    if (!caregiverId) return;

    const silent = !!opts?.silent;

    threadInFlight.current = true;
    const req = ++threadReqId.current;

    if (!silent) setLoadingThread(true);

    try {
      const res: ThreadResponse = await apiGet({ action: "getThread", caregiverId });
      if (req !== threadReqId.current) return;

      const normalized: ThreadResponse = {
        caregiverId: res?.caregiverId || caregiverId,
        caregiverName: res?.caregiverName || caregiverId,
        messages: Array.isArray(res?.messages) ? res.messages : [],
      };

      storeThreadCache(caregiverId, normalized);

      setThread(normalized.messages);
      setActiveCaregiverId((prev) => prev || normalized.caregiverId || caregiverId);
      setActiveCaregiverName((prev) => prev || normalized.caregiverName || caregiverId);
      setThreadReady(true);
    } finally {
      if (req === threadReqId.current) {
        threadInFlight.current = false;
        setLoadingThread(false);
      }
    }
  }

  function markThreadReadNow(caregiverId: string) {
    const cid = String(caregiverId || "").trim();
    if (!cid || !viewerId) return;

    setConvs((prev) =>
      reorderConversations(
        prev.map((c) =>
          String(c.caregiverId || "") === cid
            ? {
                ...c,
                unreadCount: 0,
              }
            : c
        ),
        cid
      )
    );

    apiPost({ action: "markThreadRead", viewerId, caregiverId: cid }).catch(() => {});
    loadConversations(viewerId, { silent: true });
  }

  /** ---------------- Enrichment ---------------- */

  function computeAvailabilitySubmitted(values: any[][]): Set<string> {
    const out = new Set<string>();
    if (!Array.isArray(values) || values.length < 2) return out;

    const headers = values[0] ?? [];
    const iCaregiverId = findAnyHeaderIndex(headers, ["Caregiver ID", "Caregiver Id", "CaregiverID"]);
    if (iCaregiverId < 0) return out;

    const dayCols = [
      findAnyHeaderIndex(headers, ["Sunday", "Sun"]),
      findAnyHeaderIndex(headers, ["Monday", "Mon"]),
      findAnyHeaderIndex(headers, ["Tuesday", "Tue"]),
      findAnyHeaderIndex(headers, ["Wednesday", "Wed"]),
      findAnyHeaderIndex(headers, ["Thursday", "Thu"]),
      findAnyHeaderIndex(headers, ["Friday", "Fri"]),
      findAnyHeaderIndex(headers, ["Saturday", "Sat"]),
    ].filter((x) => x >= 0);

    const iNotes = findAnyHeaderIndex(headers, ["Notes", "Note"]);
    const iDesired = findAnyHeaderIndex(headers, ["Desired Hours", "Desired", "Hours"]);

    for (let r = 1; r < values.length; r++) {
      const row = values[r] ?? [];
      const cid = String(row[iCaregiverId] ?? "").trim();
      if (!cid) continue;

      const hasAny =
        dayCols.some((i) => String(row[i] ?? "").trim()) ||
        (iNotes >= 0 && String(row[iNotes] ?? "").trim()) ||
        (iDesired >= 0 && String(row[iDesired] ?? "").trim());

      if (hasAny) out.add(cid);
    }

    return out;
  }

  function computeHoursByCaregiver(scheduleValues: any[][]): Record<string, number> {
    const out: Record<string, number> = {};
    if (!Array.isArray(scheduleValues) || scheduleValues.length < 2) return out;

    const headers = scheduleValues[0] ?? [];
    const idxCaregiverId = findHeaderIndex(headers, "Caregiver ID");
    const idxStart = findHeaderIndex(headers, "Start Time");
    const idxEnd = findHeaderIndex(headers, "End Time");
    const idxStatus = findHeaderIndex(headers, "Status");

    if (idxCaregiverId < 0 || idxStart < 0 || idxEnd < 0) return out;

    for (let i = 1; i < scheduleValues.length; i++) {
      const row = scheduleValues[i] ?? [];
      const cid = String(row[idxCaregiverId] ?? "").trim();
      if (!cid) continue;

      const status = idxStatus >= 0 ? String(row[idxStatus] ?? "").trim().toLowerCase() : "";
      if (status.includes("cancel")) continue;
      if (status === "open") continue;

      const startTime = String(row[idxStart] ?? "").trim();
      const endTime = String(row[idxEnd] ?? "").trim();
      if (!startTime || !endTime) continue;

      const mins = shiftMinutes(startTime, endTime);
      if (!mins) continue;

      out[cid] = (out[cid] || 0) + mins / 60;
    }

    Object.keys(out).forEach((k) => {
      out[k] = Math.round(out[k] * 100) / 100;
    });

    return out;
  }

  async function refreshConversationEnrichment() {
    try {
      const [cwAvailRes, nwAvailRes] = await Promise.allSettled([apiGetAvailability("cw"), apiGetAvailability("nw")]);
      const cwValues = cwAvailRes.status === "fulfilled" ? (cwAvailRes.value?.values ?? []) : [];
      const nwValues = nwAvailRes.status === "fulfilled" ? (nwAvailRes.value?.values ?? []) : [];

      setAvailSubmitted({
        cw: computeAvailabilitySubmitted(cwValues),
        nw: computeAvailabilitySubmitted(nwValues),
      });
    } catch {
      // ignore
    }

    try {
      const [cwSched, nwSched] = await Promise.allSettled([apiGetSchedule("cw"), apiGetSchedule("nw")]);
      const cwValues =
        cwSched.status === "fulfilled" ? (Array.isArray(cwSched.value?.values) ? cwSched.value.values : []) : [];
      const nwValues =
        nwSched.status === "fulfilled" ? (Array.isArray(nwSched.value?.values) ? nwSched.value.values : []) : [];

      setHoursByCaregiver({
        cw: computeHoursByCaregiver(cwValues),
        nw: computeHoursByCaregiver(nwValues),
      });
    } catch {
      // ignore
    }

    try {
      const res = await apiGetCaregivers();

      // Support either {headers,rows} or {values} or {data:{values}}
      let headers: any[] = [];
      let rows: any[][] = [];
      if (Array.isArray(res?.headers) && Array.isArray(res?.rows)) {
        headers = res.headers;
        rows = res.rows;
      } else if (Array.isArray(res?.values)) {
        headers = res.values[0] ?? [];
        rows = res.values.slice(1) ?? [];
      } else if (Array.isArray(res?.data?.values)) {
        headers = res.data.values[0] ?? [];
        rows = res.data.values.slice(1) ?? [];
      }

      if (!headers.length) return;

      const iId = findAnyHeaderIndex(headers, ["Caregiver ID", "Caregiver Id", "ID"]);
      const iCert = findAnyHeaderIndex(headers, ["Certification", "Certifications", "Cert"]);
      if (iId < 0 || iCert < 0) return;

      const map: Record<string, string> = {};
      for (const r of rows) {
        const cid = String(r[iId] ?? "").trim();
        if (!cid) continue;
        const cert = String(r[iCert] ?? "").trim();
        if (!cert) continue;
        if (cert.toLowerCase() === "none") continue;
        map[cid] = cert;
      }
      setCertByCaregiverId(map);
    } catch {
      // ignore
    }
  }

  // when open: refresh enrichment (don’t block UI)
  useEffect(() => {
    if (!open) return;
    refreshConversationEnrichment();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, viewerId]);

  // viewer change: reload list and reset thread
  useEffect(() => {
    if (!viewerId) return;
    try {
      localStorage.setItem("messages_viewer_id", viewerId);
    } catch {}

    threadCacheRef.current = new Map();
    threadPrefetchingRef.current = new Set();
    unreadSnapshotRef.current = {};
    unreadSnapshotReadyRef.current = false;
    setIncomingAlerts([]);
    setListReady(false);
    setThreadReady(false);
    goToInbox();
    loadConversations(viewerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerId]);

  // polling (light)
  useEffect(() => {
    if (!viewerId) return;

    const t = setInterval(() => {
      if (document.hidden) return;
      loadConversations(viewerId, { silent: true });
      if (open && activeCaregiverId) loadThread(activeCaregiverId, { silent: true, markRead: false });
    }, POLL_MS);

    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerId, open, activeCaregiverId]);

  /** ---------------- NEW: handle composeRequest from MessagesContext ----------------
   * Opens thread, sets category, pre-fills text, focuses composer.
   */
  useEffect(() => {
    if (!composeRequest) return;

    const req = composeRequest;
    const cid = String(req.caregiverId || "").trim();
    if (!cid) {
      clearComposeRequest();
      return;
    }

    // choose category
    const nextCat: any =
      req.category === "Payroll" ? "Payroll" : req.category === "General" ? "General" : "Scheduling";
    setCategory(nextCat);

    // prefill text
    const incoming = String(req.text || "");
    if (incoming) {
      setText((prev) => {
        const base = String(prev || "");
        const replace = !!req.replaceText;
        if (replace) return incoming;
        if (!base.trim()) return incoming;
        return `${base}\n\n${incoming}`;
      });
    }

    // open + load thread
    openPanel();
    openConversation(cid, req.caregiverName);

    // focus composer after open + thread load starts
    if (req.focusComposer !== false) {
      window.setTimeout(() => {
        const ta = document.getElementById("msgInput") as HTMLTextAreaElement | null;
        if (ta) {
          ta.focus();
          const end = ta.value.length;
          ta.selectionStart = end;
          ta.selectionEnd = end;
        }
      }, 120);
    }

    clearComposeRequest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composeRequest]);

  /** ---------------- Derived UI ---------------- */

  const filteredConvs = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return convs;
    return convs.filter(
      (c) => (c.caregiverName || "").toLowerCase().includes(q) || (c.caregiverId || "").toLowerCase().includes(q)
    );
  }, [convs, query]);

  const totalUnread = useMemo(
    () => convs.reduce((sum, conv) => sum + Math.max(0, Number(conv.unreadCount || 0)), 0),
    [convs]
  );

  useEffect(() => {
    if (!open) return;
    const hottest = filteredConvs.slice(0, 4);
    if (!hottest.length) return;

    const t = window.setTimeout(() => {
      hottest.forEach((c, idx) => {
        window.setTimeout(() => prefetchThread(c.caregiverId), idx * 180);
      });
    }, 250);

    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, filteredConvs]);

  /** ---------------- Actions ---------------- */

  async function doSend() {
    if (!viewerId) return;
    if (!activeCaregiverId) return;
    const msg = text.trim();
    if (!msg) return;

    setSendStatus("Sending…");
    try {
      const res = await apiPost({
        action: "sendMessage",
        viewerId,
        caregiverId: activeCaregiverId,
        category,
        text: msg,
      });

      if (res?.ok === false) throw new Error(res?.error || "Send failed");

      setText("");
      setSendStatus("Sent");
      await loadThread(activeCaregiverId);
      await loadConversations(viewerId);
      setTimeout(() => setSendStatus(""), 800);
    } catch {
      setSendStatus("Failed");
      setTimeout(() => setSendStatus(""), 1200);
    }
  }

  async function doUpdateMessage() {
    if (!viewerId) return;
    if (!editMid) return;

    const msg = editText.trim();
    if (!msg) return;

    setEditStatus("Saving…");
    try {
      const res = await apiPost({
        action: "updateMessage",
        messageId: editMid,
        editorId: viewerId,
        newText: msg,
        newCategory: editCategory,
      });

      if (!res?.ok) {
        setEditStatus(res?.error || res?.reason || "Failed");
        setTimeout(() => setEditStatus(""), 1400);
        return;
      }

      setEditStatus("Saved");
      setTimeout(() => setEditStatus(""), 800);
      setEditOpen(false);

      if (activeCaregiverId) {
        await loadThread(activeCaregiverId, { silent: true });
        await loadConversations(viewerId, { silent: true });
      }
    } catch {
      setEditStatus("Failed");
      setTimeout(() => setEditStatus(""), 1400);
    }
  }

  function openEditForMessage(m: ThreadMessage) {
    const isMine = String(m.sender?.id || "") === String(viewerId || "");
    if (!isMine) return;

    const k = catKey(m.category);
    const nextCat: any = k === "payroll" ? "Payroll" : k === "scheduling" ? "Scheduling" : "General";

    setEditMid(m.messageId);
    setEditText(m.text || "");
    setEditCategory(nextCat);
    setEditStatus("");
    setEditOpen(true);

    requestAnimationFrame(() => {
      const ta = document.getElementById("editMsgText") as HTMLTextAreaElement | null;
      ta?.focus();
    });
  }

  function weekToMessage(
    shifts: Array<{ date: string; startTime: string; endTime: string; client: string }>,
    which: WeekKind
  ) {
    const header =
      which === "nw" ? "Hi -  here is your schedule for the upcoming week:" : "Hi -  here is your schedule for this week:";
    const footer = "Please let me know if this works for you. Thank you!";

    if (!shifts.length) return `${header}\n\n(no shifts)\n\n${footer}`;

    const lines = shifts.map((s) => {
      const day = fullWeekday(s.date);
      const start = toShortTime(s.startTime);
      const end = toShortTime(s.endTime);
      const client = s.client ? ` w/ ${s.client}` : "";
      return `${day} ${start}-${end}${client}`;
    });

    return `${header}\n\n${lines.join("\n")}\n\n${footer}`;
  }

  async function fetchCaregiverWeekShifts(which: WeekKind, caregiverId: string) {
    const data = await apiGetSchedule(which);
    const values: any[][] = Array.isArray(data?.values) ? data.values : [];
    if (values.length < 2) return [];

    const headers = values[0] ?? [];

    const idxCaregiverId = findHeaderIndex(headers, "Caregiver ID");
    const idxDate = findHeaderIndex(headers, "Date");
    const idxStart = findHeaderIndex(headers, "Start Time");
    const idxEnd = findHeaderIndex(headers, "End Time");
    const idxClient = findHeaderIndex(headers, "Client");
    const idxStatus = findHeaderIndex(headers, "Status");

    if (idxCaregiverId < 0 || idxDate < 0 || idxStart < 0 || idxEnd < 0) return [];

    const out: Array<{ date: string; startTime: string; endTime: string; client: string }> = [];

    for (let i = 1; i < values.length; i++) {
      const row = values[i] ?? [];
      const cid = String(row[idxCaregiverId] ?? "").trim();
      if (!cid) continue;
      if (String(cid) !== String(caregiverId)) continue;

      const date = String(row[idxDate] ?? "").trim();
      const startTime = String(row[idxStart] ?? "").trim();
      const endTime = String(row[idxEnd] ?? "").trim();
      const client = idxClient >= 0 ? String(row[idxClient] ?? "").trim() : "";

      const status = idxStatus >= 0 ? String(row[idxStatus] ?? "").trim().toLowerCase() : "";
      if (status.includes("cancel")) continue;
      if (status === "open") continue;

      if (!date || !startTime || !endTime) continue;

      out.push({ date, startTime, endTime, client });
    }

    out.sort((a, b) => {
      const dk = parseDateKey(a.date).localeCompare(parseDateKey(b.date));
      if (dk !== 0) return dk;
      return minutesFromTime(a.startTime) - minutesFromTime(b.startTime);
    });

    return out;
  }

  async function insertWeekIntoMessage(which: WeekKind) {
    if (!activeCaregiverId) return;
    if (insertingWeek) return;

    setInsertingWeek(which);
    try {
      const shifts = await fetchCaregiverWeekShifts(which, activeCaregiverId);
      const block = weekToMessage(shifts, which);

      setText((prev) => {
        const existing = (prev || "").trim();
        return existing ? `${existing}\n\n${block}` : block;
      });

      requestAnimationFrame(() => {
        const ta = document.getElementById("msgInput") as HTMLTextAreaElement | null;
        if (ta) {
          ta.focus();
          ta.selectionStart = ta.selectionEnd = ta.value.length;
        }
      });
    } catch {
      // ignore
    } finally {
      setInsertingWeek(null);
    }
  }

  function scrollThreadToFirstUnreadOrBottom() {
    const wrap = threadWrapRef.current;
    if (!wrap) return;
    const el = wrap.querySelector("[data-unread='1']") as HTMLElement | null;
    if (el) {
      el.scrollIntoView({ block: "center" });
      return;
    }
    wrap.scrollTop = wrap.scrollHeight;
  }

  useEffect(() => {
    if (!open) return;
    if (!activeCaregiverId) return;
    const t = window.setTimeout(() => scrollThreadToFirstUnreadOrBottom(), 60);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeCaregiverId, thread.length]);

  useEffect(() => {
    syncComposerHeight();
  }, [text]);

  /** ---------------- Client picker ---------------- */

  const filteredClients = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) => {
      return (
        (c.name || "").toLowerCase().includes(q) ||
        (c.location || "").toLowerCase().includes(q) ||
        (c.address || "").toLowerCase().includes(q)
      );
    });
  }, [clients, clientSearch]);

  async function openClientPicker() {
    setClientModalOpen(true);
    setClientErr("");
    setClientSearch("");
    setClientSelectedIdx(-1);

    if (clients.length) {
      requestAnimationFrame(() => {
        const inp = document.getElementById("clientSearch") as HTMLInputElement | null;
        inp?.focus();
      });
      return;
    }

    setClientLoading(true);
    try {
      const res = await apiGetClients();

      let headers: any[] = [];
      let rows: any[][] = [];

      if (Array.isArray(res?.headers) && Array.isArray(res?.rows)) {
        headers = res.headers;
        rows = res.rows;
      } else if (Array.isArray(res?.values)) {
        headers = res.values[0] ?? [];
        rows = res.values.slice(1) ?? [];
      } else if (Array.isArray(res?.data?.values)) {
        headers = res.data.values[0] ?? [];
        rows = res.data.values.slice(1) ?? [];
      }

      if (!headers.length) {
        setClients([]);
        setClientErr("No clients found (missing headers).");
        return;
      }

      const iName = findAnyHeaderIndex(headers, ["Name", "Client", "Client Name"]);
      const iLoc = findAnyHeaderIndex(headers, ["Location", "Area", "Region"]);
      const iAddr = findAnyHeaderIndex(headers, ["Address", "Client Address"]);
      const iDesc = findAnyHeaderIndex(headers, ["Description", "Notes", "Client Notes"]);
      const iStat = findAnyHeaderIndex(headers, ["Status"]);

      const out: ClientItem[] = rows
        .map((r) => {
          const name = String(iName >= 0 ? r[iName] : "").trim();
          const location = String(iLoc >= 0 ? r[iLoc] : "").trim();
          const address = String(iAddr >= 0 ? r[iAddr] : "").trim();
          const description = String(iDesc >= 0 ? r[iDesc] : "").trim();
          const status = String(iStat >= 0 ? r[iStat] : "").trim();
          return { name, location, address, description, status };
        })
        .filter((c) => c.name)
        .sort((a, b) => a.name.localeCompare(b.name) || a.location.localeCompare(b.location));

      setClients(out);
      if (!out.length) setClientErr("No clients found.");
    } catch (e: any) {
      setClientErr(String(e?.message || e || "Failed to load clients"));
    } finally {
      setClientLoading(false);
      requestAnimationFrame(() => {
        const inp = document.getElementById("clientSearch") as HTMLInputElement | null;
        inp?.focus();
      });
    }
  }

  function closeClientPicker() {
    setClientModalOpen(false);
  }

  function insertClientProfile() {
    if (clientSelectedIdx < 0) return;
    const c = filteredClients[clientSelectedIdx];
    if (!c) return;

    const locLine = c.address ? c.address : c.location;
    const lines = [`📋 Client Profile: ${c.name || ""}`, `Location: ${locLine || ""}`, `Description: ${c.description || ""}`];
    const snippet = lines.join("\n");

    setText((prev) => {
      const existing = (prev || "").trim();
      return existing ? `${existing}\n\n${snippet}` : snippet;
    });

    closeClientPicker();

    requestAnimationFrame(() => {
      const ta = document.getElementById("msgInput") as HTMLTextAreaElement | null;
      if (ta) {
        ta.focus();
        ta.selectionStart = ta.selectionEnd = ta.value.length;
      }
    });
  }

  /** ---------------- Render ---------------- */

  const viewportWidth = typeof window === "undefined" ? 1440 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 900 : window.innerHeight;
  const panelWidth = docked ? Math.min(430, Math.max(320, viewportWidth - 24)) : win.w;
  const panelHeight = docked
    ? Math.min(activeCaregiverId ? 720 : 640, Math.max(420, viewportHeight - 24))
    : win.h;

  const shellStyle: React.CSSProperties = docked
    ? {
        position: "fixed",
        right: 12,
        bottom: 12,
        width: panelWidth,
        height: panelHeight,
      }
    : {
        position: "fixed",
        left: win.x,
        top: win.y,
        width: win.w,
        height: win.h,
      };

  const shellBackground = clearMode ? "rgba(255,255,255,0.58)" : UI.bgSoft;
  const chromeBackground = clearMode ? "rgba(255,255,255,0.46)" : "rgba(255,255,255,0.78)";
  const subChromeBackground = clearMode ? "rgba(248,250,252,0.36)" : "rgba(248,250,252,0.7)";
  const bodyBackground = clearMode
    ? "linear-gradient(180deg, rgba(248,250,252,0.34) 0%, rgba(255,255,255,0.30) 100%)"
    : "linear-gradient(180deg, rgba(248,250,252,0.85) 0%, rgba(255,255,255,0.92) 100%)";
  const inboxBackground = clearMode ? "rgba(248,250,252,0.24)" : "rgba(248,250,252,0.48)";
  const composerBackground = clearMode ? "rgba(255,255,255,0.42)" : "rgba(255,255,255,0.88)";

  return (
    <>
      {incomingAlerts.length ? (
        <div
          style={{
            position: "fixed",
            right: 16,
            bottom: 76,
            zIndex: 10000,
            display: "grid",
            gap: 8,
            width: "min(360px, calc(100vw - 32px))",
            pointerEvents: "none",
          }}
        >
          {incomingAlerts.map((alert) => (
            <div
              key={alert.id}
              style={{
                pointerEvents: "auto",
                border: `1px solid rgba(239,68,68,0.16)`,
                background: "rgba(255,255,255,0.97)",
                borderRadius: 18,
                boxShadow: "0 18px 40px rgba(15,23,42,0.16)",
                padding: "10px 12px",
                display: "grid",
                gap: 8,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 900, color: UI.red }}>New message</div>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 900,
                      color: UI.text,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {alert.caregiverName}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => dismissIncomingAlert(alert.id)}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: UI.textDim,
                    cursor: "pointer",
                    fontSize: 14,
                    lineHeight: 1,
                    padding: 0,
                  }}
                  title="Dismiss"
                >
                  ✕
                </button>
              </div>

              <div
                style={{
                  fontSize: 12,
                  color: UI.textDim,
                  lineHeight: 1.45,
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {alert.snippet}
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                <div style={{ fontSize: 11, fontWeight: 900, color: UI.red }}>
                  {alert.addedUnread} new
                </div>
                <button
                  type="button"
                  onClick={() => {
                    openPanel();
                    openConversation(alert.caregiverId, alert.caregiverName);
                    dismissIncomingAlert(alert.id);
                  }}
                  style={{
                    border: `1px solid ${UI.border}`,
                    background: "#fff",
                    borderRadius: 999,
                    padding: "5px 10px",
                    cursor: "pointer",
                    fontWeight: 900,
                    color: UI.text,
                    fontSize: 11,
                  }}
                >
                  Open
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* Floating Messages button */}
      <button
        onClick={toggle}
        style={{
          position: "fixed",
          right: 16,
          bottom: 16,
          zIndex: 9999,
          border: `1px solid ${UI.border}`,
          background: UI.bgSoft,
          borderRadius: 999,
          padding: "11px 14px",
          boxShadow: UI.shadow,
          cursor: "pointer",
          color: UI.text,
          fontWeight: 800,
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
        }}
        title="Messages"
      >
        💬 Messages
        {totalUnread > 0 ? (
          <span
            style={{
              minWidth: 20,
              height: 20,
              borderRadius: 999,
              background: UI.red,
              color: "#fff",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 11,
              fontWeight: 900,
              padding: "0 6px",
            }}
          >
            {totalUnread}
          </span>
        ) : null}
      </button>

      {/* Draggable + resizable floating window */}
      <div
        style={{
          ...shellStyle,
          zIndex: 9998,
          background: shellBackground,
          border: `1px solid ${UI.border}`,
          borderRadius: docked ? 22 : 24,
          boxShadow: UI.shadow,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          opacity: open ? 1 : 0,
          transform: open ? "scale(1)" : "scale(0.985)",
          transition: "opacity 120ms ease, transform 120ms ease",
          pointerEvents: open ? "auto" : "none",
        }}
      >
        {/* Header (drag handle) */}
        <div
          onMouseDown={onDragStart}
          style={{
            padding: "10px 12px 8px",
            borderBottom: `1px solid ${UI.border}`,
            display: "flex",
            alignItems: "center",
            gap: 10,
            userSelect: "none",
            background: chromeBackground,
            backdropFilter: "blur(12px)",
            cursor: docked ? "default" : "move",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0, flex: 1 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 900, color: UI.text, whiteSpace: "nowrap", lineHeight: 1.1 }}>Messages</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, minWidth: 0 }}>
                <div style={{ fontSize: 11, color: UI.textDim, fontWeight: 800, whiteSpace: "nowrap" }}>Viewing as</div>
                <select
                  value={viewerId}
                  onChange={(e) => setViewerId(e.target.value)}
                  style={{
                    flex: "0 1 170px",
                    maxWidth: docked ? 132 : 170,
                    width: docked ? 132 : undefined,
                    border: `1px solid ${UI.border}`,
                    borderRadius: 999,
                    padding: "4px 24px 4px 8px",
                    background: "#fff",
                    color: UI.text,
                    minHeight: 28,
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  {admins.length ? (
                    admins.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))
                  ) : (
                    <option value="">(no admins loaded)</option>
                  )}
                </select>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 6, alignItems: "center", flex: "0 0 auto" }}>
            <button
              onClick={() => setClearMode((prev) => !prev)}
              style={{
                border: `1px solid ${UI.border}`,
                background: "#fff",
                borderRadius: 999,
                padding: "5px 8px",
                cursor: "pointer",
                fontWeight: 900,
                color: clearMode ? UI.blue : UI.text,
                fontSize: 11,
                minHeight: 28,
              }}
              title={clearMode ? "Disable clear mode" : "Enable clear mode"}
            >
              Clear
            </button>

            <button
              onClick={() => setDocked((prev) => !prev)}
              style={{
                border: `1px solid ${UI.border}`,
                background: "#fff",
                borderRadius: 999,
                padding: "5px 8px",
                cursor: "pointer",
                fontWeight: 900,
                color: docked ? UI.blue : UI.text,
                fontSize: 11,
                minHeight: 28,
              }}
              title={docked ? "Undock window" : "Pin to corner"}
            >
              {docked ? "Pinned" : "Pin"}
            </button>

            <button
              onClick={() => {
                openPanel();
                if (viewerId) loadConversations(viewerId);
                if (activeCaregiverId) loadThread(activeCaregiverId);
                refreshConversationEnrichment();
              }}
              style={{
                border: `1px solid ${UI.border}`,
                background: "#fff",
                borderRadius: 999,
                padding: "5px 8px",
                cursor: "pointer",
                color: UI.text,
                fontSize: 11,
                minHeight: 28,
              }}
              title="Refresh"
            >
              ⟳
            </button>

            <button
              onClick={closePanel}
              style={{
                border: `1px solid ${UI.border}`,
                background: "#fff",
                borderRadius: 999,
                padding: "5px 8px",
                cursor: "pointer",
                fontWeight: 900,
                color: UI.text,
                fontSize: 11,
                minHeight: 28,
              }}
              title="Close"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Controls */}
        <div style={{ padding: activeCaregiverId ? "6px 12px" : "8px 12px", borderBottom: `1px solid ${UI.borderSoft}`, background: subChromeBackground }}>
          {!activeCaregiverId ? (
            <div>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search caregiver…"
                style={{
                  width: "100%",
                  border: `1px solid ${UI.border}`,
                  borderRadius: 999,
                  padding: "9px 12px",
                  background: "#fff",
                  color: UI.text,
                }}
              />
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                minWidth: 0,
              }}
            >
              <button
                onClick={goToInbox}
                style={{
                  border: `1px solid ${UI.border}`,
                  background: "#fff",
                  borderRadius: 999,
                  padding: "5px 10px",
                  cursor: "pointer",
                  fontWeight: 800,
                  color: UI.text,
                  flex: "0 0 auto",
                }}
                title="Back to conversations"
              >
                ← Back
              </button>

              <div
                style={{
                  fontSize: 19,
                  lineHeight: 1.1,
                  fontWeight: 900,
                  color: UI.text,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {activeCaregiverName || activeCaregiverId}
              </div>
            </div>
          )}
        </div>

        {/* Body */}
        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          {/* Inbox */}
          {!activeCaregiverId ? (
            <div style={{ flex: 1, overflow: "auto", padding: 10, background: inboxBackground }}>
              {loadingList && !listReady ? (
                <div style={{ color: UI.textDim, fontSize: 13 }}>Loading…</div>
              ) : filteredConvs.length ? (
                <div style={{ display: "grid", gap: 8 }}>
                  {filteredConvs.map((c) => {
                    const unread = Number(c.unreadCount || 0);
                    const cid = String(c.caregiverId || "");
                    const selected = cid === activeCaregiverId;

                    const cwAvail = availSubmitted.cw.has(cid);
                    const nwAvail = availSubmitted.nw.has(cid);

                    const cwHours = hoursByCaregiver.cw[cid] || 0;
                    const nwHours = hoursByCaregiver.nw[cid] || 0;

                    const cert = certByCaregiverId[cid] || "";

                    return (
                      <button
                        key={c.caregiverId}
                        onClick={() => openConversation(c.caregiverId, c.caregiverName)}
                        style={{
                          textAlign: "left",
                          border: `1px solid ${selected ? "rgba(37,99,235,0.24)" : "rgba(226,232,240,0.95)"}`,
                          background: unread > 0 ? "linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)" : "rgba(255,255,255,0.92)",
                          borderRadius: 22,
                          padding: "11px 12px",
                          cursor: "pointer",
                          color: UI.text,
                          boxShadow: unread > 0 ? "0 14px 28px rgba(37,99,235,0.10)" : "0 6px 16px rgba(15,23,42,0.04)",
                        }}
                        onMouseEnter={() => prefetchThread(c.caregiverId)}
                        onFocus={() => prefetchThread(c.caregiverId)}
                      >
                        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                          {unread > 0 ? (
                            <UnreadBadge count={unread} size={44} />
                          ) : (
                            <InitialsAvatar name={c.caregiverName || c.caregiverId} size={44} active={false} />
                          )}

                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                              <div
                                style={{
                                  fontWeight: unread > 0 ? 900 : 800,
                                  color: UI.text,
                                  minWidth: 0,
                                  fontSize: 15,
                                  whiteSpace: "nowrap",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                }}
                              >
                                {c.caregiverName || c.caregiverId}
                              </div>
                              <div style={{ fontSize: 11, color: unread > 0 ? UI.blue : UI.textDim, whiteSpace: "nowrap", fontWeight: unread > 0 ? 800 : 600 }}>
                                {fmtDateTime(c.lastTimestamp)}
                              </div>
                            </div>

                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                marginTop: 4,
                                minWidth: 0,
                              }}
                            >
                              {unread > 0 ? (
                                <span
                                  style={{
                                    width: 8,
                                    height: 8,
                                    borderRadius: "50%",
                                    background: UI.blue,
                                    flex: "0 0 auto",
                                  }}
                                />
                              ) : null}
                              <div
                                style={{
                                  fontSize: 13,
                                  color: unread > 0 ? UI.text : UI.textDim,
                                  lineHeight: 1.45,
                                  display: "-webkit-box",
                                  WebkitLineClamp: 2,
                                  WebkitBoxOrient: "vertical",
                                  overflow: "hidden",
                                }}
                              >
                                {c.lastSnippet || "No recent message"}
                              </div>
                            </div>

                            <div style={{ marginTop: 8, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                              {unread > 0 ? (
                                <Chip label={`${unread} new`} color={UI.blue} border={"rgba(37,99,235,0.22)"} bg={"rgba(37,99,235,0.08)"} />
                              ) : null}

                              <Chip
                                label={`CW ${cwAvail ? "Avail" : "Missing"}`}
                                color={cwAvail ? UI.green : UI.yellow}
                                border={cwAvail ? "rgba(16,185,129,0.25)" : "rgba(245,158,11,0.22)"}
                                bg={cwAvail ? "rgba(16,185,129,0.08)" : "rgba(245,158,11,0.10)"}
                                title={cwAvail ? "CW Availability submitted" : "CW Availability missing"}
                              />

                              <Chip
                                label={`NW ${nwAvail ? "Avail" : "Missing"}`}
                                color={nwAvail ? UI.green : UI.yellow}
                                border={nwAvail ? "rgba(16,185,129,0.25)" : "rgba(245,158,11,0.22)"}
                                bg={nwAvail ? "rgba(16,185,129,0.08)" : "rgba(245,158,11,0.10)"}
                                title={nwAvail ? "NW Availability submitted" : "NW Availability missing"}
                              />

                              {(cwHours > 0 || nwHours > 0) ? (
                                <Chip
                                  label={`${cwHours || 0}h / ${nwHours || 0}h`}
                                  color={UI.text}
                                  border={"rgba(148,163,184,0.24)"}
                                  bg={"rgba(15,23,42,0.04)"}
                                  title="Scheduled hours (CW / NW)"
                                />
                              ) : null}

                              {cert ? (
                                <Chip
                                  label={cert}
                                  color={UI.purple}
                                  border={"rgba(139,92,246,0.25)"}
                                  bg={"rgba(139,92,246,0.08)"}
                                  title="Certification"
                                />
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div style={{ color: UI.textDim, fontSize: 13 }}>No conversations.</div>
              )}
            </div>
          ) : (
            /* Thread */
            <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
              <div ref={threadWrapRef} style={{ flex: 1, overflow: "auto", padding: "10px 12px 8px", background: bodyBackground }}>
                {loadingThread && !threadReady ? (
                  <div style={{ color: UI.textDim, fontSize: 13 }}>Loading…</div>
                ) : thread.length ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    {thread.map((m) => {
                      const isMine = String(m.sender?.id || "") === String(viewerId || "");
                      const cat = catKey(m.category);
                      const payroll = cat === "payroll";
                      const scheduling = cat === "scheduling";

                      const fill = isMine
                        ? UI.bubbleMine
                        : payroll
                        ? "rgba(16,185,129,0.16)"
                        : scheduling
                        ? "rgba(139,92,246,0.12)"
                        : UI.bubbleTheirs;

                      const outline = isMine
                        ? payroll
                          ? UI.green
                          : scheduling
                          ? UI.purple
                        : "rgba(37,99,235,0.35)"
                        : payroll
                        ? "rgba(16,185,129,0.35)"
                        : scheduling
                        ? "rgba(139,92,246,0.30)"
                        : "rgba(148,163,184,0.45)";

                      const textColor = isMine ? "#fff" : UI.text;
                      const metaColor = isMine ? "rgba(255,255,255,0.82)" : UI.textDim;

                      const unread = isUnreadMsg(m, viewerId);
                      const rr = Array.isArray(m.readReceipts) ? m.readReceipts : [];
                      const rrText = rr.length ? receiptSummary(rr) : "Not read yet";
                      const receiptsOpen = !!expandedReceipts[m.messageId];

                      return (
                        <div
                          key={m.messageId}
                          data-mid={m.messageId}
                          data-unread={unread ? "1" : "0"}
                          style={{
                            width: "100%",
                            display: "flex",
                            justifyContent: isMine ? "flex-end" : "flex-start",
                          }}
                        >
                          <div style={{ maxWidth: "82%", width: "fit-content", display: "grid", gap: 4 }}>
                            <div
                              onClick={() => openEditForMessage(m)}
                              title={isMine ? "Click to edit" : undefined}
                              style={{
                                border: `1px solid ${outline}`,
                                background: fill,
                                borderRadius: isMine ? "20px 20px 6px 20px" : "20px 20px 20px 6px",
                                padding: "10px 12px",
                                overflowWrap: "anywhere",
                                cursor: isMine ? "pointer" : "default",
                                boxShadow: isMine
                                  ? "0 10px 24px rgba(29,78,216,0.20)"
                                  : "0 8px 20px rgba(15,23,42,0.06)",
                              }}
                            >
                              <div style={{ fontSize: 12, fontWeight: 900, color: textColor }}>
                                {m.sender?.name || m.sender?.id}
                              </div>

                              <div style={{ fontSize: 13.5, color: textColor, marginTop: 6, whiteSpace: "pre-wrap" }}>
                                {m.text}
                              </div>

                              <div style={{ marginTop: 8 }}>
                                <div style={{ fontSize: 11, color: metaColor }}>{fmtDateTime(m.timestamp)}</div>
                              </div>
                            </div>

                            {/* Read receipts BELOW bubble */}
                            <div
                              style={{
                                fontSize: 11,
                                color: UI.textDim,
                                paddingLeft: isMine ? 8 : 0,
                                paddingRight: isMine ? 0 : 8,
                                display: "grid",
                                gap: 3,
                                justifyItems: isMine ? "end" : "start",
                              }}
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  rr.length
                                    ? setExpandedReceipts((prev) => ({
                                        ...prev,
                                        [m.messageId]: !prev[m.messageId],
                                      }))
                                    : undefined
                                }
                                style={{
                                  border: "none",
                                  background: "transparent",
                                  padding: 0,
                                  color: UI.textDim,
                                  cursor: rr.length ? "pointer" : "default",
                                  fontSize: 11,
                                  textAlign: isMine ? "right" : "left",
                                  whiteSpace: "nowrap",
                                }}
                                disabled={!rr.length}
                                title={rr.length ? (receiptsOpen ? "Hide read receipts" : "Show read receipts") : undefined}
                              >
                                {rrText}
                                {rr.length ? <span style={{ marginLeft: 6, color: UI.blue }}>{receiptsOpen ? "Hide" : "Show"}</span> : null}
                              </button>

                              {rr.length && receiptsOpen ? (
                                <div style={{ fontSize: 10.5, opacity: 0.95, textAlign: isMine ? "right" : "left" }}>
                                  {rr.map((r) => `${r.name || r.id} • ${fmtDateTime(r.time)}`).join(" · ")}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ color: UI.textDim, fontSize: 13 }}>No messages yet.</div>
                )}
              </div>

              {/* Composer */}
              <div style={{ borderTop: `1px solid ${UI.border}`, padding: "6px 10px 10px", background: composerBackground, backdropFilter: "blur(10px)" }}>
                <div style={{ display: "flex", gap: 5, alignItems: "center", marginBottom: 6, flexWrap: "nowrap" }}>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as any)}
                    style={{
                      flex: "0 1 84px",
                      width: 84,
                      border: `1px solid ${UI.border}`,
                      borderRadius: 999,
                      padding: "4px 20px 4px 8px",
                      background: "#fff",
                      color: UI.text,
                      minHeight: 28,
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    <option value="General">General</option>
                    <option value="Scheduling">Scheduling</option>
                    <option value="Payroll">Payroll</option>
                  </select>

                  <button
                    onClick={() => insertWeekIntoMessage("cw")}
                    disabled={!!insertingWeek}
                    style={{
                      border: `1px solid ${UI.border}`,
                      background: "#fff",
                      borderRadius: 999,
                      padding: "4px 7px",
                      cursor: insertingWeek ? "not-allowed" : "pointer",
                      fontWeight: 900,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      opacity: insertingWeek ? 0.7 : 1,
                      color: UI.text,
                      minHeight: 28,
                      fontSize: 12,
                      whiteSpace: "nowrap",
                    }}
                    title="Insert this week's schedule"
                  >
                    {insertingWeek === "cw" ? <Spinner /> : null}
                    + This Week
                  </button>

                  <button
                    onClick={() => insertWeekIntoMessage("nw")}
                    disabled={!!insertingWeek}
                    style={{
                      border: `1px solid ${UI.border}`,
                      background: "#fff",
                      borderRadius: 999,
                      padding: "4px 7px",
                      cursor: insertingWeek ? "not-allowed" : "pointer",
                      fontWeight: 900,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      opacity: insertingWeek ? 0.7 : 1,
                      color: UI.text,
                      minHeight: 28,
                      fontSize: 12,
                      whiteSpace: "nowrap",
                    }}
                    title="Insert next week's schedule"
                  >
                    {insertingWeek === "nw" ? <Spinner /> : null}
                    + Next Week
                  </button>

                  <button
                    onClick={openClientPicker}
                    style={{
                      border: `1px solid ${UI.border}`,
                      background: "#fff",
                      borderRadius: 999,
                      padding: "4px 7px",
                      cursor: "pointer",
                      fontWeight: 900,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      color: UI.orange,
                      minHeight: 28,
                      fontSize: 12,
                      whiteSpace: "nowrap",
                    }}
                    title="Insert client profile"
                  >
                    <PersonIcon />
                    Client
                  </button>

                  <div style={{ marginLeft: "auto", fontSize: 10.5, color: UI.textDim, whiteSpace: "nowrap", flex: "0 0 auto" }}>
                    {sendStatus}
                  </div>

                  <button
                    onClick={doSend}
                    style={{
                      flex: "0 0 auto",
                      border: `1px solid ${UI.blue}`,
                      background: UI.blue,
                      color: "#fff",
                      borderRadius: 999,
                      padding: "4px 8px",
                      cursor: "pointer",
                      fontWeight: 900,
                      minHeight: 28,
                      fontSize: 12,
                      whiteSpace: "nowrap",
                    }}
                  >
                    Send
                  </button>
                </div>

                <textarea
                  id="msgInput"
                  ref={msgInputRef}
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    syncComposerHeight();
                  }}
                  placeholder="Type a message…"
                  style={{
                    width: "100%",
                    minHeight: 48,
                    maxHeight: 180,
                    resize: "none",
                    border: `1px solid ${UI.border}`,
                    borderRadius: 18,
                    padding: "10px 12px",
                    background: "#fff",
                    fontSize: 13,
                    color: UI.text,
                    lineHeight: 1.45,
                    overflowY: "auto",
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Resize handle */}
        {!docked ? (
          <div
            onMouseDown={onResizeStart}
            title="Resize window"
            style={{
              position: "absolute",
              right: 8,
              bottom: 8,
              width: 18,
              height: 18,
              cursor: "nwse-resize",
              borderRight: `3px solid ${UI.textDim}`,
              borderBottom: `3px solid ${UI.textDim}`,
              opacity: 0.35,
              borderRadius: 3,
              userSelect: "none",
            }}
          />
        ) : null}

        {/* Edit Message Modal */}
        {editOpen ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(0,0,0,0.35)",
              zIndex: 9999,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 14,
            }}
            onMouseDown={(e) => {
              const t = e.target as HTMLElement;
              if (t.dataset.backdrop === "1") setEditOpen(false);
            }}
            data-backdrop="1"
          >
            <div
              style={{
                width: "min(720px, 96%)",
                maxHeight: "80%",
                background: "#fff",
                border: `1px solid ${UI.border}`,
                borderRadius: 14,
                boxShadow: UI.shadow,
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div
                style={{
                  padding: 12,
                  borderBottom: `1px solid ${UI.border}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                }}
              >
                <div style={{ fontWeight: 900, color: UI.text }}>Edit Message</div>
                <button
                  onClick={() => setEditOpen(false)}
                  style={{
                    border: `1px solid ${UI.border}`,
                    background: "#fff",
                    borderRadius: 10,
                    padding: "6px 10px",
                    cursor: "pointer",
                    fontWeight: 900,
                  }}
                  title="Close"
                >
                  ✕
                </button>
              </div>

              <div style={{ padding: 12, display: "grid", gap: 10 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ fontSize: 12, color: UI.textDim }}>Category</div>
                  <select
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value as any)}
                    style={{
                      border: `1px solid ${UI.border}`,
                      borderRadius: 10,
                      padding: "8px 10px",
                      background: "#fff",
                      minWidth: 220,
                      fontWeight: 800,
                    }}
                  >
                    <option value="General">General</option>
                    <option value="Scheduling">Scheduling</option>
                    <option value="Payroll">Payroll</option>
                  </select>

                  <div style={{ marginLeft: "auto", fontSize: 11, color: UI.textDim }}>{editStatus}</div>
                </div>

                <textarea
                  id="editMsgText"
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  style={{
                    width: "100%",
                    minHeight: 140,
                    maxHeight: 340,
                    resize: "vertical",
                    border: `1px solid ${UI.border}`,
                    borderRadius: 12,
                    padding: 12,
                    background: "#fff",
                    fontSize: 13,
                  }}
                />
              </div>

              <div
                style={{
                  padding: 12,
                  borderTop: `1px solid ${UI.border}`,
                  display: "flex",
                  gap: 10,
                  justifyContent: "flex-end",
                  background: "rgba(248,250,252,0.95)",
                }}
              >
                <button
                  onClick={() => setEditOpen(false)}
                  style={{
                    border: `1px solid ${UI.border}`,
                    background: "#fff",
                    borderRadius: 10,
                    padding: "8px 12px",
                    cursor: "pointer",
                    fontWeight: 900,
                  }}
                >
                  Cancel
                </button>

                <button
                  onClick={doUpdateMessage}
                  disabled={!editText.trim()}
                  style={{
                    border: `1px solid ${!editText.trim() ? UI.border : UI.blue}`,
                    background: !editText.trim() ? "#f8fafc" : UI.blue,
                    color: !editText.trim() ? UI.textDim : "#fff",
                    borderRadius: 10,
                    padding: "8px 12px",
                    cursor: !editText.trim() ? "not-allowed" : "pointer",
                    fontWeight: 900,
                  }}
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* Client Picker Modal */}
        {clientModalOpen ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(0,0,0,0.35)",
              zIndex: 9999,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 14,
            }}
            onMouseDown={(e) => {
              const t = e.target as HTMLElement;
              if (t.dataset.backdrop === "1") closeClientPicker();
            }}
            data-backdrop="1"
          >
            <div
              style={{
                width: "min(720px, 96%)",
                maxHeight: "80%",
                background: "#fff",
                border: `1px solid ${UI.border}`,
                borderRadius: 14,
                boxShadow: UI.shadow,
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div
                style={{
                  padding: 12,
                  borderBottom: `1px solid ${UI.border}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <PersonIcon />
                  <div style={{ fontWeight: 900, color: UI.text }}>Insert Client Profile</div>
                </div>

                <button
                  onClick={closeClientPicker}
                  style={{
                    border: `1px solid ${UI.border}`,
                    background: "#fff",
                    borderRadius: 10,
                    padding: "6px 10px",
                    cursor: "pointer",
                    fontWeight: 900,
                  }}
                  title="Close"
                >
                  ✕
                </button>
              </div>

              <div style={{ padding: 12, borderBottom: `1px solid ${UI.borderSoft}` }}>
                <input
                  id="clientSearch"
                  value={clientSearch}
                  onChange={(e) => {
                    setClientSearch(e.target.value);
                    setClientSelectedIdx(-1);
                  }}
                  placeholder="Search client name or location…"
                  style={{
                    width: "100%",
                    border: `1px solid ${UI.border}`,
                    borderRadius: 12,
                    padding: "10px 12px",
                    background: "#fff",
                    fontSize: 13,
                  }}
                />
                <div style={{ marginTop: 8, fontSize: 12, color: UI.textDim }}>
                  {clientLoading ? "Loading…" : clientErr ? clientErr : `${filteredClients.length} clients`}
                </div>
              </div>

              <div style={{ flex: 1, overflow: "auto", padding: 12 }}>
                {filteredClients.length ? (
                  <div style={{ display: "grid", gap: 10 }}>
                    {filteredClients.map((c, idx) => {
                      const selected = idx === clientSelectedIdx;
                      const secondary = (c.address || c.location || "").trim();
                      return (
                        <button
                          key={`${c.name}-${idx}`}
                          onClick={() => setClientSelectedIdx(idx)}
                          style={{
                            textAlign: "left",
                            border: `2px solid ${selected ? UI.orange : UI.border}`,
                            background: selected ? "rgba(249,115,22,0.06)" : "#fff",
                            borderRadius: 12,
                            padding: 10,
                            cursor: "pointer",
                          }}
                        >
                          <div style={{ fontWeight: 900, color: UI.text }}>{c.name}</div>
                          <div style={{ fontSize: 12, color: UI.textDim, marginTop: 4 }}>
                            {secondary}
                            {c.status ? ` · ${c.status}` : ""}
                          </div>
                          {c.description ? (
                            <div style={{ fontSize: 12, color: UI.text, marginTop: 6, opacity: 0.9 }}>
                              {c.description}
                            </div>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ color: UI.textDim, fontSize: 13 }}>No clients.</div>
                )}
              </div>

              <div
                style={{
                  padding: 12,
                  borderTop: `1px solid ${UI.border}`,
                  display: "flex",
                  gap: 10,
                  justifyContent: "flex-end",
                  background: "rgba(248,250,252,0.95)",
                }}
              >
                <button
                  onClick={closeClientPicker}
                  style={{
                    border: `1px solid ${UI.border}`,
                    background: "#fff",
                    borderRadius: 10,
                    padding: "8px 12px",
                    cursor: "pointer",
                    fontWeight: 900,
                  }}
                >
                  Cancel
                </button>

                <button
                  onClick={insertClientProfile}
                  disabled={clientSelectedIdx < 0}
                  style={{
                    border: `1px solid ${clientSelectedIdx < 0 ? UI.border : UI.orange}`,
                    background: clientSelectedIdx < 0 ? "#f8fafc" : UI.orange,
                    color: clientSelectedIdx < 0 ? UI.textDim : "#fff",
                    borderRadius: 10,
                    padding: "8px 12px",
                    cursor: clientSelectedIdx < 0 ? "not-allowed" : "pointer",
                    fontWeight: 900,
                  }}
                >
                  Insert
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}

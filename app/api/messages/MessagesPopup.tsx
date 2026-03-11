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
  shadow: "0 20px 60px rgba(0,0,0,.18)",
  blue: "#2563eb",
  red: "#ef4444",
  green: "#10b981",
  purple: "#8b5cf6",
  grayBubble: "#e5e7eb",
  orange: "#f97316",
  yellow: "#f59e0b",
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

  // composer
  const [category, setCategory] = useState<"General" | "Scheduling" | "Payroll">("General");
  const [text, setText] = useState("");
  const [sendStatus, setSendStatus] = useState<string>("");
  const [composerExpanded, setComposerExpanded] = useState(false);
  const [insertingWeek, setInsertingWeek] = useState<WeekKind | null>(null);

  const POLL_MS = 5000;
  const threadWrapRef = useRef<HTMLDivElement | null>(null);

  // floating window state
  const [win, setWin] = useState<WinState>(DEFAULT_WIN);

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

    const w = Math.max(360, Math.min(next.w, vw - pad * 2));
    const h = Math.max(420, Math.min(next.h, vh - pad * 2));

    const x = Math.max(pad, Math.min(next.x, vw - w - pad));
    const y = Math.max(pad, Math.min(next.y, vh - h - pad));

    return { x, y, w, h };
  }

  // load saved window state once
  useEffect(() => {
    try {
      const raw = localStorage.getItem("messages_window_v1");
      if (raw) {
        const parsed = JSON.parse(raw);
        const merged = { ...DEFAULT_WIN, ...parsed } as WinState;
        setWin(clampToViewport(merged));
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // persist window
  useEffect(() => {
    try {
      localStorage.setItem("messages_window_v1", JSON.stringify(win));
    } catch {}
  }, [win]);

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
    const target = e.target as HTMLElement;
    if (target.closest("button, select, input, textarea, a")) return;

    dragRef.current.active = true;
    dragRef.current.startX = e.clientX;
    dragRef.current.startY = e.clientY;
    dragRef.current.startWin = win;
    e.preventDefault();
  }

  function onResizeStart(e: React.MouseEvent) {
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
      setListReady(true);
    } finally {
      listInFlight.current = false;
      if (!silent && !listReady) setLoadingList(false);
    }
  }

  async function loadThread(caregiverId: string, opts?: { silent?: boolean; markRead?: boolean }) {
    if (!caregiverId) return;
    if (threadInFlight.current) return;

    const silent = !!opts?.silent;
    const markRead = opts?.markRead !== false;

    threadInFlight.current = true;
    const req = ++threadReqId.current;

    if (!silent && !threadReady) setLoadingThread(true);

    try {
      const res: ThreadResponse = await apiGet({ action: "getThread", caregiverId });
      if (req !== threadReqId.current) return;

      setThread(res?.messages || []);
      setActiveCaregiverId(res?.caregiverId || caregiverId);
      setActiveCaregiverName(res?.caregiverName || caregiverId);
      setThreadReady(true);

      if (markRead && viewerId) {
        apiPost({ action: "markThreadRead", viewerId, caregiverId }).catch(() => {});
      }
    } finally {
      threadInFlight.current = false;
      if (!silent && !threadReady) setLoadingThread(false);
    }
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

    setListReady(false);
    setThreadReady(false);

    setActiveCaregiverId("");
    setActiveCaregiverName("");
    setThread([]);
    loadConversations(viewerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerId]);

  // polling (light)
  useEffect(() => {
    if (!viewerId) return;
    if (!open) return;

    const t = setInterval(() => {
      if (document.hidden) return;
      loadConversations(viewerId, { silent: true });
      if (activeCaregiverId) loadThread(activeCaregiverId, { silent: true, markRead: false });
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
    setThreadReady(false);
    loadThread(cid);

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

  return (
    <>
      {/* Floating Messages button */}
      <button
        onClick={toggle}
        style={{
          position: "fixed",
          right: 16,
          bottom: 16,
          zIndex: 9999,
          border: `1px solid ${UI.border}`,
          background: UI.bg,
          borderRadius: 999,
          padding: "10px 12px",
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
      </button>

      {/* Draggable + resizable floating window */}
      <div
        style={{
          position: "fixed",
          left: win.x,
          top: win.y,
          width: win.w,
          height: win.h,
          zIndex: 9998,
          background: UI.bg,
          border: `1px solid ${UI.border}`,
          borderRadius: 14,
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
            padding: "10px 12px",
            borderBottom: `1px solid ${UI.border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            userSelect: "none",
            background: "rgba(248,250,252,0.95)",
            cursor: "move",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <div style={{ fontWeight: 900, color: UI.text, whiteSpace: "nowrap" }}>Messages</div>
            <div style={{ fontSize: 12, color: UI.textDim, whiteSpace: "nowrap" }}>
              {activeCaregiverId ? "Thread" : "Inbox"}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              onClick={() => setWin(clampToViewport(DEFAULT_WIN))}
              style={{
                border: `1px solid ${UI.border}`,
                background: "#fff",
                borderRadius: 10,
                padding: "6px 10px",
                cursor: "pointer",
                fontWeight: 900,
              }}
              title="Reset window"
            >
              ⤾
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
                borderRadius: 10,
                padding: "6px 10px",
                cursor: "pointer",
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
        </div>

        {/* Controls */}
        <div style={{ padding: 10, borderBottom: `1px solid ${UI.borderSoft}` }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ fontSize: 12, color: UI.textDim }}>Viewing as</div>
            <select
              value={viewerId}
              onChange={(e) => setViewerId(e.target.value)}
              style={{
                flex: "1 1 220px",
                border: `1px solid ${UI.border}`,
                borderRadius: 10,
                padding: "6px 8px",
                background: "#fff",
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

            {activeCaregiverId ? (
              <button
                onClick={() => {
                  setActiveCaregiverId("");
                  setActiveCaregiverName("");
                  setThread([]);
                  setThreadReady(false);
                }}
                style={{
                  marginLeft: "auto",
                  border: `1px solid ${UI.border}`,
                  background: "#fff",
                  borderRadius: 10,
                  padding: "6px 10px",
                  cursor: "pointer",
                  fontWeight: 800,
                }}
                title="Back to conversations"
              >
                ← Back
              </button>
            ) : null}
          </div>

          {!activeCaregiverId ? (
            <div style={{ marginTop: 8 }}>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search caregiver…"
                style={{
                  width: "100%",
                  border: `1px solid ${UI.border}`,
                  borderRadius: 10,
                  padding: "8px 10px",
                  background: "#fff",
                }}
              />
            </div>
          ) : (
            <div style={{ marginTop: 8, fontSize: 13, color: UI.text }}>
              <div style={{ fontWeight: 900 }}>{activeCaregiverName}</div>
              <div style={{ fontSize: 12, color: UI.textDim, marginTop: 2 }}>Tip: click your sent messages to edit.</div>
            </div>
          )}
        </div>

        {/* Body */}
        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          {/* Inbox */}
          {!activeCaregiverId ? (
            <div style={{ flex: 1, overflow: "auto", padding: 10 }}>
              {loadingList && !listReady ? (
                <div style={{ color: UI.textDim, fontSize: 13 }}>Loading…</div>
              ) : filteredConvs.length ? (
                <div style={{ display: "grid", gap: 8 }}>
                  {filteredConvs.map((c) => {
                    const unread = Number(c.unreadCount || 0);
                    const cid = String(c.caregiverId || "");

                    const cwAvail = availSubmitted.cw.has(cid);
                    const nwAvail = availSubmitted.nw.has(cid);

                    const cwHours = hoursByCaregiver.cw[cid] || 0;
                    const nwHours = hoursByCaregiver.nw[cid] || 0;

                    const cert = certByCaregiverId[cid] || "";

                    return (
                      <button
                        key={c.caregiverId}
                        onClick={() => {
                          setThreadReady(false);
                          loadThread(c.caregiverId);
                        }}
                        style={{
                          textAlign: "left",
                          border: `1px solid ${UI.border}`,
                          background: "#fff",
                          borderRadius: 12,
                          padding: 10,
                          cursor: "pointer",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                          <div style={{ fontWeight: 900, color: UI.text, minWidth: 0 }}>
                            {c.caregiverName || c.caregiverId}
                          </div>
                          <div style={{ fontSize: 12, color: UI.textDim, whiteSpace: "nowrap" }}>
                            {fmtDateTime(c.lastTimestamp)}
                          </div>
                        </div>

                        <div style={{ fontSize: 12, color: UI.textDim, marginTop: 6 }}>{c.lastSnippet || ""}</div>

                        <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                          {unread > 0 ? (
                            <Chip label={`Unread: ${unread}`} color={UI.red} border={UI.red} bg={"rgba(239,68,68,0.06)"} />
                          ) : (
                            <span style={{ fontSize: 11, color: UI.textDim }}>No unread</span>
                          )}

                          <Chip
                            label="CW Avail"
                            color={cwAvail ? UI.green : UI.yellow}
                            border={cwAvail ? UI.green : UI.yellow}
                            bg={cwAvail ? "rgba(16,185,129,0.10)" : "rgba(245,158,11,0.12)"}
                            title={cwAvail ? "CW Availability submitted" : "CW Availability missing"}
                          />

                          <Chip
                            label="NW Avail"
                            color={nwAvail ? UI.green : UI.yellow}
                            border={nwAvail ? UI.green : UI.yellow}
                            bg={nwAvail ? "rgba(16,185,129,0.10)" : "rgba(245,158,11,0.12)"}
                            title={nwAvail ? "NW Availability submitted" : "NW Availability missing"}
                          />

                          <Chip
                            label={`Hours • CW ${cwHours || 0} / NW ${nwHours || 0}`}
                            color={cwHours > 0 || nwHours > 0 ? UI.text : UI.textDim}
                            border={UI.border}
                            bg={cwHours > 0 || nwHours > 0 ? "rgba(15,23,42,0.04)" : "rgba(15,23,42,0.03)"}
                            title="Scheduled hours (non-canceled, non-open)"
                          />

                          {cert ? (
                            <Chip
                              label={`Cert • ${cert}`}
                              color={UI.purple}
                              border={UI.purple}
                              bg={"rgba(139,92,246,0.10)"}
                              title="Certification"
                            />
                          ) : null}
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
              <div ref={threadWrapRef} style={{ flex: 1, overflow: "auto", padding: 10 }}>
                {loadingThread && !threadReady ? (
                  <div style={{ color: UI.textDim, fontSize: 13 }}>Loading…</div>
                ) : thread.length ? (
                  <div style={{ display: "grid", gap: 10 }}>
                    {thread.map((m) => {
                      const isMine = String(m.sender?.id || "") === String(viewerId || "");
                      const cat = catKey(m.category);
                      const payroll = cat === "payroll";
                      const scheduling = cat === "scheduling";

                      const fill = isMine ? UI.blue : payroll ? UI.green : scheduling ? UI.purple : UI.grayBubble;

                      const outline = isMine
                        ? payroll
                          ? UI.green
                          : scheduling
                          ? UI.purple
                          : "rgba(37,99,235,0.35)"
                        : payroll
                        ? "rgba(16,185,129,0.8)"
                        : scheduling
                        ? "rgba(139,92,246,0.8)"
                        : "rgba(107,114,128,0.6)";

                      const textColor = isMine ? "#fff" : fill === UI.grayBubble ? UI.text : "#fff";
                      const metaColor = isMine || fill !== UI.grayBubble ? "rgba(255,255,255,0.85)" : UI.textDim;

                      const unread = isUnreadMsg(m, viewerId);
                      const rr = Array.isArray(m.readReceipts) ? m.readReceipts : [];
                      const rrText = rr.length ? receiptSummary(rr) : "Not read yet";

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
                          <div style={{ maxWidth: "70%", width: "fit-content", display: "grid", gap: 4 }}>
                            <div
                              onClick={() => openEditForMessage(m)}
                              title={isMine ? "Click to edit" : undefined}
                              style={{
                                border: `2px solid ${outline}`,
                                background: fill,
                                borderRadius: 16,
                                padding: "10px 12px",
                                overflowWrap: "anywhere",
                                cursor: isMine ? "pointer" : "default",
                                boxShadow: "0 6px 16px rgba(0,0,0,0.08)",
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

                            {/* Read receipts BELOW bubble (grey) */}
                            {isMine ? (
                              <div style={{ fontSize: 11, color: UI.textDim, paddingLeft: 8 }}>
                                {rrText}
                                {rr.length ? (
                                  <span style={{ marginLeft: 8, fontSize: 10.5, opacity: 0.95 }}>
                                    {rr
                                      .slice(0, 4)
                                      .map((r) => `${r.name || r.id} • ${fmtDateTime(r.time)}`)
                                      .join(" · ")}
                                    {rr.length > 4 ? ` · +${rr.length - 4} more` : ""}
                                  </span>
                                ) : null}
                              </div>
                            ) : null}
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
              <div style={{ borderTop: `1px solid ${UI.border}`, padding: 10, background: "rgba(248,250,252,0.95)" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as any)}
                    style={{
                      border: `1px solid ${UI.border}`,
                      borderRadius: 10,
                      padding: "6px 8px",
                      background: "#fff",
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
                      borderRadius: 10,
                      padding: "6px 10px",
                      cursor: insertingWeek ? "not-allowed" : "pointer",
                      fontWeight: 900,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      opacity: insertingWeek ? 0.7 : 1,
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
                      borderRadius: 10,
                      padding: "6px 10px",
                      cursor: insertingWeek ? "not-allowed" : "pointer",
                      fontWeight: 900,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      opacity: insertingWeek ? 0.7 : 1,
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
                      borderRadius: 10,
                      padding: "6px 10px",
                      cursor: "pointer",
                      fontWeight: 900,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      color: UI.orange,
                    }}
                    title="Insert client profile"
                  >
                    <PersonIcon />
                    Client
                  </button>

                  <button
                    onClick={() => setComposerExpanded((v) => !v)}
                    style={{
                      border: `1px solid ${UI.border}`,
                      background: "#fff",
                      borderRadius: 10,
                      padding: "6px 10px",
                      cursor: "pointer",
                      fontWeight: 900,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                    title={composerExpanded ? "Shrink message box" : "Expand message box"}
                  >
                    {composerExpanded ? "▾" : "▴"} Text
                  </button>

                  <div style={{ marginLeft: "auto", fontSize: 11, color: UI.textDim }}>{sendStatus}</div>

                  <button
                    onClick={doSend}
                    style={{
                      border: `1px solid ${UI.border}`,
                      background: "#fff",
                      borderRadius: 10,
                      padding: "6px 10px",
                      cursor: "pointer",
                      fontWeight: 900,
                    }}
                  >
                    Send
                  </button>
                </div>

                <textarea
                  id="msgInput"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Type a message…"
                  style={{
                    width: "100%",
                    minHeight: composerExpanded ? 160 : 74,
                    maxHeight: composerExpanded ? 420 : 220,
                    resize: "vertical",
                    border: `1px solid ${UI.border}`,
                    borderRadius: 12,
                    padding: 10,
                    background: "#fff",
                    fontSize: 13,
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Resize handle */}
        <div
          onMouseDown={onResizeStart}
          title="Resize window"
          style={{
            position: "absolute",
            right: 6,
            bottom: 6,
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

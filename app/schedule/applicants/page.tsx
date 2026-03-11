// app/schedule/applicants/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type EmployeeRow = Record<string, any> & {
  __rowNumber: number;
  __key: string;
};

type ApiGetResp = {
  ok: boolean;
  headers?: any;
  rows?: any;
  error?: string;
};

const UI = {
  pageBg: "#f8fafc",
  panelBg: "#ffffff",
  border: "#d1d5db",
  borderSoft: "#e5e7eb",
  text: "#0f172a",
  textDim: "#64748b",

  blueBar: "#1e40af",
  blueBarText: "#ffffff",
  blueBarSubText: "#dbeafe",
  blueBarSubTextDim: "#bfdbfe",

  blueHeader: "rgba(29,78,216,0.95)",
  blueHeaderBorder: "rgba(30,58,138,0.30)",

  hoverRow: "#eff6ff",
  zebra: "#f8fafc",

  overlay: "rgba(0,0,0,0.5)",

  // chips
  chipBg: "#f1f5f9",
  chipBorder: "#e2e8f0",
  chipText: "#0f172a",

  amberBg: "#fffbeb",
  amberBorder: "#fde68a",
  amberText: "#92400e",

  greenBg: "#ecfdf5",
  greenBorder: "#a7f3d0",
  greenText: "#065f46",

  roseBg: "#fff1f2",
  roseBorder: "#fecdd3",
  roseText: "#9f1239",

  nameColors: {
    Red: "#dc2626",
    Orange: "#ea580c",
    Green: "#16a34a",
    Blue: "#2563eb",
    Purple: "#7c3aed",
    Default: "#0f172a",
  } as Record<string, string>,
};

const NAME_COLOR_OPTIONS = ["Default", "Red", "Orange", "Green", "Blue", "Purple"] as const;

const COLS = {
  firstName: "First Name",
  lastName: "Last Name",
  phone: "Phone Number",
  phoneType: "Phone Type",
  address: "Address",
  location: "Location",
  certification: "Certification",
  vaccinated: "Vaccinated",
  age: "Age",
  availability: "Availability",
  dateInterviewed: "Date Interviewed",
  status: "Status",
  interviewNotes: "Interview Notes",

  presentation: "Presentation",
  experience: "Experience",
  personality: "Personality",
  reliability: "Reliability",

  // ✅ sheet + backward compat
  firstImpression: "First Impression",
  firstImpressionLegacy: "First Impression Score",

  nameColor: "Name Color",
} as const;

type DatePreset = "Last week" | "This month" | "Last month" | "Last 3 months" | "This year" | "All";
type ScorePreset = "All" | "0+" | "2+" | "4+" | "5+" | "6+" | "7+" | "8+" | "9+";

const AVAILABILITY_CHIPS = [
  "Mornings",
  "Afternoon",
  "Evening",
  "Overnight",
  "Weekend",
  "Flexible",
  "Limited",
  "Can't start right away",
  "Open",
] as const;

type AvailabilityChip = (typeof AVAILABILITY_CHIPS)[number];

function norm(v: any) {
  return (v ?? "").toString().trim();
}
function includesCI(hay: string, needle: string) {
  return hay.toLowerCase().includes(needle.toLowerCase());
}
function parseMaybeNumber(v: any): number | null {
  const s = norm(v);
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function clampNum(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

/** Parse common sheet date strings like 2/26/26, 2/26/2026, ISO */
function parseSheetDate(v: any): Date | null {
  const s = norm(v);
  if (!s) return null;

  const iso = Date.parse(s);
  if (!Number.isNaN(iso)) return new Date(iso);

  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return null;

  const mm = parseInt(m[1], 10);
  const dd = parseInt(m[2], 10);
  let yy = parseInt(m[3], 10);
  if (yy < 100) yy = 2000 + yy;

  const d = new Date(yy, mm - 1, dd);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function startOfWeekSunday(d: Date) {
  const x = startOfDay(d);
  const dow = x.getDay(); // 0=Sun
  x.setDate(x.getDate() - dow);
  return x;
}
function monthStart(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function monthEndExclusive(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 1);
}

function formatMDY(d: Date) {
  const mm = d.getMonth() + 1;
  const dd = d.getDate();
  const yy = String(d.getFullYear()).slice(-2);
  return `${mm}/${dd}/${yy}`;
}

function diffDaysFromToday(d: Date) {
  const today = startOfDay(new Date()).getTime();
  const then = startOfDay(d).getTime();
  return Math.floor((today - then) / (24 * 60 * 60 * 1000));
}

function formatAgoFromDays(days: number) {
  if (days < 0) return `in ${Math.abs(days)}d`;
  if (days <= 13) return `${days} day${days === 1 ? "" : "s"} ago`;
  if (days <= 59) {
    const w = Math.round((days / 7) * 10) / 10;
    return `${w} week${w === 1 ? "" : "s"} ago`;
  }
  const m = Math.round((days / 30) * 10) / 10;
  return `${m} month${m === 1 ? "" : "s"} ago`;
}

/** ----- Color scale (0 red, 5 yellow, 10 green) ----- */
function hexToRgb(hex: string) {
  const h = hex.replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return { r, g, b };
}
function rgbToHex(r: number, g: number, b: number) {
  const to = (x: number) => x.toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
function lerpHex(a: string, b: string, t: number) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  const r = Math.round(lerp(A.r, B.r, t));
  const g = Math.round(lerp(A.g, B.g, t));
  const b2 = Math.round(lerp(A.b, B.b, t));
  return rgbToHex(r, g, b2);
}
function scoreColor10(score10: number) {
  const s = clampNum(score10, 0, 10);
  const RED = "#dc2626";
  const YEL = "#f59e0b";
  const GRN = "#16a34a";
  if (s <= 5) return lerpHex(RED, YEL, s / 5);
  return lerpHex(YEL, GRN, (s - 5) / 5);
}

function Chip({
  text,
  bg,
  border,
  color,
  title,
}: {
  text: string;
  bg: string;
  border: string;
  color: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        borderRadius: 999,
        border: `1px solid ${border}`,
        background: bg,
        color,
        padding: "2px 8px",
        fontSize: 12,
        fontWeight: 900,
        lineHeight: 1.2,
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
}

function StatusChip({ value }: { value: string }) {
  const v = norm(value);
  const low = v.toLowerCase();

  // pending => yellow, on staff => green, released/rejected => red
  if (low.includes("pending")) {
    return <Chip text={v || "—"} bg={UI.amberBg} border={UI.amberBorder} color={UI.amberText} />;
  }
  if (low.includes("on staff")) {
    return <Chip text={v || "—"} bg={UI.greenBg} border={UI.greenBorder} color={UI.greenText} />;
  }
  if (low.includes("released") || low.includes("rejected")) {
    return <Chip text={v || "—"} bg={UI.roseBg} border={UI.roseBorder} color={UI.roseText} />;
  }

  return <Chip text={v || "—"} bg={UI.chipBg} border={UI.chipBorder} color={UI.chipText} />;
}

function ScorePill({ score10, title }: { score10: number | null; title?: string }) {
  if (score10 === null) return <span style={{ fontWeight: 900, color: "#94a3b8" }}>—</span>;
  const c = scoreColor10(score10);
  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 46,
        padding: "4px 8px",
        borderRadius: 999,
        border: `1px solid ${c}33`,
        background: `${c}14`,
        color: c,
        fontWeight: 950,
      }}
    >
      {score10.toFixed(1)}
    </span>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  inputMode,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      inputMode={inputMode}
      style={{
        width: "100%",
        padding: "10px 12px",
        borderRadius: 14,
        border: `1px solid ${UI.border}`,
        background: UI.panelBg,
        fontWeight: 800,
        fontSize: 13,
        outline: "none",
      }}
      onFocus={(e) => {
        e.currentTarget.style.borderColor = "#60a5fa";
      }}
      onBlur={(e) => {
        e.currentTarget.style.borderColor = UI.border;
      }}
    />
  );
}

function Select({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: "100%",
        padding: "10px 12px",
        borderRadius: 14,
        border: `1px solid ${UI.border}`,
        background: UI.panelBg,
        fontWeight: 900,
        fontSize: 13,
        cursor: "pointer",
        outline: "none",
      }}
      onFocus={(e) => {
        e.currentTarget.style.borderColor = "#60a5fa";
      }}
      onBlur={(e) => {
        e.currentTarget.style.borderColor = UI.border;
      }}
    >
      {children}
    </select>
  );
}

function Button({
  children,
  onClick,
  disabled,
  variant = "ghost",
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: "ghost" | "primary" | "white" | "outline";
  title?: string;
}) {
  const base: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 14,
    fontWeight: 900,
    fontSize: 13,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
    border: "1px solid transparent",
    background: "transparent",
    color: UI.text,
    userSelect: "none",
    whiteSpace: "nowrap",
  };

  let style: React.CSSProperties = base;

  if (variant === "ghost") {
    style = {
      ...base,
      background: "rgba(255,255,255,0.10)",
      color: "#fff",
      border: "1px solid rgba(255,255,255,0.18)",
    };
  } else if (variant === "white") {
    style = {
      ...base,
      background: "#fff",
      color: "#1e3a8a",
      border: "1px solid rgba(255,255,255,0.65)",
    };
  } else if (variant === "primary") {
    style = {
      ...base,
      background: "#1d4ed8",
      color: "#fff",
      border: "1px solid #1d4ed8",
    };
  } else if (variant === "outline") {
    style = {
      ...base,
      background: "#fff",
      color: UI.text,
      border: `1px solid ${UI.borderSoft}`,
    };
  }

  return (
    <button onClick={onClick} disabled={disabled} style={style} title={title}>
      {children}
    </button>
  );
}

/** Quarter-step options 0..10 for the scoring fields in the drawer (matches sheet) */
function buildQuarterOptions(min = 0, max = 10) {
  const out: number[] = [];
  const start = Math.round(min * 4);
  const end = Math.round(max * 4);
  for (let i = start; i <= end; i++) out.push(i / 4);
  return out;
}
const SCORE_OPTIONS = buildQuarterOptions(0, 10);

function ScoreSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onChange={onChange}>
      <option value="">—</option>
      {SCORE_OPTIONS.map((n) => (
        <option key={n} value={String(n)}>
          {n.toFixed(2)}
        </option>
      ))}
    </Select>
  );
}

function getFirstImpressionValue(r: Record<string, any>) {
  const v = r[COLS.firstImpression];
  if (norm(v)) return v;
  return r[COLS.firstImpressionLegacy];
}

/** Compute score10 from 4 columns; fallback to First Impression (or legacy) */
function computeScoreParts(r: EmployeeRow) {
  const p = parseMaybeNumber(r[COLS.presentation]);
  const e = parseMaybeNumber(r[COLS.experience]);
  const pe = parseMaybeNumber(r[COLS.personality]);
  const rel = parseMaybeNumber(r[COLS.reliability]);

  const nums = [
    { key: "Presentation", val: p },
    { key: "Experience", val: e },
    { key: "Personality", val: pe },
    { key: "Reliability", val: rel },
  ];

  const present = nums.filter((x) => typeof x.val === "number") as Array<{ key: string; val: number }>;

  if (present.length > 0) {
    const avg = present.reduce((a, b) => a + b.val, 0) / present.length;
    const rounded = Math.round(avg * 4) / 4; // .25 increments (0..10)
    return {
      score10: clampNum(rounded, 0, 10),
      breakdown: nums,
      source: "computed" as const,
    };
  }

  const fallback = parseMaybeNumber(getFirstImpressionValue(r));
  if (fallback !== null) {
    return {
      score10: clampNum(fallback, 0, 10),
      breakdown: nums,
      source: "stored" as const,
    };
  }

  return {
    score10: null as number | null,
    breakdown: nums,
    source: "none" as const,
  };
}

function isJunkRow(r: EmployeeRow) {
  // Fix “blank rows with just Age”
  const first = norm(r[COLS.firstName]);
  const last = norm(r[COLS.lastName]);
  const phone = norm(r[COLS.phone]);
  const addr = norm(r[COLS.address]);
  const avail = norm(r[COLS.availability]);
  const loc = norm(r[COLS.location]);
  const cert = norm(r[COLS.certification]);
  const status = norm(r[COLS.status]);
  const notes = norm(r[COLS.interviewNotes]);
  const date = norm(r[COLS.dateInterviewed]);

  const meaningful = first || last || phone || addr || avail || loc || cert || status || notes || date;
  return !meaningful;
}

/** --- Availability chips helpers --- */
function parseAvailabilityChips(raw: string): AvailabilityChip[] {
  const s = norm(raw);
  if (!s) return [];

  const tokens: string[] = s
    .split(/,|;|\||\/|\n/)
    .map((x: string) => x.trim())
    .filter((x: string) => Boolean(x));

  const out: AvailabilityChip[] = [];

  for (const t of tokens) {
    const hit = AVAILABILITY_CHIPS.find((c) => c.toLowerCase() === t.toLowerCase());

    if (hit && !out.includes(hit)) out.push(hit);

    if (!hit && /\bopen\b/i.test(t) && !out.includes("Open")) {
      out.push("Open");
    }

    if (!hit && /cant\s*start\s*right\s*away|can't\s*start\s*right\s*away/i.test(t)) {
      if (!out.includes("Can't start right away")) {
        out.push("Can't start right away");
      }
    }
  }

  return out;
}

function chipsToAvailabilityString(chips: AvailabilityChip[]): string {
  if (!chips || chips.length === 0) return "";
  // If Open is selected, store just "Open" (keeps meaning clean + keeps your filter wildcard logic simple)
  if (chips.includes("Open")) return "Open";
  return chips.join(", ");
}

function ToggleChips({
  selected,
  onChange,
  options,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
  options: readonly string[];
}) {
  function toggle(opt: string) {
    const isOn = selected.includes(opt);
    let next = isOn ? selected.filter((x) => x !== opt) : [...selected, opt];

    // Special behavior for Open:
    // - turning ON Open clears everything else
    // - turning ON any other chip clears Open
    if (opt.toLowerCase() === "open") {
      if (!isOn) next = ["Open"];
    } else {
      next = next.filter((x) => x !== "Open");
    }

    onChange(next);
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {options.map((opt) => {
        const on = selected.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            onClick={() => toggle(opt)}
            style={{
              padding: "8px 10px",
              borderRadius: 999,
              border: `1px solid ${on ? "#2563eb" : UI.borderSoft}`,
              background: on ? "rgba(37,99,235,0.12)" : UI.panelBg,
              color: on ? "#1d4ed8" : UI.text,
              fontWeight: 950,
              fontSize: 12,
              cursor: "pointer",
              userSelect: "none",
              lineHeight: 1,
            }}
            title={on ? "Selected" : "Click to select"}
          >
            {on ? "✓ " : ""}
            {opt}
          </button>
        );
      })}
    </div>
  );
}

/** --- Birth Year / Age helpers --- */
function currentYearNY() {
  // Good enough for UI calc; we store age as whole years.
  return new Date().getFullYear();
}
function deriveBirthYearFromAge(ageVal: any): string {
  const age = parseMaybeNumber(ageVal);
  if (age === null) return "";
  const y = currentYearNY() - Math.round(age);
  if (!Number.isFinite(y) || y < 1900 || y > currentYearNY()) return "";
  return String(y);
}
function ageFromBirthYear(birthYearStr: string): number | null {
  const s = norm(birthYearStr);
  if (!s) return null;
  const y = Number(s);
  const cy = currentYearNY();
  if (!Number.isFinite(y) || y < 1900 || y > cy) return null;
  const age = cy - y;
  if (age < 0 || age > 120) return null;
  return age;
}

export default function ApplicantsPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<EmployeeRow[]>([]);

  const [q, setQ] = useState("");
  const [locationQ, setLocationQ] = useState("");
  const [availabilityQ, setAvailabilityQ] = useState("");

  const [datePreset, setDatePreset] = useState<DatePreset>("All");
  const [statusFilter, setStatusFilter] = useState<string>("All");
  const [scorePreset, setScorePreset] = useState<ScorePreset>("All");

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"edit" | "create">("edit");
  const [activeRow, setActiveRow] = useState<EmployeeRow | null>(null);
  const [draft, setDraft] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);

  // UI-only state for Birth Year (we still save computed Age to the sheet)
  const [birthYear, setBirthYear] = useState<string>("");

  async function load() {
    setLoading(true);
    setErr(null);

    try {
      const res = await fetch("/api/employees", { cache: "no-store" });
      const text = await res.text();
      const data: ApiGetResp = text ? JSON.parse(text) : { ok: false, error: "Empty response" };
      if (!data?.ok) throw new Error(data?.error || "Failed to load");

      const nextHeaders = Array.isArray(data.headers) ? (data.headers as any[]) : [];
      const nextRows = Array.isArray(data.rows) ? (data.rows as any[]) : [];

      setHeaders(nextHeaders.map((h) => (h ?? "").toString().trim()).filter(Boolean));
      setRows(nextRows as EmployeeRow[]);
    } catch (e: any) {
      setErr(e?.message || "Failed to load applicants");
      setHeaders([]);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function clearFilters() {
    setQ("");
    setLocationQ("");
    setAvailabilityQ("");
    setDatePreset("All");
    setStatusFilter("All");
    setScorePreset("All");
  }

  const statusOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => {
      const s = norm(r[COLS.status]);
      if (s) set.add(s);
    });
    return ["All", ...Array.from(set).sort()];
  }, [rows]);

  const formFields = useMemo(() => {
    const hdrSet = new Set(headers);
    const fields: string[] = [];

    // identity/contact
    [COLS.firstName, COLS.lastName, COLS.phone, COLS.phoneType].forEach((c) => {
      if (hdrSet.has(c)) fields.push(c);
    });

    // location/address/availability
    [COLS.location, COLS.address, COLS.availability].forEach((c) => {
      if (hdrSet.has(c)) fields.push(c);
    });

    // misc
    [COLS.certification, COLS.vaccinated, COLS.age, COLS.status].forEach((c) => {
      if (hdrSet.has(c)) fields.push(c);
    });

    if (hdrSet.has(COLS.dateInterviewed)) fields.push(COLS.dateInterviewed);
    if (hdrSet.has(COLS.nameColor)) fields.push(COLS.nameColor);

    // scoring fields
    [COLS.presentation, COLS.experience, COLS.personality, COLS.reliability].forEach((c) => {
      if (hdrSet.has(c)) fields.push(c);
    });

    // First Impression (or legacy if present)
    if (hdrSet.has(COLS.firstImpression)) fields.push(COLS.firstImpression);
    else if (hdrSet.has(COLS.firstImpressionLegacy)) fields.push(COLS.firstImpressionLegacy);

    // notes last
    if (hdrSet.has(COLS.interviewNotes)) fields.push(COLS.interviewNotes);

    return fields;
  }, [headers]);

  function recomputeFirstImpression(nextDraft: Record<string, any>) {
    const p = parseMaybeNumber(nextDraft[COLS.presentation]);
    const e = parseMaybeNumber(nextDraft[COLS.experience]);
    const pe = parseMaybeNumber(nextDraft[COLS.personality]);
    const r = parseMaybeNumber(nextDraft[COLS.reliability]);

    const nums = [p, e, pe, r].filter((x) => typeof x === "number") as number[];
    if (nums.length === 0) return nextDraft;

    const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
    const rounded = Math.round(avg * 4) / 4;

    if (headers.includes(COLS.firstImpression)) {
      nextDraft[COLS.firstImpression] = String(clampNum(rounded, 0, 10));
    } else if (headers.includes(COLS.firstImpressionLegacy)) {
      nextDraft[COLS.firstImpressionLegacy] = String(clampNum(rounded, 0, 10));
    } else {
      nextDraft[COLS.firstImpression] = String(clampNum(rounded, 0, 10));
    }

    return nextDraft;
  }

  // Table columns (the table includes Score + Name plus these)
  const tableCols = useMemo(() => {
    const base = [
      COLS.phone,
      COLS.location,
      COLS.address,
      COLS.availability,
      COLS.certification,
      COLS.vaccinated,
      COLS.age,
      COLS.dateInterviewed,
      COLS.status,
    ] as const;

    const hdrSet = new Set(headers);
    return base.filter((h) => hdrSet.has(h));
  }, [headers]);

  function openEdit(row: EmployeeRow) {
    setMode("edit");
    setActiveRow(row);
    setDraft({ ...row });

    // Seed birthYear from existing Age (best effort)
    setBirthYear(deriveBirthYearFromAge(row[COLS.age]));
    setOpen(true);
  }

  function openCreate() {
    setMode("create");
    setActiveRow(null);

    const blank: Record<string, any> = {};
    headers.forEach((h) => (blank[h] = ""));

    if (headers.includes(COLS.dateInterviewed)) {
      const d = new Date();
      blank[COLS.dateInterviewed] = `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)}`;
    }
    if (headers.includes(COLS.nameColor)) {
      blank[COLS.nameColor] = "Default";
    }
    if (headers.includes(COLS.status) && !blank[COLS.status]) blank[COLS.status] = "Pending";

    setDraft(blank);
    setBirthYear("");
    setOpen(true);
  }

  function closeDrawer() {
    if (saving) return;
    setOpen(false);
    setActiveRow(null);
    setDraft({});
    setBirthYear("");
  }

  async function save() {
    setSaving(true);
    setErr(null);

    try {
      const updates: Record<string, any> = {};
      headers.forEach((h) => {
        updates[h] = draft[h] ?? "";
      });

      if (mode === "create") {
        const res = await fetch("/api/employees", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "create", updates }),
        });
        const text = await res.text();
        const data = text ? JSON.parse(text) : null;
        if (!data?.ok) throw new Error(data?.error || "Create failed");
      } else {
        const rowNumber =
          typeof (draft as any).__rowNumber === "number" ? (draft as any).__rowNumber : activeRow?.__rowNumber;

        const res = await fetch("/api/employees", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "update", rowNumber, updates }),
        });
        const text = await res.text();
        const data = text ? JSON.parse(text) : null;
        if (!data?.ok) throw new Error(data?.error || "Update failed");
      }

      await load();
      closeDrawer();
    } catch (e: any) {
      setErr(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const dateRange = useMemo(() => {
    const now = new Date();
    const today = startOfDay(now);

    if (datePreset === "All") return { min: null as Date | null, maxExcl: null as Date | null };

    if (datePreset === "Last week") {
      const thisSun = startOfWeekSunday(today);
      const min = new Date(thisSun);
      min.setDate(min.getDate() - 7);
      const maxExcl = new Date(thisSun);
      maxExcl.setDate(maxExcl.getDate() + 7);
      return { min, maxExcl };
    }

    if (datePreset === "This month") {
      const min = monthStart(today);
      const maxExcl = monthEndExclusive(today);
      return { min, maxExcl };
    }

    if (datePreset === "Last month") {
      const d = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const min = monthStart(d);
      const maxExcl = monthEndExclusive(d);
      return { min, maxExcl };
    }

    if (datePreset === "Last 3 months") {
      const min = new Date(today.getFullYear(), today.getMonth() - 2, 1);
      const maxExcl = monthEndExclusive(today);
      return { min, maxExcl };
    }

    // This year
    const min = new Date(today.getFullYear(), 0, 1);
    const maxExcl = new Date(today.getFullYear() + 1, 0, 1);
    return { min, maxExcl };
  }, [datePreset]);

  function minScoreFromPreset(p: ScorePreset): number | null {
    if (p === "All") return null;
    const n = Number(p.replace("+", ""));
    return Number.isFinite(n) ? n : null;
  }

  const filtered = useMemo(() => {
    const needle = q.trim();
    const locNeedle = locationQ.trim();
    const availNeedle = availabilityQ.trim();
    const { min, maxExcl } = dateRange;

    const minScore10 = minScoreFromPreset(scorePreset);

    return rows
      .filter((r) => !isJunkRow(r))
      .filter((r) => {
        if (statusFilter !== "All" && norm(r[COLS.status]) !== statusFilter) return false;

        if (min && maxExcl) {
          const d = parseSheetDate(r[COLS.dateInterviewed]);
          if (!d) return false;
          const x = startOfDay(d);
          if (x < min || x >= maxExcl) return false;
        }

        if (minScore10 !== null) {
          const s10 = computeScoreParts(r).score10;
          if (s10 === null) return false;
          if (s10 < minScore10) return false;
        }

        if (locNeedle) {
          const locHay = norm(r[COLS.location]) || norm(r[COLS.address]);
          if (!includesCI(locHay, locNeedle)) return false;
        }

        // availability filter (Open is wildcard)
        if (availNeedle) {
          const aHay = norm(r[COLS.availability]);
          const isOpen = /\bopen\b/i.test(aHay);
          if (!isOpen && !includesCI(aHay, availNeedle)) return false;
        }

        if (!needle) return true;

        const hay =
          [
            r[COLS.firstName],
            r[COLS.lastName],
            r[COLS.phone],
            r[COLS.location],
            r[COLS.address],
            r[COLS.availability],
            r[COLS.certification],
            r[COLS.status],
            r[COLS.interviewNotes],
            r[COLS.presentation],
            r[COLS.experience],
            r[COLS.personality],
            r[COLS.reliability],
            getFirstImpressionValue(r),
          ]
            .map(norm)
            .join(" | ") || "";

        return includesCI(hay, needle);
      });
  }, [rows, q, locationQ, availabilityQ, dateRange, statusFilter, scorePreset]);

  const topStats = useMemo(() => {
    const shown = filtered.length;
    const total = rows.filter((r) => !isJunkRow(r)).length;
    return loading ? "Loading…" : `${shown} shown / ${total} total`;
  }, [filtered.length, rows, loading]);

  // ✅ Top metrics: interviews this month + average score
  const monthMetrics = useMemo(() => {
    const now = new Date();
    const min = monthStart(now);
    const maxExcl = monthEndExclusive(now);

    let count = 0;
    let sum = 0;
    let n = 0;

    rows
      .filter((r) => !isJunkRow(r))
      .forEach((r) => {
        const d = parseSheetDate(r[COLS.dateInterviewed]);
        if (!d) return;
        const x = startOfDay(d);
        if (x < min || x >= maxExcl) return;

        count += 1;

        const s = computeScoreParts(r).score10;
        if (typeof s === "number") {
          sum += s;
          n += 1;
        }
      });

    const avg = n > 0 ? sum / n : null;
    const monthName = now.toLocaleString(undefined, { month: "long" });

    return { monthName, count, avg };
  }, [rows]);

  const metricsHeader = (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <span style={{ color: UI.blueBarSubTextDim, fontWeight: 900, fontSize: 12 }}>
        {monthMetrics.monthName} interviews = {monthMetrics.count}
      </span>
      <span style={{ color: UI.blueBarSubTextDim, fontWeight: 900, fontSize: 12 }}>•</span>
      <span style={{ color: UI.blueBarSubTextDim, fontWeight: 900, fontSize: 12 }}>
        Average score {monthMetrics.avg === null ? "—" : monthMetrics.avg.toFixed(1)}
      </span>
    </div>
  );

  return (
    <div
      style={{
        height: "100vh",
        background: UI.pageBg,
        color: UI.text,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* TOP BLUE BAR */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 40,
          background: UI.blueBar,
          borderBottom: "1px solid rgba(30,58,138,0.20)",
        }}
      >
        {/* ✅ Better spacing + prevents overlap by allowing actions to wrap cleanly */}
        <div
          style={{
            padding: "14px 16px",
            display: "flex",
            flexWrap: "wrap",
            gap: 14,
            alignItems: "flex-start",
          }}
        >
          {/* Left: title */}
          <div style={{ minWidth: 260, flex: "1 1 260px" }}>
            <div style={{ fontSize: 20, fontWeight: 950, color: UI.blueBarText }}>Applicants</div>
            <div style={{ marginTop: 4, fontSize: 13, color: UI.blueBarSubText }}>
              Employee Information → <span style={{ fontWeight: 900 }}>Info</span>
              <span style={{ marginLeft: 10, color: UI.blueBarSubTextDim, fontWeight: 800 }}>{topStats}</span>
            </div>
            <div style={{ marginTop: 10 }}>{metricsHeader}</div>
          </div>

          {/* Middle: filters */}
          <div
            style={{
              flex: "2 1 700px",
              minWidth: 420,
              display: "grid",
              gridTemplateColumns:
                "minmax(240px, 2fr) minmax(160px, 1fr) minmax(180px, 1fr) minmax(150px, 1fr) minmax(150px, 1fr) minmax(150px, 1fr)",
              gap: 10,
              alignItems: "center",
            }}
          >
            <TextInput value={q} onChange={setQ} placeholder="Search name, phone, notes, certification…" />
            <TextInput value={locationQ} onChange={setLocationQ} placeholder="Location filter…" />
            <TextInput value={availabilityQ} onChange={setAvailabilityQ} placeholder="Availability filter…" />

            <Select value={datePreset} onChange={(v) => setDatePreset(v as DatePreset)}>
              {(["Last week", "This month", "Last month", "Last 3 months", "This year", "All"] as DatePreset[]).map(
                (p) => (
                  <option key={p} value={p}>
                    Dates: {p}
                  </option>
                )
              )}
            </Select>

            <Select value={statusFilter} onChange={setStatusFilter}>
              {statusOptions.map((s) => (
                <option key={s} value={s}>
                  Status: {s}
                </option>
              ))}
            </Select>

            <Select value={scorePreset} onChange={(v) => setScorePreset(v as ScorePreset)}>
              {(["All", "9+", "8+", "7+", "6+", "5+", "4+", "2+", "0+"] as ScorePreset[]).map((p) => (
                <option key={p} value={p}>
                  Score: {p === "All" ? "All" : `≥ ${p.replace("+", "")}`}
                </option>
              ))}
            </Select>
          </div>

          {/* Right: actions (wraps below instead of overlapping) */}
          <div
            style={{
              flex: "1 1 360px",
              minWidth: 320,
              display: "flex",
              gap: 10,
              alignItems: "center",
              justifyContent: "flex-end",
            }}
          >
            <Button onClick={() => router.push("/schedule")} disabled={saving} variant="ghost" title="Back to Schedule">
              ← Back
            </Button>

            <Button onClick={clearFilters} disabled={loading} variant="ghost" title="Reset all filters">
              Clear filters
            </Button>
            <Button onClick={load} disabled={loading} variant="ghost">
              Refresh
            </Button>
            <Button onClick={openCreate} disabled={loading} variant="white">
              + Add Applicant
            </Button>
          </div>
        </div>
      </div>

      {/* Error */}
      {err ? (
        <div style={{ padding: "12px 16px 0" }}>
          <div
            style={{
              borderRadius: 14,
              border: "1px solid #fecdd3",
              background: "#fff1f2",
              color: "#9f1239",
              padding: "10px 12px",
              fontWeight: 900,
              fontSize: 13,
            }}
          >
            {err}
          </div>
        </div>
      ) : null}

      {/* TABLE AREA */}
      <div style={{ flex: 1, minHeight: 0, padding: 16 }}>
        <div
          style={{
            height: "100%",
            overflow: "hidden",
            borderRadius: 14,
            border: `1px solid ${UI.borderSoft}`,
            background: UI.panelBg,
            boxShadow: "0 1px 2px rgba(15,23,42,0.08)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div style={{ flex: 1, minHeight: 0, overflowX: "auto" }}>
            <div style={{ height: "100%", overflowY: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "separate",
                  borderSpacing: 0,
                  fontSize: 13,
                  tableLayout: "fixed",
                }}
              >
                <colgroup>
                  {[
                    <col key="score" style={{ width: 92 }} />,
                    <col key="name" style={{ width: 210 }} />,
                    <col key="phone" style={{ width: 150 }} />,
                    headers.includes(COLS.location) ? <col key="loc" style={{ width: 140 }} /> : null,
                    headers.includes(COLS.address) ? <col key="addr" style={{ width: 260 }} /> : null,
                    headers.includes(COLS.availability) ? <col key="avail" style={{ width: 240 }} /> : null,
                    headers.includes(COLS.certification) ? <col key="cert" style={{ width: 110 }} /> : null,
                    headers.includes(COLS.vaccinated) ? <col key="vax" style={{ width: 110 }} /> : null,
                    headers.includes(COLS.age) ? <col key="age" style={{ width: 80 }} /> : null,
                    headers.includes(COLS.dateInterviewed) ? <col key="di" style={{ width: 180 }} /> : null,
                    headers.includes(COLS.status) ? <col key="status" style={{ width: 150 }} /> : null,
                  ].filter(Boolean)}
                </colgroup>

                <thead
                  style={{
                    position: "sticky",
                    top: 0,
                    zIndex: 10,
                    background: UI.blueHeader,
                    backdropFilter: "blur(6px)",
                  }}
                >
                  <tr>
                    <th
                      style={{
                        textAlign: "left",
                        padding: "12px 10px",
                        fontSize: 11,
                        fontWeight: 950,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        color: "#dbeafe",
                        borderBottom: `1px solid ${UI.blueHeaderBorder}`,
                        borderRight: "1px solid rgba(30,58,138,0.15)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Score
                    </th>

                    <th
                      style={{
                        textAlign: "left",
                        padding: "12px 10px",
                        fontSize: 11,
                        fontWeight: 950,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        color: "#dbeafe",
                        borderBottom: `1px solid ${UI.blueHeaderBorder}`,
                        borderRight: "1px solid rgba(30,58,138,0.15)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Name
                    </th>

                    {tableCols.map((h) => (
                      <th
                        key={h}
                        style={{
                          textAlign: "left",
                          padding: "12px 10px",
                          fontSize: 11,
                          fontWeight: 950,
                          letterSpacing: "0.06em",
                          textTransform: "uppercase",
                          color: "#dbeafe",
                          borderBottom: `1px solid ${UI.blueHeaderBorder}`,
                          borderRight: "1px solid rgba(30,58,138,0.15)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={999} style={{ padding: "28px 14px", color: UI.textDim }}>
                        Loading…
                      </td>
                    </tr>
                  ) : filtered.length === 0 ? (
                    <tr>
                      <td colSpan={999} style={{ padding: "28px 14px", color: UI.textDim }}>
                        No applicants match your filters.
                      </td>
                    </tr>
                  ) : (
                    filtered.map((r, idx) => {
                      const bg = idx % 2 === 0 ? "#ffffff" : UI.zebra;
                      const rowKey = `row_${r.__rowNumber}_${idx}`;

                      const tdBase: React.CSSProperties = {
                        padding: "12px 10px",
                        borderBottom: "1px solid rgba(226,232,240,0.70)",
                        borderRight: "1px solid rgba(226,232,240,0.55)",
                        whiteSpace: "nowrap",
                        verticalAlign: "middle",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      };

                      const scoreInfo = computeScoreParts(r);
                      const score10 = scoreInfo.score10;

                      const scoreTooltip =
                        `Presentation: ${scoreInfo.breakdown[0].val ?? "—"}\n` +
                        `Experience: ${scoreInfo.breakdown[1].val ?? "—"}\n` +
                        `Personality: ${scoreInfo.breakdown[2].val ?? "—"}\n` +
                        `Reliability: ${scoreInfo.breakdown[3].val ?? "—"}\n` +
                        (scoreInfo.source === "computed"
                          ? "Score: computed average"
                          : scoreInfo.source === "stored"
                          ? "Score: from First Impression column"
                          : "Score: no data") +
                        (score10 !== null ? `\nDisplayed: ${score10.toFixed(1)} / 10` : "");

                      const name = `${norm(r[COLS.firstName])} ${norm(r[COLS.lastName])}`.trim() || "—";
                      const colorKey = norm(r[COLS.nameColor]) || "Default";
                      const nameColor = UI.nameColors[colorKey] || UI.nameColors.Default;

                      const notesTooltip = norm(r[COLS.interviewNotes]) || "No interview notes";

                      return (
                        <tr
                          key={rowKey}
                          onClick={() => openEdit(r)}
                          style={{
                            cursor: "pointer",
                            background: bg,
                            transition: "background 120ms ease",
                          }}
                          onMouseEnter={(e) => {
                            (e.currentTarget as HTMLTableRowElement).style.background = UI.hoverRow;
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget as HTMLTableRowElement).style.background = bg;
                          }}
                        >
                          <td style={{ ...tdBase }} title={scoreTooltip}>
                            <ScorePill score10={score10} title={scoreTooltip} />
                          </td>

                          <td style={tdBase} title={notesTooltip}>
                            <span style={{ fontWeight: 950, color: nameColor }}>{name}</span>
                          </td>

                          {tableCols.map((h) => {
                            const v = norm(r[h]);

                            if (h === COLS.status) {
                              return (
                                <td key={h} style={tdBase}>
                                  <StatusChip value={v} />
                                </td>
                              );
                            }

                            if (h === COLS.dateInterviewed) {
                              const d = parseSheetDate(v);
                              if (!d) {
                                return (
                                  <td key={h} style={{ ...tdBase, color: "#94a3b8", fontWeight: 800 }} title={v || ""}>
                                    {v || "—"}
                                  </td>
                                );
                              }
                              const days = diffDaysFromToday(d);
                              const ago = formatAgoFromDays(days);
                              const shown = `${formatMDY(d)} (${ago})`;
                              return (
                                <td key={h} style={{ ...tdBase, color: UI.text, fontWeight: 900 }} title={shown}>
                                  {shown}
                                </td>
                              );
                            }

                            return (
                              <td
                                key={h}
                                style={{ ...tdBase, color: v ? UI.text : "#94a3b8", fontWeight: 800 }}
                                title={v}
                              >
                                {v || "—"}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* bottom bar */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "10px 14px",
              borderTop: `1px solid ${UI.borderSoft}`,
              background: UI.panelBg,
              color: UI.textDim,
              fontSize: 12,
              fontWeight: 800,
            }}
          >
            <div>{topStats}</div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span>Hover Score for breakdown • Hover Name for notes • Click a row to edit</span>
            </div>
          </div>
        </div>
      </div>

      {/* Drawer */}
      {open ? (
        <div style={{ position: "fixed", inset: 0, zIndex: 50 }}>
          <div style={{ position: "absolute", inset: 0, background: UI.overlay }} onClick={closeDrawer} />
          <div
            style={{
              position: "absolute",
              right: 0,
              top: 0,
              height: "100%",
              width: "100%",
              maxWidth: 860,
              background: UI.panelBg,
              borderLeft: `1px solid ${UI.borderSoft}`,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                alignItems: "center",
                padding: "14px 16px",
                borderBottom: `1px solid ${UI.borderSoft}`,
              }}
            >
              <div style={{ minWidth: 220 }}>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 950,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: UI.textDim,
                  }}
                >
                  {mode === "create" ? "New Applicant" : "Edit Applicant"}
                </div>

                <div style={{ marginTop: 6, fontSize: 18, fontWeight: 950, color: UI.text }}>
                  {mode === "create"
                    ? "Add to Applicant Tracker"
                    : `${norm(draft[COLS.firstName])} ${norm(draft[COLS.lastName])}`.trim() || "Applicant"}
                </div>

                {mode === "edit" ? (
                  <div style={{ marginTop: 6, fontSize: 12, color: UI.textDim, fontWeight: 800 }}>
                    Row {activeRow?.__rowNumber ?? (draft as any).__rowNumber ?? "?"}
                  </div>
                ) : null}
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Button onClick={closeDrawer} disabled={saving} variant="outline">
                  Close
                </Button>
                <Button onClick={save} disabled={saving} variant="primary">
                  {saving ? "Saving…" : "Save"}
                </Button>
              </div>
            </div>

            <div style={{ height: "calc(100% - 72px)", overflow: "auto", padding: 16 }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: 14,
                }}
              >
                {formFields.length === 0 ? (
                  <div style={{ gridColumn: "1 / -1", color: UI.textDim, fontWeight: 800 }}>
                    No editable fields found — check sheet headers loaded correctly.
                  </div>
                ) : null}

                {formFields.map((h) => {
                  const v = draft[h] ?? "";
                  const lower = h.toLowerCase();

                  const isNotes = h === COLS.interviewNotes || lower.includes("notes");

                  const isScore =
                    h === COLS.presentation ||
                    h === COLS.experience ||
                    h === COLS.personality ||
                    h === COLS.reliability;

                  const isFirstImpression = h === COLS.firstImpression || h === COLS.firstImpressionLegacy;
                  const isNameColor = h === COLS.nameColor;

                  const isAvailability = h === COLS.availability;
                  const isAge = h === COLS.age;
                  const isWideText =
                    isNotes || h === COLS.address || h === COLS.location; // ✅ Availability no longer a textarea

                  // --- Availability chips state (derived from draft value) ---
                  const selectedAvail = isAvailability ? parseAvailabilityChips(String(v ?? "")) : [];

                  // --- Birth year / age UI ---
                  const computedAge = ageFromBirthYear(birthYear);

                  return (
                    <label key={h} style={{ gridColumn: isWideText || isAvailability ? "1 / -1" : undefined }}>
                      <div style={{ fontSize: 12, fontWeight: 950, color: UI.textDim, marginBottom: 6 }}>
                        {isAge ? "Birth Year" : h}
                      </div>

                      {/* Name Color */}
                      {isNameColor ? (
                        <Select
                          value={String(v || "Default")}
                          onChange={(val) =>
                            setDraft((d) => ({
                              ...d,
                              [h]: val,
                            }))
                          }
                        >
                          {NAME_COLOR_OPTIONS.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </Select>
                      ) : null}

                      {/* Availability chips (instead of a textbox) */}
                      {isAvailability ? (
                        <div>
                          <ToggleChips
                            options={AVAILABILITY_CHIPS}
                            selected={selectedAvail}
                            onChange={(next) => {
                              const nextStr = chipsToAvailabilityString(next as AvailabilityChip[]);
                              setDraft((d) => ({ ...d, [COLS.availability]: nextStr }));
                            }}
                          />
                          <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                            <div style={{ fontSize: 12, fontWeight: 900, color: UI.textDim }}>
                              Saved as:{" "}
                              <span style={{ color: UI.text }}>
                                {norm(draft[COLS.availability]) ? norm(draft[COLS.availability]) : "—"}
                              </span>
                            </div>
                            <div style={{ fontSize: 12, fontWeight: 800, color: UI.textDim }}>
                              Tip: selecting <b>Open</b> overrides other options.
                            </div>
                          </div>
                        </div>
                      ) : null}

                      {/* Age -> Birth Year input, auto-calc Age */}
                      {isAge ? (
                        <div style={{ display: "grid", gridTemplateColumns: "minmax(160px, 220px) 1fr", gap: 12 }}>
                          <div>
                            <TextInput
                              value={birthYear}
                              onChange={(val) => {
                                const cleaned = val.replace(/[^\d]/g, "").slice(0, 4);
                                setBirthYear(cleaned);

                                const age = ageFromBirthYear(cleaned);
                                // Save computed Age to the sheet column
                                setDraft((d) => ({ ...d, [COLS.age]: age === null ? "" : String(age) }));
                              }}
                              placeholder="e.g. 1995"
                              inputMode="numeric"
                            />
                          </div>
                          <div
                            style={{
                              borderRadius: 14,
                              border: `1px solid ${UI.borderSoft}`,
                              background: "#f8fafc",
                              padding: "10px 12px",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 10,
                            }}
                          >
                            <div style={{ fontSize: 12, fontWeight: 900, color: UI.textDim }}>Calculated Age</div>
                            <div style={{ fontWeight: 950, color: computedAge === null ? "#94a3b8" : UI.text }}>
                              {computedAge === null ? "—" : `${computedAge}`}
                            </div>
                          </div>
                        </div>
                      ) : null}

                      {/* Score dropdowns (.25) */}
                      {isScore ? (
                        <ScoreSelect
                          value={String(v ?? "")}
                          onChange={(val) =>
                            setDraft((d) => {
                              const next = { ...d, [h]: val };
                              return { ...recomputeFirstImpression(next) };
                            })
                          }
                        />
                      ) : null}

                      {/* First Impression (editable, and auto-updates when scores change) */}
                      {isFirstImpression ? (
                        <TextInput
                          value={String(v ?? "")}
                          onChange={(val) => setDraft((d) => ({ ...d, [h]: val }))}
                          placeholder="Auto-calculated"
                        />
                      ) : null}

                      {/* Notes textarea */}
                      {isNotes ? (
                        <textarea
                          value={String(v ?? "")}
                          onChange={(e) => setDraft((d) => ({ ...d, [h]: e.target.value }))}
                          style={{
                            width: "100%",
                            minHeight: 140,
                            resize: "vertical",
                            padding: "10px 12px",
                            borderRadius: 14,
                            border: `1px solid ${UI.border}`,
                            background: UI.panelBg,
                            fontWeight: 800,
                            fontSize: 13,
                            outline: "none",
                          }}
                          onFocus={(e) => {
                            e.currentTarget.style.borderColor = "#60a5fa";
                          }}
                          onBlur={(e) => {
                            e.currentTarget.style.borderColor = UI.border;
                          }}
                        />
                      ) : null}

                      {/* Wide text fields */}
                      {!isNameColor && !isScore && !isFirstImpression && !isNotes && !isAvailability && !isAge && isWideText ? (
                        <textarea
                          value={String(v ?? "")}
                          onChange={(e) => setDraft((d) => ({ ...d, [h]: e.target.value }))}
                          style={{
                            width: "100%",
                            minHeight: 90,
                            resize: "vertical",
                            padding: "10px 12px",
                            borderRadius: 14,
                            border: `1px solid ${UI.border}`,
                            background: UI.panelBg,
                            fontWeight: 800,
                            fontSize: 13,
                            outline: "none",
                          }}
                          onFocus={(e) => {
                            e.currentTarget.style.borderColor = "#60a5fa";
                          }}
                          onBlur={(e) => {
                            e.currentTarget.style.borderColor = UI.border;
                          }}
                        />
                      ) : null}

                      {/* Default input */}
                      {!isNameColor && !isScore && !isFirstImpression && !isNotes && !isWideText && !isAvailability && !isAge ? (
                        <TextInput value={String(v ?? "")} onChange={(val) => setDraft((d) => ({ ...d, [h]: val }))} />
                      ) : null}

                      {/* Helper text for Birth Year */}
                      {isAge ? (
                        <div style={{ marginTop: 8, color: UI.textDim, fontSize: 12, fontWeight: 800 }}>
                          We store <b>Age</b> in the sheet, but you enter <b>Birth Year</b> here.
                        </div>
                      ) : null}
                    </label>
                  );
                })}
              </div>

              <div style={{ marginTop: 14, color: UI.textDim, fontSize: 12, fontWeight: 800 }}>
                First Impression auto-updates when you change Presentation/Experience/Personality/Reliability.
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
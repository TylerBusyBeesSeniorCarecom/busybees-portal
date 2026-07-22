// app/api/historical-weeks/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type HistoricalRow = {
  date: string;
  startTime?: string;
  endTime?: string;
  status?: string;
};

function norm(v: any) {
  return (v ?? "").toString().trim();
}

function toDateSafe(dateStr: string): Date | null {
  const raw = norm(dateStr);
  if (!raw) return null;

  const d0 = new Date(raw);
  if (!Number.isNaN(d0.getTime())) return d0;

  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;

  const mm = parseInt(m[1], 10);
  const dd = parseInt(m[2], 10);
  const yyyy = parseInt(m[3], 10);
  const d = new Date(yyyy, mm - 1, dd);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfSundayWeek(d: Date) {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  out.setDate(out.getDate() - out.getDay());
  return out;
}

function addDays(d: Date, days: number) {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

function ymd(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function mdyyyy(d: Date) {
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

function toInt(v: string | null, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : fallback;
}

/** ---- hours helpers ---- */

function parseTimeToMinutes(t: string): number | null {
  const raw = norm(t);
  if (!raw) return null;

  const normalized = raw.replace(/\s+/g, " ").replace(/([AP]M)$/i, " $1").trim();
  const m = normalized.match(/^(\d{1,2})(?::(\d{2}))?\s*([AP]M)$/i);
  if (!m) return null;

  let hh = parseInt(m[1], 10);
  const mm = m[2] ? parseInt(m[2], 10) : 0;
  const ap = m[3].toUpperCase();

  if (hh < 1 || hh > 12 || mm < 0 || mm > 59) return null;

  if (ap === "AM") {
    if (hh === 12) hh = 0;
  } else {
    if (hh !== 12) hh += 12;
  }
  return hh * 60 + mm;
}

function shiftDurationHours(startTime: string, endTime: string): number {
  const start = parseTimeToMinutes(startTime);
  const end0 = parseTimeToMinutes(endTime);
  if (start == null || end0 == null) return 0;

  let end = end0;
  if (end <= start) end += 24 * 60; // overnight
  return Math.max(0, (end - start) / 60);
}

function isFilled(statusRaw: string): boolean {
  return norm(statusRaw).toLowerCase().includes("filled");
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const tailWeeks = toInt(url.searchParams.get("tailWeeks"), 12); // ✅ default: 12 weeks

    // IMPORTANT: server-side fetch must be ABSOLUTE
    const origin = url.origin;

    const res = await fetch(`${origin}/api/historical-data?tailWeeks=${tailWeeks}&limit=20000`, {
      cache: "no-store",
      headers: {
        cookie: req.headers.get("cookie") || "",
      },
    });
    const j = await res.json();

    if (!res.ok || !j?.ok) {
      return NextResponse.json(
        { ok: false, error: j?.error || `Failed to read historical-data (${res.status})` },
        { status: 500 }
      );
    }

    const rows = (j.rows || []) as HistoricalRow[];

    const bucket = new Map<
      string,
      { weekStart: string; weekEnd: string; label: string; count: number; filledHours: number; lastDate: string }
    >();

    for (const r of rows) {
      const d = toDateSafe(r.date);
      if (!d) continue;

      const ws = startOfSundayWeek(d);
      const we = addDays(ws, 6);

      const key = ymd(ws);
      const lastDate = ymd(d);
      const label = `${mdyyyy(ws)} - ${mdyyyy(we)}`;

      const hrs = isFilled(r.status || "") ? shiftDurationHours(norm(r.startTime), norm(r.endTime)) : 0;

      const existing = bucket.get(key);
      if (!existing) {
        bucket.set(key, {
          weekStart: key,
          weekEnd: ymd(we),
          label,
          count: 1,
          filledHours: hrs,
          lastDate,
        });
      } else {
        existing.count += 1;
        existing.filledHours += hrs;
        if (lastDate > existing.lastDate) existing.lastDate = lastDate;
      }
    }

    // Most recent first
    const weeks = Array.from(bucket.values()).sort((a, b) => b.weekStart.localeCompare(a.weekStart));

    return NextResponse.json({
      ok: true,
      meta: { tailWeeks, computedFrom: "tail slice (bottom of sheet)" },
      weeks,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Unknown error" }, { status: 500 });
  }
}

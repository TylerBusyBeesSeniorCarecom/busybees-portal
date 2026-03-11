import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function getBase() {
  const base = process.env.CURRENT_WEEK_API_URL;
  if (!base) throw new Error("Missing CURRENT_WEEK_API_URL");
  return base;
}

export async function GET(req: Request) {
  try {
    const base = getBase();
    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "getCurrentWeekGrid";

    const r = await fetch(`${base}?action=${encodeURIComponent(action)}`, {
      cache: "no-store",
    });

    const text = await r.text();
    // Apps Script always returns JSON, but keep this safe:
    const data = text ? JSON.parse(text) : null;

    return NextResponse.json(data, { status: r.ok ? 200 : 500 });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const base = getBase();
    const body = await req.json();

    const r = await fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const text = await r.text();
    const data = text ? JSON.parse(text) : null;

    return NextResponse.json(data, { status: r.ok ? 200 : 500 });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function getBaseUrl() {
  const url = process.env.MESSAGES_API_URL;
  if (!url) throw new Error("Missing MESSAGES_API_URL");
  return url;
}

export async function GET(req: Request) {
  try {
    const base = getBaseUrl();
    const { searchParams } = new URL(req.url);

    // Forward ALL query params (e.g. action=..., viewerId=..., caregiverId=...)
    const url = new URL(base);
    searchParams.forEach((v, k) => url.searchParams.set(k, v));

    const r = await fetch(url.toString(), {
      method: "GET",
      cache: "no-store",
    });

    const text = await r.text();

    // Apps Script returns JSON but sometimes as text; pass-through safely
    return new NextResponse(text, {
      status: r.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const base = getBaseUrl();
    const body = await req.text(); // keep raw

    const r = await fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      cache: "no-store",
    });

    const text = await r.text();

    return new NextResponse(text, {
      status: r.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}
